import assert from 'node:assert/strict';
import test from 'node:test';
import type Database from 'better-sqlite3';
import {
  createCheckoutService,
  type CheckoutParams,
} from '../../src/features/checkout/checkoutService.js';
import { createAuditRepository } from '../../src/features/audit/auditRepository.js';
import { createAuditWriter } from '../../src/features/audit/auditService.js';
import { createCartRepository } from '../../src/features/cart/cartRepository.js';
import { addItem, createCart } from '../../src/features/cart/cartService.js';
import { createProductRepository } from '../../src/features/catalog/productRepository.js';
import { createCountryProfileService } from '../../src/features/countryProfile/countryProfileService.js';
import { openSeededDatabase, createSeededAppFixture } from '../support/seededDatabase.js';
import { createUnitOfWork } from '../../src/db/unitOfWork.js';
import { createInventoryRepository } from '../../src/features/inventory/inventoryRepository.js';
import { createInventoryService } from '../../src/features/inventory/inventoryService.js';
import { createMailboxRepository } from '../../src/features/mailbox/mailboxRepository.js';
import { createOrderRepository } from '../../src/features/orders/orderRepository.js';
import type { PaymentGateway } from '../../src/features/payments/paymentGateway.js';
import { createPaymentRepository } from '../../src/features/payments/paymentRepository.js';
import { createPromoRepository } from '../../src/features/promos/promoRepository.js';
import {
  adhocBilling,
  adhocDestination,
  bookableSlot,
  checkoutDepthDependencies,
} from './checkoutDepthFixtures.js';

const NOW = new Date('2026-08-05T10:00:00.000Z');

function rowCount(db: Database.Database, sql: string, ...params: unknown[]): number {
  return (db.prepare(sql).get(...params) as { count: number }).count;
}

void test('checkout rejects a persisted-country blocked line before reservations or gateway', async (t) => {
  const { db } = openSeededDatabase(t);

  const row = db
    .prepare(
      `SELECT v.id AS variant_id, p.id AS product_id
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
       WHERE p.category = 'Sports Nutrition' AND p.active = 1 AND v.active = 1
       ORDER BY p.id, v.sort_order
       LIMIT 1`,
    )
    .get() as { variant_id: number; product_id: number } | undefined;
  assert.ok(row, 'seed must contain an active Sports Nutrition lot');
  db.prepare('UPDATE product_variants SET stock_count = 100 WHERE id = ?').run(row.variant_id);

  const carts = createCartRepository(db);
  const { cartId } = createCart(carts, 'US');
  assert.equal(typeof addItem(carts, cartId, String(row.variant_id)), 'object');
  // Simulates a persisted cart country changing after the line was accepted. Checkout must use
  // this row, not any caller-controlled request country.
  db.prepare("UPDATE carts SET country = 'CN' WHERE id = ?").run(cartId);

  let gatewayCalls = 0;
  const gateway: PaymentGateway = {
    process: () => {
      gatewayCalls += 1;
      return Promise.resolve({ status: 'success' });
    },
  };
  const clock = { now: () => NOW };
  const inventory = createInventoryService({ repository: createInventoryRepository(db) });
  const checkout = createCheckoutService({
    unitOfWork: createUnitOfWork(db),
    carts,
    promos: createPromoRepository(db),
    payments: createPaymentRepository(db),
    orders: createOrderRepository(db),
    mailbox: createMailboxRepository(db),
    gateway,
    clock,
    products: createProductRepository(db),
    audit: createAuditWriter({ repository: createAuditRepository(db), clock }),
    inventory,
    countryProfiles: createCountryProfileService(),
    ...checkoutDepthDependencies(db, clock),
  });
  const idempotencyKey = 'checkout-country-blocked';
  const params: CheckoutParams = {
    cartId,
    customerName: 'Country Buyer',
    customerEmail: 'country-buyer@example.test',
    deliveryDestination: adhocDestination,
    billingSelection: adhocBilling,
    deliverySlot: bookableSlot(NOW),
    cardNumber: '4242 4242 4242 4242',
    cardExpiry: '12/99',
    cardCvc: '123',
    idempotencyKey,
    userId: null,
    auditContext: {
      actor: { type: 'anonymous', userId: null },
      requestId: 'request-checkout-country-blocked',
    },
  };
  const movementsBefore = rowCount(db, 'SELECT COUNT(*) AS count FROM inventory_stock_movements');

  assert.deepEqual(await checkout.process(params), {
    success: false,
    error: 'BLOCKED_IN_COUNTRY',
    productIds: [String(row.product_id)],
  });
  assert.equal(gatewayCalls, 0);
  assert.equal(
    rowCount(
      db,
      'SELECT COUNT(*) AS count FROM cart_reservations WHERE payment_idempotency_key = ?',
      idempotencyKey,
    ),
    0,
  );
  assert.equal(
    rowCount(
      db,
      'SELECT COUNT(*) AS count FROM inventory_reservations WHERE payment_idempotency_key = ?',
      idempotencyKey,
    ),
    0,
  );
  assert.equal(
    rowCount(db, 'SELECT COUNT(*) AS count FROM inventory_stock_movements'),
    movementsBefore,
  );
});

void test('the payment route maps BLOCKED_IN_COUNTRY to a 409 pre-gateway conflict', async (t) => {
  const fixture = await createSeededAppFixture({
    testContext: t,
    app: { clock: { now: () => NOW } },
  });
  const { db, app } = fixture;

  const variant = db
    .prepare(
      `SELECT v.id, p.id AS product_id
       FROM product_variants v JOIN products p ON p.id = v.product_id
       WHERE p.category = 'Sports Nutrition' AND p.active = 1 AND v.active = 1
       ORDER BY p.id, v.sort_order LIMIT 1`,
    )
    .get() as { id: number; product_id: number } | undefined;
  assert.ok(variant);
  const carts = createCartRepository(db);
  const { cartId } = createCart(carts, 'US');
  assert.equal(typeof addItem(carts, cartId, String(variant.id)), 'object');
  db.prepare("UPDATE carts SET country = 'CN' WHERE id = ?").run(cartId);

  const response = await app.inject({
    method: 'POST',
    url: '/api/payments/pay',
    payload: {
      cartId,
      customerName: 'Country Buyer',
      customerEmail: 'country-buyer@example.test',
      deliveryDestination: adhocDestination,
      billingSelection: adhocBilling,
      deliverySlot: bookableSlot(NOW),
      cardNumber: '4242 4242 4242 4242',
      cardExpiry: '12/99',
      cardCvc: '123',
      idempotencyKey: '9e62272c-ea5e-4be9-b174-dc735f3816d7',
    },
  });
  assert.equal(response.statusCode, 409, response.body);
  assert.deepEqual(response.json(), {
    error: 'This item is not available in your country.',
    code: 'BLOCKED_IN_COUNTRY',
    meta: { productIds: [String(variant.product_id)] },
  });
});
