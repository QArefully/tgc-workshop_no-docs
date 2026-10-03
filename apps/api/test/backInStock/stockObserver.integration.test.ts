import assert from 'node:assert/strict';
import test from 'node:test';
import { openDatabase } from '../../src/db/index.js';
import { createUnitOfWork } from '../../src/db/unitOfWork.js';
import { createAuditRepository } from '../../src/features/audit/auditRepository.js';
import { createAuditWriter } from '../../src/features/audit/auditService.js';
import { createVariantAdminRepository } from '../../src/features/catalog/variantAdminRepository.js';
import { createVariantAdminService } from '../../src/features/catalog/variantAdminService.js';
import { createInventoryRepository } from '../../src/features/inventory/inventoryRepository.js';
import { createInventoryService } from '../../src/features/inventory/inventoryService.js';
import type { StockChangeObserver } from '../../src/features/inventory/stockObserver.js';
import { openSeededDatabase } from '../support/seededDatabase.js';

interface RecordedCall {
  variantId: number;
  occurredAt: string;
  /** Stock as it stood at the instant the observer was told — proves fulfilment ordering. */
  stockAtCall: number;
  /** Backordered units still open for the variant at the instant of the call. */
  openBackordersAtCall: number;
}

/**
 * Recording observer. Reads live persistence state on every call so tests can assert *when* the
 * notification happened, not merely that it happened, and mirrors each call into a durable row so
 * a rolled-back caller transaction can be shown to discard the notification with the stock write.
 */
function recordingObserver(db: ReturnType<typeof openDatabase>): {
  observer: StockChangeObserver;
  calls: RecordedCall[];
  durableCallCount: () => number;
} {
  const calls: RecordedCall[] = [];
  db.prepare(
    'CREATE TABLE observer_log (variant_id INTEGER NOT NULL, occurred_at TEXT NOT NULL)',
  ).run();
  return {
    calls,
    durableCallCount: () =>
      (db.prepare('SELECT COUNT(*) AS count FROM observer_log').get() as { count: number }).count,
    observer: {
      stockChanged(variantId, occurredAt) {
        const stock = db
          .prepare('SELECT stock_count FROM product_variants WHERE id = ?')
          .get(variantId) as { stock_count: number } | undefined;
        const open = db
          .prepare(
            `SELECT COALESCE(SUM(backordered_quantity), 0) AS open
               FROM order_inventory_allocations
              WHERE variant_id = ? AND backordered_quantity > 0`,
          )
          .get(variantId) as { open: number };
        calls.push({
          variantId,
          occurredAt,
          stockAtCall: stock?.stock_count ?? -1,
          openBackordersAtCall: open.open,
        });
        db.prepare('INSERT INTO observer_log (variant_id, occurred_at) VALUES (?, ?)').run(
          variantId,
          occurredAt,
        );
      },
    },
  };
}

function defaultVariantId(db: ReturnType<typeof openDatabase>, productId: number): number {
  const row = db
    .prepare(
      'SELECT id FROM product_variants WHERE product_id = ? AND sort_order = 1 AND active = 1 LIMIT 1',
    )
    .get(productId) as { id: number } | undefined;
  if (!row) throw new Error(`No default variant for product ${productId}`);
  return row.id;
}

function fixture(t: test.TestContext) {
  const { db } = openSeededDatabase(t);
  const recorder = recordingObserver(db);
  const clock = { now: () => new Date('2030-01-01T00:00:00.000Z') };
  return {
    db,
    recorder,
    inventory: createInventoryService({
      repository: createInventoryRepository(db),
      stockObserver: recorder.observer,
    }),
    variantAdmin: createVariantAdminService({
      repository: createVariantAdminRepository(db),
      unitOfWork: createUnitOfWork(db),
      audit: createAuditWriter({ repository: createAuditRepository(db), clock }),
      clock,
      stockObserver: recorder.observer,
    }),
    context: { actor: { type: 'user' as const, userId: 3 }, requestId: 'stock-observer-test' },
  };
}

