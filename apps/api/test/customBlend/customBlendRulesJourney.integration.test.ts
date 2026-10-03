import assert from 'node:assert/strict';
import test from 'node:test';
import type Database from 'better-sqlite3';
import { Value } from '@sinclair/typebox/value';
import {
  Cart,
  CreateCartResponse,
  CURRENT_PERSISTED_CHECKOUT_QUOTE_VERSION,
  CustomBlendBaseListResponse,
  CustomBlendEvaluationResponse,
  CustomBlendOptionsResponse,
  Order,
  OrderDetailResponse,
  PersistedCheckoutQuote,
  PersistedCheckoutQuoteV10,
  ResolvedCustomBlendSnapshot,
  type CustomBlendEvaluationResponse as CustomBlendEvaluationResponseType,
} from '@shop/contracts';
import { parsePersistedCheckoutQuote } from '@shop/contracts/payments';
import type {
  PaymentGateway,
  PaymentGatewayRequest,
} from '../../src/features/payments/paymentGateway.js';
import { adhocBilling, adhocDestination, bookableSlot } from '../checkout/checkoutDepthFixtures.js';
import { createSeededAppFixture } from '../support/seededDatabase.js';

const NOW = new Date('2026-08-05T10:00:00.000Z');
const UK_HEADERS = { 'x-shop-country': 'UK' };

interface Lot {
  variantId: number;
  productId: number;
  productName: string;
  mixingGroup: string;
  priceCents: number;
  stockCount: number;
}

/** Choose live seeded lots by group so the journey never relies on global row ids or counts. */
function eligibleLot(db: Database.Database, mixingGroup: string): Lot {
  const row = db
    .prepare(
      `SELECT pv.id AS variantId, p.id AS productId, p.name AS productName,
              p.mixing_group AS mixingGroup, pv.price_cents AS priceCents,
              pv.stock_count AS stockCount
         FROM product_variants pv
         INNER JOIN products p ON p.id = pv.product_id
        WHERE p.active = 1
          AND pv.active = 1
          AND pv.sort_order = 1
          AND pv.weight_grams = 25000
          AND p.mixing_group = ?
        ORDER BY p.name COLLATE NOCASE ASC, pv.id ASC
        LIMIT 1`,
    )
    .get(mixingGroup) as Lot | undefined;
  if (!row) throw new Error(`Expected an eligible ${mixingGroup} 25 kg lot`);
  return row;
}

function countGateway(): { gateway: PaymentGateway; requests: PaymentGatewayRequest[] } {
  const requests: PaymentGatewayRequest[] = [];
  return {
    requests,
    gateway: {
      process(request) {
        requests.push(request);
        return Promise.resolve({
          status: 'success',
          reference: `journey-${request.idempotencyKey}`,
        });
      },
    },
  };
}

function parseCart(response: { json<T>(): T }): import('@shop/contracts/cart').Cart {
  const body = response.json<unknown>();
  assert.equal(
    Value.Check(Cart, body),
    true,
    `cart transport invalid: ${JSON.stringify(Array.from(Value.Errors(Cart, body)))}`,
  );
  return body as import('@shop/contracts/cart').Cart;
}

function responseCode(response: { json<T>(): T }): string {
  const body = response.json<unknown>();
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error('Expected an error response object');
  }
  const code = (body as Record<string, unknown>).code;
  if (typeof code !== 'string')
    throw new Error(`Expected an error response code: ${JSON.stringify(body)}`);
  return code;
}

function orderCookie(response: { headers: Record<string, string | string[] | undefined> }): string {
  const header = response.headers['set-cookie'];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) throw new Error('Expected anonymous order access cookie');
  return value.split(';', 1)[0]!;
}

function paymentPayload(cartId: string, idempotencyKey: string, customerEmail: string) {
  return {
    cartId,
    customerName: 'Convergence Buyer',
    customerEmail,
    deliveryDestination: adhocDestination,
    billingSelection: adhocBilling,
    deliverySlot: bookableSlot(NOW),
    cardNumber: '4242 4242 4242 4242',
    cardExpiry: '12/99',
    cardCvc: '123',
    idempotencyKey,
  };
}

