import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { migrateDatabase } from '../../src/db/migrate.js';
import { createUnitOfWork } from '../../src/db/unitOfWork.js';
import { buildAuditEvent } from '../../src/features/audit/auditEvent.js';
import { createAuditRepository } from '../../src/features/audit/auditRepository.js';
import { createAuditWriter } from '../../src/features/audit/auditService.js';
import { createBackInStockRepository } from '../../src/features/backInStock/backInStockRepository.js';
import { createBackInStockService } from '../../src/features/backInStock/backInStockService.js';
import { createBackInStockTrigger } from '../../src/features/backInStock/backInStockTrigger.js';
import { BACK_IN_STOCK_SUBSCRIPTION_LIMIT } from '../../src/features/backInStock/backInStockRules.js';
import type { InventoryProduct } from '../../src/features/inventory/inventoryTypes.js';
import type { VariantRow } from '../../src/features/catalog/productRepository.js';

const FROZEN_NOW = '2026-08-02T09:30:00.000Z';
const system = { actor: { type: 'system' as const, userId: null }, requestId: null };

interface EnqueuedJob {
  kind: string;
  dedupeKey: string | null;
  payload: unknown;
}

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'shop-back-in-stock-'));
  const db = new Database(join(directory, 'shop.db'));
  migrateDatabase(db);
  let now = new Date(FROZEN_NOW);
  const clock = { now: () => now };
  const stock = new Map<number, number>();
  const enqueued: EnqueuedJob[] = [];
  const dedupeKeys = new Set<string>();

  const repository = createBackInStockRepository(db);
  const auditRepository = createAuditRepository(db);
  const audit = createAuditWriter({ repository: auditRepository, clock });
  const unitOfWork = createUnitOfWork(db);

  const variants = {
    findVariantById: (variantId: number) =>
      db.prepare('SELECT * FROM product_variants WHERE id = ?').get(variantId) as
        VariantRow | undefined,
  };
  const inventory = {
    availableToSell: (variantIds: readonly number[]): readonly InventoryProduct[] =>
      variantIds.map((variantId) => ({
        variantId,
        stockCount: stock.get(variantId) ?? 0,
        availableToSell: stock.get(variantId) ?? 0,
        backorderable: false,
        backorderLeadDays: null,
      })),
  };
  const jobs = {
    enqueue: (input: { kind: string; dedupeKey?: string | null; payload: unknown }) => {
      const dedupeKey = input.dedupeKey ?? null;
      if (dedupeKey !== null && dedupeKeys.has(dedupeKey)) {
        return { created: false } as never;
      }
      if (dedupeKey !== null) dedupeKeys.add(dedupeKey);
      enqueued.push({ kind: input.kind, dedupeKey, payload: input.payload });
      return { created: true } as never;
    },
  };

  const service = createBackInStockService({
    repository,
    inventory,
    variants,
    unitOfWork,
    audit,
    clock,
  });
  const trigger = createBackInStockTrigger({ repository, jobs, unitOfWork, clock });

  let nextProductId = 1;
  const addUser = (email: string) =>
    Number(
      (
        db
          .prepare(
            "INSERT INTO users (email, display_name, password_hash, password_salt, role) VALUES (?, 'Buyer', 'hash', 'salt', 'customer') RETURNING id",
          )
          .get(email) as { id: number }
      ).id,
    );
  const addVariant = (input: { sku: string; active?: boolean; available?: number }) => {
    const productId = nextProductId++;
    db.prepare(
      `INSERT INTO products
         (id, name, description, price_cents, category, stock_count, image_set_id, slug,
          compare_at_price_cents, sales_count, active, created_at)
       VALUES (?, ?, 'Test-only lot', 1000, 'Building Materials', 0, NULL, ?, NULL, 0, 1, ?)`,
    ).run(productId, `Product ${input.sku}`, `product-${input.sku.toLowerCase()}`, FROZEN_NOW);
    const variantId = Number(
      (
        db
          .prepare(
            `INSERT INTO product_variants
               (product_id, sku, label, weight_grams, price_cents, compare_at_price_cents,
                clearance_price_cents, clearance_starts_at, clearance_ends_at, stock_count,
                backorderable, backorder_lead_days, delivery_class, active, sort_order, moq_sacks,
                created_at, updated_at)
             VALUES (?, ?, '25 kg sack', 25000, 1000, NULL, NULL, NULL, NULL, 0, 0, NULL,
                     'freight', ?, 1, 4, ?, ?)
             RETURNING id`,
          )
          .get(productId, input.sku, input.active === false ? 0 : 1, FROZEN_NOW, FROZEN_NOW) as {
          id: number;
        }
      ).id,
    );
    stock.set(variantId, input.available ?? 0);
    return variantId;
  };

  return {
    db,
    service,
    trigger,
    repository,
    auditRepository,
    enqueued,
    addUser,
    addVariant,
    setAvailable(variantId: number, value: number) {
      stock.set(variantId, value);
    },
    setNow(value: string) {
      now = new Date(value);
    },
    close() {
      db.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

void test('buyer subscribes, lists, and cancels an out-of-stock lot with audit rows', () => {
  const f = fixture();
  try {
    const buyer = f.addUser('bis-buyer@example.test');
    const variantId = f.addVariant({ sku: 'BIS-001' });
    const context = { actor: { type: 'user' as const, userId: buyer }, requestId: 'bis-request' };

    const created = f.service.subscribe(buyer, variantId, context);
    assert.equal(created.ok, true);
    assert.deepEqual(
      {
        variantId: created.value.variantId,
        sku: created.value.sku,
        variantLabel: created.value.variantLabel,
        status: created.value.status,
        requestedAt: created.value.requestedAt,
        notifiedAt: created.value.notifiedAt,
        minimumOrderQuantity: created.value.minimumOrderQuantity,
      },
      {
        variantId,
        sku: 'BIS-001',
        variantLabel: '25 kg sack',
        status: 'pending',
        requestedAt: FROZEN_NOW,
        notifiedAt: null,
        minimumOrderQuantity: 4,
      },
    );

    assert.deepEqual(f.service.listOwned(buyer), [created.value]);
    assert.deepEqual(f.service.listOwned(buyer, 'pending'), [created.value]);
    assert.deepEqual(f.service.listOwned(buyer, 'cancelled'), []);

    const other = f.addUser('bis-other@example.test');
    assert.deepEqual(f.service.listOwned(other), [], 'listing is owner-scoped');

    assert.deepEqual(f.service.cancel(buyer, Number(created.value.subscriptionId), context), {
      ok: true,
      value: null,
    });
    assert.equal(f.service.listOwned(buyer, 'pending').length, 0);
    assert.equal(f.service.listOwned(buyer, 'cancelled').length, 1);

    const actions = ['back_in_stock.subscribed', 'back_in_stock.cancelled'] as const;
    for (const action of actions) {
      const rows = f.auditRepository.list({ action, page: 1, pageSize: 25 });
      assert.equal(rows.length, 1, `expected one ${action} audit row`);
      assert.deepEqual(
        {
          entityType: rows[0]!.entityType,
          entityId: rows[0]!.entityId,
          actorUserId: rows[0]!.actorUserId,
          requestId: rows[0]!.requestId,
        },
        {
          entityType: 'back_in_stock_subscription',
          entityId: created.value.subscriptionId,
          actorUserId: buyer,
          requestId: 'bis-request',
        },
      );
    }
  } finally {
    f.close();
  }
});

void test('rejects duplicate, available, retired, unknown, and foreign subscription targets', () => {
  const f = fixture();
  try {
    const buyer = f.addUser('bis-reject@example.test');
    const outOfStock = f.addVariant({ sku: 'BIS-010' });
    const available = f.addVariant({ sku: 'BIS-011', available: 4 });
    const belowMoq = f.addVariant({ sku: 'BIS-012', available: 3 });
    const retired = f.addVariant({ sku: 'BIS-013', active: false });

    const first = f.service.subscribe(buyer, outOfStock, system);
    assert.equal(first.ok, true);
    assert.deepEqual(f.service.subscribe(buyer, outOfStock, system), {
      ok: false,
      code: 'ALREADY_SUBSCRIBED',
    });
    assert.deepEqual(f.service.subscribe(buyer, available, system), {
      ok: false,
      code: 'VARIANT_AVAILABLE',
    });
    // Stock below the MOQ floor is not orderable, so it is still a valid subscription target.
    assert.equal(f.service.subscribe(buyer, belowMoq, system).ok, true);
    assert.deepEqual(f.service.subscribe(buyer, retired, system), {
      ok: false,
      code: 'VARIANT_RETIRED',
    });
    assert.deepEqual(f.service.subscribe(buyer, 9_999_999, system), {
      ok: false,
      code: 'VARIANT_NOT_FOUND',
    });

    assert.deepEqual(f.service.cancel(buyer, 9_999_999, system), {
      ok: false,
      code: 'SUBSCRIPTION_NOT_FOUND',
    });
    const stranger = f.addUser('bis-stranger@example.test');
    assert.deepEqual(
      f.service.cancel(stranger, Number(first.value.subscriptionId), system),
      { ok: false, code: 'SUBSCRIPTION_NOT_FOUND' },
      'ownership is enforced in SQL',
    );
    assert.equal(f.service.cancel(buyer, Number(first.value.subscriptionId), system).ok, true);
    assert.deepEqual(
      f.service.cancel(buyer, Number(first.value.subscriptionId), system),
      { ok: false, code: 'SUBSCRIPTION_NOT_FOUND' },
      'a cancelled subscription has no interest left to withdraw',
    );
    // The partial unique index only covers pending rows, so re-subscribing must succeed.
    assert.equal(f.service.subscribe(buyer, outOfStock, system).ok, true);
  } finally {
    f.close();
  }
});

void test('enforces the pending subscription ceiling per buyer', () => {
  const f = fixture();
  try {
    const buyer = f.addUser('bis-limit@example.test');
    const variantIds = Array.from({ length: BACK_IN_STOCK_SUBSCRIPTION_LIMIT + 1 }, (_, index) =>
      f.addVariant({ sku: `BIS-L${index}` }),
    );
    for (let index = 0; index < BACK_IN_STOCK_SUBSCRIPTION_LIMIT; index += 1) {
      assert.equal(f.service.subscribe(buyer, variantIds[index]!, system).ok, true);
    }
    assert.deepEqual(f.service.subscribe(buyer, variantIds.at(-1)!, system), {
      ok: false,
      code: 'SUBSCRIPTION_LIMIT_REACHED',
    });
    // The ceiling is per buyer, not global.
    const another = f.addUser('bis-limit-other@example.test');
    assert.equal(f.service.subscribe(another, variantIds.at(-1)!, system).ok, true);
  } finally {
    f.close();
  }
});

void test('trigger enqueues one notify job only while pending interest exists', () => {
  const f = fixture();
  try {
    const buyer = f.addUser('bis-trigger@example.test');
    const watched = f.addVariant({ sku: 'BIS-020' });
    const unwatched = f.addVariant({ sku: 'BIS-021' });

    f.trigger.stockChanged(unwatched, FROZEN_NOW);
    assert.deepEqual(f.enqueued, [], 'no pending interest must enqueue nothing');

    const created = f.service.subscribe(buyer, watched, system);
    assert.equal(created.ok, true);

    f.trigger.stockChanged(watched, FROZEN_NOW);
    assert.equal(f.enqueued.length, 1);
    assert.deepEqual(f.enqueued[0], {
      kind: 'back_in_stock.notify',
      dedupeKey: `back-in-stock:${watched}:${FROZEN_NOW}`,
      payload: { variantId: watched },
    });

    f.trigger.stockChanged(watched, FROZEN_NOW);
    assert.equal(f.enqueued.length, 1, 'the same movement instant must collapse onto one job');

    const laterInstant = '2026-08-02T10:00:00.000Z';
    f.trigger.stockChanged(watched, laterInstant);
    assert.equal(f.enqueued.length, 2, 'a later movement is a distinct job');

    assert.equal(f.service.cancel(buyer, Number(created.value.subscriptionId), system).ok, true);
    f.trigger.stockChanged(watched, '2026-08-02T11:00:00.000Z');
    assert.equal(f.enqueued.length, 2, 'cancelled interest must not enqueue');
  } finally {
    f.close();
  }
});

void test('records notification delivery and accepts every back-in-stock audit action', () => {
  const f = fixture();
  try {
    const buyer = f.addUser('bis-notify@example.test');
    const variantId = f.addVariant({ sku: 'BIS-030' });
    const created = f.service.subscribe(buyer, variantId, system);
    assert.equal(created.ok, true);
    const subscriptionId = Number(created.value.subscriptionId);

    assert.deepEqual(
      f.repository.listPendingForVariant(variantId).map((row) => row.id),
      [subscriptionId],
    );
    f.repository.markNotified(subscriptionId, null, '2026-08-02T10:00:00.000Z');
    assert.equal(f.repository.hasPendingForVariant(variantId), false);
    const notified = f.service.listOwned(buyer, 'notified');
    assert.deepEqual(
      { count: notified.length, status: notified[0]?.status },
      { count: 1, status: 'notified' },
    );

    for (const action of [
      'back_in_stock.subscribed',
      'back_in_stock.cancelled',
      'back_in_stock.notified',
    ] as const) {
      const event = buildAuditEvent({ action, subscriptionId, context: system });
      assert.deepEqual(
        { action: event.action, entityType: event.entityType, entityId: event.entityId },
        {
          action,
          entityType: 'back_in_stock_subscription',
          entityId: String(subscriptionId),
        },
      );
    }
  } finally {
    f.close();
  }
});