function insertPayment(db: ReturnType<typeof openDatabase>, key: string): void {
  db.prepare(
    `INSERT INTO payments
      (idempotency_key, request_fingerprint, status, amount_cents, card_last4, card_brand, created_at, updated_at)
     VALUES (?, 'fingerprint', 'prepared', 100, '4242', 'visa', ?, ?)`,
  ).run(key, '2030-01-01T00:00:00.000Z', '2030-01-01T00:00:00.000Z');
}

function insertOrderLine(
  db: ReturnType<typeof openDatabase>,
  variantId: number,
  quantity: number,
): { orderId: number; lineId: number } {
  const productId = (
    db.prepare('SELECT product_id FROM product_variants WHERE id = ?').get(variantId) as {
      product_id: number;
    }
  ).product_id;
  const orderId = Number(
    db
      .prepare(
        `INSERT INTO orders
          (customer_name, customer_email, shipping_address, subtotal_cents, discount_cents, total_cents, created_at)
         VALUES ('Observer', 'observer@example.test', '1 Stock Road', 100, 0, 100, '2030-01-01T00:00:00.000Z')`,
      )
      .run().lastInsertRowid,
  );
  const lineId = Number(
    db
      .prepare(
        `INSERT INTO order_line_items
          (order_id, product_id, product_name, product_price_cents, quantity, line_total_cents, variant_id)
         VALUES (?, ?, 'Observer product', 100, ?, ?, ?)`,
      )
      .run(orderId, productId, quantity, quantity * 100, variantId).lastInsertRowid,
  );
  return { orderId, lineId };
}

function insertReturnRequest(db: ReturnType<typeof openDatabase>, orderId: number): number {
  const userId = (db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get() as { id: number })
    .id;
  return Number(
    db
      .prepare(
        `INSERT INTO return_requests
          (order_id, user_id, status, reason, requested_at, approved_at)
         VALUES (?, ?, 'approved', 'damaged', '2030-01-01T09:00:00.000Z', '2030-01-01T09:30:00.000Z')`,
      )
      .run(orderId, userId).lastInsertRowid,
  );
}

function placeBackorder(
  db: ReturnType<typeof openDatabase>,
  inventory: ReturnType<typeof createInventoryService>,
  variantId: number,
  quantity: number,
  key: string,
  occurredAt: string,
): { orderId: number; lineId: number } {
  const order = insertOrderLine(db, variantId, quantity);
  insertPayment(db, key);
  db.transaction(() => {
    inventory.reserveCheckout({
      paymentIdempotencyKey: key,
      demands: [{ variantId, quantity }],
      now: occurredAt,
      expiresAt: '2030-01-01T12:00:00.000Z',
    });
    inventory.authorizeReservation(key, occurredAt);
    inventory.commitReservation({
      paymentIdempotencyKey: key,
      orderId: order.orderId,
      ordinaryLines: [{ orderLineItemId: order.lineId, variantId, quantity }],
      occurredAt,
    });
  })();
  return order;
}

void test('goods receipt notifies the observer exactly once, after backorders have consumed it', (t) => {
  const { db, inventory, recorder } = fixture(t);
  const variant = defaultVariantId(db, 49);
  db.prepare(
    'UPDATE product_variants SET stock_count = 0, backorderable = 1, backorder_lead_days = 14 WHERE id = ?',
  ).run(variant);
  placeBackorder(db, inventory, variant, 2, 'observer-backorder', '2030-01-01T10:00:00.000Z');
  assert.deepEqual(recorder.calls, []);

  db.transaction(() =>
    inventory.receiveStock({
      idempotencyKey: 'observer-receipt',
      variantId: variant,
      quantity: 3,
      receivedByUserId: 3,
      occurredAt: '2030-01-01T11:00:00.000Z',
    }),
  )();

  assert.equal(recorder.calls.length, 1);
  assert.equal(recorder.calls[0]?.variantId, variant);
  assert.equal(recorder.calls[0]?.occurredAt, '2030-01-01T11:00:00.000Z');
  // Ordering proof: had the observer run before fulfillBackorders, it would have seen the raw
  // received 3 and 2 units still backordered. It must instead see the settled net position.
  assert.equal(recorder.calls[0]?.stockAtCall, 1);
  assert.equal(recorder.calls[0]?.openBackordersAtCall, 0);
});

