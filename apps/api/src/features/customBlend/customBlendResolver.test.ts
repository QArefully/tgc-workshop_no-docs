import assert from 'node:assert/strict';
import test from 'node:test';
import type { CustomBlendIngredientInput, CustomBlendOption } from '@shop/contracts';
import {
  createCustomBlendResolver,
  CustomBlendResolverError,
  type CustomBlendCountryAvailability,
  type CustomBlendResolverClock,
} from './customBlendResolver.js';
import type {
  CustomBlendCandidateQuery,
  CustomBlendFactRow,
  CustomBlendRepository,
} from './customBlendRepository.js';

const NOW = new Date('2026-08-15T12:00:00.000Z');

function fact(
  variantId: number,
  mixingGroup: string,
  overrides: Partial<CustomBlendFactRow> = {},
): CustomBlendFactRow {
  return {
    product_id: variantId + 1000,
    product_name: `Material ${variantId}`,
    product_description: `Description ${variantId}`,
    category: 'Trade Materials',
    product_slug: `material-${variantId}`,
    consumption_classification: mixingGroup === 'cleaning' ? 'caution' : 'food',
    details_json: null,
    mixing_group: mixingGroup,
    variant_id: variantId,
    sku: `MAT-${variantId}`,
    label: '25 kg sack',
    weight_grams: 25_000,
    price_cents: 1_000,
    moq_sacks: 4,
    compare_at_price_cents: null,
    clearance_price_cents: null,
    clearance_starts_at: null,
    clearance_ends_at: null,
    stock_count: 10,
    backorderable: 0,
    backorder_lead_days: null,
    delivery_class: 'freight',
    variant_active: 1,
    sort_order: 1,
    ...overrides,
  };
}

function fixture(
  rows: CustomBlendFactRow[],
  now: Date = NOW,
  countryAvailability?: CustomBlendCountryAvailability,
): {
  resolver: ReturnType<typeof createCustomBlendResolver>;
  queries: Array<CustomBlendCandidateQuery | undefined>;
} {
  const queries: Array<CustomBlendCandidateQuery | undefined> = [];
  const repository: CustomBlendRepository = {
    findEligibleVariant: (variantId) => rows.find((row) => row.variant_id === variantId),
    listCandidateFacts: (query) => {
      queries.push(query);
      return rows;
    },
    listCompatibleIngredients: (base) => rows.filter((row) => row.variant_id !== base.variant_id),
  };
  const clock: CustomBlendResolverClock = { now: () => now };
  return { resolver: createCustomBlendResolver(repository, clock, countryAvailability), queries };
}

function expectCode(action: () => unknown, code: CustomBlendResolverError['code']): void {
  assert.throws(
    action,
    (error: unknown) => error instanceof CustomBlendResolverError && error.code === code,
  );
}

void test('lists only policy-approved bases and filters options in the resolver', () => {
  const rows = [
    fact(1, 'food-grade'),
    fact(2, 'food-grade', { product_name: 'Sold out food ingredient', stock_count: 0 }),
    fact(3, 'cleaning', { consumption_classification: 'caution' }),
    fact(4, 'pigments'),
    fact(5, 'absorbents'),
  ];
  const { resolver } = fixture(rows);

  const bases = resolver.listBases({ q: '  material  ', category: ' trade materials ' });
  assert.deepEqual(
    bases.items.map((item: CustomBlendOption) => item.variant.variantId),
    [3, 1, 2],
  );
  assert.equal(bases.total, 3);

  const options = resolver.listOptions(3);
  assert.deepEqual(
    options.ingredients.map((item) => item.variant.variantId),
    [4],
  );
  assert.equal(
    options.ingredients.some((item) => item.variant.variantId === 4),
    true,
  );
  assert.equal(
    options.ingredients.some((item) => item.variant.variantId === 1),
    false,
  );
  assert.equal(
    options.ingredients.find((item) => item.variant.variantId === 4)?.variant.stockCount,
    10,
  );
});

void test('evaluates default MOQ, current facts, classification, and component pricing', () => {
  const rows = [
    fact(1, 'cleaning', { price_cents: 1_000, consumption_classification: 'caution' }),
    fact(2, 'cleaning', { price_cents: 2_000, consumption_classification: 'non-food' }),
  ];
  const { resolver } = fixture(rows);
  const resolved = resolver.evaluate(1, [{ variantId: 2, percentage: 25 }]);

  assert.equal(resolved.quantity, 4);
  assert.equal(resolved.basePercentage, 75);
  assert.equal(resolved.resultClassification, 'non-food');
  assert.equal(resolved.components.length, 2);
  assert.equal(resolved.components[0]?.role, 'base');
  assert.equal(resolved.components[1]?.role, 'ingredient');
  assert.equal(resolved.components[0]?.weightGrams, 75_000);
  assert.equal(resolved.components[1]?.weightGrams, 25_000);
  assert.equal(resolved.materialSubtotalCents, resolved.materialUnitPriceCents * 4);
  assert.equal(resolved.lineTotalCents, resolved.materialSubtotalCents + 2_500);
});

void test('returns typed incompatible and combined pigment-cap failures', () => {
  const rows = [
    fact(1, 'cleaning'),
    fact(2, 'food-grade'),
    fact(3, 'pigments'),
    fact(4, 'pigments'),
    fact(5, 'cleaning'),
  ];
  const { resolver } = fixture(rows);

  expectCode(
    () => resolver.evaluate(1, [{ variantId: 2, percentage: 10 }]),
    'CUSTOM_BLEND_INCOMPATIBLE',
  );
  expectCode(
    () =>
      resolver.evaluate(1, [
        { variantId: 3, percentage: 6 },
        { variantId: 4, percentage: 5 },
      ]),
    'CUSTOM_BLEND_PIGMENT_CAP_EXCEEDED',
  );
});

