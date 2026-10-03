import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { CreateBillingEntityBody } from '@shop/contracts/trade-account';
import { closeDatabase, openDatabase } from '../../src/db/index.js';
import { createUnitOfWork } from '../../src/db/unitOfWork.js';
import { createBillingEntityRepository } from '../../src/features/tradeAccount/billingEntityRepository.js';
import {
  createBillingEntityService,
  MAX_BILLING_ENTITIES_PER_USER,
  type BillingEntityService,
} from '../../src/features/tradeAccount/billingEntityService.js';

const CLOCK = { now: () => new Date('2026-07-26T09:00:00.000Z') };

function createUser(db: import('better-sqlite3').Database, email: string): number {
  const result = db
    .prepare(
      `INSERT INTO users (email, display_name, password_hash, password_salt, role, created_at)
       VALUES (?, 'Trade Test', 'hash', '', 'customer', '2026-07-26T09:00:00.000Z')`,
    )
    .run(email);
  return Number(result.lastInsertRowid);
}

function entityBody(overrides: Partial<CreateBillingEntityBody> = {}): CreateBillingEntityBody {
  return {
    legalName: 'Northgate Builders Ltd',
    registrationNumber: '09876543',
    vatNumber: 'GB123456789',
    address: {
      line1: '4 Kiln Street',
      city: 'Leeds',
      postcode: 'ls1 4ap',
      countryCode: 'GB',
    },
    ...overrides,
  };
}

function unwrap<T>(result: { ok: true; value: T } | { ok: false; code: string }): T {
  if (!result.ok) throw new Error(`Expected success, got ${result.code}`);
  return result.value;
}

