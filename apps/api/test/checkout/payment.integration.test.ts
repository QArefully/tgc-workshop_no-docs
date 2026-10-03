import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  createCheckoutService,
  type CheckoutParams,
} from '../../src/features/checkout/checkoutService.js';
import type {
  GatewayResult,
  PaymentGateway,
  PaymentGatewayRequest,
} from '../../src/features/payments/paymentGateway.js';
import { createCartRepository } from '../../src/features/cart/cartRepository.js';
import { addItem, createCart, getCart } from '../../src/features/cart/cartService.js';
import { createSeededAppFixture, openSeededDatabase } from '../support/seededDatabase.js';
import { createPromoRepository } from '../../src/features/promos/promoRepository.js';
import {
  createPaymentRepository,
  parsePersistedCheckoutQuote,
} from '../../src/features/payments/paymentRepository.js';
import { createOrderRepository } from '../../src/features/orders/orderRepository.js';
import { createMailboxRepository } from '../../src/features/mailbox/mailboxRepository.js';
import { createUnitOfWork } from '../../src/db/unitOfWork.js';
import {
  AUTHORITATIVE_CURRENCY,
  simulatedPaymentGateway,
} from '../../src/features/payments/paymentGateway.js';
import { createProductRepository } from '../../src/features/catalog/productRepository.js';
import { createAuditRepository } from '../../src/features/audit/auditRepository.js';
import { createAuditWriter } from '../../src/features/audit/auditService.js';
import { createInventoryRepository } from '../../src/features/inventory/inventoryRepository.js';
import { createInventoryService } from '../../src/features/inventory/inventoryService.js';
import { minimumOrderQuantity } from '../../src/features/pricing/pricingRules.js';
import {
  adhocBilling,
  adhocDestination,
  bookableSlot,
  checkoutDepthDependencies,
} from './checkoutDepthFixtures.js';

function checkout(
  params: CheckoutParams,
  dependencies: {
    db: import('better-sqlite3').Database;
    gateway?: PaymentGateway;
    now?: () => Date;
  },
) {
  const carts = createCartRepository(dependencies.db);
  return createCheckoutService({
    unitOfWork: createUnitOfWork(dependencies.db),
    carts,
    promos: createPromoRepository(dependencies.db),
    payments: createPaymentRepository(dependencies.db),
    orders: createOrderRepository(dependencies.db),
    mailbox: createMailboxRepository(dependencies.db),
    gateway: dependencies.gateway ?? simulatedPaymentGateway,
    clock: { now: dependencies.now ?? (() => new Date()) },
    products: createProductRepository(dependencies.db),
    audit: createAuditWriter({
      repository: createAuditRepository(dependencies.db),
      clock: { now: dependencies.now ?? (() => new Date()) },
    }),
    inventory: createInventoryService({ repository: createInventoryRepository(dependencies.db) }),
    ...checkoutDepthDependencies(dependencies.db, {
      now: dependencies.now ?? (() => new Date()),
    }),
  }).process(params);
}

function deferredGateway(): { gateway: PaymentGateway; resolve: (result: GatewayResult) => void } {
  let resolve!: (result: GatewayResult) => void;
  return {
    gateway: {
      process: async () =>
        new Promise<GatewayResult>((done) => {
          resolve = done;
        }),
    },
    resolve: (result) => resolve(result),
  };
}

function spyGateway(result: GatewayResult = { status: 'success' }): {
  gateway: PaymentGateway;
  calls: () => number;
  requests: () => PaymentGatewayRequest[];
} {
  let count = 0;
  const requests: PaymentGatewayRequest[] = [];
  return {
    gateway: {
      process: (request) => {
        count += 1;
        requests.push(request);
        return Promise.resolve(result);
      },
    },
    calls: () => count,
    requests: () => requests,
  };
}

