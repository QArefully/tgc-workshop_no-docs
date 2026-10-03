import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import {
  Cart,
  CreateCartResponse,
  CustomBlendBaseListResponse,
  CustomBlendEvaluationResponse,
  ErrorResponse,
  type CustomBlendEvaluationResponse as CustomBlendEvaluationResponseType,
} from '@shop/contracts';
import { openDatabase } from '../../src/db/index.js';
import { createSeededAppFixture } from '../support/seededDatabase.js';

type Lot = {
  id: number;
  productId: number;
  productName: string;
  category: string;
  mixingGroup: string;
  moqSacks: number;
};

function lots(
  db: ReturnType<typeof openDatabase>,
  predicate: string,
  params: readonly unknown[] = [],
): Lot[] {
  return db
    .prepare(
      `SELECT pv.id, pv.product_id AS productId, p.name AS productName, p.category,
              p.mixing_group AS mixingGroup, pv.moq_sacks AS moqSacks
       FROM product_variants pv
       INNER JOIN products p ON p.id = pv.product_id
       WHERE p.active = 1
         AND pv.active = 1
         AND pv.sort_order = 1
         AND pv.weight_grams = 25000
         AND p.mixing_group IS NOT NULL
         AND ${predicate}
       ORDER BY p.mixing_group COLLATE NOCASE ASC, p.name COLLATE NOCASE ASC, pv.id ASC`,
    )
    .all(...params) as Lot[];
}

function cartIdFrom(response: { json(): unknown }): string {
  return Value.Parse(CreateCartResponse, response.json()).cartId;
}

function responseCode(response: { json(): unknown }): string {
  const body = response.json<unknown>();
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error('Expected an error response object');
  }
  const code = (body as Record<string, unknown>).code;
  if (typeof code !== 'string') throw new Error('Expected an error response code');
  return code;
}

void test('Custom Blend base list is strict, filtered, paginated, and stably ordered', async (t) => {
  const { app } = await createSeededAppFixture(t);

  const response = await app.inject({
    method: 'GET',
    url: '/api/custom-blends/bases?page=1&pageSize=5',
  });
  assert.equal(response.statusCode, 200);
  const body = response.json<unknown>();
  assert.equal(Value.Check(CustomBlendBaseListResponse, body), true);
  const parsed = body as {
    items: Array<{ mixingGroup: string; productName: string; variant: { variantId: number } }>;
    total: number;
    page: number;
    pageSize: number;
  };
  assert.equal(parsed.page, 1);
  assert.equal(parsed.pageSize, 5);
  assert.ok(parsed.total >= parsed.items.length);
  assert.ok(parsed.items.every((item) => !['pigments', 'absorbents'].includes(item.mixingGroup)));
  assert.deepEqual(
    parsed.items.map((item) => item.variant.variantId),
    [...parsed.items]
      .sort(
        (left, right) =>
          left.mixingGroup.localeCompare(right.mixingGroup) ||
          left.productName.localeCompare(right.productName) ||
          left.variant.variantId - right.variant.variantId,
      )
      .map((item) => item.variant.variantId),
  );

  const filtered = await app.inject({
    method: 'GET',
    url: '/api/custom-blends/bases?q=cement&category=Trade%20%26%20Creative%20Materials',
  });
  assert.equal(filtered.statusCode, 200);
  const filteredBody = filtered.json<{
    items: Array<{ productName: string; category: string }>;
  }>();
  assert.ok(filteredBody.items.length > 0);
  assert.ok(filteredBody.items.some((item) => /cement/i.test(item.productName)));
  assert.ok(filteredBody.items.every((item) => item.category === 'Trade & Creative Materials'));

  for (const query of ['?page=0', '?pageSize=49', '?unexpected=true', '?page=1.2']) {
    const malformed = await app.inject({
      method: 'GET',
      url: `/api/custom-blends/bases${query}`,
    });
    assert.equal(malformed.statusCode, 400);
    assert.equal(responseCode(malformed), 'REQUEST_INVALID');
  }
});