function ownedIdempotencyKey(
  prefix: 'a' | 'b',
  baseVariantId: number,
  ingredientVariantId: number,
) {
  const suffix = `${baseVariantId.toString(16).padStart(6, '0').slice(-6)}${ingredientVariantId
    .toString(16)
    .padStart(6, '0')
    .slice(-6)}`;
  return `${prefix}0000000-0000-4000-8000-${suffix}`;
}

function assertValidEvaluation(value: unknown): asserts value is CustomBlendEvaluationResponseType {
  assert.equal(
    Value.Check(CustomBlendEvaluationResponse, value),
    true,
    `evaluation transport invalid: ${JSON.stringify(
      Array.from(Value.Errors(CustomBlendEvaluationResponse, value)),
    )}`,
  );
}

function componentMoney(value: {
  role: string;
  variantId: number;
  mixingGroup: string;
  percentage: number;
  weightGrams: number;
  sourceUnitPriceCents: number;
  tierDiscountPct: number;
  unitContributionCents: number;
  subtotalCents: number;
}) {
  return {
    role: value.role,
    variantId: value.variantId,
    mixingGroup: value.mixingGroup,
    percentage: value.percentage,
    weightGrams: value.weightGrams,
    sourceUnitPriceCents: value.sourceUnitPriceCents,
    tierDiscountPct: value.tierDiscountPct,
    unitContributionCents: value.unitContributionCents,
    subtotalCents: value.subtotalCents,
  };
}

