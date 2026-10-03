import {
  MOQ_DEFAULT_SACKS,
  PALLET_WEIGHT_GRAMS,
  SACK_WEIGHT_GRAMS,
  TIER_LADDER,
  type PriceTier,
} from '@shop/contracts/pricing';

function requireNonNegativeSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer.`);
  }
}

function requirePositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer.`);
  }
}

function totalWeightGramsFor(quantity: number, weightGrams: number): number {
  requireNonNegativeSafeInteger(quantity, 'quantity');
  requirePositiveSafeInteger(weightGrams, 'weightGrams');
  const totalWeightGrams = quantity * weightGrams;
  if (!Number.isSafeInteger(totalWeightGrams)) {
    throw new RangeError('Total weight is outside the safe integer range.');
  }
  return totalWeightGrams;
}

function tierMinimumWeightGrams(tier: PriceTier): number {
  requirePositiveSafeInteger(tier.minTonnes, 'tier minTonnes');
  requireNonNegativeSafeInteger(tier.discountPct, 'tier discountPct');
  if (tier.discountPct > 100) {
    throw new RangeError('tier discountPct must not exceed 100.');
  }
  const minimumWeightGrams = tier.minTonnes * PALLET_WEIGHT_GRAMS;
  if (!Number.isSafeInteger(minimumWeightGrams)) {
    throw new RangeError('Tier minimum weight is outside the safe integer range.');
  }
  return minimumWeightGrams;
}

/**
 * Rounds a non-negative integer ratio to the nearest integer, breaking exact
 * halves upwards. Both inputs and the result stay within JavaScript's safe
 * integer range.
 */
export function roundHalfUp(numerator: number, denominator: number): number {
  requireNonNegativeSafeInteger(numerator, 'rounding numerator');
  requirePositiveSafeInteger(denominator, 'rounding denominator');

  // Compare the remainder to ceil(denominator / 2) instead of adding a
  // half-denominator to the numerator. That keeps the intermediate arithmetic
  // safe even when both inputs are close to MAX_SAFE_INTEGER.
  const quotient = Math.floor(numerator / denominator);
  const remainder = numerator % denominator;
  const roundsUp = remainder >= Math.ceil(denominator / 2);
  const rounded = quotient + (roundsUp ? 1 : 0);
  if (!Number.isSafeInteger(rounded)) {
    throw new RangeError('Calculated price is outside the safe integer range.');
  }
  return rounded;
}

/** Resolves the highest qualifying discount for a total line weight in grams. */
export function resolveTierDiscountPctForWeight(
  totalWeightGrams: number,
  tiers: readonly PriceTier[] = TIER_LADDER,
): number {
  requireNonNegativeSafeInteger(totalWeightGrams, 'totalWeightGrams');

  let highestQualifyingMinTonnes = 0;
  let discountPct = 0;
  for (const tier of tiers) {
    const minimumWeightGrams = tierMinimumWeightGrams(tier);
    if (totalWeightGrams >= minimumWeightGrams && tier.minTonnes > highestQualifyingMinTonnes) {
      highestQualifyingMinTonnes = tier.minTonnes;
      discountPct = tier.discountPct;
    }
  }
  return discountPct;
}

/** Resolves the highest qualifying discount from the uniform tonne-based ladder. */
export function resolveTierDiscountPct(
  quantity: number,
  weightGrams: number,
  tiers: readonly PriceTier[] = TIER_LADDER,
): number {
  const totalWeightGrams = totalWeightGramsFor(quantity, weightGrams);
  return resolveTierDiscountPctForWeight(totalWeightGrams, tiers);
}

/** Progress from the current line weight to the next unqualified price tier. */
export interface NextTierProgress {
  minTonnes: number;
  discountPct: number;
  sacksToNextTier: number;
  weightToNextTierGrams: number;
}

/**
 * Returns the nearest tier that has not yet qualified, or null when no next tier remains.
 */