void test('resolves each component against its own tier and active clearance at injected time', () => {
  const rows = [
    fact(1, 'cleaning', {
      price_cents: 1_001,
      clearance_price_cents: 501,
      clearance_starts_at: '2026-08-01T00:00:00.000Z',
      clearance_ends_at: '2026-09-01T00:00:00.000Z',
    }),
    fact(2, 'cleaning', { price_cents: 2_001 }),
  ];
  const { resolver } = fixture(rows);
  const resolved = resolver.evaluate(1, [{ variantId: 2, percentage: 50 }], 400);

  assert.equal(resolved.components[0]?.sourceUnitPriceCents, 501);
  assert.equal(resolved.components[0]?.tierDiscountPct, 5);
  assert.equal(resolved.components[1]?.tierDiscountPct, 5);
  assert.equal(resolved.components[0]?.clearance?.priceCents, 501);
  assert.equal(resolved.components[0]?.nextTierProgress?.minTonnes, 10);
});

void test('rehydrates only the persisted specification and rejects corrupt identity', () => {
  const rows = [
    fact(1, 'cleaning', { product_name: 'Current Base' }),
    fact(2, 'cleaning', { product_name: 'Current Ingredient', price_cents: 1_500 }),
  ];
  const { resolver, queries } = fixture(rows);
  const resolved = resolver.evaluate(1, [{ variantId: 2, percentage: 25 }], 4);
  const persisted = resolver.toPersistedSpec(resolved);

  assert.equal('components' in persisted, false);
  assert.equal('quantity' in persisted, false);
  assert.equal('lineTotalCents' in persisted, false);
  const changedOutcome = {
    ...resolved,
    lineTotalCents: 1,
    materialSubtotalCents: 1,
    components: resolved.components.map((component) => ({
      ...component,
      sourceUnitPriceCents: 1,
      subtotalCents: 1,
    })),
  };
  const rehydrated = resolver.rehydrate(1, changedOutcome, 4);
  assert.equal(rehydrated.lineTotalCents, resolved.lineTotalCents);
  assert.equal(rehydrated.components[1]?.sourceUnitPriceCents, 1_500);
  assert.deepEqual(queries.length > 0, true);

  expectCode(
    () => resolver.rehydrate(1, { ...persisted, configKey: 'bad' }, 4),
    'CUSTOM_BLEND_CORRUPT_SNAPSHOT',
  );
  expectCode(() => resolver.rehydrate(1, '{not json', 4), 'CUSTOM_BLEND_CORRUPT_SNAPSHOT');
});

void test('retains active facts even when an ingredient is sold out', () => {
  const rows = [fact(1, 'food-grade'), fact(2, 'food-grade', { stock_count: 0 })];
  const { resolver } = fixture(rows);
  const resolved = resolver.evaluate(1, [{ variantId: 2, percentage: 5 }]);
  assert.equal(resolved.ingredients[0]?.variantId, 2);
  assert.equal(resolved.components[1]?.variantId, 2);
});

void test('reports unavailable current facts separately from incompatible policy', () => {
  const { resolver } = fixture([fact(1, 'food-grade')]);
  expectCode(
    () => resolver.evaluate(1, [{ variantId: 99, percentage: 5 }]),
    'CUSTOM_BLEND_UNAVAILABLE',
  );
  expectCode(() => resolver.listOptions(99), 'CUSTOM_BLEND_UNAVAILABLE');
});

void test('accepts readonly ingredient input without mutating it', () => {
  const rows = [fact(1, 'food-grade'), fact(2, 'food-grade')];
  const { resolver } = fixture(rows);
  const ingredients: readonly CustomBlendIngredientInput[] = [{ variantId: 2, percentage: 5 }];
  resolver.evaluate(1, ingredients);
  assert.deepEqual(ingredients, [{ variantId: 2, percentage: 5 }]);
});

void test('applies category and product country exclusions before listing and evaluation', () => {
  const rows = [
    fact(1, 'food-grade', { category: 'Blocked Category', product_slug: 'blocked-base' }),
    fact(2, 'food-grade', { category: 'Trade Materials', product_slug: 'allowed-lot' }),
    fact(3, 'food-grade', { category: 'Trade Materials', product_slug: 'blocked-ingredient' }),
  ];
  const countryAvailability: CustomBlendCountryAvailability = {
    isCategoryBlocked: (country, category) => country === 'CN' && category === 'Blocked Category',
    isProductBlocked: (country, slug) => country === 'CN' && slug === 'blocked-ingredient',
  };
  const { resolver } = fixture(rows, NOW, countryAvailability);

  assert.deepEqual(
    resolver.listBases(undefined, 'CN').items.map((item) => item.variant.variantId),
    [2],
  );
  expectCode(() => resolver.listOptions(1, 'CN'), 'CUSTOM_BLEND_UNAVAILABLE');
  assert.deepEqual(
    resolver.listOptions(2, 'CN').ingredients.map((item) => item.variant.variantId),
    [],
  );
  expectCode(
    () => resolver.evaluate(2, [{ variantId: 3, percentage: 5 }], undefined, 'CN'),
    'CUSTOM_BLEND_UNAVAILABLE',
  );
});