void test('Custom Blend converges from mixed-group evaluation through V10 immutable order', async (t) => {
  const gateway = countGateway();
  const { db, app } = await createSeededAppFixture({
    testContext: t,
    app: { clock: { now: () => NOW }, paymentGateway: gateway.gateway },
  });
  const base = eligibleLot(db, 'cleaning');
  const pigment = eligibleLot(db, 'pigments');
  db.prepare(
    'UPDATE product_variants SET price_cents = 4000, stock_count = 100000 WHERE id = ?',
  ).run(base.variantId);
  db.prepare('UPDATE product_variants SET price_cents = 8000 WHERE id = ?').run(pigment.variantId);

  const basesResponse = await app.inject({
    method: 'GET',
    url: '/api/custom-blends/bases?page=1&pageSize=48',
    headers: UK_HEADERS,
  });
  assert.equal(basesResponse.statusCode, 200, basesResponse.body);
  assert.equal(Value.Check(CustomBlendBaseListResponse, basesResponse.json()), true);
  assert.ok(
    basesResponse
      .json<{ items: Array<{ variant: { variantId: number } }> }>()
      .items.some((item) => item.variant.variantId === base.variantId),
  );

  const optionsResponse = await app.inject({
    method: 'GET',
    url: `/api/custom-blends/options?baseVariantId=${base.variantId}`,
    headers: UK_HEADERS,
  });
  assert.equal(optionsResponse.statusCode, 200, optionsResponse.body);
  const options = optionsResponse.json<CustomBlendOptionsResponse>();
  assert.equal(Value.Check(CustomBlendOptionsResponse, options), true);
  assert.ok(options.ingredients.some((item) => item.variant.variantId === pigment.variantId));
  assert.equal(
    options.ingredients.find((item) => item.variant.variantId === pigment.variantId)?.mixingGroup,
    'pigments',
  );

  const evaluationResponse = await app.inject({
    method: 'POST',
    url: '/api/custom-blends/evaluate',
    headers: UK_HEADERS,
    payload: {
      baseVariantId: base.variantId,
      ingredients: [{ variantId: pigment.variantId, percentage: 10 }],
      quantity: 4,
    },
  });
  assert.equal(evaluationResponse.statusCode, 200, evaluationResponse.body);
  const evaluation = evaluationResponse.json<CustomBlendEvaluationResponseType>();
  assertValidEvaluation(evaluation);
  const baseComponent = evaluation.customBlend.components.find(
    (component) => component.role === 'base',
  )!;
  const pigmentComponent = evaluation.customBlend.components.find(
    (component) => component.role === 'ingredient',
  )!;
  assert.equal(evaluation.quantity, 4);
  assert.equal(evaluation.customBlend.quantity, 4);
  assert.equal(evaluation.customBlend.basePercentage, 90);
  assert.equal(evaluation.customBlend.mixingGroup, 'cleaning');
  assert.equal(typeof evaluation.customBlend.configKey, 'string');
  assert.ok(evaluation.customBlend.configKey.length > 0);
  assert.deepEqual(
    evaluation.customBlend.ingredients.map((ingredient) => ({
      variantId: ingredient.variantId,
      productId: ingredient.productId,
      mixingGroup: ingredient.mixingGroup,
      percentage: ingredient.percentage,
    })),
    [
      {
        variantId: pigment.variantId,
        productId: String(pigment.productId),
        mixingGroup: 'pigments',
        percentage: 10,
      },
    ],
  );
  assert.equal(evaluation.customBlend.resultClassification, 'non-food');
  assert.deepEqual(evaluation.customBlend.components.map(componentMoney), [
    {
      role: 'base',
      variantId: base.variantId,
      mixingGroup: 'cleaning',
      percentage: 90,
      weightGrams: 90_000,
      sourceUnitPriceCents: 4000,
      tierDiscountPct: 0,
      unitContributionCents: 3600,
      subtotalCents: 14_400,
    },
    {
      role: 'ingredient',
      variantId: pigment.variantId,
      mixingGroup: 'pigments',
      percentage: 10,
      weightGrams: 10_000,
      sourceUnitPriceCents: 8000,
      tierDiscountPct: 0,
      unitContributionCents: 800,
      subtotalCents: 3200,
    },
  ]);
  assert.equal(baseComponent.percentage, 90);
  assert.equal(pigmentComponent.percentage, 10);
  assert.equal(evaluation.customBlend.materialUnitPriceCents, 4400);
  assert.equal(evaluation.customBlend.materialSubtotalCents, 17600);
  assert.equal(evaluation.customBlend.blendingFeeCents, 2500);
  assert.equal(evaluation.customBlend.lineTotalCents, 20100);

  const cartResponse = await app.inject({
    method: 'POST',
    url: '/api/cart',
    headers: UK_HEADERS,
    payload: { country: 'UK' },
  });
  assert.equal(cartResponse.statusCode, 201, cartResponse.body);
  const cartId = Value.Parse(CreateCartResponse, cartResponse.json()).cartId;
  const configuredResponse = await app.inject({
    method: 'POST',
    url: `/api/cart/${cartId}/custom-blends`,
    headers: UK_HEADERS,
    payload: {
      baseVariantId: base.variantId,
      ingredients: [{ variantId: pigment.variantId, percentage: 10 }],
      quantity: 4,
    },
  });
  assert.equal(configuredResponse.statusCode, 200, configuredResponse.body);
  const cart = parseCart(configuredResponse);
  const cartLine = cart.items[0]!;
  assert.equal(cartLine.quantity, 4);
  assert.equal(cartLine.configKey, evaluation.customBlend.configKey);
  assert.equal(cartLine.product.consumptionClassification, 'non-food');
  const cartBlend = Value.Parse(ResolvedCustomBlendSnapshot, cartLine.customBlend);
  assert.equal(cartBlend.resultClassification, 'non-food');
  assert.equal(cartBlend.quantity, 4);
  assert.deepEqual(cartBlend.components.map(componentMoney), [
    {
      role: 'base',
      variantId: base.variantId,
      mixingGroup: 'cleaning',
      percentage: 90,
      weightGrams: 90_000,
      sourceUnitPriceCents: 4000,
      tierDiscountPct: 0,
      unitContributionCents: 3600,
      subtotalCents: 14_400,
    },
    {
      role: 'ingredient',
      variantId: pigment.variantId,
      mixingGroup: 'pigments',
      percentage: 10,
      weightGrams: 10_000,
      sourceUnitPriceCents: 8000,
      tierDiscountPct: 0,
      unitContributionCents: 800,
      subtotalCents: 3200,
    },
  ]);
  assert.equal(cartLine.resolvedUnitPriceCents, 4400);
  assert.equal(cartLine.materialSubtotalCents, 17600);
  assert.equal(cartLine.blendingFeeCents, 2500);
  assert.equal(cartLine.lineTotalCents, 20100);
  assert.equal(cart.discountableSubtotalCents, 17600);
  assert.equal(cart.subtotalCents, 20100);

  const readCartResponse = await app.inject({
    method: 'GET',
    url: `/api/cart/${cartId}`,
    headers: UK_HEADERS,
  });
  assert.equal(readCartResponse.statusCode, 200, readCartResponse.body);
  assert.deepEqual(parseCart(readCartResponse), cart);

  const idempotencyKey = ownedIdempotencyKey('a', base.variantId, pigment.variantId);
  const customerEmail = 'custom-blend-convergence@example.test';
  const payment = await app.inject({
    method: 'POST',
    url: '/api/payments/pay',
    headers: UK_HEADERS,
    payload: paymentPayload(cartId, idempotencyKey, customerEmail),
  });
  assert.equal(payment.statusCode, 201, payment.body);
  const orderBody = payment.json<unknown>();
  assert.equal(
    Value.Check(Order, orderBody),
    true,
    `order transport invalid: ${JSON.stringify(Array.from(Value.Errors(Order, orderBody)))}`,
  );
  const order = orderBody as import('@shop/contracts/orders').Order;
  assert.equal(gateway.requests.length, 1);
  assert.equal(gateway.requests[0]!.amountCents, order.totalCents);
  assert.equal(gateway.requests[0]!.currency, 'GBP');
  assert.equal(gateway.requests[0]!.idempotencyKey, idempotencyKey);
  const orderLine = order.items[0]!;
  assert.equal(orderLine.productId, String(base.productId));
  assert.equal(orderLine.unitPriceCents, 4400);
  const orderBlend = Value.Parse(ResolvedCustomBlendSnapshot, orderLine.customBlend);
  assert.equal(orderBlend.ruleVersion, 1);
  assert.equal(orderBlend.resultClassification, 'non-food');
  assert.equal(orderBlend.configKey, evaluation.customBlend.configKey);
  assert.equal(orderBlend.quantity, 4);
  assert.deepEqual(orderBlend.components.map(componentMoney), [
    {
      role: 'base',
      variantId: base.variantId,
      mixingGroup: 'cleaning',
      percentage: 90,
      weightGrams: 90_000,
      sourceUnitPriceCents: 4000,
      tierDiscountPct: 0,
      unitContributionCents: 3600,
      subtotalCents: 14_400,
    },
    {
      role: 'ingredient',
      variantId: pigment.variantId,
      mixingGroup: 'pigments',
      percentage: 10,
      weightGrams: 10_000,
      sourceUnitPriceCents: 8000,
      tierDiscountPct: 0,
      unitContributionCents: 800,
      subtotalCents: 3200,
    },
  ]);
  assert.equal(orderLine.variantSnapshot?.consumptionClassification, 'non-food');
  assert.equal(orderLine.discountableTotalCents, 17600);
  assert.equal(orderLine.blendingFeeCents, 2500);
  assert.equal(orderLine.lineTotalCents, 20100);

  const paymentRow = db
    .prepare(
      'SELECT status, order_id AS orderId, quote_json AS quoteJson FROM payments WHERE idempotency_key = ?',
    )
    .get(idempotencyKey) as { status: string; orderId: number | null; quoteJson: string | null };
  assert.equal(paymentRow.status, 'succeeded');
  assert.equal(String(paymentRow.orderId), order.id);
  assert.ok(paymentRow.quoteJson);
  const quote = parsePersistedCheckoutQuote(JSON.parse(paymentRow.quoteJson));
  assert.equal(Value.Check(PersistedCheckoutQuote, quote), true);
  assert.equal(quote.version, 10);
  assert.equal(quote.version, CURRENT_PERSISTED_CHECKOUT_QUOTE_VERSION);
  const quoteV10 = Value.Parse(PersistedCheckoutQuoteV10, quote);
  const quoteLine = quoteV10.variantLines.find((line) => line.customBlend !== undefined);
  assert.ok(quoteLine);
  assert.equal(quoteLine.productId, String(base.productId));
  assert.equal(quoteLine.variantId, base.variantId);
  const quoteBlend = Value.Parse(ResolvedCustomBlendSnapshot, quoteLine.customBlend);
  assert.equal(quoteBlend.configKey, evaluation.customBlend.configKey);
  assert.equal(quoteBlend.quantity, 4);
  assert.equal(quoteBlend.ruleVersion, 1);
  assert.equal(quoteBlend.resultClassification, 'non-food');
  assert.deepEqual(quoteBlend.components.map(componentMoney), [
    {
      role: 'base',
      variantId: base.variantId,
      mixingGroup: 'cleaning',
      percentage: 90,
      weightGrams: 90_000,
      sourceUnitPriceCents: 4000,
      tierDiscountPct: 0,
      unitContributionCents: 3600,
      subtotalCents: 14_400,
    },
    {
      role: 'ingredient',
      variantId: pigment.variantId,
      mixingGroup: 'pigments',
      percentage: 10,
      weightGrams: 10_000,
      sourceUnitPriceCents: 8000,
      tierDiscountPct: 0,
      unitContributionCents: 800,
      subtotalCents: 3200,
    },
  ]);
  assert.equal(quoteLine.materialSubtotalCents, 17_600);
  assert.equal(quoteLine.blendingFeeCents, 2_500);
  assert.equal(quoteLine.discountableTotalCents, 17_600);
  assert.equal(quoteLine.unitPriceCents, 4400);
  assert.equal(quoteLine.lineTotalCents, 20100);

  const cookie = orderCookie(payment);
  const beforeMutationResponse = await app.inject({
    method: 'GET',
    url: `/api/orders/${order.id}`,
    headers: { cookie },
  });
  assert.equal(beforeMutationResponse.statusCode, 200, beforeMutationResponse.body);
  const beforeMutation = beforeMutationResponse.json<unknown>();
  assert.equal(Value.Check(OrderDetailResponse, beforeMutation), true);

  // The order stores the resolved component facts. Later catalogue edits cannot rewrite it.
  db.prepare('UPDATE product_variants SET price_cents = 9999 WHERE id IN (?, ?)').run(
    base.variantId,
    pigment.variantId,
  );
  db.prepare("UPDATE products SET consumption_classification = 'food' WHERE id IN (?, ?)").run(
    base.productId,
    pigment.productId,
  );
  const afterMutationResponse = await app.inject({
    method: 'GET',
    url: `/api/orders/${order.id}`,
    headers: { cookie },
  });
  assert.equal(afterMutationResponse.statusCode, 200, afterMutationResponse.body);
  assert.deepEqual(afterMutationResponse.json(), beforeMutation);

  const replay = await app.inject({
    method: 'POST',
    url: '/api/payments/pay',
    headers: UK_HEADERS,
    payload: paymentPayload(cartId, idempotencyKey, customerEmail),
  });
  assert.equal(replay.statusCode, 201, replay.body);
  assert.deepEqual(replay.json(), orderBody);
  assert.equal(gateway.requests.length, 1, 'idempotent replay must not call the gateway again');
  assert.equal(
    (
      db
        .prepare('SELECT COUNT(*) AS count FROM orders WHERE customer_email = ?')
        .get(customerEmail) as { count: number }
    ).count,
    1,
  );
});

