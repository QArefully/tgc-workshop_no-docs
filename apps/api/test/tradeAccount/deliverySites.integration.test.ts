import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import { DeliverySite, type CreateDeliverySiteBody } from '@shop/contracts/trade-account';
import { closeDatabase, openDatabase } from '../../src/db/index.js';
import { createUnitOfWork } from '../../src/db/unitOfWork.js';
import { createDeliverySiteRepository } from '../../src/features/tradeAccount/deliverySiteRepository.js';
import {
  createDeliverySiteService,
  MAX_DELIVERY_SITES_PER_USER,
  type DeliverySiteService,
} from '../../src/features/tradeAccount/deliverySiteService.js';

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

function siteBody(overrides: Partial<CreateDeliverySiteBody> = {}): CreateDeliverySiteBody {
  return {
    label: 'Yard A',
    contactName: 'Site Foreman',
    contactPhone: '01234 567890',
    address: {
      line1: '1 Wharf Road',
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

void test('delivery site trade account integration', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'shop-delivery-sites-'));
  const dbPath = join(dir, 'shop.db');
  const db = openDatabase({ path: dbPath });

  t.after(() => {
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  });

  const repository = createDeliverySiteRepository(db);
  const service: DeliverySiteService = createDeliverySiteService({
    repository,
    unitOfWork: createUnitOfWork(db),
    clock: CLOCK,
  });

  /** Live defaults owned by one test user. Scoped by user id: the database carries other rows. */
  const activeDefaultCount = (userId: number): number => {
    const row = db
      .prepare(
        'SELECT COUNT(*) AS total FROM delivery_sites WHERE user_id = ? AND is_default = 1 AND active = 1',
      )
      .get(userId) as { total: number };
    return row.total;
  };

  await t.test('create normalizes address and makes the first site the default', () => {
    const userId = createUser(db, 'sites-create@example.test');
    const site = unwrap(
      service.create(
        userId,
        siteBody({
          label: '  Yard   A  ',
          address: {
            line1: ' 1 Wharf Road ',
            line2: '  ',
            city: 'Leeds',
            postcode: ' ls1 4ap ',
            countryCode: 'gb',
          },
        }),
      ),
    );

    assert.equal(site.label, 'Yard A');
    assert.equal(site.address.line1, '1 Wharf Road');
    assert.equal(site.address.line2, undefined);
    assert.equal(site.address.postcode, 'LS1 4AP');
    assert.equal(site.address.countryCode, 'GB');
    assert.equal(site.isDefault, true);
    assert.equal(site.active, true);
    assert.match(site.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.equal(activeDefaultCount(userId), 1);
  });

  await t.test('setting a new default clears the prior one in one transaction', () => {
    const userId = createUser(db, 'sites-default@example.test');
    const first = unwrap(service.create(userId, siteBody({ label: 'Yard A' })));
    const second = unwrap(service.create(userId, siteBody({ label: 'Yard B' })));
    assert.equal(second.isDefault, false);

    const promoted = unwrap(service.setDefault(userId, Number(second.id)));
    assert.equal(promoted.isDefault, true);
    assert.equal(activeDefaultCount(userId), 1);
    assert.equal(unwrap(service.get(userId, Number(first.id))).isDefault, false);

    // create with isDefault also swaps rather than adding a second default
    const third = unwrap(service.create(userId, siteBody({ label: 'Yard C', isDefault: true })));
    assert.equal(third.isDefault, true);
    assert.equal(activeDefaultCount(userId), 1);
    assert.equal(unwrap(service.get(userId, Number(second.id))).isDefault, false);
  });

  await t.test('a failed default swap rolls back, leaving the prior default intact', () => {
    const userId = createUser(db, 'sites-rollback@example.test');
    const first = unwrap(service.create(userId, siteBody({ label: 'Yard A' })));
    const second = unwrap(service.create(userId, siteBody({ label: 'Yard B' })));

    const failing = createDeliverySiteService({
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
    const ownerId = createUser(db, 'sites-owner@example.test');
    const intruderId = createUser(db, 'sites-intruder@example.test');
    const owned = unwrap(service.create(ownerId, siteBody({ label: 'Owner Yard' })));
    const siteId = Number(owned.id);

    for (const result of [
      service.get(intruderId, siteId),
      service.update(intruderId, siteId, { label: 'Stolen' }),
      service.setDefault(intruderId, siteId),
      service.retire(intruderId, siteId),
    ]) {
      assert.equal(result.ok, false);
      if (result.ok) throw new Error('Expected failure');
      assert.equal(result.code, 'SITE_NOT_FOUND');
    }
    assert.equal(service.findForOrderHydration(intruderId, siteId), null);
    assert.deepEqual(service.list(intruderId), []);
    // owner row untouched by the rejected writes
    assert.equal(unwrap(service.get(ownerId, siteId)).label, 'Owner Yard');
  });

  await t.test('duplicate labels are rejected case-insensitively and freed by retirement', () => {
    const userId = createUser(db, 'sites-duplicate@example.test');
    const first = unwrap(service.create(userId, siteBody({ label: 'Depot North' })));

    const duplicate = service.create(userId, siteBody({ label: 'depot north' }));
    assert.equal(duplicate.ok, false);
    if (duplicate.ok) throw new Error('Expected failure');
    assert.equal(duplicate.code, 'DUPLICATE_LABEL');

    const other = unwrap(service.create(userId, siteBody({ label: 'Depot South' })));
    const renameClash = service.update(userId, Number(other.id), { label: 'Depot North' });
    assert.equal(renameClash.ok, false);
    if (renameClash.ok) throw new Error('Expected failure');
    assert.equal(renameClash.code, 'DUPLICATE_LABEL');

    // renaming a site to its own label is not a duplicate
    assert.equal(
      unwrap(service.update(userId, Number(other.id), { label: 'Depot South' })).label,
      'Depot South',
    );

    assert.equal(unwrap(service.retire(userId, Number(first.id))), null);
    assert.equal(
      unwrap(service.create(userId, siteBody({ label: 'Depot North' }))).label,
      'Depot North',
    );
  });

  await t.test('retired sites leave the list, stay resolvable, and hand over the default', () => {
    const userId = createUser(db, 'sites-retire@example.test');
    const first = unwrap(service.create(userId, siteBody({ label: 'Yard A' })));
    const second = unwrap(service.create(userId, siteBody({ label: 'Yard B' })));
    assert.equal(first.isDefault, true);

    unwrap(service.retire(userId, Number(first.id)));

    assert.deepEqual(
      service.list(userId).map((site) => site.label),
      ['Yard B'],
    );
    const hydrated = service.findForOrderHydration(userId, Number(first.id));
    assert.ok(hydrated);
    assert.equal(hydrated.active, false);
    assert.equal(hydrated.label, 'Yard A');
    // retired row is not a valid checkout destination
    const live = service.get(userId, Number(first.id));
    assert.equal(live.ok, false);

    assert.equal(unwrap(service.get(userId, Number(second.id))).isDefault, true);
    assert.equal(activeDefaultCount(userId), 1);

    // retiring the last site leaves no default and no rows to list
    unwrap(service.retire(userId, Number(second.id)));
    assert.deepEqual(service.list(userId), []);
    assert.equal(activeDefaultCount(userId), 0);
  });

  await t.test('the per-user cap counts live sites only', () => {
    const userId = createUser(db, 'sites-cap@example.test');
    for (let index = 0; index < MAX_DELIVERY_SITES_PER_USER; index += 1) {
      unwrap(service.create(userId, siteBody({ label: `Yard ${index}` })));
    }
    assert.equal(service.list(userId).length, MAX_DELIVERY_SITES_PER_USER);

    const overflow = service.create(userId, siteBody({ label: 'Yard overflow' }));
    assert.equal(overflow.ok, false);
    if (overflow.ok) throw new Error('Expected failure');
    assert.equal(overflow.code, 'SITE_LIMIT_REACHED');

    const [oldest] = service.list(userId);
    unwrap(service.retire(userId, Number(oldest!.id)));
    assert.equal(
      unwrap(service.create(userId, siteBody({ label: 'Yard overflow' }))).label,
      'Yard overflow',
    );
  });

  await t.test('update patches only supplied fields and never demotes the default', () => {
    const userId = createUser(db, 'sites-update@example.test');
    const site = unwrap(service.create(userId, siteBody({ label: 'Yard A' })));

    const updated = unwrap(
      service.update(userId, Number(site.id), { contactName: '  New Foreman ', isDefault: false }),
    );
    assert.equal(updated.contactName, 'New Foreman');
    assert.equal(updated.label, 'Yard A');
    assert.equal(updated.address.postcode, 'LS1 4AP');
    assert.equal(updated.isDefault, true);
    assert.equal(activeDefaultCount(userId), 1);
  });

  // Defence in depth behind the ContactPhone pattern: the contract now rejects a digit-free phone,
  // but the service owns the normalisation that produces the empty value, so a caller reaching the
  // service directly must still never write '' into a column whose CHECK is
  // `contact_phone IS NULL OR length(contact_phone) BETWEEN 1 AND 40` (migration 023).
  await t.test(
    'a phone that normalises to empty is stored as NULL, never as an empty string',
    () => {
      const storedPhone = (siteId: number): string | null => {
        const row = db
          .prepare('SELECT contact_phone FROM delivery_sites WHERE id = ?')
          .get(siteId) as { contact_phone: string | null };
        return row.contact_phone;
      };

      const userId = createUser(db, 'sites-blank-phone@example.test');
      const blank = '     ' as unknown as CreateDeliverySiteBody['contactPhone'];

      const created = unwrap(
        service.create(userId, siteBody({ label: 'Yard blank', contactPhone: blank })),
      );
      assert.equal(storedPhone(Number(created.id)), null);

      // The NULL must survive the read path too: the mapper reports the phone as absent, and the
      // record still satisfies the response schema. Mapping NULL to '' instead would fail this
      // check on every read of the row — a 500 rather than a site with no phone on file.
      assert.equal(created.contactPhone, undefined);
      assert.ok(!Object.hasOwn(created, 'contactPhone'));
      assert.equal(Value.Check(DeliverySite, created), true);
      const [listed] = service.list(userId);
      assert.ok(listed);
      assert.equal(listed.contactPhone, undefined);
      assert.equal(Value.Check(DeliverySite, listed), true);

      // A real phone still round-trips normalised.
      const populated = unwrap(
        service.update(userId, Number(created.id), { contactPhone: '  01234   567890 ' }),
      );
      assert.equal(populated.contactPhone, '01234 567890');
      assert.equal(storedPhone(Number(created.id)), '01234 567890');

      // ...and the update path clears back to NULL rather than to ''.
      unwrap(service.update(userId, Number(created.id), { contactPhone: blank }));
      assert.equal(storedPhone(Number(created.id)), null);
    },
  );
});
