import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import {
  CustomBlendErrorResponse,
  CustomBlendOptionsResponse,
  ErrorResponse,
  type CustomBlendOptionsResponse as CustomBlendOptionsResponseType,
} from '@shop/contracts';
import { openDatabase } from '../../src/db/index.js';
import { createSeededAppFixture } from '../support/seededDatabase.js';

type EligibleLot = { variantId: number; productId: number; category: string };

function eligibleLot(db: ReturnType<typeof openDatabase>, category?: string): EligibleLot {
  const categoryClause = category ? 'AND p.category = ?' : '';
  const row = db
    .prepare(
      `SELECT pv.id AS variantId, p.id AS productId, p.category
       FROM product_variants pv
       INNER JOIN products p ON p.id = pv.product_id
       WHERE p.active = 1
         AND pv.active = 1
         AND pv.sort_order = 1
         AND pv.weight_grams = 25000
         AND p.mixing_group = 'food-grade'
         ${categoryClause}
       ORDER BY pv.id ASC
       LIMIT 1`,
    )
    .get(...(category ? [category] : [])) as EligibleLot | undefined;
  if (!row) throw new Error('Expected eligible food-grade lot');
  return row;
}

void test('Custom Blend options expose all compatible active 25 kg lots across categories, including sold out lots', async (t) => {
  const { db, app } = await createSeededAppFixture(t);
  const base = eligibleLot(db, 'Sports Nutrition');
  const crossCategory = db
    .prepare(
      `SELECT pv.id AS variantId, p.id AS productId, p.category
       FROM product_variants pv
       INNER JOIN products p ON p.id = pv.product_id
       WHERE p.active = 1 AND pv.active = 1 AND pv.sort_order = 1 AND pv.weight_grams = 25000
         AND p.mixing_group = 'food-grade' AND p.category != ?
       ORDER BY p.category ASC, pv.id ASC LIMIT 1`,
    )
    .get(base.category) as EligibleLot | undefined;
  if (!crossCategory) throw new Error('Expected cross-category food-grade lot');
  db.prepare('UPDATE product_variants SET stock_count = 0 WHERE id = ?').run(
    crossCategory.variantId,
  );

  const excluded = db
    .prepare(
      `SELECT pv.id AS variantId, p.id AS productId, p.category
       FROM product_variants pv
       INNER JOIN products p ON p.id = pv.product_id
       WHERE p.active = 1 AND pv.active = 1 AND pv.sort_order = 1 AND pv.weight_grams = 25000
         AND p.mixing_group = 'food-grade' AND pv.id NOT IN (?, ?)
       ORDER BY pv.id ASC LIMIT 1`,
    )
    .get(base.variantId, crossCategory.variantId) as EligibleLot | undefined;
  if (!excluded) throw new Error('Expected additional eligible food-grade lot');
  db.prepare('UPDATE products SET mixing_group = NULL WHERE id = ?').run(excluded.productId);
  const response = await app.inject({
    method: 'GET',
    url: `/api/custom-blends/options?baseVariantId=${base.variantId}`,
  });
  assert.equal(response.statusCode, 200);
  const body = response.json<CustomBlendOptionsResponseType>();
  assert.equal(Value.Check(CustomBlendOptionsResponse, body), true);
  assert.equal(body.base.variant.variantId, base.variantId);
  assert.equal(body.base.mixingGroup, 'food-grade');
  for (const option of [body.base, ...body.ingredients]) {
    assert.ok(option.category.length > 0);
    assert.ok(['food', 'non-food', 'caution'].includes(option.consumptionClassification));
    assert.equal(typeof option.categoryFacts, 'object');
  }
  assert.notEqual(body.base.categoryFacts.texture, 'Not specified');
  assert.ok(
    body.ingredients.some((option) => option.variant.variantId === crossCategory.variantId),
  );
  assert.equal(
    body.ingredients.find((option) => option.variant.variantId === crossCategory.variantId)?.variant
      .stockCount,
    0,
  );
  assert.equal(
    body.ingredients.some((option) => option.variant.variantId === base.variantId),
    false,
  );
  assert.equal(
    body.ingredients.some((option) => option.productId === String(excluded.productId)),
    false,
  );
  assert.deepEqual(
    body.ingredients.map((option) => option.variant.variantId),
    [...body.ingredients]
      .sort(
        (left, right) =>
          left.mixingGroup.localeCompare(right.mixingGroup) ||
          left.productName.localeCompare(right.productName) ||
          left.variant.variantId - right.variant.variantId,
      )
      .map((option) => option.variant.variantId),
  );
});

