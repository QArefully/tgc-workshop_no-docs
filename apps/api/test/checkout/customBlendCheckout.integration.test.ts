import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type Database from 'better-sqlite3';
import { Value } from '@sinclair/typebox/value';
import {
  CUSTOM_BLEND_FEE_CENTS,
  ResolvedCustomBlendSnapshot,
  SACK_WEIGHT_GRAMS,
  type CustomBlendSnapshot,
} from '@shop/contracts';
import { parsePersistedCheckoutQuote } from '@shop/contracts/payments';
import { createUnitOfWork } from '../../src/db/unitOfWork.js';
import { createAuditRepository } from '../../src/features/audit/auditRepository.js';
import { createAuditWriter } from '../../src/features/audit/auditService.js';
import { createCartRepository } from '../../src/features/cart/cartRepository.js';
import { createCartService } from '../../src/features/cart/cartService.js';
import { createProductRepository } from '../../src/features/catalog/productRepository.js';
import {
  createCheckoutService,
  type CheckoutDependencies,
  type CheckoutParams,
} from '../../src/features/checkout/checkoutService.js';
import { createCustomBlendRepository } from '../../src/features/customBlend/customBlendRepository.js';
import { createCustomBlendResolver } from '../../src/features/customBlend/customBlendResolver.js';
import { createCustomBlendService } from '../../src/features/customBlend/customBlendService.js';
import { createInventoryRepository } from '../../src/features/inventory/inventoryRepository.js';
import { createInventoryService } from '../../src/features/inventory/inventoryService.js';
import {
  adhocBilling,
  adhocDestination,
  bookableSlot,
  checkoutDepthDependencies,
} from './checkoutDepthFixtures.js';
import { createMailboxRepository } from '../../src/features/mailbox/mailboxRepository.js';
import { createOrderRepository } from '../../src/features/orders/orderRepository.js';
import type { PaymentGateway } from '../../src/features/payments/paymentGateway.js';
import { createPaymentRepository } from '../../src/features/payments/paymentRepository.js';
import { createPromoRepository } from '../../src/features/promos/promoRepository.js';
import { resolveTierDiscountPct } from '../../src/features/pricing/pricingRules.js';
import { createSeededAppFixture, openSeededDatabase } from '../support/seededDatabase.js';

interface Lot {
  variantId: number;
  productId: number;
  priceCents: number;
  weightGrams: number;
}

/** Two eligible lots that share a mixing group, so one can serve as the other's ingredient. */
function eligiblePair(db: Database.Database): { base: Lot; ingredient: Lot } {
  const rows = db
    .prepare(
      `SELECT pv.id AS variantId, p.id AS productId, pv.price_cents AS priceCents,
              pv.weight_grams AS weightGrams
         FROM product_variants pv
         INNER JOIN products p ON p.id = pv.product_id
        WHERE p.active = 1 AND pv.active = 1 AND pv.sort_order = 1
          AND pv.weight_grams = ${SACK_WEIGHT_GRAMS}
          AND p.mixing_group = 'food-grade'
        ORDER BY pv.id ASC
        LIMIT 2`,
    )
    .all() as Lot[];
  if (rows.length < 2) throw new Error('Expected two eligible food-grade lots');
  return { base: rows[0]!, ingredient: rows[1]! };
}

function eligibleLotForGroup(db: Database.Database, mixingGroup: string): Lot {
  const row = db
    .prepare(
      `SELECT pv.id AS variantId, p.id AS productId, pv.price_cents AS priceCents,
              pv.weight_grams AS weightGrams
         FROM product_variants pv
         INNER JOIN products p ON p.id = pv.product_id
        WHERE p.active = 1 AND pv.active = 1 AND pv.sort_order = 1
          AND pv.weight_grams = ${SACK_WEIGHT_GRAMS} AND p.mixing_group = ?
        ORDER BY pv.id ASC LIMIT 1`,
    )
    .get(mixingGroup) as Lot | undefined;
  if (!row) throw new Error(`Expected an eligible ${mixingGroup} lot`);
  return row;
}

interface CountingGateway extends PaymentGateway {
  calls: number;
}

/** Counts authorization attempts so pre-gateway rejections can be proven, not inferred. */
function countingGateway(): CountingGateway {
  const gateway: CountingGateway = {
    calls: 0,
    process: (input) => {
      gateway.calls += 1;
      return Promise.resolve({ status: 'success', reference: `ref-${input.idempotencyKey}` });
    },
  };
  return gateway;
}