void test('Custom Blend evaluation is side-effect free, localized, and returns strict resolved money', async (t) => {
  const { db, app } = await createSeededAppFixture(t);
  const base = lots(db, "p.mixing_group = 'cleaning'")[0];
  const sameGroup = lots(db, "p.mixing_group = 'cleaning'").find((lot) => lot.id !== base?.id);
  const incompatible = lots(db, "p.mixing_group = 'food-grade'")[0];
  if (!base || !sameGroup || !incompatible) throw new Error('Expected seeded Custom Blend lots');

  const payload = {
    baseVariantId: base.id,
    ingredients: [{ variantId: sameGroup.id, percentage: 25 }],
    quantity: 4,
  };
  const cart = await app.inject({ method: 'POST', url: '/api/cart' });
  const cartId = cartIdFrom(cart);
  const before = await app.inject({ method: 'GET', url: `/api/cart/${cartId}` });

  const evaluated = await app.inject({
    method: 'POST',
    url: '/api/custom-blends/evaluate',
    payload,
  });
  assert.equal(evaluated.statusCode, 200);
  const result = evaluated.json<CustomBlendEvaluationResponseType>();
  assert.equal(Value.Check(CustomBlendEvaluationResponse, result), true);
  assert.equal(result.quantity, payload.quantity);
  assert.equal(result.customBlend.quantity, payload.quantity);
  assert.equal(result.customBlend.resultClassification, 'non-food');
  assert.equal(
    result.customBlend.materialSubtotalCents,
    result.customBlend.materialUnitPriceCents * result.quantity,
  );
  assert.equal(
    result.customBlend.lineTotalCents,
    result.customBlend.materialSubtotalCents + result.customBlend.blendingFeeCents,
  );
  assert.equal(result.customBlend.components.length, 2);

  const after = await app.inject({ method: 'GET', url: `/api/cart/${cartId}` });
  assert.deepEqual(after.json(), before.json());

  const incompatibleResponse = await app.inject({
    method: 'POST',
    url: '/api/custom-blends/evaluate',
    headers: { 'x-shop-country': 'DE' },
    payload: {
      baseVariantId: base.id,
      ingredients: [{ variantId: incompatible.id, percentage: 5 }],
    },
  });
  assert.equal(incompatibleResponse.statusCode, 400);
  assert.equal(responseCode(incompatibleResponse), 'CUSTOM_BLEND_INCOMPATIBLE');
  assert.match(incompatibleResponse.json<{ error: string }>().error, /ausgewählten/i);

  const unavailable = await app.inject({
    method: 'POST',
    url: '/api/custom-blends/evaluate',
    payload: {
      baseVariantId: base.id,
      ingredients: [{ variantId: 999_999, percentage: 5 }],
    },
  });
  assert.equal(unavailable.statusCode, 400);
  assert.equal(responseCode(unavailable), 'CUSTOM_BLEND_INVALID');
  assert.doesNotMatch(unavailable.json<{ error: string }>().error, /Selected Custom Blend/);

  for (const malformedPayload of [
    { ...payload, unexpected: true },
    { ...payload, ingredients: [] },
    { ...payload, quantity: 0 },
  ]) {
    const malformed = await app.inject({
      method: 'POST',
      url: '/api/custom-blends/evaluate',
      payload: malformedPayload,
    });
    assert.equal(malformed.statusCode, 400);
    assert.equal(Value.Check(ErrorResponse, malformed.json()), true);
    assert.equal(responseCode(malformed), 'REQUEST_INVALID');
  }
});

void test('Custom Blend reads and evaluation honour country product exclusions', async (t) => {
  const { db, app } = await createSeededAppFixture(t);
  const blockedBase = lots(
    db,
    "p.category = 'Sports Nutrition' AND p.mixing_group = 'food-grade'",
  )[0];
  const allowedBase = lots(
    db,
    "p.category != 'Sports Nutrition' AND p.mixing_group = 'food-grade'",
  )[0];
  if (!blockedBase || !allowedBase) throw new Error('Expected blocked and allowed food-grade lots');

  const cnBases = await app.inject({
    method: 'GET',
    url: '/api/custom-blends/bases?pageSize=48',
    headers: { 'x-shop-country': 'CN' },
  });
  assert.equal(cnBases.statusCode, 200);
  const cnBaseBody = cnBases.json<{
    items: Array<{ category: string; variant: { variantId: number } }>;
  }>();
  assert.equal(
    cnBaseBody.items.some((item) => item.category === 'Sports Nutrition'),
    false,
  );
  assert.equal(
    cnBaseBody.items.some((item) => item.variant.variantId === blockedBase.id),
    false,
  );

  const cnOptions = await app.inject({
    method: 'GET',
    url: `/api/custom-blends/options?baseVariantId=${allowedBase.id}`,
    headers: { 'x-shop-country': 'CN' },
  });
  assert.equal(cnOptions.statusCode, 200);
  const cnOptionBody = cnOptions.json<{
    ingredients: Array<{ category: string; variant: { variantId: number } }>;
  }>();
  assert.equal(
    cnOptionBody.ingredients.some((item) => item.category === 'Sports Nutrition'),
    false,
  );
  assert.equal(
    cnOptionBody.ingredients.some((item) => item.variant.variantId === blockedBase.id),
    false,
  );

  const blockedBaseEvaluation = await app.inject({
    method: 'POST',
    url: '/api/custom-blends/evaluate',
    headers: { 'x-shop-country': 'CN' },
    payload: {
      baseVariantId: blockedBase.id,
      ingredients: [{ variantId: allowedBase.id, percentage: 5 }],
    },
  });
  assert.equal(blockedBaseEvaluation.statusCode, 400);
  assert.equal(responseCode(blockedBaseEvaluation), 'CUSTOM_BLEND_INVALID');
  assert.doesNotMatch(blockedBaseEvaluation.json<{ error: string }>().error, /Sports Nutrition/);

  const blockedIngredientEvaluation = await app.inject({
    method: 'POST',
    url: '/api/custom-blends/evaluate',
    headers: { 'x-shop-country': 'CN' },
    payload: {
      baseVariantId: allowedBase.id,
      ingredients: [{ variantId: blockedBase.id, percentage: 5 }],
    },
  });
  assert.equal(blockedIngredientEvaluation.statusCode, 400);
  assert.equal(responseCode(blockedIngredientEvaluation), 'CUSTOM_BLEND_INVALID');
  assert.doesNotMatch(
    blockedIngredientEvaluation.json<{ error: string }>().error,
    /Sports Nutrition/,
  );
});