void test('Custom Blend options safely default invalid category facts', async (t) => {
  const { db, app } = await createSeededAppFixture(t);
  const base = eligibleLot(db, 'Sports Nutrition');
  const ingredient = db
    .prepare(
      `SELECT pv.id AS variantId, p.id AS productId, p.category
       FROM product_variants pv
       INNER JOIN products p ON p.id = pv.product_id
       WHERE p.active = 1 AND pv.active = 1 AND pv.sort_order = 1 AND pv.weight_grams = 25000
         AND p.mixing_group = 'food-grade' AND pv.id != ?
       ORDER BY p.name COLLATE NOCASE ASC, pv.id ASC LIMIT 1`,
    )
    .get(base.variantId) as EligibleLot | undefined;
  if (!ingredient) throw new Error('Expected compatible ingredient lot');
  const expectedFacts = {
    texture: 'Not specified',
    colour: 'Not specified',
    source: 'Not specified',
    intendedUse: 'Not specified',
    storage: 'Not specified',
    consumptionClassification: 'food',
  };
  for (const detailsJson of [
    null,
    '{malformed',
    '{}',
    '[]',
    JSON.stringify({ texture: 'Fine soft powder' }),
    JSON.stringify({ ...expectedFacts, unexpected: 'fact' }),
  ]) {
    db.prepare('UPDATE products SET details_json = ? WHERE id IN (?, ?)').run(
      detailsJson,
      base.productId,
      ingredient.productId,
    );
    const response = await app.inject({
      method: 'GET',
      url: `/api/custom-blends/options?baseVariantId=${base.variantId}`,
    });
    assert.equal(response.statusCode, 200);
    const body = response.json<CustomBlendOptionsResponseType>();
    assert.equal(Value.Check(CustomBlendOptionsResponse, body), true);
    assert.deepEqual(body.base.categoryFacts, expectedFacts);
    assert.deepEqual(
      body.ingredients.find((option) => option.variant.variantId === ingredient.variantId)
        ?.categoryFacts,
      expectedFacts,
    );
  }
});

void test('Custom Blend options reject nonexistent, inactive, null-group, and wrong-shape bases', async (t) => {
  void t;
  const invalidCases: Array<{
    variantId: number | 'base';
    mutate: (db: ReturnType<typeof openDatabase>, base: EligibleLot) => void;
  }> = [
    { variantId: 999_999, mutate: () => undefined },
    {
      variantId: 'base',
      mutate: (db, base) =>
        db.prepare('UPDATE product_variants SET active = 0 WHERE id = ?').run(base.variantId),
    },
    {
      variantId: 'base',
      mutate: (db, base) =>
        db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(base.productId),
    },
    {
      variantId: 'base',
      mutate: (db, base) =>
        db.prepare('UPDATE products SET mixing_group = NULL WHERE id = ?').run(base.productId),
    },
    {
      variantId: 'base',
      mutate: (db, base) =>
        db
          .prepare('UPDATE product_variants SET weight_grams = 1000 WHERE id = ?')
          .run(base.variantId),
    },
    {
      variantId: 'base',
      mutate: (db, base) =>
        db.prepare('UPDATE product_variants SET sort_order = 0 WHERE id = ?').run(base.variantId),
    },
  ];

  for (const invalidCase of invalidCases) {
    const fixture = await createSeededAppFixture();
    try {
      const { db, app } = fixture;
      const base = eligibleLot(db, 'Sports Nutrition');
      const variantId = invalidCase.variantId === 'base' ? base.variantId : invalidCase.variantId;
      invalidCase.mutate(db, base);
      const response = await app.inject({
        method: 'GET',
        url: `/api/custom-blends/options?baseVariantId=${variantId}`,
      });
      assert.equal(response.statusCode, 400);
      assert.equal(Value.Check(CustomBlendErrorResponse, response.json()), true);
    } finally {
      await fixture.cleanup();
    }
  }
});

void test('Custom Blend options serialize malformed query validation as 400 responses', async (t) => {
  const { app } = await createSeededAppFixture(t);

  for (const query of ['', '?baseVariantId=not-a-number', '?baseVariantId=1&unexpected=true']) {
    const response = await app.inject({ method: 'GET', url: `/api/custom-blends/options${query}` });
    assert.equal(response.statusCode, 400);
    assert.equal(Value.Check(ErrorResponse, response.json()), true);
  }
});