export function nextTierProgress(
  quantity: number,
  weightGrams: number,
  tiers: readonly PriceTier[] = TIER_LADDER,
): NextTierProgress | null {
  const currentWeightGrams = totalWeightGramsFor(quantity, weightGrams);
  let nextTier: PriceTier | null = null;
  let nextTierWeightGrams: number | null = null;

  for (const tier of tiers) {
    const minimumWeightGrams = tierMinimumWeightGrams(tier);
    if (
      minimumWeightGrams > currentWeightGrams &&
      (nextTierWeightGrams === null || minimumWeightGrams < nextTierWeightGrams)
    ) {
      nextTier = tier;
      nextTierWeightGrams = minimumWeightGrams;
    }
  }

  if (nextTier === null || nextTierWeightGrams === null) return null;

  const weightToNextTierGrams = nextTierWeightGrams - currentWeightGrams;
  return {
    minTonnes: nextTier.minTonnes,
    discountPct: nextTier.discountPct,
    sacksToNextTier: Math.ceil(weightToNextTierGrams / SACK_WEIGHT_GRAMS),
    weightToNextTierGrams,
  };
}

/** Resolves the per-unit price from the base price; tiers never compound. */
export function resolveUnitPriceCents(
  baseUnitPriceCents: number,
  quantity: number,
  weightGrams: number,
): number {
  requireNonNegativeSafeInteger(baseUnitPriceCents, 'baseUnitPriceCents');
  const discountPct = resolveTierDiscountPct(quantity, weightGrams);
  const multiplier = 100 - discountPct;
  if (baseUnitPriceCents > Number.MAX_SAFE_INTEGER / multiplier) {
    throw new RangeError('Calculated price is outside the safe integer range.');
  }
  return roundHalfUp(baseUnitPriceCents * multiplier, 100);
}

/** Derives an informational base-price-per-tonne figure using half-up minor-unit rounding. */
export function perTonneCents(baseUnitPriceCents: number, weightGrams: number): number {
  requireNonNegativeSafeInteger(baseUnitPriceCents, 'baseUnitPriceCents');
  requirePositiveSafeInteger(weightGrams, 'weightGrams');
  if (baseUnitPriceCents > Number.MAX_SAFE_INTEGER / PALLET_WEIGHT_GRAMS) {
    throw new RangeError('Calculated price is outside the safe integer range.');
  }
  return roundHalfUp(baseUnitPriceCents * PALLET_WEIGHT_GRAMS, weightGrams);
}

/** Checks a per-variant sack MOQ as a total line-weight floor. */
export function validateMoq(
  quantity: number,
  weightGrams: number,
  moqSacks: number = MOQ_DEFAULT_SACKS,
): boolean {
  requirePositiveSafeInteger(moqSacks, 'moqSacks');

  const totalWeightGrams = totalWeightGramsFor(quantity, weightGrams);
  const minimumWeightGrams = moqSacks * SACK_WEIGHT_GRAMS;
  if (!Number.isSafeInteger(minimumWeightGrams)) {
    throw new RangeError('MOQ weight is outside the safe integer range.');
  }
  return totalWeightGrams >= minimumWeightGrams;
}

/**
 * Smallest whole-pack quantity whose total weight clears the per-variant sack MOQ.
 *
 * Returns `undefined` rather than throwing because callers use it to default an omitted
 * quantity: an unusable variant must degrade to a domain error, not a request-level crash.
 */
export function minimumOrderQuantity(weightGrams: number, moqSacks: number): number | undefined {
  if (
    !Number.isSafeInteger(weightGrams) ||
    weightGrams < 1 ||
    !Number.isSafeInteger(moqSacks) ||
    moqSacks < 1 ||
    moqSacks > Math.floor(Number.MAX_SAFE_INTEGER / SACK_WEIGHT_GRAMS)
  ) {
    return undefined;
  }
  const quantity = Math.ceil((moqSacks * SACK_WEIGHT_GRAMS) / weightGrams);
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    return undefined;
  }
  return quantity;
}

/** Returns the number of additional same-weight packs needed to satisfy the line MOQ. */
export function moqShortfallSacks(quantity: number, weightGrams: number, moqSacks: number): number {
  requirePositiveSafeInteger(moqSacks, 'moqSacks');
  const totalWeightGrams = totalWeightGramsFor(quantity, weightGrams);
  const minimumWeightGrams = moqSacks * SACK_WEIGHT_GRAMS;
  if (!Number.isSafeInteger(minimumWeightGrams)) {
    throw new RangeError('MOQ weight is outside the safe integer range.');
  }
  return Math.max(0, Math.ceil((minimumWeightGrams - totalWeightGrams) / weightGrams));
}
