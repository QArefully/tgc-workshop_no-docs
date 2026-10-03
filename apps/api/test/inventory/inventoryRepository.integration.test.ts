import assert from 'node:assert/strict';
import test from 'node:test';
import { openDatabase } from '../../src/db/index.js';
import { createInventoryRepository } from '../../src/features/inventory/inventoryRepository.js';
import { createInventoryService } from '../../src/features/inventory/inventoryService.js';
import { InventoryError } from '../../src/features/inventory/inventoryTypes.js';
import { openSeededDatabase } from '../support/seededDatabase.js';

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
  return { db, inventory: createInventoryService({ repository: createInventoryRepository(db) }) };
}

function insertPayment(db: ReturnType<typeof openDatabase>, key: string): void {
  db.prepare(
    `INSERT INTO payments
      (idempotency_key, request_fingerprint, status, amount_cents, card_last4, card_brand, created_at, updated_at)
     VALUES (?, 'fingerprint', 'prepared', 100, '4242', 'visa', ?, ?)`,
  ).run(key, '2026-07-19T12:00:00.000Z', '2026-07-19T12:00:00.000Z');
}

function insertOrderLine(
  db: ReturnType<typeof openDatabase>,
  variantId: number,
  quantity: number,
): {
  orderId: number;
  lineId: number;
} {
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
     VALUES ('Inventory', 'inventory@example.test', '1 Stock Road', 100, 0, 100, '2026-07-19T12:00:00.000Z')`,
      )
      .run().lastInsertRowid,
  );
  const lineId = Number(
    db
      .prepare(
        `INSERT INTO order_line_items
      (order_id, product_id, product_name, product_price_cents, quantity, line_total_cents, variant_id)
     VALUES (?, ?, 'Inventory product', 100, ?, ?, ?)`,
      )
      .run(orderId, productId, quantity, quantity * 100, variantId).lastInsertRowid,
  );
  return { orderId, lineId };
}

void test('prepared expiry boundary releases final unit and a second connection can reserve it', (t) => {
  const { db, inventory } = fixture(t);
  const variant1 = defaultVariantId(db, 1);
  db.prepare(
    'UPDATE product_variants SET stock_count = 1, backorderable = 0, backorder_lead_days = NULL WHERE id = ?',
  ).run(variant1);
  insertPayment(db, 'first');
  db.transaction(() =>
    inventory.reserveCheckout({
      paymentIdempotencyKey: 'first',
      demands: [{ variantId: variant1, quantity: 1 }],
      now: '2026-07-19T12:00:00.000Z',
      expiresAt: '2026-07-19T12:15:00.000Z',
    }),
  )();
  assert.equal(
    inventory.availableToSell([variant1], '2026-07-19T12:10:00.000Z')[0]?.availableToSell,
    0,
  );
  assert.deepEqual(inventory.expirePrepared('2026-07-19T12:15:00.000Z'), ['first']);
  insertPayment(db, 'second');
  assert.doesNotThrow(() =>
    db.transaction(() =>
      inventory.reserveCheckout({
        paymentIdempotencyKey: 'second',
        demands: [{ variantId: variant1, quantity: 1 }],
        now: '2026-07-19T12:15:00.000Z',
        expiresAt: '2026-07-19T12:30:00.000Z',
      }),
    )(),
  );
});

void test('commit creates exactly one ordinary allocation and receipt replay has no duplicate stock delta', (t) => {
  const { db, inventory } = fixture(t);
  const variant49 = defaultVariantId(db, 49);
  db.prepare(
    'UPDATE product_variants SET stock_count = 0, backorderable = 1, backorder_lead_days = 14 WHERE id = ?',
  ).run(variant49);
  insertPayment(db, 'backorder');
  const order = insertOrderLine(db, variant49, 3);
  db.transaction(() => {
    const split = inventory.reserveCheckout({
      paymentIdempotencyKey: 'backorder',
      demands: [{ variantId: variant49, quantity: 3 }],
      now: '2026-07-19T12:00:00.000Z',
      expiresAt: '2026-07-19T12:15:00.000Z',
    });
    assert.equal(split[0]?.backorderedQuantity, 3);
    inventory.authorizeReservation('backorder', '2026-07-19T12:00:01.000Z');
    inventory.commitReservation({
      paymentIdempotencyKey: 'backorder',
      orderId: order.orderId,
      ordinaryLines: [{ orderLineItemId: order.lineId, variantId: variant49, quantity: 3 }],
      occurredAt: '2026-07-19T12:01:00.000Z',
    });
  })();
  assert.equal(
    (
      db
        .prepare(
          'SELECT COUNT(*) AS count FROM order_inventory_allocations WHERE order_line_item_id = ?',
        )
        .get(order.lineId) as { count: number }
    ).count,
    1,
  );
  const first = db.transaction(() =>
    inventory.receiveStock({
      idempotencyKey: 'receipt',
      variantId: variant49,
      quantity: 3,
      receivedByUserId: 3,
      occurredAt: '2026-07-19T12:02:00.000Z',
    }),
  )();
  const replay = db.transaction(() =>
    inventory.receiveStock({
      idempotencyKey: 'receipt',
      variantId: variant49,
      quantity: 3,
      receivedByUserId: 3,
      occurredAt: '2026-07-19T12:03:00.000Z',
    }),
  )();
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.deepEqual({ ...replay, replayed: false }, first);
  assert.equal(
    (
      db.prepare('SELECT stock_count FROM product_variants WHERE id = ?').get(variant49) as {
        stock_count: number;
      }
    ).stock_count,
    0,
  );
  assert.equal(
    (
      db.prepare('SELECT COUNT(*) AS count FROM inventory_stock_movements').get() as {
        count: number;
      }
    ).count,
    2,
  );
});

void test('outer rollback removes partial reservation and rejects corrupted commit without stock movement', (t) => {
  const { db, inventory } = fixture(t);
  const variant1 = defaultVariantId(db, 1);
  db.prepare(
    'UPDATE product_variants SET stock_count = 1, backorderable = 0, backorder_lead_days = NULL WHERE id = ?',
  ).run(variant1);
  insertPayment(db, 'rollback');
  assert.throws(
    () =>
      db.transaction(() => {
        inventory.reserveCheckout({
          paymentIdempotencyKey: 'rollback',
          demands: [{ variantId: variant1, quantity: 1 }],
          now: '2026-07-19T12:00:00.000Z',
          expiresAt: '2026-07-19T12:15:00.000Z',
        });
        throw new Error('force rollback');
      })(),
    /force rollback/,
  );
  assert.equal(
    (
      db
        .prepare(
          'SELECT COUNT(*) AS count FROM inventory_reservations WHERE payment_idempotency_key = ?',
        )
        .get('rollback') as { count: number }
    ).count,
    0,
  );
  assert.throws(
    () =>
      db.transaction(() =>
        inventory.commitReservation({
          paymentIdempotencyKey: 'rollback',
          orderId: 1,
          ordinaryLines: [],
          occurredAt: '2026-07-19T12:01:00.000Z',
        }),
      )(),
    (error: unknown) => error instanceof InventoryError && error.code === 'RESERVATION_EXPIRED',
  );
  assert.equal(
    (
      db.prepare('SELECT COUNT(*) AS count FROM inventory_stock_movements').get() as {
        count: number;
      }
    ).count,
    0,
  );
});

void test('cancellation restores debited stock into oldest remaining backorder', (t) => {
  const { db, inventory } = fixture(t);
  const variant49 = defaultVariantId(db, 49);
  db.prepare(
    'UPDATE product_variants SET stock_count = 1, backorderable = 1, backorder_lead_days = 14 WHERE id = ?',
  ).run(variant49);
  const first = insertOrderLine(db, variant49, 1);
  insertPayment(db, 'first-order');
  db.transaction(() => {
    inventory.reserveCheckout({
      paymentIdempotencyKey: 'first-order',
      demands: [{ variantId: variant49, quantity: 1 }],
      now: '2026-07-19T12:00:00.000Z',
      expiresAt: '2026-07-19T12:15:00.000Z',
    });
    inventory.authorizeReservation('first-order', '2026-07-19T12:00:01.000Z');
    inventory.commitReservation({
      paymentIdempotencyKey: 'first-order',
      orderId: first.orderId,
      ordinaryLines: [{ orderLineItemId: first.lineId, variantId: variant49, quantity: 1 }],
      occurredAt: '2026-07-19T12:01:00.000Z',
    });
  })();
  const second = insertOrderLine(db, variant49, 1);
  insertPayment(db, 'second-order');
  db.transaction(() => {
    inventory.reserveCheckout({
      paymentIdempotencyKey: 'second-order',
      demands: [{ variantId: variant49, quantity: 1 }],
      now: '2026-07-19T12:02:00.000Z',
      expiresAt: '2026-07-19T12:17:00.000Z',
    });
    inventory.authorizeReservation('second-order', '2026-07-19T12:02:01.000Z');
    inventory.commitReservation({
      paymentIdempotencyKey: 'second-order',
      orderId: second.orderId,
      ordinaryLines: [{ orderLineItemId: second.lineId, variantId: variant49, quantity: 1 }],
      occurredAt: '2026-07-19T12:03:00.000Z',
    });
    const allocations = inventory.cancelOrderInventory({
      orderId: first.orderId,
      occurredAt: '2026-07-19T12:04:00.000Z',
    });
    assert.deepEqual(allocations, [
      { orderId: second.orderId, orderLineItemId: second.lineId, quantity: 1 },
    ]);
  })();
  assert.deepEqual(
    db
      .prepare(
        'SELECT allocated_quantity, backordered_quantity FROM order_inventory_allocations WHERE order_line_item_id = ?',
      )
      .get(second.lineId),
    { allocated_quantity: 1, backordered_quantity: 0 },
  );
  assert.equal(
    (
      db.prepare('SELECT stock_count FROM product_variants WHERE id = ?').get(variant49) as {
        stock_count: number;
      }
    ).stock_count,
    0,
  );
});

void test('authorization at or after expiry cannot revive prepared reservation', (t) => {
  const { db, inventory } = fixture(t);
  const variant1 = defaultVariantId(db, 1);
  db.prepare(
    'UPDATE product_variants SET stock_count = 1, backorderable = 0, backorder_lead_days = NULL WHERE id = ?',
  ).run(variant1);
  insertPayment(db, 'late-authorization');
  db.transaction(() =>
    inventory.reserveCheckout({
      paymentIdempotencyKey: 'late-authorization',
      demands: [{ variantId: variant1, quantity: 1 }],
      now: '2026-07-19T12:00:00.000Z',
      expiresAt: '2026-07-19T12:15:00.000Z',
    }),
  )();
  for (const now of ['2026-07-19T12:15:00.000Z', '2026-07-19T12:15:00.001Z']) {
    assert.throws(
      () => db.transaction(() => inventory.authorizeReservation('late-authorization', now))(),
      (error: unknown) => error instanceof InventoryError && error.code === 'RESERVATION_EXPIRED',
    );
  }
  assert.equal(
    (
      db
        .prepare('SELECT expires_at FROM inventory_reservations WHERE payment_idempotency_key = ?')
        .get('late-authorization') as { expires_at: string }
    ).expires_at,
    '2026-07-19T12:15:00.000Z',
  );
});

void test('receipt allocation becomes cancellable stock and reassigns FIFO', (t) => {
  const { db, inventory } = fixture(t);
  const variant49 = defaultVariantId(db, 49);
  db.prepare(
    'UPDATE product_variants SET stock_count = 0, backorderable = 1, backorder_lead_days = 14 WHERE id = ?',
  ).run(variant49);
  const placeBackorder = (key: string, occurredAt: string) => {
    const order = insertOrderLine(db, variant49, 2);
    insertPayment(db, key);
    db.transaction(() => {
      inventory.reserveCheckout({
        paymentIdempotencyKey: key,
        demands: [{ variantId: variant49, quantity: 2 }],
        now: occurredAt,
        expiresAt: '2026-07-19T12:15:00.000Z',
      });
      inventory.authorizeReservation(key, occurredAt);
      inventory.commitReservation({
        paymentIdempotencyKey: key,
        orderId: order.orderId,
        ordinaryLines: [{ orderLineItemId: order.lineId, variantId: variant49, quantity: 2 }],
        occurredAt,
      });
    })();
    return order;
  };
  const first = placeBackorder('receipt-first', '2026-07-19T12:00:00.000Z');
  const second = placeBackorder('receipt-second', '2026-07-19T12:01:00.000Z');
  db.transaction(() =>
    inventory.receiveStock({
      idempotencyKey: 'receipt-cancel',
      variantId: variant49,
      quantity: 2,
      receivedByUserId: 3,
      occurredAt: '2026-07-19T12:02:00.000Z',
    }),
  )();
  assert.deepEqual(
    db
      .prepare(
        'SELECT allocated_quantity, backordered_quantity, stock_debited_quantity FROM order_inventory_allocations WHERE order_line_item_id = ?',
      )
      .get(first.lineId),
    { allocated_quantity: 2, backordered_quantity: 0, stock_debited_quantity: 2 },
  );
  const reassigned = db.transaction(() =>
    inventory.cancelOrderInventory({
      orderId: first.orderId,
      occurredAt: '2026-07-19T12:03:00.000Z',
    }),
  )();
  assert.deepEqual(reassigned, [
    { orderId: second.orderId, orderLineItemId: second.lineId, quantity: 2 },
  ]);
  assert.deepEqual(
    db
      .prepare(
        'SELECT allocated_quantity, backordered_quantity, stock_debited_quantity FROM order_inventory_allocations WHERE order_line_item_id = ?',
      )
      .get(second.lineId),
    { allocated_quantity: 2, backordered_quantity: 0, stock_debited_quantity: 2 },
  );
  assert.equal(
    (
      db.prepare('SELECT stock_count FROM product_variants WHERE id = ?').get(variant49) as {
        stock_count: number;
      }
    ).stock_count,
    0,
  );
});
