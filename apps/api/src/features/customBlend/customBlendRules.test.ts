import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CUSTOM_BLEND_FEE_CENTS,
  SACK_WEIGHT_GRAMS,
  CUSTOM_BLEND_MAX_PIGMENT_PERCENTAGE,
} from '@shop/contracts';
import {
  assertCustomBlendCompatibility,
  assertCustomBlendPigmentCap,
  calculateCustomBlendComponentPricing,
  calculateCustomBlendPricing,
  calculateCustomBlendLinePricing,
  combinedCustomBlendPigmentPercentage,
  canonicalCustomBlendJson,
  canonicalizeCustomBlendIngredients,
  customBlendComponentWeightGrams,
  customBlendLineWeightGrams,
  isCustomBlendBaseGroup,
  isIngredientGroupAllowed,
  normalizeCustomBlendSpec,
  resolveCustomBlendClassification,
  validateCustomBlendCompatibility,
  validateCustomBlendPigmentCap,
} from './customBlendRules.js';

void test('normalizes permutations without mutating caller ingredients', () => {
  const input = [
    { variantId: 9, percentage: 15 },
    { variantId: 2, percentage: 20 },
  ];
  const original = structuredClone(input);
  const first = normalizeCustomBlendSpec(1, input);
  const second = normalizeCustomBlendSpec(1, [...input].reverse());

  assert.deepEqual(input, original);
  assert.deepEqual(first.ingredients, [
    { variantId: 2, percentage: 20 },
    { variantId: 9, percentage: 15 },
  ]);
  assert.equal(first.basePercentage, 65);
  assert.equal(
    first.canonicalJson,
    '[{"variantId":2,"percentage":20},{"variantId":9,"percentage":15}]',
  );
  assert.equal(first.canonicalJson, second.canonicalJson);
  assert.equal(first.configKey, second.configKey);
  assert.match(first.configKey, /^[a-f0-9]{64}$/);
});

void test('accepts every legal ratio boundary including exact fifty ingredient total', () => {
  assert.deepEqual(normalizeCustomBlendSpec(10, [{ variantId: 20, percentage: 5 }]), {
    ingredients: [{ variantId: 20, percentage: 5 }],
    basePercentage: 95,
    canonicalJson: '[{"variantId":20,"percentage":5}]',
    configKey: '6f1477ddfc768f7ada201533d2ef6a587b1ce17ca9c30cc79f07992e2000d1c0',
  });
  const exactFifty = normalizeCustomBlendSpec(1, [
    { variantId: 2, percentage: 5 },
    { variantId: 3, percentage: 10 },
    { variantId: 4, percentage: 15 },
    { variantId: 5, percentage: 20 },
  ]);
  assert.equal(exactFifty.basePercentage, 50);
  assert.equal(exactFifty.ingredients.length, 4);
});

void test('rejects invalid entries, ratio bounds, duplicate IDs, fifth ingredient, and base ingredient', () => {
  const cases: Array<() => unknown> = [
    () => normalizeCustomBlendSpec(1, []),
    () => normalizeCustomBlendSpec(1, [{ variantId: 2, percentage: 0 }]),
    () => normalizeCustomBlendSpec(1, [{ variantId: 2, percentage: 4 }]),
    () => normalizeCustomBlendSpec(1, [{ variantId: 2, percentage: 51 }]),
    () => normalizeCustomBlendSpec(1, [{ variantId: 2, percentage: 5.5 }]),
    () => normalizeCustomBlendSpec(1, [{ variantId: 0, percentage: 5 }]),
    () => normalizeCustomBlendSpec(1, [{ variantId: 1, percentage: 5 }]),
    () =>
      normalizeCustomBlendSpec(1, [
        { variantId: 2, percentage: 5 },
        { variantId: 2, percentage: 5 },
      ]),
    () =>
      normalizeCustomBlendSpec(1, [
        { variantId: 2, percentage: 50 },
        { variantId: 3, percentage: 5 },
      ]),
    () =>
      normalizeCustomBlendSpec(1, [
        { variantId: 2, percentage: 5 },
        { variantId: 3, percentage: 5 },
        { variantId: 4, percentage: 5 },
        { variantId: 5, percentage: 5 },
        { variantId: 6, percentage: 5 },
      ]),
  ];
  for (const invalid of cases) assert.throws(invalid, RangeError);
});

void test('canonical JSON sorts input before serializing to prevent identity ambiguity', () => {
  assert.equal(
    canonicalCustomBlendJson([
      { variantId: 3, percentage: 5 },
      { variantId: 2, percentage: 5 },
    ]),
    '[{"variantId":2,"percentage":5},{"variantId":3,"percentage":5}]',
  );
  assert.deepEqual(
    canonicalizeCustomBlendIngredients([
      { variantId: 3, percentage: 5 },
      { variantId: 2, percentage: 5 },
    ]),
    [
      { variantId: 2, percentage: 5 },
      { variantId: 3, percentage: 5 },
    ],
  );
});

