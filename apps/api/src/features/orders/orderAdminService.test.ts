import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { closeDatabase, openDatabase } from '../../db/index.js';
import { createOrderAdminRepository } from './orderAdminRepository.js';
import { createOrderAdminService, OrderAdminError } from './orderAdminService.js';
import { createOrderRepository } from './orderRepository.js';

function fixture(t: test.TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'shop-order-admin-'));
  const db = openDatabase({ path: join(directory, 'shop.db') });
  t.after(() => {
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  });
  const users = db.prepare(
    `INSERT INTO users (email, display_name, password_hash, password_salt)
     VALUES (?, ?, 'hash', 'salt')`,
  );
  const aliceId = Number(users.run('alice@example.test', 'Alice Buyer').lastInsertRowid);
  const bobId = Number(users.run('bob@example.test', 'Bob Buyer').lastInsertRowid);
  const orders = db.prepare(
    `INSERT INTO orders
      (customer_name, customer_email, shipping_address, promo_code_applied, subtotal_cents,
       discount_cents, total_cents, user_id, created_at, lifecycle_status, version)
     VALUES (?, ?, 'address', ?, 1000, 0, 1000, ?, ?, ?, 0)`,
  );
  const aliceOrderId = Number(
    orders.run(
      'Alice Buyer',
      'alice@example.test',
      'ALICE10',
      aliceId,
      '2026-07-10T10:00:00.000Z',
      'processing',
    ).lastInsertRowid,
  );
  const bobOrderId = Number(
    orders.run(
      'Bob Buyer',
      'bob@example.test',
      null,
      bobId,
      '2026-07-11T10:00:00.000Z',
      'delivered',
    ).lastInsertRowid,
  );
  const paymentId = Number(
    db
      .prepare(
        `INSERT INTO payments
          (order_id, idempotency_key, request_fingerprint, status, amount_cents, card_last4,
           card_brand, created_at)
         VALUES (?, 'captured-payment', 'fingerprint', 'succeeded', 1000, '4242', 'visa', ?)`,
      )
      .run(aliceOrderId, '2026-07-12T10:00:00.000Z').lastInsertRowid,
  );
  const returnId = Number(
    db
      .prepare(
        `INSERT INTO return_requests
          (order_id, user_id, status, reason, version, requested_at, approved_at, received_at, refunded_at)
         VALUES (?, ?, 'refunded', 'other', 3, ?, ?, ?, ?)`,
      )
      .run(
        aliceOrderId,
        aliceId,
        '2026-07-01T00:00:00.000Z',
        '2026-07-02T00:00:00.000Z',
        '2026-07-03T00:00:00.000Z',
        '2026-07-04T00:00:00.000Z',
      ).lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO refunds
      (return_request_id, payment_id, idempotency_key, gross_subtotal_cents, discount_share_cents,
       net_refund_cents, processor, simulated_reference, created_at)
     VALUES (?, ?, 'return-refund', 300, 0, 300, 'simulated', 'return-ref', ?)`,
  ).run(returnId, paymentId, '2026-07-04T00:00:00.000Z');
  db.prepare(
    `INSERT INTO admin_refunds
      (payment_id, order_id, actor_user_id, amount_cents, reason, idempotency_key, processor,
       simulated_reference, created_at)
     VALUES (?, ?, ?, 200, 'Commercial goodwill', 'admin-refund', 'simulated', 'admin-ref', ?)`,
  ).run(paymentId, aliceOrderId, aliceId, '2026-07-05T00:00:00.000Z');
  return {
    service: createOrderAdminService({
      repository: createOrderAdminRepository(db),
      orderRepository: createOrderRepository(db),
    }),
    aliceOrderId,
    bobOrderId,
    paymentId,
  };
}

void test('admin orders list filters across buyers and enforces bounded pages', (t) => {
  const { service, aliceOrderId, bobOrderId, paymentId } = fixture(t);
  const filtered = service.listAdmin({
    userEmail: 'ALICE@example.test',
    promoCode: 'ALICE10',
    status: 'processing',
    occurredFrom: '2026-07-10T00:00:00.000Z',
    occurredTo: '2026-07-10T23:59:59.999Z',
    page: 1,
    pageSize: 10,
  });
  assert.equal(filtered.total, 1);
  assert.equal(filtered.items[0]?.id, String(aliceOrderId));
  assert.equal(filtered.items[0]?.buyer.email, 'alice@example.test');
  const detail = service.getAdminDetail(aliceOrderId);
  assert.equal(detail.id, String(aliceOrderId));
  assert.deepEqual(detail.refundPayment, {
    paymentId: String(paymentId),
    remainingRefundableCents: 500,
  });
  assert.equal(service.getAdminDetail(bobOrderId).refundPayment, null);
  assert.throws(() => service.listAdmin({ page: 0 }), OrderAdminError);
  assert.throws(() => service.listAdmin({ pageSize: 101 }), OrderAdminError);
  assert.throws(() => service.listAdmin({ status: 'unknown' as never }), OrderAdminError);
});