void test('receipt replay does not notify a second time', (t) => {
  const { db, inventory, recorder } = fixture(t);
  const variant = defaultVariantId(db, 49);
  db.prepare('UPDATE product_variants SET stock_count = 0 WHERE id = ?').run(variant);
  const receive = () =>
    db.transaction(() =>
      inventory.receiveStock({
        idempotencyKey: 'observer-replay',
        variantId: variant,
        quantity: 4,
        receivedByUserId: 3,
        occurredAt: '2030-01-01T11:00:00.000Z',
      }),
    )();
  assert.equal(receive().replayed, false);
  assert.equal(receive().replayed, true);
  assert.equal(recorder.calls.length, 1);
});

void test('return receipt notifies once per restored line, after that line fulfils backorders', (t) => {
  const { db, inventory, recorder } = fixture(t);
  const first = defaultVariantId(db, 49);
  const second = defaultVariantId(db, 50);
  for (const variant of [first, second]) {
    db.prepare(
      'UPDATE product_variants SET stock_count = 0, backorderable = 1, backorder_lead_days = 14 WHERE id = ?',
    ).run(variant);
  }
  const backordered = placeBackorder(
    db,
    inventory,
    first,
    1,
    'observer-return-backorder',
    '2030-01-01T10:00:00.000Z',
  );
  const returned = insertOrderLine(db, second, 2);
  const returnRequestId = insertReturnRequest(db, returned.orderId);

  db.transaction(() =>
    inventory.restoreReturnInventory({
      returnRequestId,
      lines: [
        { variantId: first, orderLineItemId: backordered.lineId, quantity: 2 },
        { variantId: second, orderLineItemId: returned.lineId, quantity: 2 },
      ],
      occurredAt: '2030-01-01T12:00:00.000Z',
    }),
  )();

  assert.deepEqual(
    recorder.calls.map((call) => call.variantId),
    [first, second],
  );
  assert.deepEqual(
    recorder.calls.map((call) => call.occurredAt),
    ['2030-01-01T12:00:00.000Z', '2030-01-01T12:00:00.000Z'],
  );
  // The first line restored 2 but an open backorder of 1 consumed one unit before the notification.
  assert.equal(recorder.calls[0]?.stockAtCall, 1);
  assert.equal(recorder.calls[0]?.openBackordersAtCall, 0);
  assert.equal(recorder.calls[1]?.stockAtCall, 2);
});

void test('order cancellation notifies once per restored variant, after backorder reassignment', (t) => {
  const { db, inventory, recorder } = fixture(t);
  const variant = defaultVariantId(db, 49);
  db.prepare(
    'UPDATE product_variants SET stock_count = 2, backorderable = 1, backorder_lead_days = 14 WHERE id = ?',
  ).run(variant);
  const held = placeBackorder(
    db,
    inventory,
    variant,
    2,
    'observer-cancel-held',
    '2030-01-01T10:00:00.000Z',
  );
  const waiting = placeBackorder(
    db,
    inventory,
    variant,
    2,
    'observer-cancel-waiting',
    '2030-01-01T10:05:00.000Z',
  );
  recorder.calls.length = 0;

  const reassigned = db.transaction(() =>
    inventory.cancelOrderInventory({
      orderId: held.orderId,
      occurredAt: '2030-01-01T13:00:00.000Z',
    }),
  )();

  assert.deepEqual(reassigned, [
    { orderId: waiting.orderId, orderLineItemId: waiting.lineId, quantity: 2 },
  ]);
  assert.equal(recorder.calls.length, 1);
  assert.equal(recorder.calls[0]?.variantId, variant);
  assert.equal(recorder.calls[0]?.occurredAt, '2030-01-01T13:00:00.000Z');
  // The 2 restored units went straight to the waiting backorder before the notification fired.
  assert.equal(recorder.calls[0]?.stockAtCall, 0);
  assert.equal(recorder.calls[0]?.openBackordersAtCall, 0);
});

