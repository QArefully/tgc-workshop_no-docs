import assert from 'node:assert/strict';
import test from 'node:test';
import { PALLET_WEIGHT_GRAMS, SACK_WEIGHT_GRAMS } from '@shop/contracts/pricing';
import {
  minimumOrderQuantity,
  moqShortfallSacks,
  nextTierProgress,
  perTonneCents,
  resolveTierDiscountPctForWeight,
  resolveTierDiscountPct,
  roundHalfUp,
  resolveUnitPriceCents,
  validateMoq,
} from './pricingRules.js';

void test('resolves discount tiers at exact tonne boundaries', () => {
  const tenKilogramPackGrams = 10_000;
  const packQuantityFor = (tonnes: number) => (tonnes * PALLET_WEIGHT_GRAMS) / tenKilogramPackGrams;

  assert.equal(resolveTierDiscountPct(packQuantityFor(4.99), tenKilogramPackGrams), 0);
  assert.equal(resolveTierDiscountPct(packQuantityFor(5), tenKilogramPackGrams), 5);
  assert.equal(resolveTierDiscountPct(packQuantityFor(9.99), tenKilogramPackGrams), 5);
  assert.equal(resolveTierDiscountPct(packQuantityFor(10), tenKilogramPackGrams), 10);
});

void test('uses the highest qualifying tier for pallet and zero/one quantities', () => {
  assert.equal(resolveTierDiscountPct(0, SACK_WEIGHT_GRAMS), 0);
  assert.equal(resolveTierDiscountPct(1, SACK_WEIGHT_GRAMS), 0);
  assert.equal(resolveTierDiscountPct(1, PALLET_WEIGHT_GRAMS), 0);
  assert.equal(resolveTierDiscountPct(10, PALLET_WEIGHT_GRAMS), 10);
});

void test('resolves gram-based tiers at exact and minus-one-gram boundaries', () => {
  for (const [tonnes, discountPct, precedingDiscountPct] of [
    [1, 0, 0],
    [5, 5, 0],
    [10, 10, 5],
  ] as const) {
    const boundary = tonnes * PALLET_WEIGHT_GRAMS;
    assert.equal(resolveTierDiscountPctForWeight(boundary - 1), precedingDiscountPct);
    assert.equal(resolveTierDiscountPctForWeight(boundary), discountPct);
  }
});

void test('rounds non-negative integer ratios half-up without unsafe intermediate arithmetic', () => {
  assert.equal(roundHalfUp(1, 2), 1);
  assert.equal(roundHalfUp(2, 3), 1);
  assert.equal(roundHalfUp(Number.MAX_SAFE_INTEGER, 2), 4_503_599_627_370_496);
  assert.throws(() => roundHalfUp(-1, 2), RangeError);
  assert.throws(() => roundHalfUp(1.5, 2), RangeError);
  assert.throws(() => roundHalfUp(1, 0), RangeError);
  assert.throws(() => roundHalfUp(Number.MAX_SAFE_INTEGER + 1, 2), RangeError);
});

void test('reports the next tier at exact and minus-one tonne boundaries', () => {
  const sacksPerTonne = PALLET_WEIGHT_GRAMS / SACK_WEIGHT_GRAMS;

  assert.deepEqual(nextTierProgress(sacksPerTonne - 1, SACK_WEIGHT_GRAMS), {
    minTonnes: 1,
    discountPct: 0,
    sacksToNextTier: 1,
    weightToNextTierGrams: SACK_WEIGHT_GRAMS,
  });
  assert.deepEqual(nextTierProgress(sacksPerTonne, SACK_WEIGHT_GRAMS), {
    minTonnes: 5,
    discountPct: 5,
    sacksToNextTier: 160,
    weightToNextTierGrams: 4 * PALLET_WEIGHT_GRAMS,
  });
  assert.deepEqual(nextTierProgress(5 * sacksPerTonne - 1, SACK_WEIGHT_GRAMS), {
    minTonnes: 5,
    discountPct: 5,
    sacksToNextTier: 1,
    weightToNextTierGrams: SACK_WEIGHT_GRAMS,
  });
  assert.deepEqual(nextTierProgress(5 * sacksPerTonne, SACK_WEIGHT_GRAMS), {
    minTonnes: 10,
    discountPct: 10,
    sacksToNextTier: 200,
    weightToNextTierGrams: 5 * PALLET_WEIGHT_GRAMS,
  });
  assert.deepEqual(nextTierProgress(10 * sacksPerTonne - 1, SACK_WEIGHT_GRAMS), {
    minTonnes: 10,
    discountPct: 10,
    sacksToNextTier: 1,
    weightToNextTierGrams: SACK_WEIGHT_GRAMS,
  });
  assert.equal(nextTierProgress(10 * sacksPerTonne, SACK_WEIGHT_GRAMS), null);
});

