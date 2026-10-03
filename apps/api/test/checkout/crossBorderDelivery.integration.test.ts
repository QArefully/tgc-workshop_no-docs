import assert from 'node:assert/strict';
import test from 'node:test';
import type Database from 'better-sqlite3';
import { MOQ_DEFAULT_SACKS } from '@shop/contracts/pricing';
import { createAuditRepository } from '../../src/features/audit/auditRepository.js';
import { createAuditWriter } from '../../src/features/audit/auditService.js';
import { createCartRepository } from '../../src/features/cart/cartRepository.js';
import { addItem, createCart } from '../../src/features/cart/cartService.js';
import {
  createCheckoutService,
  type CheckoutParams,
} from '../../src/features/checkout/checkoutService.js';
import { createInventoryRepository } from '../../src/features/inventory/inventoryRepository.js';
import { createInventoryService } from '../../src/features/inventory/inventoryService.js';
import { createMailboxRepository } from '../../src/features/mailbox/mailboxRepository.js';
import { createOrderRepository } from '../../src/features/orders/orderRepository.js';
import type { PaymentGateway } from '../../src/features/payments/paymentGateway.js';
import { createPaymentRepository } from '../../src/features/payments/paymentRepository.js';
import { createProductRepository } from '../../src/features/catalog/productRepository.js';
import { createPromoRepository } from '../../src/features/promos/promoRepository.js';
import { createUnitOfWork } from '../../src/db/unitOfWork.js';
import { adhocBilling, bookableSlot, checkoutDepthDependencies } from './checkoutDepthFixtures.js';
import { createSeededAppFixture, openSeededDatabase } from '../support/seededDatabase.js';

const NOW = new Date('2026-08-05T10:00:00.000Z');
const CLOCK = { now: () => NOW };

function createFrenchUser(db: Database.Database): number {
  return Number(
    db
      .prepare(
        `INSERT INTO users
           (email, display_name, password_hash, password_salt, role, country, created_at)
         VALUES
           ('cross-border@example.test', 'Cross-border Buyer', 'hash', '', 'customer', 'FR', ?)`,
      )
      .run(NOW.toISOString()).lastInsertRowid,
  );
}

void test('checkout refuses saved and ad-hoc destinations outside the persisted cart country', async (t) => {
  const { db } = openSeededDatabase(t);

  const carts = createCartRepository(db);
  const depth = checkoutDepthDependencies(db, CLOCK);
  const userId = createFrenchUser(db);
  const site = depth.tradeAccount.sites.create(userId, {
    label: 'Paris Depot',
    contactName: 'Depot Foreman',
    address: {
      line1: '1 Rue des Matériaux',
      city: 'Paris',
      postcode: '75001',
      countryCode: 'FR',
    },
  });
  assert.equal(site.ok, true);
  if (!site.ok) throw new Error(`Could not create saved site: ${site.code}`);

  const variantId = (
    db
      .prepare('SELECT id FROM product_variants WHERE active = 1 ORDER BY sort_order, id LIMIT 1')
      .get() as { id: number }
  ).id;
  const freshUkCart = (): string => {
    const { cartId } = createCart(carts, 'UK');
    assert.equal(typeof addItem(carts, cartId, String(variantId), MOQ_DEFAULT_SACKS), 'object');
    return cartId;
  };

  let gatewayCalls = 0;
  const gateway: PaymentGateway = {
    process: () => {
      gatewayCalls += 1;
      return Promise.resolve({ status: 'success' });
    },
  };
  const checkout = createCheckoutService({
    unitOfWork: createUnitOfWork(db),
    carts,
    promos: createPromoRepository(db),
    payments: createPaymentRepository(db),
    orders: createOrderRepository(db),
    mailbox: createMailboxRepository(db),
    gateway,
    clock: CLOCK,
    products: createProductRepository(db),
    audit: createAuditWriter({ repository: createAuditRepository(db), clock: CLOCK }),
    inventory: createInventoryService({ repository: createInventoryRepository(db) }),
    ...depth,
  });

  const params = (cartId: string, idempotencyKey: string): CheckoutParams => ({
    cartId,
    customerName: 'Cross-border Buyer',
    customerEmail: 'cross-border@example.test',
    deliveryDestination: {
      kind: 'adhoc',
      address: {
        line1: '1 Rue des Matériaux',
        city: 'Paris',
        postcode: '75001',
        countryCode: 'FR',
      },
    },
    billingSelection: adhocBilling,
    deliverySlot: bookableSlot(NOW),
    cardNumber: '4242 4242 4242 4242',
    cardExpiry: '12/99',
    cardCvc: '123',
    idempotencyKey,
    userId,
    auditContext: {
      actor: { type: 'user', userId },
      requestId: `request-${idempotencyKey}`,
    },
  });

  await t.test('saved destination is refused against the cart profile', async () => {
    const checkoutParams = params(freshUkCart(), 'cross-border-saved');
    checkoutParams.deliveryDestination = {
      kind: 'saved',
      deliverySiteId: site.value.id,
    };
    assert.deepEqual(await checkout.process(checkoutParams), {
      success: false,
      error: 'DELIVERY_COUNTRY_NOT_ALLOWED',
    });
  });

  await t.test('ad-hoc destination is refused against the cart profile', async () => {
    assert.deepEqual(await checkout.process(params(freshUkCart(), 'cross-border-adhoc')), {
      success: false,
      error: 'DELIVERY_COUNTRY_NOT_ALLOWED',
    });
  });

  assert.equal(gatewayCalls, 0);
});

void test('payment route rejects a delivery address outside the persisted cart country', async (t) => {
  const fixture = await createSeededAppFixture({
    testContext: t,
    app: { clock: CLOCK },
  });
  const { db, app } = fixture;

  const variantId = (
    db
      .prepare('SELECT id FROM product_variants WHERE active = 1 ORDER BY sort_order, id LIMIT 1')
      .get() as { id: number }
  ).id;
  const carts = createCartRepository(db);
  const { cartId } = createCart(carts, 'UK');
  assert.equal(typeof addItem(carts, cartId, String(variantId), MOQ_DEFAULT_SACKS), 'object');

  const response = await app.inject({
    method: 'POST',
    url: '/api/payments/pay',
    payload: {
      cartId,
      customerName: 'Cross-border Buyer',
      customerEmail: 'cross-border-route@example.test',
      deliveryDestination: {
        kind: 'adhoc',
        address: {
          line1: '1 Rue des Materiaux',
          city: 'Paris',
          postcode: '75001',
          countryCode: 'FR',
        },
      },
      billingSelection: adhocBilling,
      deliverySlot: bookableSlot(NOW),
      cardNumber: '4242 4242 4242 4242',
      cardExpiry: '12/99',
      cardCvc: '123',
      idempotencyKey: '84f325f2-d13f-4ce4-8551-ef0a19c634db',
    },
  });

  assert.equal(response.statusCode, 400, response.body);
  assert.deepEqual(response.json(), {
    error: 'Delivery is only available within your country.',
    code: 'DELIVERY_COUNTRY_NOT_ALLOWED',
  });
});
