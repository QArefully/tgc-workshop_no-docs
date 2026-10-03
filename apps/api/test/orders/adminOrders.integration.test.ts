import assert from 'node:assert/strict';
import test from 'node:test';
import { openSeededDatabase } from '../support/seededDatabase.js';
import { createOrderAdminRepository } from '../../src/features/orders/orderAdminRepository.js';
import { createOrderAdminService } from '../../src/features/orders/orderAdminService.js';
import { createOrderRepository } from '../../src/features/orders/orderRepository.js';

function createOrderFixture(t: test.TestContext) {
  const { db } = openSeededDatabase(t);
  const orders = createOrderRepository(db);
  const createdAt = '2026-09-01T09:00:00.000Z';
  const userId = 9401;
  const companyId = 9401;
  db.prepare(
    `INSERT INTO users (id, email, display_name, password_hash, password_salt, role, country)
     VALUES (?, 'admin-order-buyer@example.test', 'Admin Order Buyer', 'hash', 'salt', 'customer', 'UK')`,
  ).run(userId);
  db.prepare(
    `INSERT INTO company_accounts
      (id, name, created_by_user_id, active, approval_threshold_cents, credit_limit_cents,
       credit_terms_days, credit_state, credit_version, created_at, updated_at, country)
     VALUES (?, 'Admin Order Materials Ltd', ?, 1, 0, 100000, 30, 'active', 0, ?, ?, 'UK')`,
  ).run(companyId, userId, createdAt, createdAt);
  const orderInput = {
    country: 'UK' as const,
    customerName: 'Admin Order Buyer',
    customerEmail: 'admin-order-buyer@example.test',
    shippingAddress: '1 Admin Order Lane',
    promoApplied: null,
    subtotalCents: 10000,
    discountCents: 0,
    totalCents: 12000,
    userId,
    items: [
      {
        productId: '1',
        productName: 'Material sacks',
        unitPriceCents: 10000,
        quantity: 1,
        discountableTotalCents: 10000,
        blendingFeeCents: 0,
        lineTotalCents: 10000,
      },
    ],
    createdAt,
  };
  const cardOrderId = orders.create({
    ...orderInput,
    totalCents: 1000,
    subtotalCents: 1000,
    items: [
      {
        ...orderInput.items[0],
        unitPriceCents: 1000,
        discountableTotalCents: 1000,
        lineTotalCents: 1000,
      },
    ],
  });
  const creditOrderId = orders.create({
    ...orderInput,
    paymentMethod: 'trade_credit' as const,
    companyId,
    netCents: 10000,
    vatRateBasisPoints: 2000,
    vatCents: 2000,
    grossCents: 12000,
  });
  db.prepare(
    `INSERT INTO payments
      (id, order_id, idempotency_key, request_fingerprint, status, amount_cents,
       card_last4, card_brand, created_at, payment_method, company_id, user_id)
     VALUES (9401, ?, '123e4567-e89b-42d3-a456-426614174902', 'card-admin-order',
             'succeeded', 1000, '4242', 'visa', ?, 'card', NULL, NULL)`,
  ).run(cardOrderId, createdAt);
  db.prepare(
    `INSERT INTO payments
      (id, order_id, idempotency_key, request_fingerprint, status, amount_cents,
       card_last4, card_brand, created_at, payment_method, company_id, user_id)
     VALUES (9402, ?, '123e4567-e89b-42d3-a456-426614174903', 'credit-admin-order',
             'succeeded', 12000, NULL, NULL, ?, 'trade_credit', ?, ?)`,
  ).run(creditOrderId, createdAt, companyId, userId);
  const service = createOrderAdminService({
    repository: createOrderAdminRepository(db),
    orderRepository: orders,
  });
  return { service, cardOrderId, creditOrderId };
}

void test('admin credit detail exposes frozen invoice accounting facts and no card refund balance', (t) => {
  const fixture = createOrderFixture(t);
  const credit = fixture.service.getAdminDetail(fixture.creditOrderId);
  assert.equal(credit.paymentMethod, 'trade_credit');
  assert.equal(credit.companyId, '9401');
  assert.equal(credit.netCents, 10000);
  assert.equal(credit.vatRateBasisPoints, 2000);
  assert.equal(credit.vatCents, 2000);
  assert.equal(credit.grossCents, 12000);
  assert.equal(credit.refundPayment, null);
});

void test('admin card detail retains captured refund projection', (t) => {
  const fixture = createOrderFixture(t);
  const card = fixture.service.getAdminDetail(fixture.cardOrderId);
  assert.deepEqual(card.refundPayment, {
    paymentId: '9401',
    remainingRefundableCents: 1000,
  });
});
