import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { migrateDatabase } from '../../src/db/migrate.js';
import { createUnitOfWork } from '../../src/db/unitOfWork.js';
import { createAuditRepository } from '../../src/features/audit/auditRepository.js';
import { createAuditWriter } from '../../src/features/audit/auditService.js';
import { createBackInStockNotifyHandler } from '../../src/features/backInStock/backInStockNotifyHandler.js';
import { createBackInStockRepository } from '../../src/features/backInStock/backInStockRepository.js';
import { createBackInStockService } from '../../src/features/backInStock/backInStockService.js';
import type { FaultKey } from '../../src/features/jobs/faultSwitch.js';
import type { JobHandlerResult } from '../../src/features/jobs/jobHandlerRegistry.js';
import { createNotificationRepository } from '../../src/features/notifications/notificationRepository.js';
import { createNotificationService } from '../../src/features/notifications/notificationService.js';
import type { InventoryProduct } from '../../src/features/inventory/inventoryTypes.js';
import type { VariantRow } from '../../src/features/catalog/productRepository.js';

const FROZEN_NOW = '2026-08-02T09:30:00.000Z';
const RESTOCK_NOW = '2026-08-02T10:00:00.000Z';

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'shop-bis-notify-'));
  const db = new Database(join(directory, 'shop.db'));
  migrateDatabase(db);
  let now = new Date(FROZEN_NOW);
  const clock = { now: () => now };
  const stock = new Map<number, number>();
  const enabledFaults = new Set<FaultKey>();
  const enqueued: { kind: string; dedupeKey: string | null; payload: unknown }[] = [];

  const repository = createBackInStockRepository(db);
  const auditRepository = createAuditRepository(db);
  const audit = createAuditWriter({ repository: auditRepository, clock });
  const unitOfWork = createUnitOfWork(db);
  const notificationRepository = createNotificationRepository(db);
  const jobs = {
    enqueue: (input: { kind: string; dedupeKey?: string | null; payload: unknown }) => {
      enqueued.push({
        kind: input.kind,
        dedupeKey: input.dedupeKey ?? null,
        payload: input.payload,
      });
      return { created: true } as never;
    },
  };
  const notifications = createNotificationService({
    repository: notificationRepository,
    jobs,
    unitOfWork,
    audit,
    clock,
  });
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
  const variants = {
    findVariantById: (variantId: number) =>
      db.prepare('SELECT * FROM product_variants WHERE id = ?').get(variantId) as
        VariantRow | undefined,
  };
  const service = createBackInStockService({
    repository,
    inventory,
    variants,
    unitOfWork,
    audit,
    clock,
  });
  const faults = { isEnabled: (key: FaultKey) => enabledFaults.has(key) };
  const handler = createBackInStockNotifyHandler({
    repository,
    notifications,
    inventory,
    unitOfWork,
    audit,
    clock,
    faults,
  });

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

  const run = (variantId: number): JobHandlerResult =>
    handler({
      jobId: 1,
      kind: 'back_in_stock.notify',
      payload: { variantId },
      attempt: 1,
    }) as JobHandlerResult;

  return {
    db,
    service,
    repository,
    handler,
    run,
    enqueued,
    addUser,
    addVariant,
    notificationsFor: (userId: number) => notifications.list(userId).items,
    statusOf: (subscriptionId: number, userId: number) =>
      repository.findOwned(subscriptionId, userId)?.status,
    auditCount: (action: 'back_in_stock.notified' | 'back_in_stock.cancelled') =>
      auditRepository.list({ action, page: 1, pageSize: 100 }).length,
    subscribe(userId: number, variantId: number) {
      const created = service.subscribe(userId, variantId, {
        actor: { type: 'user' as const, userId },
        requestId: `bis-subscribe-${userId}-${variantId}`,
      });
      assert.equal(created.ok, true);
      return Number((created as { value: { subscriptionId: string } }).value.subscriptionId);
    },
    setAvailable(variantId: number, value: number) {
      stock.set(variantId, value);
    },
    setFault(key: FaultKey, enabled: boolean) {
      if (enabled) enabledFaults.add(key);
      else enabledFaults.delete(key);
    },
    setNow(value: string) {
      now = new Date(value);
    },
    retireVariant(variantId: number) {
      db.prepare('UPDATE product_variants SET active = 0 WHERE id = ?').run(variantId);
    },
    close() {
      db.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

void test('notifies every pending subscriber exactly once and is a no-op on a repeat run', () => {
  const f = fixture();
  try {
    const first = f.addUser('bis-h1@example.test');
    const second = f.addUser('bis-h2@example.test');
    const variantId = f.addVariant({ sku: 'BISH-001' });
    const other = f.addVariant({ sku: 'BISH-002' });
    const firstSubscription = f.subscribe(first, variantId);
    const secondSubscription = f.subscribe(second, variantId);
    const untouched = f.subscribe(first, other);

    f.setNow(RESTOCK_NOW);
    f.setAvailable(variantId, 4);
    assert.deepEqual(f.run(variantId), { ok: true });

    assert.equal(f.statusOf(firstSubscription, first), 'notified');
    assert.equal(f.statusOf(secondSubscription, second), 'notified');
    assert.equal(f.statusOf(untouched, first), 'pending', 'other variants are untouched');

    for (const [userId, subscriptionId] of [
      [first, firstSubscription],
      [second, secondSubscription],
    ] as const) {
      const items = f.notificationsFor(userId);
      assert.equal(items.length, 1, 'exactly one notification per pending subscription');
      assert.deepEqual(
        {
          kind: items[0]!.kind,
          entityType: items[0]!.entityType,
          entityId: items[0]!.entityId,
          title: items[0]!.title,
        },
        {
          kind: 'back_in_stock.available',
          entityType: 'back_in_stock_subscription',
          entityId: String(subscriptionId),
          title: 'Back in stock: Product BISH-001',
        },
      );
    }
    assert.equal(f.auditCount('back_in_stock.notified'), 2);
    const notifiedRow = f.repository.findOwned(firstSubscription, first)!;
    assert.equal(notifiedRow.notified_at, RESTOCK_NOW);
    assert.equal(notifiedRow.notification_id !== null, true, 'notification id is recorded');

    // A reclaimed job must acknowledge without fanning out a second time.
    assert.deepEqual(f.run(variantId), { ok: true });
    assert.equal(f.notificationsFor(first).length, 1);
    assert.equal(f.notificationsFor(second).length, 1);
    assert.equal(f.auditCount('back_in_stock.notified'), 2);
  } finally {
    f.close();
  }
});

void test('a below-MOQ restock notifies nobody and leaves interest pending', () => {
  const f = fixture();
  try {
    const buyer = f.addUser('bis-h3@example.test');
    const variantId = f.addVariant({ sku: 'BISH-010' });
    const subscriptionId = f.subscribe(buyer, variantId);

    f.setAvailable(variantId, 3);
    assert.deepEqual(f.run(variantId), { ok: true });
    assert.equal(f.statusOf(subscriptionId, buyer), 'pending');
    assert.equal(f.notificationsFor(buyer).length, 0);
    assert.equal(f.auditCount('back_in_stock.notified'), 0);

    // The same subscription still notifies once the lot clears the MOQ floor.
    f.setAvailable(variantId, 4);
    assert.deepEqual(f.run(variantId), { ok: true });
    assert.equal(f.statusOf(subscriptionId, buyer), 'notified');
    assert.equal(f.notificationsFor(buyer).length, 1);
  } finally {
    f.close();
  }
});

void test('a retired variant closes pending interest as cancelled without notifying', () => {
  const f = fixture();
  try {
    const buyer = f.addUser('bis-h4@example.test');
    const variantId = f.addVariant({ sku: 'BISH-020' });
    const subscriptionId = f.subscribe(buyer, variantId);

    f.retireVariant(variantId);
    f.setAvailable(variantId, 40);
    assert.deepEqual(f.run(variantId), { ok: true });

    assert.equal(f.statusOf(subscriptionId, buyer), 'cancelled');
    assert.equal(f.notificationsFor(buyer).length, 0);
    assert.equal(f.auditCount('back_in_stock.cancelled'), 1);
    assert.equal(f.auditCount('back_in_stock.notified'), 0);

    // Repeat runs find nothing pending and stay a no-op.
    assert.deepEqual(f.run(variantId), { ok: true });
    assert.equal(f.auditCount('back_in_stock.cancelled'), 1);
  } finally {
    f.close();
  }
});

void test('an unknown variant, empty pending set, and bad payload are handled without throwing', () => {
  const f = fixture();
  try {
    const buyer = f.addUser('bis-h5@example.test');
    const variantId = f.addVariant({ sku: 'BISH-030' });
    f.setAvailable(variantId, 40);
    assert.deepEqual(f.run(variantId), { ok: true }, 'no pending interest is a success');
    assert.deepEqual(f.run(9_999_999), { ok: true }, 'unknown variant with no interest is a no-op');
    assert.equal(f.notificationsFor(buyer).length, 0);

    for (const payload of [null, {}, { variantId: 'x' }, { variantId: 0 }, { variantId: 1.5 }]) {
      assert.deepEqual(f.handler({ jobId: 1, kind: 'back_in_stock.notify', payload, attempt: 1 }), {
        ok: false,
        error: 'Invalid back-in-stock notify payload',
      });
    }
  } finally {
    f.close();
  }
});

void test('the fault flag forces failure and a retry after it clears succeeds', () => {
  const f = fixture();
  try {
    const buyer = f.addUser('bis-h6@example.test');
    const variantId = f.addVariant({ sku: 'BISH-040' });
    const subscriptionId = f.subscribe(buyer, variantId);

    f.setAvailable(variantId, 8);
    f.setFault('async.back_in_stock_failure', true);
    assert.deepEqual(f.run(variantId), {
      ok: false,
      error: 'Simulated back-in-stock notify failure',
    });
    assert.equal(f.statusOf(subscriptionId, buyer), 'pending');
    assert.equal(f.notificationsFor(buyer).length, 0);

    f.setFault('async.back_in_stock_failure', false);
    assert.deepEqual(f.run(variantId), { ok: true });
    assert.equal(f.statusOf(subscriptionId, buyer), 'notified');
    assert.equal(f.notificationsFor(buyer).length, 1);
  } finally {
    f.close();
  }
});

void test('a partial-progress retry resumes without double-notifying settled subscriptions', () => {
  const f = fixture();
  try {
    const first = f.addUser('bis-h7@example.test');
    const second = f.addUser('bis-h8@example.test');
    const variantId = f.addVariant({ sku: 'BISH-050' });
    const firstSubscription = f.subscribe(first, variantId);
    const secondSubscription = f.subscribe(second, variantId);

    // Simulate a crash after the first subscription's transaction committed.
    f.repository.markNotified(firstSubscription, null, RESTOCK_NOW);
    assert.equal(f.statusOf(firstSubscription, first), 'notified');

    f.setAvailable(variantId, 4);
    assert.deepEqual(f.run(variantId), { ok: true });

    assert.equal(f.notificationsFor(first).length, 0, 'an already-settled row is not re-notified');
    assert.equal(f.notificationsFor(second).length, 1);
    assert.equal(f.statusOf(secondSubscription, second), 'notified');
    assert.equal(f.auditCount('back_in_stock.notified'), 1);
  } finally {
    f.close();
  }
});

void test('re-subscribing after a notify stays notifiable because dedupe is subscription-scoped', () => {
  const f = fixture();
  try {
    const buyer = f.addUser('bis-h9@example.test');
    const variantId = f.addVariant({ sku: 'BISH-060' });
    const firstSubscription = f.subscribe(buyer, variantId);

    f.setAvailable(variantId, 4);
    assert.deepEqual(f.run(variantId), { ok: true });
    assert.equal(f.notificationsFor(buyer).length, 1);

    // The lot sells out again and the buyer re-subscribes; the new row is a new dedupe identity.
    f.setAvailable(variantId, 0);
    const secondSubscription = f.subscribe(buyer, variantId);
    assert.notEqual(secondSubscription, firstSubscription);

    f.setAvailable(variantId, 4);
    assert.deepEqual(f.run(variantId), { ok: true });
    const items = f.notificationsFor(buyer);
    assert.equal(items.length, 2, 'a re-subscription earns its own notification');
    assert.deepEqual(
      items.map((item) => item.entityId).sort(),
      [String(firstSubscription), String(secondSubscription)].sort(),
    );
    assert.equal(f.statusOf(secondSubscription, buyer), 'notified');
  } finally {
    f.close();
  }
});

void test('queued delivery jobs are enqueued once per created notification', () => {
  const f = fixture();
  try {
    const buyer = f.addUser('bis-h10@example.test');
    const variantId = f.addVariant({ sku: 'BISH-070' });
    f.subscribe(buyer, variantId);
    f.setAvailable(variantId, 4);
    assert.deepEqual(f.run(variantId), { ok: true });
    assert.deepEqual(
      f.enqueued.map((job) => job.kind),
      ['notification.deliver'],
    );
  } finally {
    f.close();
  }
});
