import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../../src/app.js';
import { openDatabase } from '../../src/db/index.js';
import { createOrderRepository } from '../../src/features/orders/orderRepository.js';
import { createSeededAppFixture } from '../support/seededDatabase.js';

function cookieValue(response: { headers: Record<string, string | string[] | undefined> }): string {
  const header = response.headers['set-cookie'];
  const cookie = Array.isArray(header) ? header[0] : header;
  if (!cookie) throw new Error('Expected set-cookie header');
  return cookie.split(';', 1)[0]!;
}

async function login(app: Awaited<ReturnType<typeof buildApp>>, email: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/login',
    payload: { email, password: 'Password123!', country: 'UK' },
  });
  assert.equal(response.statusCode, 200);
  return cookieValue(response);
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

function createBackorder(
  repository: ReturnType<typeof createOrderRepository>,
  productId: string,
  quantity: number,
  createdAt: string,
): { orderId: number; lineId: number } {
  const orderId = repository.create({
    customerName: 'Backorder Customer',
    customerEmail: 'backorder@example.test',
    shippingAddress: '1 Backorder Lane',
    promoApplied: null,
    subtotalCents: 500,
    discountCents: 0,
    totalCents: 500,
    userId: 1,
    items: [
      {
        productId,
        productName: 'Moon Rock',
        unitPriceCents: 500,
        quantity,
        discountableTotalCents: 500 * quantity,
        blendingFeeCents: 0,
        lineTotalCents: 500 * quantity,
      },
    ],
    createdAt,
  });
  const lineId = Number(repository.findDetailById(orderId)?.items[0]?.lineId);
  if (!Number.isSafeInteger(lineId)) throw new Error('Expected persisted order line');
  return { orderId, lineId };
}

void test('admin receipt authenticates, replays, rejects changed keys, and fulfills FIFO', async (t) => {
  const fixture = await createSeededAppFixture({
    testContext: t,
    app: { clock: { now: () => new Date('2026-07-19T12:10:00.000Z') } },
  });
  const db = fixture.db;
  const variant49 = defaultVariantId(db, 49);
  db.prepare(
    'UPDATE product_variants SET stock_count = 0, backorderable = 1, backorder_lead_days = 14 WHERE id = ?',
  ).run(variant49);
  const orders = createOrderRepository(db);
  const first = createBackorder(orders, '49', 2, '2026-07-19T12:00:00.000Z');
  const second = createBackorder(orders, '49', 2, '2026-07-19T12:01:00.000Z');
  // Update order_line_items to include variant_id
  db.prepare('UPDATE order_line_items SET variant_id = ? WHERE id = ?').run(
    variant49,
    first.lineId,
  );
  db.prepare('UPDATE order_line_items SET variant_id = ? WHERE id = ?').run(
    variant49,
    second.lineId,
  );
  const addAllocation = db.prepare(
    `INSERT INTO order_inventory_allocations
      (order_line_item_id, variant_id, allocated_quantity, backordered_quantity, cancelled_quantity,
       stock_debited_quantity, created_at, updated_at)
     VALUES (?, ?, 0, 2, 0, 0, ?, ?)`,
  );
  addAllocation.run(
    first.lineId,
    variant49,
    '2026-07-19T12:00:00.000Z',
    '2026-07-19T12:00:00.000Z',
  );
  addAllocation.run(
    second.lineId,
    variant49,
    '2026-07-19T12:01:00.000Z',
    '2026-07-19T12:01:00.000Z',
  );
  const app = fixture.app;

  const customerCookie = await login(app, 'alice@example.com');
  const adminCookie = await login(app, 'admin@example.com');
  const payload = {
    variantId: variant49,
    quantity: 3,
    idempotencyKey: '72e6c071-d2df-47d2-8d7f-bb878378e7ae',
  };
  assert.equal(
    (await app.inject({ method: 'POST', url: '/api/admin/inventory/receipts', payload }))
      .statusCode,
    401,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/admin/inventory/receipts',
        headers: { cookie: customerCookie },
        payload,
      })
    ).statusCode,
    403,
  );
  const created = await app.inject({
    method: 'POST',
    url: '/api/admin/inventory/receipts',
    headers: { cookie: adminCookie },
    payload,
  });
  assert.equal(created.statusCode, 201);
  assert.deepEqual(created.json(), {
    receiptId: '1',
    variantId: variant49,
    receivedQuantity: 3,
    allocatedQuantity: 3,
    remainingStock: 0,
    allocations: [
      { orderId: String(first.orderId), orderLineItemId: String(first.lineId), quantity: 2 },
      { orderId: String(second.orderId), orderLineItemId: String(second.lineId), quantity: 1 },
    ],
  });
  const replay = await app.inject({
    method: 'POST',
    url: '/api/admin/inventory/receipts',
    headers: { cookie: adminCookie },
    payload,
  });
  assert.equal(replay.statusCode, 200);
  assert.deepEqual(replay.json(), created.json());
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/admin/inventory/receipts',
        headers: { cookie: adminCookie },
        payload: { ...payload, quantity: 4 },
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/admin/inventory/receipts',
        headers: { cookie: adminCookie },
        payload: {
          variantId: 999999,
          quantity: 1,
          idempotencyKey: '9830252c-d848-4b9c-b7c3-3703a74ac6b5',
        },
      })
    ).statusCode,
    404,
  );
});