void test('billing entity trade account integration', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'shop-billing-entities-'));
  const dbPath = join(dir, 'shop.db');
  const db = openDatabase({ path: dbPath });

  t.after(() => {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  });

  const repository = createBillingEntityRepository(db);
  const service: BillingEntityService = createBillingEntityService({
    repository,
    unitOfWork: createUnitOfWork(db),
    clock: CLOCK,
  });

  /** Live defaults owned by one test user. Scoped by user id: the database carries other rows. */
  const activeDefaultCount = (userId: number): number => {
    const row = db
      .prepare(
        'SELECT COUNT(*) AS total FROM billing_entities WHERE user_id = ? AND is_default = 1 AND active = 1',
      )
      .get(userId) as { total: number };
    return row.total;
  };

  await t.test('create normalizes the record and makes the first entity the default', () => {
    const userId = createUser(db, 'billing-create@example.test');
    const entity = unwrap(
      service.create(
        userId,
        entityBody({
          legalName: '  Northgate   Builders   Ltd  ',
          registrationNumber: ' 09876543 ',
          address: {
            line1: ' 4 Kiln Street ',
            line2: '   ',
            city: 'Leeds',
            region: '  ',
            postcode: ' ls1 4ap ',
            countryCode: 'gb',
          },
        }),
      ),
    );

    assert.equal(entity.legalName, 'Northgate Builders Ltd');
    assert.equal(entity.registrationNumber, '09876543');
    assert.equal(entity.vatNumber, 'GB123456789');
    assert.equal(entity.address.line1, '4 Kiln Street');
    // whitespace-only optional parts are stored as NULL, so they are absent from the contract shape
    assert.equal(entity.address.line2, undefined);
    assert.equal(entity.address.region, undefined);
    assert.equal(entity.address.postcode, 'LS1 4AP');
    assert.equal(entity.address.countryCode, 'GB');
    assert.equal(entity.isDefault, true);
    assert.equal(entity.active, true);
    assert.match(entity.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.equal(activeDefaultCount(userId), 1);
  });

  await t.test('omitted optional identifiers persist as null, not empty strings', () => {
    const userId = createUser(db, 'billing-optional@example.test');
    const entity = unwrap(
      service.create(userId, {
        legalName: 'Sole Trader Yard',
        address: entityBody().address,
      }),
    );
    assert.equal(entity.registrationNumber, null);
    assert.equal(entity.vatNumber, null);
  });

  await t.test('setting a new default clears the prior one in one transaction', () => {
    const userId = createUser(db, 'billing-default@example.test');
    const first = unwrap(service.create(userId, entityBody({ legalName: 'Entity A' })));
    const second = unwrap(service.create(userId, entityBody({ legalName: 'Entity B' })));
    assert.equal(second.isDefault, false);

    const promoted = unwrap(service.setDefault(userId, Number(second.id)));
    assert.equal(promoted.isDefault, true);
    assert.equal(activeDefaultCount(userId), 1);
    assert.equal(unwrap(service.get(userId, Number(first.id))).isDefault, false);

    // create with isDefault also swaps rather than adding a second default
    const third = unwrap(
      service.create(userId, entityBody({ legalName: 'Entity C', isDefault: true })),
    );
    assert.equal(third.isDefault, true);
    assert.equal(activeDefaultCount(userId), 1);
    assert.equal(unwrap(service.get(userId, Number(second.id))).isDefault, false);
  });

  await t.test('a failed default swap rolls back, leaving the prior default intact', () => {
    const userId = createUser(db, 'billing-rollback@example.test');
    const first = unwrap(service.create(userId, entityBody({ legalName: 'Entity A' })));
    const second = unwrap(service.create(userId, entityBody({ legalName: 'Entity B' })));

    const failing = createBillingEntityService({
      repository: {
        ...repository,
        markDefault() {
          throw new Error('swap interrupted');
        },
      },
      unitOfWork: createUnitOfWork(db),
      clock: CLOCK,
    });
    assert.throws(() => failing.setDefault(userId, Number(second.id)), /swap interrupted/);

    assert.equal(activeDefaultCount(userId), 1);
    assert.equal(unwrap(service.get(userId, Number(first.id))).isDefault, true);
    assert.equal(unwrap(service.get(userId, Number(second.id))).isDefault, false);
  });

  await t.test('another user id is not found and never leaks the row', () => {
    const ownerId = createUser(db, 'billing-owner@example.test');
    const intruderId = createUser(db, 'billing-intruder@example.test');
    const owned = unwrap(service.create(ownerId, entityBody({ legalName: 'Owner Holdings' })));
    const entityId = Number(owned.id);

    for (const result of [
      service.get(intruderId, entityId),
      service.update(intruderId, entityId, { legalName: 'Stolen Holdings' }),
      service.setDefault(intruderId, entityId),
      service.retire(intruderId, entityId),
    ]) {
      assert.equal(result.ok, false);
      if (result.ok) throw new Error('Expected failure');
      assert.equal(result.code, 'BILLING_ENTITY_NOT_FOUND');
    }
    assert.equal(service.findForOrderHydration(intruderId, entityId), null);
    assert.deepEqual(service.list(intruderId), []);
    // owner row untouched by the rejected writes
    const stillOwned = unwrap(service.get(ownerId, entityId));
    assert.equal(stillOwned.legalName, 'Owner Holdings');
    assert.equal(stillOwned.isDefault, true);
    assert.equal(stillOwned.active, true);
  });

  await t.test('duplicate legal names are rejected case-insensitively', () => {
    const userId = createUser(db, 'billing-duplicate@example.test');
    unwrap(service.create(userId, entityBody({ legalName: 'Kiln Works Ltd' })));

    const duplicate = service.create(userId, entityBody({ legalName: 'kiln works ltd' }));
    assert.equal(duplicate.ok, false);
    if (duplicate.ok) throw new Error('Expected failure');
    assert.equal(duplicate.code, 'DUPLICATE_LEGAL_NAME');

    const other = unwrap(service.create(userId, entityBody({ legalName: 'Kiln Works North' })));
    const renameClash = service.update(userId, Number(other.id), { legalName: 'Kiln Works Ltd' });
    assert.equal(renameClash.ok, false);
    if (renameClash.ok) throw new Error('Expected failure');
    assert.equal(renameClash.code, 'DUPLICATE_LEGAL_NAME');

    // renaming an entity to its own legal name is not a duplicate
    assert.equal(
      unwrap(service.update(userId, Number(other.id), { legalName: 'Kiln Works North' })).legalName,
      'Kiln Works North',
    );
  });

  await t.test('a legal name held by another user does not block this one', () => {
    const firstUserId = createUser(db, 'billing-shared-name-a@example.test');
    const secondUserId = createUser(db, 'billing-shared-name-b@example.test');
    unwrap(service.create(firstUserId, entityBody({ legalName: 'Shared Name Ltd' })));
    assert.equal(
      unwrap(service.create(secondUserId, entityBody({ legalName: 'Shared Name Ltd' }))).legalName,
      'Shared Name Ltd',
    );
  });

  await t.test('a retired legal name is reusable by the same user', () => {
    const userId = createUser(db, 'billing-reuse@example.test');
    const first = unwrap(service.create(userId, entityBody({ legalName: 'Reused Holdings' })));
    unwrap(service.retire(userId, Number(first.id)));

    // uniqueness is scoped to live rows only, so the name is free again
    const replacement = unwrap(
      service.create(userId, entityBody({ legalName: 'Reused Holdings' })),
    );
    assert.notEqual(replacement.id, first.id);
    assert.equal(replacement.active, true);
    // the retired row survives alongside the new one
    const retired = service.findForOrderHydration(userId, Number(first.id));
    assert.ok(retired);
    assert.equal(retired.active, false);
  });

  await t.test(
    'retired entities leave the list, stay resolvable, and hand over the default',
    () => {
      const userId = createUser(db, 'billing-retire@example.test');
      const first = unwrap(service.create(userId, entityBody({ legalName: 'Entity A' })));
      const second = unwrap(service.create(userId, entityBody({ legalName: 'Entity B' })));
      assert.equal(first.isDefault, true);

      unwrap(service.retire(userId, Number(first.id)));

      assert.deepEqual(
        service.list(userId).map((entity) => entity.legalName),
        ['Entity B'],
      );
      // order hydration still resolves the retired entity by id
      const hydrated = service.findForOrderHydration(userId, Number(first.id));
      assert.ok(hydrated);
      assert.equal(hydrated.active, false);
      assert.equal(hydrated.legalName, 'Entity A');
      // retired row is not a selectable billing party
      const live = service.get(userId, Number(first.id));
      assert.equal(live.ok, false);
      if (live.ok) throw new Error('Expected failure');
      assert.equal(live.code, 'BILLING_ENTITY_NOT_FOUND');

      assert.equal(unwrap(service.get(userId, Number(second.id))).isDefault, true);
      assert.equal(activeDefaultCount(userId), 1);

      // retiring the last entity leaves no default and no rows to list
      unwrap(service.retire(userId, Number(second.id)));
      assert.deepEqual(service.list(userId), []);
      assert.equal(activeDefaultCount(userId), 0);
    },
  );

  await t.test('the per-user cap counts live entities only', () => {
    const userId = createUser(db, 'billing-cap@example.test');
    for (let index = 0; index < MAX_BILLING_ENTITIES_PER_USER; index += 1) {
      unwrap(service.create(userId, entityBody({ legalName: `Entity ${index}` })));
    }
    assert.equal(service.list(userId).length, MAX_BILLING_ENTITIES_PER_USER);

    const overflow = service.create(userId, entityBody({ legalName: 'Entity overflow' }));
    assert.equal(overflow.ok, false);
    if (overflow.ok) throw new Error('Expected failure');
    assert.equal(overflow.code, 'BILLING_ENTITY_LIMIT_REACHED');

    const [oldest] = service.list(userId);
    unwrap(service.retire(userId, Number(oldest!.id)));
    assert.equal(
      unwrap(service.create(userId, entityBody({ legalName: 'Entity overflow' }))).legalName,
      'Entity overflow',
    );
  });

  await t.test('update patches only supplied fields and never demotes the default', () => {
    const userId = createUser(db, 'billing-update@example.test');
    const entity = unwrap(service.create(userId, entityBody({ legalName: 'Patch Works Ltd' })));

    const updated = unwrap(
      service.update(userId, Number(entity.id), {
        vatNumber: '  GB999999999 ',
        isDefault: false,
      }),
    );
    assert.equal(updated.vatNumber, 'GB999999999');
    assert.equal(updated.legalName, 'Patch Works Ltd');
    assert.equal(updated.registrationNumber, '09876543');
    assert.equal(updated.address.postcode, 'LS1 4AP');
    assert.equal(updated.isDefault, true);
    assert.equal(activeDefaultCount(userId), 1);

    const readdressed = unwrap(
      service.update(userId, Number(entity.id), {
        address: {
          line1: '9 Foundry Way',
          city: 'Sheffield',
          postcode: 's1 2hh',
          countryCode: 'gb',
        },
      }),
    );
    assert.equal(readdressed.address.line1, '9 Foundry Way');
    assert.equal(readdressed.address.postcode, 'S1 2HH');
    assert.equal(readdressed.address.countryCode, 'GB');
  });

  await t.test('an explicit null clears an identifier while an absent key leaves it alone', () => {
    // These are two different instructions and must not collapse into one. If null were treated as
    // "no change", a buyer clearing a saved VAT number would get a success response and keep the old
    // number; if absent were treated as "clear", every partial patch would wipe untouched fields.
    const userId = createUser(db, 'billing-clear@example.test');
    const entity = unwrap(service.create(userId, entityBody({ legalName: 'Clearable Ltd' })));
    const entityId = Number(entity.id);
    const storedIdentifiers = () =>
      db
        .prepare('SELECT registration_number, vat_number FROM billing_entities WHERE id = ?')
        .get(entityId) as { registration_number: string | null; vat_number: string | null };

    assert.equal(entity.registrationNumber, '09876543');
    assert.equal(entity.vatNumber, 'GB123456789');

    // absent -> untouched. Patching an unrelated field leaves both identifiers as they were.
    const untouched = unwrap(service.update(userId, entityId, { legalName: 'Clearable Two Ltd' }));
    assert.equal(untouched.registrationNumber, '09876543');
    assert.equal(untouched.vatNumber, 'GB123456789');
    assert.deepEqual(storedIdentifiers(), {
      registration_number: '09876543',
      vat_number: 'GB123456789',
    });

    // null -> cleared to SQL NULL, and only the field that was sent.
    const cleared = unwrap(service.update(userId, entityId, { vatNumber: null }));
    assert.equal(cleared.vatNumber, null);
    assert.equal(cleared.registrationNumber, '09876543');
    assert.deepEqual(storedIdentifiers(), {
      registration_number: '09876543',
      vat_number: null,
    });

    // the cleared value is NULL rather than '', which the column CHECK would have rejected
    const nullCount = db
      .prepare('SELECT COUNT(*) AS total FROM billing_entities WHERE id = ? AND vat_number IS NULL')
      .get(entityId) as { total: number };
    assert.equal(nullCount.total, 1);

    // clearing the remaining identifier leaves the record valid with both absent
    const bothCleared = unwrap(service.update(userId, entityId, { registrationNumber: null }));
    assert.equal(bothCleared.registrationNumber, null);
    assert.equal(bothCleared.vatNumber, null);
    assert.equal(bothCleared.legalName, 'Clearable Two Ltd');

    // a cleared identifier can be set again afterwards
    const restored = unwrap(service.update(userId, entityId, { vatNumber: 'GB555000111' }));
    assert.equal(restored.vatNumber, 'GB555000111');
  });
});