void test('splits configured-line pricing with one non-discountable fee', () => {
  assert.deepEqual(calculateCustomBlendLinePricing(2_500, 4), {
    materialSubtotalCents: 10_000,
    blendingFeeCents: CUSTOM_BLEND_FEE_CENTS,
    discountableTotalCents: 10_000,
    lineTotalCents: 12_500,
  });
  assert.deepEqual(calculateCustomBlendLinePricing(0, 1, 0), {
    materialSubtotalCents: 0,
    blendingFeeCents: 0,
    discountableTotalCents: 0,
    lineTotalCents: 0,
  });
});

void test('rejects unsafe custom blend line pricing arithmetic', () => {
  assert.throws(() => calculateCustomBlendLinePricing(-1, 1), RangeError);
  assert.throws(() => calculateCustomBlendLinePricing(1, 0), RangeError);
  assert.throws(() => calculateCustomBlendLinePricing(1, 1, -1), RangeError);
  assert.throws(() => calculateCustomBlendLinePricing(Number.MAX_SAFE_INTEGER, 2, 0), RangeError);
  assert.throws(() => calculateCustomBlendLinePricing(Number.MAX_SAFE_INTEGER, 1, 1), RangeError);
});

void test('enforces the complete directional matrix and excludes pigment/absorbent bases', () => {
  const groups = [
    'food-grade',
    'cleaning',
    'garden-treatment',
    'cementitious-materials',
    'casting-materials',
    'pigments',
    'theatrical-effects',
    'absorbents',
  ] as const;

  assert.equal(isCustomBlendBaseGroup('food-grade'), true);
  assert.equal(isCustomBlendBaseGroup('cleaning'), true);
  assert.equal(isCustomBlendBaseGroup('garden-treatment'), true);
  assert.equal(isCustomBlendBaseGroup('cementitious-materials'), true);
  assert.equal(isCustomBlendBaseGroup('casting-materials'), true);
  assert.equal(isCustomBlendBaseGroup('theatrical-effects'), true);
  assert.equal(isCustomBlendBaseGroup('pigments'), false);
  assert.equal(isCustomBlendBaseGroup('absorbents'), false);
  assert.equal(isCustomBlendBaseGroup('not-a-group'), false);

  const expected: Record<(typeof groups)[number], readonly string[]> = {
    'food-grade': ['food-grade'],
    cleaning: ['cleaning', 'pigments'],
    'garden-treatment': ['garden-treatment'],
    'cementitious-materials': ['cementitious-materials'],
    'casting-materials': ['casting-materials', 'pigments'],
    pigments: [],
    'theatrical-effects': ['theatrical-effects', 'pigments'],
    absorbents: [],
  };
  for (const base of groups) {
    for (const ingredient of groups) {
      assert.equal(
        isIngredientGroupAllowed(base, ingredient),
        expected[base].includes(ingredient),
        `${base} -> ${ingredient}`,
      );
    }
  }
  assert.equal(isIngredientGroupAllowed('cleaning', 'casting-materials'), false);
  assert.equal(isIngredientGroupAllowed('pigments', 'cleaning'), false);
  assert.equal(isIngredientGroupAllowed('absorbents', 'absorbents'), false);
});

void test('returns typed incompatibility failures instead of rule prose', () => {
  assert.deepEqual(validateCustomBlendCompatibility('cleaning', ['cleaning', 'pigments']), {
    ok: true,
    value: true,
  });
  assert.deepEqual(validateCustomBlendCompatibility('cleaning', ['pigments', 'food-grade']), {
    ok: false,
    code: 'CUSTOM_BLEND_INCOMPATIBLE',
  });
  assert.throws(
    () => assertCustomBlendCompatibility('cementitious-materials', ['food-grade']),
    (error: unknown) =>
      error instanceof Error && 'code' in error && error.code === 'CUSTOM_BLEND_INCOMPATIBLE',
  );
});

void test('applies one combined pigment cap across multiple pigment ingredients', () => {
  const pigments = [
    { mixingGroup: 'pigments', percentage: 5 },
    { mixingGroup: 'pigments', percentage: 5 },
    { mixingGroup: 'cleaning', percentage: 40 },
  ];
  assert.equal(combinedCustomBlendPigmentPercentage(pigments), CUSTOM_BLEND_MAX_PIGMENT_PERCENTAGE);
  assert.deepEqual(validateCustomBlendPigmentCap(pigments), { ok: true, value: true });

  const exceeded = [...pigments, { mixingGroup: 'pigments', percentage: 1 }];
  assert.deepEqual(validateCustomBlendPigmentCap(exceeded), {
    ok: false,
    code: 'CUSTOM_BLEND_PIGMENT_CAP_EXCEEDED',
    maxPercentage: CUSTOM_BLEND_MAX_PIGMENT_PERCENTAGE,
    actualPercentage: 11,
  });
  assert.throws(() => assertCustomBlendPigmentCap(exceeded), /CUSTOM_BLEND_PIGMENT_CAP_EXCEEDED/);
});