void test('payment route emits stable localized code for invalid card details', async (t) => {
  const { db, app } = await createSeededAppFixture(t);

  const response = await app.inject({
    method: 'POST',
    url: '/api/payments/pay',
    headers: { 'x-shop-country': 'DE' },
    payload: {
      cartId: '00000000-0000-4000-8000-000000000000',
      customerName: 'Checkout Test',
      customerEmail: 'checkout@example.test',
      deliveryDestination: adhocDestination,
      billingSelection: adhocBilling,
      deliverySlot: bookableSlot(),
      cardNumber: '4242 4242 4242 4242',
      cardExpiry: '01/20',
      cardCvc: '123',
      idempotencyKey: '00000000-0000-4000-8000-000000000001',
    },
  });
  assert.equal(response.statusCode, 400, response.body);
  const body = response.json<{ code: string; error: string }>();
  assert.equal(body.code, 'CARD_INVALID');
  assert.notEqual(body.error, 'Invalid card details');

  const carts = createCartRepository(db);
  const cartId = createCart(carts).cartId;
  const variant = db
    .prepare(
      'SELECT id, weight_grams, moq_sacks FROM product_variants WHERE active = 1 ORDER BY id LIMIT 1',
    )
    .get() as { id: number; weight_grams: number; moq_sacks: number };
  carts.addLineQuantity(cartId, String(variant.id), 1);
  const belowMoq = await app.inject({
    method: 'POST',
    url: '/api/payments/pay',
    headers: { 'x-shop-country': 'DE' },
    payload: {
      cartId,
      customerName: 'Checkout Test',
      customerEmail: 'checkout@example.test',
      deliveryDestination: adhocDestination,
      billingSelection: adhocBilling,
      deliverySlot: bookableSlot(),
      cardNumber: '4242 4242 4242 4242',
      cardExpiry: '12/99',
      cardCvc: '123',
      idempotencyKey: '00000000-0000-4000-8000-000000000002',
    },
  });
  assert.equal(belowMoq.statusCode, 400);
  const belowMoqBody = belowMoq.json<{
    error: string;
    code: string;
    meta?: { minQuantity?: number };
  }>();
  assert.equal(belowMoqBody.code, 'BELOW_MOQ');
  assert.deepEqual(belowMoqBody.meta, {
    minQuantity: minimumOrderQuantity(variant.weight_grams, variant.moq_sacks),
  });
  assert.notEqual(
    belowMoqBody.error,
    'Cart quantity does not meet a variant minimum order quantity',
  );

  const promoCartId = createCart(carts).cartId;
  const minimumQuantity = minimumOrderQuantity(variant.weight_grams, variant.moq_sacks);
  if (minimumQuantity === undefined) throw new Error('Expected a valid seeded MOQ');
  carts.addLineQuantity(promoCartId, String(variant.id), minimumQuantity);
  db.prepare('UPDATE product_variants SET price_cents = 1 WHERE id = ?').run(variant.id);
  const promoThreshold = await app.inject({
    method: 'POST',
    url: '/api/payments/pay',
    headers: { 'x-shop-country': 'DE' },
    payload: {
      cartId: promoCartId,
      customerName: 'Checkout Test',
      customerEmail: 'checkout@example.test',
      promoCode: 'SAVE20',
      deliveryDestination: adhocDestination,
      billingSelection: adhocBilling,
      deliverySlot: bookableSlot(),
      cardNumber: '4242 4242 4242 4242',
      cardExpiry: '12/99',
      cardCvc: '123',
      idempotencyKey: '00000000-0000-4000-8000-000000000003',
    },
  });
  assert.equal(promoThreshold.statusCode, 400);
  const promoBody = promoThreshold.json<{
    error: string;
    code: string;
    meta?: { minSubtotalCents?: number };
  }>();
  assert.equal(promoBody.code, 'PROMO_MIN_SUBTOTAL');
  assert.deepEqual(promoBody.meta, { minSubtotalCents: 10_000 });
  assert.notEqual(promoBody.error, 'Minimum qualifying subtotal required');
});