void test('retired variant restored by a return still notifies the observer', (t) => {
  const { db, inventory, recorder } = fixture(t);
  const variant = defaultVariantId(db, 49);
  const line = insertOrderLine(db, variant, 1);
  const returnRequestId = insertReturnRequest(db, line.orderId);
  db.prepare('UPDATE product_variants SET stock_count = 0, active = 0 WHERE id = ?').run(variant);

  db.transaction(() =>
    inventory.restoreReturnInventory({
      returnRequestId,
      lines: [{ variantId: variant, orderLineItemId: line.lineId, quantity: 1 }],
      occurredAt: '2030-01-01T14:00:00.000Z',
    }),
  )();

  assert.deepEqual(
    recorder.calls.map((call) => call.variantId),
    [variant],
  );
});

void test('admin stock write notifies inside the unit of work; a patch without stockCount does not', (t) => {
  const { db, variantAdmin, recorder, context } = fixture(t);
  const variant = db
    .prepare('SELECT id FROM product_variants WHERE active = 1 ORDER BY id LIMIT 1')
    .get() as { id: number };

  variantAdmin.update(variant.id, { stockCount: 12 }, context);
  assert.equal(recorder.calls.length, 1);
  assert.equal(recorder.calls[0]?.variantId, variant.id);
  assert.equal(recorder.calls[0]?.occurredAt, '2030-01-01T00:00:00.000Z');
  assert.equal(recorder.calls[0]?.stockAtCall, 12);

  variantAdmin.update(variant.id, { priceCents: 9_900 }, context);
  assert.equal(recorder.calls.length, 1);
});

void test('a rolled-back caller transaction discards the observer notification', (t) => {
  const { db, inventory, recorder } = fixture(t);
  const variant = defaultVariantId(db, 49);
  db.prepare('UPDATE product_variants SET stock_count = 0 WHERE id = ?').run(variant);

  assert.throws(
    () =>
      db.transaction(() => {
        inventory.receiveStock({
          idempotencyKey: 'observer-rollback',
          variantId: variant,
          quantity: 5,
          receivedByUserId: 3,
          occurredAt: '2030-01-01T15:00:00.000Z',
        });
        throw new Error('force rollback');
      })(),
    /force rollback/,
  );

  assert.equal(recorder.durableCallCount(), 0);
  assert.equal(
    (
      db.prepare('SELECT stock_count FROM product_variants WHERE id = ?').get(variant) as {
        stock_count: number;
      }
    ).stock_count,
    0,
  );
});

void test('an absent observer leaves receipt, return, and cancellation behaviour unchanged', (t) => {
  const { db } = fixture(t);
  const plain = createInventoryService({ repository: createInventoryRepository(db) });
  const variant = defaultVariantId(db, 49);
  db.prepare(
    'UPDATE product_variants SET stock_count = 0, backorderable = 1, backorder_lead_days = 14 WHERE id = ?',
  ).run(variant);
  const order = placeBackorder(
    db,
    plain,
    variant,
    2,
    'observer-absent',
    '2030-01-01T10:00:00.000Z',
  );
  const receipt = db.transaction(() =>
    plain.receiveStock({
      idempotencyKey: 'observer-absent-receipt',
      variantId: variant,
      quantity: 3,
      receivedByUserId: 3,
      occurredAt: '2030-01-01T11:00:00.000Z',
    }),
  )();
  assert.deepEqual(receipt.allocations, [
    { orderId: order.orderId, orderLineItemId: order.lineId, quantity: 2 },
  ]);
  assert.equal(receipt.remainingStock, 1);
  db.transaction(() =>
    plain.restoreReturnInventory({
      returnRequestId: insertReturnRequest(db, order.orderId),
      lines: [{ variantId: variant, orderLineItemId: order.lineId, quantity: 1 }],
      occurredAt: '2030-01-01T12:00:00.000Z',
    }),
  )();
  assert.deepEqual(
    db.transaction(() =>
      plain.cancelOrderInventory({
        orderId: order.orderId,
        occurredAt: '2030-01-01T13:00:00.000Z',
      }),
    )(),
    [],
  );
});