void test('reduces classifications to food only when every component is food', () => {
  assert.equal(resolveCustomBlendClassification(['food', 'food']), 'food');
  assert.equal(resolveCustomBlendClassification('food', ['food', 'food']), 'food');
  assert.equal(resolveCustomBlendClassification(['food', 'caution']), 'non-food');
  assert.equal(resolveCustomBlendClassification(['food', 'non-food']), 'non-food');
  assert.equal(resolveCustomBlendClassification([]), 'non-food');
});

void test('prices components against their own weight tier, not the aggregate blend tier', () => {
  const quantity = 400; // 10 tonnes in aggregate.
  const priced = calculateCustomBlendPricing({
    quantity,
    components: [
      {
        role: 'base',
        percentage: 50,
        sourceUnitPriceCents: 1_000,
        consumptionClassification: 'food',
      },
      {
        role: 'ingredient',
        percentage: 50,
        sourceUnitPriceCents: 2_000,
        consumptionClassification: 'food',
      },
    ],
  });

  assert.equal(priced.lineWeightGrams, quantity * SACK_WEIGHT_GRAMS);
  assert.deepEqual(
    priced.components.map((component) => ({
      weightGrams: component.weightGrams,
      tierDiscountPct: component.tierDiscountPct,
      unitContributionCents: component.unitContributionCents,
    })),
    [
      { weightGrams: 5_000_000, tierDiscountPct: 5, unitContributionCents: 475 },
      { weightGrams: 5_000_000, tierDiscountPct: 5, unitContributionCents: 950 },
    ],
  );
  assert.equal(priced.materialUnitPriceCents, 1_425);
  assert.equal(priced.materialSubtotalCents, 570_000);
  assert.equal(priced.discountableTotalCents, 570_000);
  assert.equal(priced.blendingFeeCents, CUSTOM_BLEND_FEE_CENTS);
  assert.equal(priced.lineTotalCents, 572_500);
  assert.equal(priced.resultClassification, 'food');
});

void test('resolves exact component tier boundaries and component-specific next progress', () => {
  const oneTonne = calculateCustomBlendComponentPricing({
    quantity: 40,
    percentage: 100,
    sourceUnitPriceCents: 101,
  });
  assert.equal(oneTonne.weightGrams, 1_000_000);
  assert.equal(oneTonne.tierDiscountPct, 0);
  assert.deepEqual(oneTonne.nextTierProgress, {
    minTonnes: 5,
    discountPct: 5,
    sacksToNextTier: 160,
    weightToNextTierGrams: 4_000_000,
  });

  const tenTonnes = calculateCustomBlendComponentPricing({
    quantity: 400,
    percentage: 100,
    sourceUnitPriceCents: 101,
  });
  assert.equal(tenTonnes.tierDiscountPct, 10);
  assert.equal(tenTonnes.nextTierProgress, undefined);
  assert.equal(customBlendLineWeightGrams(40), 1_000_000);
  assert.equal(customBlendComponentWeightGrams(40, 50), 500_000);
});

void test('uses active clearance as the source before component tier and rounds once', () => {
  const priced = calculateCustomBlendComponentPricing({
    quantity: 40,
    percentage: 100,
    priceCents: 1_001,
    clearanceInput: {
      priceCents: 1_001,
      clearancePriceCents: 501,
      clearanceStartsAt: '2026-08-01T00:00:00.000Z',
      clearanceEndsAt: '2026-09-01T00:00:00.000Z',
      weightGrams: SACK_WEIGHT_GRAMS,
      now: new Date('2026-08-15T12:00:00.000Z'),
    },
  });
  assert.equal(priced.sourceUnitPriceCents, 501);
  assert.equal(priced.clearance?.priceCents, 501);
  assert.equal(priced.unitContributionCents, 501);
  assert.equal(priced.subtotalCents, 20_040);
});

void test('rejects unsafe component arithmetic and preserves fee isolation', () => {
  assert.throws(() => customBlendLineWeightGrams(Number.MAX_SAFE_INTEGER), RangeError);
  assert.throws(
    () =>
      calculateCustomBlendComponentPricing({
        quantity: 1,
        percentage: 100,
        sourceUnitPriceCents: Number.MAX_SAFE_INTEGER,
      }),
    RangeError,
  );
  assert.throws(
    () =>
      calculateCustomBlendPricing({
        quantity: 1,
        blendingFeeCents: Number.MAX_SAFE_INTEGER,
        components: [
          { percentage: 50, sourceUnitPriceCents: 1 },
          { percentage: 50, sourceUnitPriceCents: 1 },
        ],
      }),
    RangeError,
  );
});