void test('atomic checkout orchestration', async (t) => {
  let db!: import('better-sqlite3').Database;
  let carts!: ReturnType<typeof createCartRepository>;
  const startCase = (): void => {
    const fixture = openSeededDatabase(t);
    db = fixture.db;
    carts = createCartRepository(db);
  };
  // `now` must match the clock the suite runs checkout under: the booked slot is re-validated
  // against a lead time derived from that same instant.
  const payment = (
    cartId: string,
    idempotencyKey: string,
    now: Date = new Date(),
  ): CheckoutParams => ({
    cartId,
    customerName: 'Checkout Test',
    customerEmail: 'checkout@example.test',
    deliveryDestination: adhocDestination,
    billingSelection: adhocBilling,
    deliverySlot: bookableSlot(now),
    cardNumber: '4242 4242 4242 4242',
    cardExpiry: '12/99',
    cardCvc: '123',
    idempotencyKey,
    userId: null,
    auditContext: {
      actor: { type: 'anonymous', userId: null },
      requestId: `request-${idempotencyKey}`,
    },
  });
  const freshCart = () => {
    const { cartId } = createCart(carts);
    const vId = (
      db
        .prepare('SELECT id FROM product_variants WHERE active = 1 ORDER BY sort_order LIMIT 1')
        .get() as { id: number } | undefined
    )?.id;
    if (!vId) throw new Error('No active variants found');
    addItem(carts, cartId, String(vId));
    return cartId;
  };

  function addVariantForProduct(cartId: string, productId: number) {
    const row = db
      .prepare(
        'SELECT id FROM product_variants WHERE product_id = ? AND active = 1 ORDER BY sort_order LIMIT 1',
      )
      .get(productId) as { id: number } | undefined;
    if (!row) throw new Error(`No active variant for product ${productId}`);
    return addItem(carts, cartId, String(row.id));
  }

  function freshGardenClearanceCart() {
    const { cartId } = createCart(carts);
    const variant = db
      .prepare(
        `SELECT v.id, p.id AS product_id
         FROM product_variants v
         JOIN products p ON p.id = v.product_id
         WHERE v.sku = 'GDN-1043-001'`,
      )
      .get() as { id: number; product_id: number } | undefined;
    if (!variant) throw new Error('Expected active Garden clearance variant');
    addItem(carts, cartId, String(variant.id));
    return { cartId, productId: variant.product_id };
  }

  await t.test('reserves same-key work once and replays its completed order', async () => {
    startCase();
    const cartId = freshCart();
    const deferred = deferredGateway();
    const params = payment(cartId, 'same-key');
    const first = checkout(params, { db, gateway: deferred.gateway });
    const concurrent = await checkout(params, { db, gateway: deferred.gateway });
    assert.deepEqual(concurrent, { success: false, error: 'IDEMPOTENT_IN_PROGRESS' });
    deferred.resolve({ status: 'success' });
    const completed = await first;
    assert.equal(completed.success, true);
    const replay = await checkout(params, { db, gateway: deferred.gateway });
    assert.deepEqual(replay, completed);
    assert.ok(
      (
        db
          .prepare('SELECT response_json FROM payments WHERE idempotency_key = ?')
          .get('same-key') as {
          response_json: string | null;
        }
      ).response_json,
    );
    assert.equal(
      (
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM orders WHERE customer_email = 'checkout@example.test'",
          )
          .get() as { count: number }
      ).count,
      1,
    );
  });

  await t.test(
    'rejects concurrent same-key changed payload without a duplicate order',
    async () => {
      startCase();
      const cartId = freshCart();
      const deferred = deferredGateway();
      const params = payment(cartId, 'conflict-key');
      const first = checkout(params, { db, gateway: deferred.gateway });
      const conflict = await checkout(
        { ...params, customerName: 'Changed customer' },
        { db, gateway: deferred.gateway },
      );
      assert.deepEqual(conflict, { success: false, error: 'IDEMPOTENT_CONFLICT' });
      deferred.resolve({ status: 'success' });
      assert.equal((await first).success, true);
      assert.equal(
        (
          db
            .prepare(
              "SELECT COUNT(*) AS count FROM orders WHERE customer_email = 'checkout@example.test'",
            )
            .get() as { count: number }
        ).count,
        1,
      );
    },
  );

  await t.test('rejects same-key changed card expiry without another gateway request', async () => {
    startCase();
    const cartId = freshCart();
    const gateway = spyGateway();
    const params = payment(cartId, 'expiry-conflict');
    assert.equal((await checkout(params, { db, gateway: gateway.gateway })).success, true);

    const conflict = await checkout(
      { ...params, cardExpiry: '11/99' },
      { db, gateway: gateway.gateway },
    );
    assert.deepEqual(conflict, { success: false, error: 'IDEMPOTENT_CONFLICT' });
    assert.equal(gateway.calls(), 1);
  });

  await t.test('replays decline and timeout deterministically', async () => {
    startCase();
    for (const result of [{ status: 'declined' }, { status: 'timeout' }] as const) {
      const cartId = freshCart();
      const params = payment(cartId, `failure-${result.status}`);
      const gateway: PaymentGateway = { process: () => Promise.resolve(result) };
      const first = await checkout(params, { db, gateway });
      const replay = await checkout(params, { db, gateway });
      assert.deepEqual(replay, first);
      assert.equal(getCart(carts, cartId)?.totalItems, 4);
      const events = db
        .prepare('SELECT action, entity_id FROM audit_events WHERE request_id = ?')
        .all(params.auditContext.requestId) as Array<{ action: string; entity_id: string }>;
      assert.deepEqual(
        events.map((event) => event.action),
        [result.status === 'declined' ? 'payment.declined' : 'payment.timed_out'],
      );
      assert.match(events[0]?.entity_id ?? '', /^\d+$/);
    }
  });

  await t.test('does not call gateway when cart is missing', async () => {
    startCase();
    const gateway = spyGateway();

    const result = await checkout(payment('missing-cart', 'missing-cart'), {
      db,
      gateway: gateway.gateway,
    });

    assert.deepEqual(result, { success: false, error: 'CART_NOT_FOUND' });
    assert.equal(gateway.calls(), 0);
    const event = db
      .prepare('SELECT action, entity_id, metadata_json FROM audit_events WHERE request_id = ?')
      .get('request-missing-cart') as {
      action: string;
      entity_id: string;
      metadata_json: string;
    };
    assert.equal(event.action, 'payment.pre_gateway_failed');
    assert.match(event.entity_id, /^\d+$/);
    assert.equal(event.metadata_json, '{"errorCode":"CART_NOT_FOUND"}');
  });

  await t.test('rolls back pre-gateway failure when its audit write fails', async () => {
    startCase();
    db.exec(
      `CREATE TRIGGER abort_pre_gateway_audit BEFORE INSERT ON audit_events
       WHEN NEW.action = 'payment.pre_gateway_failed'
       BEGIN SELECT RAISE(ABORT, 'audit failure'); END`,
    );
    try {
      await assert.rejects(() =>
        checkout(payment('missing-audit-cart', 'pre-gateway-audit-rollback'), { db }),
      );
      assert.equal(
        (
          db
            .prepare('SELECT COUNT(*) AS count FROM payments WHERE idempotency_key = ?')
            .get('pre-gateway-audit-rollback') as { count: number }
        ).count,
        0,
      );
    } finally {
      db.exec('DROP TRIGGER IF EXISTS abort_pre_gateway_audit');
    }
  });

  await t.test('does not call gateway when cart is empty', async () => {
    startCase();
    const { cartId } = createCart(carts);
    const gateway = spyGateway();

    const result = await checkout(payment(cartId, 'empty-cart'), { db, gateway: gateway.gateway });

    assert.deepEqual(result, { success: false, error: 'CART_EMPTY' });
    assert.equal(gateway.calls(), 0);
  });

  await t.test('rejects a cart line below its variant MOQ before gateway processing', async () => {
    startCase();
    const cartId = createCart(carts).cartId;
    const variant = db
      .prepare('SELECT id FROM product_variants WHERE active = 1 ORDER BY id LIMIT 1')
      .get() as { id: number };
    carts.addLineQuantity(cartId, String(variant.id), 1);
    const gateway = spyGateway();

    const result = await checkout(payment(cartId, 'below-moq-checkout'), {
      db,
      gateway: gateway.gateway,
    });

    const facts = db
      .prepare('SELECT weight_grams, moq_sacks FROM product_variants WHERE id = ?')
      .get(variant.id) as { weight_grams: number; moq_sacks: number };
    assert.deepEqual(result, {
      success: false,
      error: 'BELOW_MOQ',
      minQuantity: minimumOrderQuantity(facts.weight_grams, facts.moq_sacks),
    });
    assert.equal(gateway.calls(), 0);
  });

  await t.test('does not call gateway for invalid or ineligible promos', async () => {
    startCase();
    const invalidCartId = freshCart();
    const invalidGateway = spyGateway();
    const invalid = await checkout(
      { ...payment(invalidCartId, 'invalid-promo'), promoCode: 'NOT-A-PROMO' },
      { db, gateway: invalidGateway.gateway },
    );

    const ineligibleCartId = freshCart();
    const ineligibleGateway = spyGateway();
    const ineligible = await checkout(
      { ...payment(ineligibleCartId, 'ineligible-promo'), promoCode: 'SAVE10' },
      { db, gateway: ineligibleGateway.gateway },
    );
    assert.equal(invalid.error, 'PROMO_INVALID');
    assert.equal(ineligible.error, 'PROMO_INVALID');
    assert.equal(invalidGateway.calls(), 0);
    assert.equal(ineligibleGateway.calls(), 0);

    const thresholdCartId = freshCart();
    const thresholdVariant = db
      .prepare('SELECT variant_id FROM cart_line_items WHERE cart_id = ? LIMIT 1')
      .get(thresholdCartId) as { variant_id: number };
    db.prepare('UPDATE product_variants SET price_cents = 1 WHERE id = ?').run(
      thresholdVariant.variant_id,
    );
    const thresholdGateway = spyGateway();
    const threshold = await checkout(
      { ...payment(thresholdCartId, 'min-subtotal-promo'), promoCode: 'SAVE20' },
      { db, gateway: thresholdGateway.gateway },
    );
    assert.equal(threshold.success, false);
    if (!threshold.success) {
      assert.equal(threshold.error, 'PROMO_INVALID');
      assert.equal(threshold.promoErrorCode, 'MIN_SUBTOTAL');
      assert.equal(threshold.minSubtotalCents, 10_000);
    }
    assert.equal(thresholdGateway.calls(), 0);
  });

  await t.test('uses checkout clock at promo expiry boundary', async () => {
    startCase();
    const cartId = freshCart();
    for (const productId of [2, 3]) addVariantForProduct(cartId, productId);
    const checkoutClock = new Date('2024-12-31T23:59:59.999Z');

    const result = await checkout(
      { ...payment(cartId, 'clock-boundary', checkoutClock), promoCode: 'EXPIRED10' },
      { db, now: () => checkoutClock },
    );

    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.order.promoApplied, 'EXPIRED10');
      assert.equal(result.order.createdAt, checkoutClock.toISOString());
    }
  });

  await t.test('charges the persisted server quote total', async () => {
    startCase();
    const cartId = freshCart();
    const gateway = spyGateway();
    const result = await checkout(payment(cartId, 'quoted-amount'), {
      db,
      gateway: gateway.gateway,
    });
    const quoteJson = createPaymentRepository(db).load('quoted-amount')?.quoteJson;
    if (!quoteJson) throw new Error('Expected persisted checkout quote');
    const expectedTotal = parsePersistedCheckoutQuote(quoteJson).totalCents;

    assert.equal(result.success, true);
    assert.equal(gateway.requests()[0]?.amountCents, expectedTotal);
    assert.equal(AUTHORITATIVE_CURRENCY, 'GBP');
    assert.equal(gateway.requests()[0]?.currency, AUTHORITATIVE_CURRENCY);
    if (result.success) assert.equal(result.order.totalCents, expectedTotal);
    const receiptRow = db
      .prepare(
        `SELECT kind, order_id, body FROM dev_mailbox
         WHERE recipient = ? ORDER BY id DESC LIMIT 1`,
      )
      .get('checkout@example.test') as { kind: string; order_id: number; body: string };
    assert.equal(receiptRow.kind, 'order_receipt');
    assert.equal(result.success, true);
    if (result.success) assert.equal(receiptRow.order_id, Number(result.order.id));
    assert.doesNotMatch(receiptRow.body, /[$£€]|converted|total:/i);
  });

  await t.test(
    'checks out an active clearance scoped promo, persists its disclosure, and replays one key',
    async () => {
      startCase();
      const now = new Date('2026-07-28T12:00:00.000Z');
      const { cartId } = freshGardenClearanceCart();
      const gateway = spyGateway();
      const params = {
        ...payment(cartId, 'garden-clearance-scoped-replay', now),
        promoCode: 'GARDEN10',
      };

      const completed = await checkout(params, { db, gateway: gateway.gateway, now: () => now });
      assert.equal(completed.success, true, JSON.stringify(completed));
      if (!completed.success) return;

      const quoteJson = createPaymentRepository(db).load(params.idempotencyKey)?.quoteJson;
      if (!quoteJson) throw new Error('Expected persisted scoped clearance quote');
      const quote = parsePersistedCheckoutQuote(quoteJson);
      assert.equal(quote.variantLines[0]?.unitPriceCents, 24_000);
      assert.equal(quote.promoCode, 'GARDEN10');
      assert.equal(quote.promoCategoryScope, 'Garden & Outdoors');
      assert.equal(quote.discountBaseCents, quote.subtotalCents);
      assert.equal(quote.deliverySummary.mode, 'freight');
      assert.deepEqual(quote.deliverySlot, params.deliverySlot);
      assert.equal(completed.order.promoApplied, 'GARDEN10');
      assert.equal(completed.order.promoCategoryScope, 'Garden & Outdoors');
      assert.equal(completed.order.discountBaseCents, quote.discountBaseCents);
      assert.equal(completed.order.deliveryMode, 'freight');
      assert.equal(completed.order.deliveryChargeCents, quote.deliverySummary.chargeCents);
      assert.deepEqual(completed.order.deliverySlot, params.deliverySlot);

      const persisted = db
        .prepare(
          `SELECT promo_category_scope, discount_base_cents, delivery_mode, delivery_charge_cents
           FROM orders WHERE id = ?`,
        )
        .get(Number(completed.order.id)) as {
        promo_category_scope: string;
        discount_base_cents: number;
        delivery_mode: string;
        delivery_charge_cents: number;
      };
      assert.deepEqual(persisted, {
        promo_category_scope: 'Garden & Outdoors',
        discount_base_cents: quote.discountBaseCents,
        delivery_mode: 'freight',
        delivery_charge_cents: quote.deliverySummary.chargeCents,
      });

      assert.deepEqual(
        await checkout(params, { db, gateway: gateway.gateway, now: () => now }),
        completed,
      );
      assert.equal(gateway.calls(), 1);
    },
  );

  await t.test(
    'rejects a scoped promo after its cart category changes without held reservations',
    async () => {
      startCase();
      const now = new Date('2026-07-28T12:00:00.000Z');
      const { cartId, productId } = freshGardenClearanceCart();
      db.prepare("UPDATE products SET category = 'Building Materials' WHERE id = ?").run(productId);
      const gateway = spyGateway();
      const params = {
        ...payment(cartId, 'garden-category-changed', now),
        promoCode: 'GARDEN10',
      };

      const result = await checkout(params, { db, gateway: gateway.gateway, now: () => now });
      assert.equal(result.success, false);
      assert.equal(result.success === false && result.error, 'PROMO_INVALID');
      assert.equal(result.success === false && result.promoErrorCode, 'CATEGORY_MISMATCH');
      assert.equal(gateway.calls(), 0);
      assert.equal(
        (
          db
            .prepare(
              'SELECT COUNT(*) AS count FROM inventory_reservations WHERE payment_idempotency_key = ?',
            )
            .get(params.idempotencyKey) as { count: number }
        ).count,
        0,
      );
      assert.equal(
        (
          db
            .prepare(
              'SELECT COUNT(*) AS count FROM promo_reservations WHERE payment_idempotency_key = ?',
            )
            .get(params.idempotencyKey) as { count: number }
        ).count,
        0,
      );
      assert.equal(
        (
          db
            .prepare('SELECT COUNT(*) AS count FROM cart_reservations WHERE cart_id = ?')
            .get(cartId) as { count: number }
        ).count,
        0,
      );
    },
  );

  await t.test('locks the quote and promo reservation before the gateway wait', async () => {
    startCase();
    const cartId = freshCart();
    const deferred = deferredGateway();
    const first = checkout(payment(cartId, 'cart-change'), { db, gateway: deferred.gateway });
    assert.equal(addVariantForProduct(cartId, 2), 'CART_RESERVED');
    deferred.resolve({ status: 'success' });
    const result = await first;
    assert.equal(result.success, true);
    if (result.success) assert.equal(result.order.items.length, 1);

    const promoCartId = freshCart();
    for (const productId of [2, 3, 4, 5]) addVariantForProduct(promoCartId, productId);
    const promoDeferred = deferredGateway();
    const promoPayment = { ...payment(promoCartId, 'promo-change'), promoCode: 'SAVE10' };
    const pending = checkout(promoPayment, { db, gateway: promoDeferred.gateway });
    db.prepare("UPDATE promo_codes SET active = 0 WHERE code = 'SAVE10'").run();
    promoDeferred.resolve({ status: 'success' });
    assert.equal((await pending).success, true);
    assert.equal(
      (await checkout(promoPayment, { db, gateway: promoDeferred.gateway })).success,
      true,
    );
    assert.equal(getCart(carts, promoCartId), undefined);
  });

  await t.test('expires prepared reservations and rejects late gateway completion', async () => {
    startCase();
    const cartId = freshCart();
    const deferred = deferredGateway();
    let current = new Date('2026-07-14T10:00:00.000Z');
    const params = payment(cartId, 'expired-reservation', current);
    const first = checkout(params, { db, gateway: deferred.gateway, now: () => current });
    current = new Date('2026-07-14T10:15:00.000Z');
    const expired = await checkout(params, { db, gateway: deferred.gateway, now: () => current });
    assert.deepEqual(expired, {
      success: false,
      error: 'RESERVATION_EXPIRED',
      reservationExpiresAt: '2026-07-14T10:15:00.000Z',
    });
    assert.notEqual(addVariantForProduct(cartId, 2), 'CART_RESERVED');
    assert.equal(
      (
        db
          .prepare(
            'SELECT COUNT(*) AS count FROM inventory_reservations WHERE payment_idempotency_key = ?',
          )
          .get(params.idempotencyKey) as { count: number }
      ).count,
      0,
    );
    deferred.resolve({ status: 'success' });
    assert.deepEqual(await first, expired);
  });

  await t.test(
    'terminalizes an expired reservation when gateway success arrives late',
    async () => {
      startCase();
      const cartId = freshCart();
      const deferred = deferredGateway();
      let current = new Date('2026-07-14T10:00:00.000Z');
      const params = payment(cartId, 'late-gateway-expiry', current);
      const first = checkout(params, { db, gateway: deferred.gateway, now: () => current });
      current = new Date('2026-07-14T10:15:00.000Z');
      deferred.resolve({ status: 'success' });
      const expired = {
        success: false as const,
        error: 'RESERVATION_EXPIRED' as const,
        reservationExpiresAt: '2026-07-14T10:15:00.000Z',
      };
      assert.deepEqual(await first, expired);
      assert.equal(
        (
          db
            .prepare('SELECT status, response_json FROM payments WHERE idempotency_key = ?')
            .get(params.idempotencyKey) as { status: string; response_json: string }
        ).status,
        'failed_pre_gateway',
      );
      assert.equal(
        (
          db
            .prepare(
              'SELECT COUNT(*) AS count FROM inventory_reservations WHERE payment_idempotency_key = ?',
            )
            .get(params.idempotencyKey) as { count: number }
        ).count,
        0,
      );
      assert.notEqual(addVariantForProduct(cartId, 2), 'CART_RESERVED');
      assert.deepEqual(
        await checkout(params, { db, gateway: deferred.gateway, now: () => current }),
        expired,
      );
    },
  );

  await t.test('rolls back order and redemption writes together', async () => {
    startCase();
    const cartId = freshCart();
    for (const productId of [2, 3, 4, 5]) addVariantForProduct(cartId, productId);
    db.exec(
      `CREATE TRIGGER abort_checkout_mailbox BEFORE INSERT ON dev_mailbox BEGIN SELECT RAISE(ABORT, 'mailbox failure'); END`,
    );
    const result = await checkout({ ...payment(cartId, 'rollback'), promoCode: 'SAVE10' }, { db });
    assert.deepEqual(result, { success: false, error: 'IDEMPOTENT_IN_PROGRESS' });
    assert.equal(getCart(carts, cartId)?.totalItems, 20);
    assert.equal(
      (
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM orders WHERE customer_email = 'checkout@example.test'",
          )
          .get() as { count: number }
      ).count,
      0,
    );
    db.exec('DROP TRIGGER IF EXISTS abort_checkout_mailbox');
    assert.equal(
      (db.prepare('SELECT COUNT(*) AS count FROM promo_redemptions').get() as { count: number })
        .count,
      0,
    );
  });

  await t.test('keeps gateway-success finalization failure resumable', async () => {
    startCase();
    const cartId = freshCart();
    db.exec('DROP TRIGGER IF EXISTS abort_checkout_mailbox');
    db.exec(
      `CREATE TRIGGER abort_checkout_mailbox BEFORE INSERT ON dev_mailbox BEGIN SELECT RAISE(ABORT, 'mailbox failure'); END`,
    );

    const result = await checkout(payment(cartId, 'resume-after-finalize'), { db });
    const stored = db
      .prepare('SELECT status, response_json FROM payments WHERE idempotency_key = ?')
      .get('resume-after-finalize') as { status: string; response_json: string | null };

    assert.notDeepEqual(result, { success: false, error: 'CHECKOUT_FAILED' });
    assert.equal(stored.status, 'authorized_pending_finalize');
    assert.equal(stored.response_json, null);
    db.exec('DROP TRIGGER IF EXISTS abort_checkout_mailbox');
    const resumed = await checkout(payment(cartId, 'resume-after-finalize'), { db });
    assert.equal(resumed.success, true);
    assert.equal(
      (
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM orders WHERE customer_email = 'checkout@example.test'",
          )
          .get() as { count: number }
      ).count,
      1,
    );
  });

  await t.test('rolls back audited finalization and appends its events once on retry', async () => {
    startCase();
    const cartId = freshCart();
    const params = payment(cartId, 'audit-finalize-rollback');
    db.exec(
      `CREATE TRIGGER abort_order_audit BEFORE INSERT ON audit_events
       WHEN NEW.action = 'order.created'
       BEGIN SELECT RAISE(ABORT, 'audit failure'); END`,
    );
    const failed = await checkout(params, { db });
    assert.deepEqual(failed, { success: false, error: 'IDEMPOTENT_IN_PROGRESS' });
    assert.equal(
      (
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM orders WHERE customer_email = 'checkout@example.test'",
          )
          .get() as { count: number }
      ).count,
      0,
    );
    assert.equal(getCart(carts, cartId)?.totalItems, 4);
    assert.equal(
      (
        db
          .prepare('SELECT status FROM payments WHERE idempotency_key = ?')
          .get(params.idempotencyKey) as { status: string }
      ).status,
      'authorized_pending_finalize',
    );
    db.exec('DROP TRIGGER IF EXISTS abort_order_audit');
    assert.equal((await checkout(params, { db })).success, true);
    const events = db
      .prepare('SELECT action FROM audit_events WHERE request_id = ? ORDER BY id')
      .all(params.auditContext.requestId) as Array<{ action: string }>;
    assert.deepEqual(
      events.map((event) => event.action),
      ['order.created', 'payment.succeeded', 'checkout.cart_consumed'],
    );
  });

  await t.test('persists only safe card metadata and fingerprint inputs', async () => {
    startCase();
    const cartId = freshCart();
    const params = payment(cartId, 'safe-data');
    await checkout(params, { db });
    const stored = db
      .prepare('SELECT * FROM payments WHERE idempotency_key = ?')
      .get(params.idempotencyKey) as Record<string, unknown> & {
      request_fingerprint: string;
      card_last4: string;
      card_brand: string;
    };
    const oldUnsafeFingerprint = createHash('sha256')
      .update(
        JSON.stringify(
          {
            cartId,
            promoCode: null,
            customerName: params.customerName,
            customerEmail: params.customerEmail,
            shippingAddress: '1 Test Street',
            cardNumber: '4242424242424242',
            cardExpiry: params.cardExpiry,
            cardCvc: params.cardCvc,
          },
          [
            'cartId',
            'promoCode',
            'customerName',
            'customerEmail',
            'shippingAddress',
            'cardNumber',
            'cardExpiry',
            'cardCvc',
          ].sort(),
        ),
      )
      .digest('hex');
    assert.notEqual(stored.request_fingerprint, oldUnsafeFingerprint);
    assert.deepEqual(
      { card_last4: stored.card_last4, card_brand: stored.card_brand },
      { card_last4: '4242', card_brand: 'Visa' },
    );
    // The persisted row is inspected structurally rather than by substring-matching its JSON
    // dump: `request_fingerprint` is a sha256 digest, and a hex digest can incidentally contain
    // any short decimal run (the fixture CVC `123` among them), so a substring check against it
    // is noise, not a signal. The digest gets a shape check; every other value is scanned.
    assert.match(stored.request_fingerprint, /^[0-9a-f]{64}$/);

    // Card-derived columns are limited to the display-safe pair. A newly persisted `card_cvc`
    // (or any other `card_*` column) fails here whatever value it carries.
    assert.deepEqual(
      Object.keys(stored)
        .filter((column) => column.startsWith('card_'))
        .sort(),
      ['card_brand', 'card_last4'],
    );

    // Collect every persisted leaf value and key name, descending into JSON-valued columns so a
    // secret hidden inside `response_json`/`quote_json` is caught as well.
    const persistedValues: string[] = [];
    const persistedKeys: string[] = [];
    const collect = (value: unknown): void => {
      if (typeof value === 'string') {
        persistedValues.push(value);
        try {
          const parsed: unknown = JSON.parse(value);
          if (parsed !== null && typeof parsed === 'object') collect(parsed);
        } catch {
          // not a JSON-valued column; the raw string is already recorded
        }
        return;
      }
      if (Array.isArray(value)) {
        for (const entry of value) collect(entry);
        return;
      }
      if (value !== null && typeof value === 'object') {
        for (const [key, entry] of Object.entries(value)) {
          persistedKeys.push(key);
          collect(entry);
        }
      }
    };
    for (const [column, value] of Object.entries(stored)) {
      persistedKeys.push(column);
      if (column === 'request_fingerprint') continue;
      collect(value);
    }

    const secretKeyPattern = /cvc|cvv|securitycode|cardnumber|^pan$/i;
    assert.deepEqual(
      persistedKeys.filter((key) => secretKeyPattern.test(key.replaceAll('_', ''))),
      [],
      'payments row exposes a field named after card secret material',
    );
    const pan = params.cardNumber.replaceAll(' ', '');
    for (const value of persistedValues) {
      assert.equal(value.includes(pan), false, `raw card number persisted in: ${value}`);
      assert.notEqual(value, params.cardCvc, 'raw card CVC persisted');
    }
  });
});