void test('Custom Blend pigment cap exposes safe metadata and mutations use resolver quantities', async (t) => {
  const { db, app } = await createSeededAppFixture(t);
  const base = lots(db, "p.mixing_group = 'casting-materials'")[0];
  const pigments = lots(db, "p.mixing_group = 'pigments'").slice(0, 2);
  const sameGroup = lots(db, "p.mixing_group = 'casting-materials'").filter(
    (lot) => lot.id !== base?.id,
  )[0];
  if (!base || pigments.length < 2 || !sameGroup) {
    throw new Error('Expected casting and pigment Custom Blend lots');
  }

  const cap = await app.inject({
    method: 'POST',
    url: '/api/custom-blends/evaluate',
    payload: {
      baseVariantId: base.id,
      ingredients: pigments.map((lot, index) => ({ variantId: lot.id, percentage: index ? 5 : 6 })),
    },
  });
  assert.equal(cap.statusCode, 400);
  assert.equal(responseCode(cap), 'CUSTOM_BLEND_PIGMENT_CAP_EXCEEDED');
  assert.deepEqual(cap.json<{ meta: { maxPercentage: number; actualPercentage: number } }>().meta, {
    maxPercentage: 10,
    actualPercentage: 11,
  });

  const cartId = cartIdFrom(await app.inject({ method: 'POST', url: '/api/cart' }));
  const created = await app.inject({
    method: 'POST',
    url: `/api/cart/${cartId}/custom-blends`,
    payload: {
      baseVariantId: base.id,
      ingredients: [{ variantId: sameGroup.id, percentage: 5 }],
    },
  });
  assert.equal(created.statusCode, 200);
  const createdCart = Value.Parse(Cart, created.json());
  const createdLine = createdCart.items[0];
  assert.ok(createdLine);
  assert.equal(createdLine.quantity, base.moqSacks);

  const lockedQuantity = createdLine.quantity + base.moqSacks;
  const updated = await app.inject({
    method: 'PATCH',
    url: `/api/cart/${cartId}/items`,
    payload: {
      productId: createdLine.productId,
      variantId: base.id,
      configKey: createdLine.configKey,
      quantity: lockedQuantity,
    },
  });
  assert.equal(updated.statusCode, 200);
  const lockedCart = Value.Parse(Cart, updated.json());
  const lockedLine = lockedCart.items[0];
  assert.ok(lockedLine);

  const replacement = await app.inject({
    method: 'PUT',
    url: `/api/cart/${cartId}/custom-blends`,
    payload: {
      baseVariantId: base.id,
      configKey: lockedLine.configKey,
      ingredients: [{ variantId: sameGroup.id, percentage: 10 }],
    },
  });
  assert.equal(replacement.statusCode, 200);
  const replacedCart = Value.Parse(Cart, replacement.json());
  const replacedLine = replacedCart.items[0];
  assert.ok(replacedLine?.customBlend && 'quantity' in replacedLine.customBlend);
  assert.equal(replacedLine.quantity, lockedQuantity);
  assert.equal(replacedLine.customBlend.quantity, lockedQuantity);
});