function services(
  db: Database.Database,
  gateway: PaymentGateway,
  approvals?: CheckoutDependencies['approvals'],
) {
  const carts = createCartRepository(db);
  const clock = { now: () => new Date('2026-07-25T10:00:00.000Z') };
  const customBlendResolver = createCustomBlendResolver(createCustomBlendRepository(db), clock);
  const audit = createAuditWriter({ repository: createAuditRepository(db), clock });
  return {
    carts: createCartService(carts, undefined, undefined, customBlendResolver),
    blends: createCustomBlendService(customBlendResolver),
    checkout: createCheckoutService({
      unitOfWork: createUnitOfWork(db),
      carts,
      promos: createPromoRepository(db),
      payments: createPaymentRepository(db),
      orders: createOrderRepository(db),
      mailbox: createMailboxRepository(db),
      gateway,
      clock,
      products: createProductRepository(db),
      audit,
      inventory: createInventoryService({ repository: createInventoryRepository(db) }),
      customBlendResolver,
      approvals,
      ...checkoutDepthDependencies(db, clock),
    }),
  };
}

function paymentParams(cartId: string, idempotencyKey: string, promoCode?: string): CheckoutParams {
  return {
    cartId,
    ...(promoCode ? { promoCode } : {}),
    customerName: 'Blend Buyer',
    customerEmail: 'blend@example.test',
    deliveryDestination: adhocDestination,
    billingSelection: adhocBilling,
    deliverySlot: bookableSlot(new Date('2026-07-25T10:00:00.000Z')),
    cardNumber: '4242 4242 4242 4242',
    cardExpiry: '12/99',
    cardCvc: '123',
    idempotencyKey,
    userId: null,
    auditContext: {
      actor: { type: 'anonymous', userId: null },
      requestId: `request-${idempotencyKey}`,
    },
  };
}

function loadQuote(db: Database.Database, idempotencyKey: string) {
  const row = db
    .prepare('SELECT quote_json FROM payments WHERE idempotency_key = ?')
    .get(idempotencyKey) as { quote_json: string | null } | undefined;
  if (!row?.quote_json) throw new Error('Expected a persisted checkout quote');
  return parsePersistedCheckoutQuote(JSON.parse(row.quote_json));
}