void test('stale mixed-group Custom Blend fails before gateway and preserves business state', async (t) => {
  const gateway = countGateway();
  const { db, app } = await createSeededAppFixture({
    testContext: t,
    app: { clock: { now: () => NOW }, paymentGateway: gateway.gateway },
  });
  const base = eligibleLot(db, 'cleaning');
  const pigment = eligibleLot(db, 'pigments');
  db.prepare('UPDATE product_variants SET stock_count = 100000 WHERE id = ?').run(base.variantId);

  const cartResponse = await app.inject({
    method: 'POST',
    url: '/api/cart',
    headers: UK_HEADERS,
    payload: { country: 'UK' },
  });
  assert.equal(cartResponse.statusCode, 201, cartResponse.body);
  const cartId = Value.Parse(CreateCartResponse, cartResponse.json()).cartId;
  const configuredResponse = await app.inject({
    method: 'POST',
    url: `/api/cart/${cartId}/custom-blends`,
    headers: UK_HEADERS,
    payload: {
      baseVariantId: base.variantId,
      ingredients: [{ variantId: pigment.variantId, percentage: 10 }],
      quantity: 4,
    },
  });
  assert.equal(configuredResponse.statusCode, 200, configuredResponse.body);
  parseCart(configuredResponse);

  const cartLineBefore = db
    .prepare(
      `SELECT variant_id AS variantId, quantity, config_key AS configKey,
              custom_blend_json AS customBlendJson, created_at AS createdAt, updated_at AS updatedAt
         FROM cart_line_items WHERE cart_id = ?`,
    )
    .all(cartId);
  const baseStockBefore = (
    db
      .prepare('SELECT stock_count AS stockCount FROM product_variants WHERE id = ?')
      .get(base.variantId) as {
      stockCount: number;
    }
  ).stockCount;
  db.prepare('UPDATE product_variants SET active = 0 WHERE id = ?').run(pigment.variantId);

  const idempotencyKey = ownedIdempotencyKey('b', base.variantId, pigment.variantId);
  const stalePayment = await app.inject({
    method: 'POST',
    url: '/api/payments/pay',
    headers: UK_HEADERS,
    payload: paymentPayload(cartId, idempotencyKey, 'custom-blend-stale@example.test'),
  });
  assert.equal(stalePayment.statusCode, 409, stalePayment.body);
  assert.equal(responseCode(stalePayment), 'CUSTOM_BLEND_INVALID');
  assert.equal(
    gateway.requests.length,
    0,
    'stale validation must happen before gateway authorization',
  );

  const cartLineAfter = db
    .prepare(
      `SELECT variant_id AS variantId, quantity, config_key AS configKey,
              custom_blend_json AS customBlendJson, created_at AS createdAt, updated_at AS updatedAt
         FROM cart_line_items WHERE cart_id = ?`,
    )
    .all(cartId);
  assert.deepEqual(cartLineAfter, cartLineBefore);
  const baseStockAfter = (
    db
      .prepare('SELECT stock_count AS stockCount FROM product_variants WHERE id = ?')
      .get(base.variantId) as {
      stockCount: number;
    }
  ).stockCount;
  assert.equal(baseStockAfter, baseStockBefore);
  assert.equal(
    (
      db
        .prepare(
          'SELECT COUNT(*) AS count FROM cart_reservations WHERE payment_idempotency_key = ?',
        )
        .get(idempotencyKey) as { count: number }
    ).count,
    0,
  );
  assert.equal(
    (
      db
        .prepare(
          'SELECT COUNT(*) AS count FROM inventory_reservations WHERE payment_idempotency_key = ?',
        )
        .get(idempotencyKey) as { count: number }
    ).count,
    0,
  );
  assert.equal(
    (
      db
        .prepare('SELECT COUNT(*) AS count FROM orders WHERE customer_email = ?')
        .get('custom-blend-stale@example.test') as { count: number }
    ).count,
    0,
  );
  const paymentRow = db
    .prepare(
      'SELECT status, order_id AS orderId, response_json AS responseJson FROM payments WHERE idempotency_key = ?',
    )
    .get(idempotencyKey) as { status: string; orderId: number | null; responseJson: string | null };
  assert.equal(paymentRow.status, 'failed_pre_gateway');
  assert.equal(paymentRow.orderId, null);
  assert.deepEqual(JSON.parse(paymentRow.responseJson ?? '{}'), {
    success: false,
    error: 'CUSTOM_BLEND_INVALID',
  });
});