void test('chooses the highest qualifying minimum rather than the largest discount value', () => {
  assert.equal(
    resolveTierDiscountPct(10, PALLET_WEIGHT_GRAMS, [
      { minTonnes: 1, discountPct: 20 },
      { minTonnes: 10, discountPct: 10 },
    ]),
    10,
  );
});

void test('resolves unit prices from base price with integer half-up rounding', () => {
  assert.equal(resolveUnitPriceCents(101, 200, SACK_WEIGHT_GRAMS), 96);
  assert.equal(resolveUnitPriceCents(101, 400, SACK_WEIGHT_GRAMS), 91);
  assert.equal(resolveUnitPriceCents(101, 0, SACK_WEIGHT_GRAMS), 101);
});

void test('derives pre-tier per-tonne prices with integer half-up rounding', () => {
  assert.equal(perTonneCents(1, 32_000), 31);
  assert.equal(perTonneCents(101, SACK_WEIGHT_GRAMS), 4_040);
});

void test('validates MOQ as a total weight floor', () => {
  assert.equal(validateMoq(3, SACK_WEIGHT_GRAMS), false);
  assert.equal(validateMoq(4, SACK_WEIGHT_GRAMS), true);
  assert.equal(validateMoq(0, SACK_WEIGHT_GRAMS), false);
  assert.equal(validateMoq(1, SACK_WEIGHT_GRAMS), false);
  assert.equal(validateMoq(1, PALLET_WEIGHT_GRAMS), true);
  assert.equal(validateMoq(3, SACK_WEIGHT_GRAMS, 3), true);
});

void test('reports the exact number of same-weight sacks needed to reach MOQ', () => {
  assert.equal(moqShortfallSacks(3, SACK_WEIGHT_GRAMS, 4), 1);
  assert.equal(moqShortfallSacks(4, SACK_WEIGHT_GRAMS, 4), 0);
  assert.equal(moqShortfallSacks(5, SACK_WEIGHT_GRAMS, 4), 0);
  assert.equal(moqShortfallSacks(1, PALLET_WEIGHT_GRAMS, 4), 0);
  assert.equal(moqShortfallSacks(3, 20_000, 4), 2);
});

void test('derives the smallest whole-pack quantity that clears the MOQ floor', () => {
  assert.equal(minimumOrderQuantity(SACK_WEIGHT_GRAMS, 1), 1);
  assert.equal(minimumOrderQuantity(SACK_WEIGHT_GRAMS, 4), 4);
  assert.equal(minimumOrderQuantity(PALLET_WEIGHT_GRAMS, 4), 1);
  // Non-round pack weight must round up, never leave the line below the floor.
  assert.equal(minimumOrderQuantity(30_000, 4), 4);
  assert.equal(minimumOrderQuantity(20_000, 4), 5);
  assert.equal(minimumOrderQuantity(7_000, 4), 15);
  for (const [weightGrams, moqSacks] of [
    [SACK_WEIGHT_GRAMS, 1],
    [SACK_WEIGHT_GRAMS, 4],
    [30_000, 4],
    [7_000, 4],
  ] as const) {
    const quantity = minimumOrderQuantity(weightGrams, moqSacks)!;
    assert.equal(validateMoq(quantity, weightGrams, moqSacks), true);
    assert.equal(validateMoq(quantity - 1, weightGrams, moqSacks), false);
  }
});

void test('reports an unusable MOQ basis as undefined instead of throwing', () => {
  assert.equal(minimumOrderQuantity(0, 4), undefined);
  assert.equal(minimumOrderQuantity(-1, 4), undefined);
  assert.equal(minimumOrderQuantity(1.5, 4), undefined);
  assert.equal(minimumOrderQuantity(SACK_WEIGHT_GRAMS, 0), undefined);
  assert.equal(minimumOrderQuantity(SACK_WEIGHT_GRAMS, Number.MAX_SAFE_INTEGER), undefined);
});

void test('rejects invalid numeric inputs', () => {
  assert.throws(() => resolveTierDiscountPct(-1, SACK_WEIGHT_GRAMS), RangeError);
  assert.throws(() => resolveUnitPriceCents(-1, 1, SACK_WEIGHT_GRAMS), RangeError);
  assert.throws(() => perTonneCents(1, 0), RangeError);
  assert.throws(() => validateMoq(1, SACK_WEIGHT_GRAMS, 0), RangeError);
  assert.throws(() => nextTierProgress(-1, SACK_WEIGHT_GRAMS), RangeError);
  assert.throws(() => moqShortfallSacks(1, SACK_WEIGHT_GRAMS, 0), RangeError);
});