void test('Custom Blend checkout money, promotion, and revalidation', async (t) => {
  const setupFresh = (testContext: TestContext) => {
    const { db } = openSeededDatabase(testContext);
    const lots = eligiblePair(db);
    // Stock is deliberately generous on the base lot: tier boundaries, not availability, are
    // under test. Ingredient stock stays untouched here.
    db.prepare('UPDATE product_variants SET stock_count = 100000 WHERE id = ?').run(
      lots.base.variantId,
    );
    return { db, lots };
  };

  const configure = (
    api: ReturnType<typeof services>,
    lots: { base: Lot; ingredient: Lot },
    quantity: number,
  ) => {
    const cartId = api.carts.create().cartId;
    const result = api.blends.create(
      api.carts,
      cartId,
      {
        baseVariantId: lots.base.variantId,
        ingredients: [{ variantId: lots.ingredient.variantId, percentage: 25 }],
        quantity,
      },
      { actor: { type: 'anonymous', userId: null }, requestId: `configure-${cartId}` },
    );
    assert.equal(typeof result === 'string', false, `configure failed: ${JSON.stringify(result)}`);
    return cartId;
  };

  await t.test(
    'blending fee is a flat per-line charge across every tier boundary',
    (testContext) => {
      for (const [quantity, expectedDiscountPct] of [
        [39, 0],
        [40, 0],
        [200, 5],
        [400, 10],
      ] as const) {
        const { db, lots } = setupFresh(testContext);
        const api = services(db, countingGateway());
        const cartId = configure(api, lots, quantity);
        const cart = api.carts.get(cartId)!;
        const line = cart.items[0]!;

        assert.equal(
          resolveTierDiscountPct(quantity, SACK_WEIGHT_GRAMS),
          expectedDiscountPct,
          `tier ladder for ${quantity} sacks`,
        );
        const unitPriceCents = line.resolvedUnitPriceCents;
        assert.equal(line.resolvedUnitPriceCents, unitPriceCents);
        assert.equal(line.materialSubtotalCents, unitPriceCents * quantity);
        // Flat, never tiered, never scaled by quantity.
        assert.equal(line.blendingFeeCents, CUSTOM_BLEND_FEE_CENTS);
        assert.equal(line.customBlend?.blendingFeeCents, CUSTOM_BLEND_FEE_CENTS);
        assert.equal(line.discountableTotalCents, unitPriceCents * quantity);
        assert.equal(line.lineTotalCents, unitPriceCents * quantity + CUSTOM_BLEND_FEE_CENTS);
        assert.equal(cart.discountableSubtotalCents, unitPriceCents * quantity);
        assert.equal(cart.subtotalCents, unitPriceCents * quantity + CUSTOM_BLEND_FEE_CENTS);
        assert.equal(cart.blendingFeeTotalCents, CUSTOM_BLEND_FEE_CENTS);
        assert.equal(cart.totalItems, quantity);
      }
    },
  );

  await t.test(
    'SAVE10 five-sack gate is met by blend sacks and discounts material only',
    async (testContext) => {
      const { db, lots } = setupFresh(testContext);
      const gateway = countingGateway();
      const api = services(db, gateway);
      const cartId = configure(api, lots, 5);
      const cart = api.carts.get(cartId)!;
      assert.equal(cart.totalItems, 5);

      const result = await api.checkout.process(paymentParams(cartId, 'blend-promo', 'SAVE10'));
      assert.equal(result.success, true, `checkout failed: ${JSON.stringify(result)}`);
      assert.equal(gateway.calls, 1);

      const quote = loadQuote(db, 'blend-promo');
      const materialSubtotalCents = lots.base.priceCents * 5;
      const expectedDiscountCents = Math.floor((materialSubtotalCents * 10) / 100);
      assert.equal(quote.promoCode, 'SAVE10');
      assert.equal(quote.subtotalCents, materialSubtotalCents + CUSTOM_BLEND_FEE_CENTS);
      // The fee neither enlarges the discount base nor is reduced by the promotion.
      assert.equal(quote.discountCents, expectedDiscountCents);
      assert.equal(
        quote.totalCents,
        quote.subtotalCents - expectedDiscountCents + quote.deliverySummary.chargeCents,
      );

      const line = quote.variantLines[0]!;
      assert.equal(line.variantId, lots.base.variantId);
      // Unit price stays the per-sack material price; the fee is never smeared across sacks.
      assert.equal(line.unitPriceCents, lots.base.priceCents);
      assert.equal(line.materialSubtotalCents, materialSubtotalCents);
      assert.equal(line.blendingFeeCents, CUSTOM_BLEND_FEE_CENTS);
      assert.equal(line.discountableTotalCents, materialSubtotalCents);
      assert.equal(line.lineTotalCents, materialSubtotalCents + CUSTOM_BLEND_FEE_CENTS);
      const snapshot = line.customBlend as CustomBlendSnapshot;
      assert.equal(snapshot.ingredients.length, 1);
      assert.equal(snapshot.ingredients[0]!.variantId, lots.ingredient.variantId);
      assert.equal(snapshot.basePercentage, 75);
      assert.equal(snapshot.madeToOrder, true);
      assert.equal(snapshot.returnable, false);
    },
  );

  await t.test(
    'plain lines keep a fee-free money split and an unchanged quote shape',
    async (testContext) => {
      const { db, lots } = setupFresh(testContext);
      const gateway = countingGateway();
      const api = services(db, gateway);
      const cartId = api.carts.create().cartId;
      const added = api.carts.add(cartId, String(lots.base.variantId), 5);
      assert.equal(typeof added === 'string', false, `add failed: ${JSON.stringify(added)}`);

      const result = await api.checkout.process(paymentParams(cartId, 'plain-line'));
      assert.equal(result.success, true, `checkout failed: ${JSON.stringify(result)}`);

      const quote = loadQuote(db, 'plain-line');
      const line = quote.variantLines[0]!;
      assert.equal(quote.subtotalCents, lots.base.priceCents * 5);
      assert.equal(line.blendingFeeCents, undefined);
      assert.equal(line.materialSubtotalCents, undefined);
      assert.equal(line.discountableTotalCents, undefined);
      assert.equal(line.customBlend, undefined);
    },
  );

  await t.test(
    'ingredient stock of zero does not block checkout and never enters demand',
    async (testContext) => {
      const { db, lots } = setupFresh(testContext);
      db.prepare('UPDATE product_variants SET stock_count = 0 WHERE id = ?').run(
        lots.ingredient.variantId,
      );
      const gateway = countingGateway();
      const api = services(db, gateway);
      const cartId = configure(api, lots, 5);

      const result = await api.checkout.process(paymentParams(cartId, 'zero-ingredient-stock'));
      assert.equal(result.success, true, `checkout failed: ${JSON.stringify(result)}`);

      // Only the base lot is consumed; the ingredient is a recipe fact, not stock demand.
      const quote = loadQuote(db, 'zero-ingredient-stock');
      assert.deepEqual(
        quote.inventoryAllocations.map((allocation) => allocation.productId),
        [String(lots.base.variantId)],
      );
      const reservedVariantIds = db
        .prepare('SELECT DISTINCT variant_id FROM inventory_reservations')
        .all() as Array<{ variant_id: number }>;
      assert.equal(
        reservedVariantIds.some((row) => row.variant_id === lots.ingredient.variantId),
        false,
      );
    },
  );

  await t.test(
    'an ingredient retired after configuration is rejected before the gateway',
    async (testContext) => {
      const { db, lots } = setupFresh(testContext);
      const gateway = countingGateway();
      const api = services(db, gateway);
      const cartId = configure(api, lots, 5);
      db.prepare('UPDATE product_variants SET active = 0 WHERE id = ?').run(
        lots.ingredient.variantId,
      );

      const result = await api.checkout.process(paymentParams(cartId, 'retired-ingredient'));
      assert.equal(result.success, false);
      assert.equal(result.success === false && result.error, 'CUSTOM_BLEND_INVALID');
      assert.equal(gateway.calls, 0);

      const payment = db
        .prepare('SELECT status FROM payments WHERE idempotency_key = ?')
        .get('retired-ingredient') as { status: string } | undefined;
      assert.equal(payment?.status, 'failed_pre_gateway');
      const reservations = db
        .prepare(
          'SELECT COUNT(*) AS count FROM inventory_reservations WHERE payment_idempotency_key = ?',
        )
        .get('retired-ingredient') as { count: number };
      assert.equal(reservations.count, 0);
      // Stock is untouched: a rejected blend must not move inventory.
      const stock = db
        .prepare('SELECT stock_count FROM product_variants WHERE id = ?')
        .get(lots.base.variantId) as { stock_count: number };
      assert.equal(stock.stock_count, 100000);
    },
  );

  await t.test(
    'an approved retry terminalizes a stale blend so restoring facts cannot charge the key',
    async (testContext) => {
      const { db, lots } = setupFresh(testContext);
      const gateway = countingGateway();
      let approved = false;
      const approvals = {
        evaluate: () =>
          approved
            ? { gate: 'approved-retry' as const, approvedApprovalRequestId: 'approval-1' }
            : { gate: 'defer' as const, approvalRequestId: 'approval-1' },
      } as NonNullable<CheckoutDependencies['approvals']>;
      const api = services(db, gateway, approvals);
      const cartId = configure(api, lots, 5);
      const params = paymentParams(cartId, 'stale-after-approval');
      const orderCountBefore = (
        db.prepare('SELECT COUNT(*) AS count FROM orders').get() as { count: number }
      ).count;

      const pending = await api.checkout.process(params);
      assert.equal(pending.success === false && pending.error, 'PENDING_APPROVAL');
      assert.equal(gateway.calls, 0);

      approved = true;
      db.prepare('UPDATE product_variants SET active = 0 WHERE id = ?').run(
        lots.ingredient.variantId,
      );
      const rejected = await api.checkout.process(params);
      assert.deepEqual(rejected, { success: false, error: 'CUSTOM_BLEND_INVALID' });
      assert.equal(gateway.calls, 0);

      assert.deepEqual(
        db
          .prepare('SELECT status, response_json, order_id FROM payments WHERE idempotency_key = ?')
          .get(params.idempotencyKey),
        {
          status: 'failed_pre_gateway',
          response_json: JSON.stringify(rejected),
          order_id: null,
        },
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
      assert.equal(
        (
          db
            .prepare('SELECT stock_count FROM product_variants WHERE id = ?')
            .get(lots.base.variantId) as {
            stock_count: number;
          }
        ).stock_count,
        100000,
      );
      assert.equal(
        (db.prepare('SELECT COUNT(*) AS count FROM orders').get() as { count: number }).count,
        orderCountBefore,
      );

      db.prepare('UPDATE product_variants SET active = 1 WHERE id = ?').run(
        lots.ingredient.variantId,
      );
      const replayed = await api.checkout.process(params);
      assert.deepEqual(replayed, rejected);
      assert.equal(gateway.calls, 0);
    },
  );

  await t.test('a retired base lot is rejected before the gateway', async (testContext) => {
    const { db, lots } = setupFresh(testContext);
    const gateway = countingGateway();
    const api = services(db, gateway);
    const cartId = configure(api, lots, 5);
    db.prepare('UPDATE products SET mixing_group = NULL WHERE id = ?').run(lots.base.productId);

    const result = await api.checkout.process(paymentParams(cartId, 'retired-base'));
    assert.equal(result.success === false && result.error, 'CUSTOM_BLEND_INVALID');
    assert.equal(gateway.calls, 0);
  });

  await t.test(
    'resolver prices every material component before applying the flat fee',
    async (testContext) => {
      const { db, lots } = setupFresh(testContext);
      db.prepare('UPDATE product_variants SET price_cents = 4000 WHERE id = ?').run(
        lots.base.variantId,
      );
      db.prepare('UPDATE product_variants SET price_cents = 8000 WHERE id = ?').run(
        lots.ingredient.variantId,
      );
      const gateway = countingGateway();
      const api = services(db, gateway);
      const cartId = configure(api, lots, 5);
      const cart = api.carts.get(cartId)!;
      const line = cart.items[0]!;

      assert.equal(line.resolvedUnitPriceCents, 5000);
      assert.equal(line.materialSubtotalCents, 25_000);
      assert.equal(line.blendingFeeCents, CUSTOM_BLEND_FEE_CENTS);
      assert.equal(line.lineTotalCents, 25_000 + CUSTOM_BLEND_FEE_CENTS);

      const result = await api.checkout.process(paymentParams(cartId, 'resolver-material-fee'));
      assert.equal(result.success, true, `checkout failed: ${JSON.stringify(result)}`);
      assert.equal(gateway.calls, 1);
      const quote = loadQuote(db, 'resolver-material-fee');
      assert.equal(quote.subtotalCents, 25_000 + CUSTOM_BLEND_FEE_CENTS);
      assert.equal(
        quote.totalCents,
        25_000 + CUSTOM_BLEND_FEE_CENTS + quote.deliverySummary.chargeCents,
      );
    },
  );

  await t.test(
    'promo minimum subtotal includes all material components but excludes the fee',
    async (testContext) => {
      const { db, lots } = setupFresh(testContext);
      db.prepare('UPDATE product_variants SET price_cents = 4000 WHERE id = ?').run(
        lots.base.variantId,
      );
      db.prepare('UPDATE product_variants SET price_cents = 8000 WHERE id = ?').run(
        lots.ingredient.variantId,
      );
      db.prepare("UPDATE promo_codes SET min_subtotal_cents = 25000 WHERE code = 'SAVE10'").run();
      const gateway = countingGateway();
      const api = services(db, gateway);
      const cartId = configure(api, lots, 5);

      const result = await api.checkout.process(
        paymentParams(cartId, 'resolver-promo-boundary', 'SAVE10'),
      );
      assert.equal(result.success, true, `checkout failed: ${JSON.stringify(result)}`);
      const quote = loadQuote(db, 'resolver-promo-boundary');
      assert.equal(quote.discountCents, 2500);
      assert.equal(quote.subtotalCents, 25_000 + CUSTOM_BLEND_FEE_CENTS);
      assert.equal(
        quote.totalCents,
        25_000 + CUSTOM_BLEND_FEE_CENTS - 2500 + quote.deliverySummary.chargeCents,
      );
    },
  );

  await t.test(
    'promo validation does not apply the aggregate tier a second time',
    async (testContext) => {
      const { db, lots } = setupFresh(testContext);
      db.prepare('UPDATE product_variants SET price_cents = 4000 WHERE id = ?').run(
        lots.base.variantId,
      );
      db.prepare('UPDATE product_variants SET price_cents = 8000 WHERE id = ?').run(
        lots.ingredient.variantId,
      );
      const gateway = countingGateway();
      const api = services(db, gateway);
      const cartId = configure(api, lots, 200);
      const cart = api.carts.get(cartId)!;
      const materialSubtotalCents = cart.discountableSubtotalCents;
      // The base and ingredient qualify for different component tiers at this quantity. The
      // promo gate must see their already-resolved sum, not another discount on that sum.
      assert.equal(materialSubtotalCents, 1_000_000);
      db.prepare("UPDATE promo_codes SET min_subtotal_cents = ? WHERE code = 'SAVE10'").run(
        materialSubtotalCents,
      );

      const result = await api.checkout.process(
        paymentParams(cartId, 'resolver-promo-tier-boundary', 'SAVE10'),
      );
      assert.equal(result.success, true, `checkout failed: ${JSON.stringify(result)}`);
      const quote = loadQuote(db, 'resolver-promo-tier-boundary');
      assert.equal(quote.discountBaseCents, materialSubtotalCents);
      assert.equal(quote.discountCents, 100_000);
      assert.equal(quote.subtotalCents, materialSubtotalCents + CUSTOM_BLEND_FEE_CENTS);
    },
  );
});

void test('payment route maps a stale Custom Blend line to a 409 conflict', async (t) => {
  const { db, app } = await createSeededAppFixture(t);
  const lots = eligiblePair(db);
  db.prepare('UPDATE product_variants SET stock_count = 100000 WHERE id = ?').run(
    lots.base.variantId,
  );

  const cartId = (await app.inject({ method: 'POST', url: '/api/cart' })).json<{
    cartId: string;
  }>().cartId;
  const configured = await app.inject({
    method: 'POST',
    url: `/api/cart/${cartId}/custom-blends`,
    payload: {
      baseVariantId: lots.base.variantId,
      ingredients: [{ variantId: lots.ingredient.variantId, percentage: 25 }],
      quantity: 5,
    },
  });
  assert.equal(configured.statusCode, 200, configured.body);
  db.prepare('UPDATE product_variants SET active = 0 WHERE id = ?').run(lots.ingredient.variantId);

  const response = await app.inject({
    method: 'POST',
    url: '/api/payments/pay',
    payload: {
      cartId,
      customerName: 'Blend Buyer',
      customerEmail: 'blend@example.test',
      deliveryDestination: adhocDestination,
      billingSelection: adhocBilling,
      deliverySlot: bookableSlot(),
      cardNumber: '4242 4242 4242 4242',
      cardExpiry: '12/99',
      cardCvc: '123',
      idempotencyKey: '33333333-3333-4333-8333-333333333333',
    },
  });
  assert.equal(response.statusCode, 409);
  assert.deepEqual(response.json(), {
    error: 'The custom blend is no longer valid.',
    code: 'CUSTOM_BLEND_INVALID',
  });
});

void test('cleaning checkout accepts a pigment ingredient through the resolver policy', async (t) => {
  const { db } = await createSeededAppFixture(t);
  const lots = {
    base: eligibleLotForGroup(db, 'cleaning'),
    ingredient: eligibleLotForGroup(db, 'pigments'),
  };
  db.prepare('UPDATE product_variants SET stock_count = 100000 WHERE id = ?').run(
    lots.base.variantId,
  );
  const gateway = countingGateway();
  const api = services(db, gateway);
  const cartId = api.carts.create().cartId;
  const configured = api.blends.create(
    api.carts,
    cartId,
    {
      baseVariantId: lots.base.variantId,
      ingredients: [{ variantId: lots.ingredient.variantId, percentage: 10 }],
      quantity: 5,
    },
    { actor: { type: 'anonymous', userId: null }, requestId: `cleaning-${cartId}` },
  );
  assert.equal(
    typeof configured === 'string',
    false,
    `configure failed: ${JSON.stringify(configured)}`,
  );

  const result = await api.checkout.process(paymentParams(cartId, 'cleaning-pigment'));
  assert.equal(result.success, true, `checkout failed: ${JSON.stringify(result)}`);
  assert.equal(gateway.calls, 1);
  const quote = loadQuote(db, 'cleaning-pigment');
  const line = quote.variantLines[0]!;
  const resolvedBlend = Value.Parse(ResolvedCustomBlendSnapshot, line.customBlend);
  assert.equal(resolvedBlend.ruleVersion, 1);
  assert.equal(resolvedBlend.resultClassification, 'non-food');
  assert.deepEqual(
    resolvedBlend.components.map((component) => component.mixingGroup),
    ['cleaning', 'pigments'],
  );
});
