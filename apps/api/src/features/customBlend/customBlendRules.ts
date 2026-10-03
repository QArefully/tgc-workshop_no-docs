import { createHash } from 'node:crypto';
import { MIXING_GROUPS, type MixingGroup } from '@shop/catalog';
import {
  CUSTOM_BLEND_FEE_CENTS,
  CUSTOM_BLEND_MAX_INGREDIENT_PERCENTAGE,
  CUSTOM_BLEND_MAX_INGREDIENT_TOTAL_PERCENTAGE,
  CUSTOM_BLEND_MAX_PIGMENT_PERCENTAGE,
  CUSTOM_BLEND_MIN_BASE_PERCENTAGE,
  CUSTOM_BLEND_MAX_BASE_PERCENTAGE,
  CUSTOM_BLEND_MIN_INGREDIENT_PERCENTAGE,
  SACK_WEIGHT_GRAMS,
  TIER_LADDER,
  type ClearanceWindow,
  type ConsumptionClassification,
  type CustomBlendComponentRole,
  type CustomBlendIngredientInput,
  type PriceTier,
  type ResolvedCustomBlendNextTierProgress,
  type CustomBlendResultClassification,
} from '@shop/contracts';
import {
  resolveClearance,
  type ClearanceResolution,
  type ResolveClearanceParams,
} from '../pricing/clearanceRules.js';
import {
  nextTierProgress,
  resolveTierDiscountPctForWeight,
  roundHalfUp,
} from '../pricing/pricingRules.js';

const MIN_INGREDIENTS = 1;
const MAX_INGREDIENTS = 4;
const MIN_PERCENTAGE = CUSTOM_BLEND_MIN_INGREDIENT_PERCENTAGE;
const MAX_INGREDIENT_PERCENTAGE = CUSTOM_BLEND_MAX_INGREDIENT_PERCENTAGE;
const MAX_INGREDIENT_TOTAL = CUSTOM_BLEND_MAX_INGREDIENT_TOTAL_PERCENTAGE;

/**
 * API-owned directional compatibility policy. The map is deliberately private: web clients may
 * render the server verdict, but must not receive or duplicate this matrix.
 */
const INGREDIENT_GROUPS_BY_BASE: Readonly<Record<MixingGroup, readonly MixingGroup[]>> = {
  'food-grade': ['food-grade'],
  cleaning: ['cleaning', 'pigments'],
  'garden-treatment': ['garden-treatment'],
  'cementitious-materials': ['cementitious-materials'],
  'casting-materials': ['casting-materials', 'pigments'],
  pigments: [],
  'theatrical-effects': ['theatrical-effects', 'pigments'],
  absorbents: [],
};

const MIXING_GROUP_SET = new Set<string>(MIXING_GROUPS);

/** Public error identities emitted by Custom Blend rule evaluation. */
export type CustomBlendRuleFailureCode =
  'CUSTOM_BLEND_INCOMPATIBLE' | 'CUSTOM_BLEND_PIGMENT_CAP_EXCEEDED';

export type CustomBlendRuleFailure =
  | { readonly ok: false; readonly code: 'CUSTOM_BLEND_INCOMPATIBLE' }
  | {
      readonly ok: false;
      readonly code: 'CUSTOM_BLEND_PIGMENT_CAP_EXCEEDED';
      readonly maxPercentage: number;
      readonly actualPercentage: number;
    };

export type CustomBlendRuleResult<T> =
  { readonly ok: true; readonly value: T } | CustomBlendRuleFailure;

/** Typed domain error for callers that prefer exception control flow at an invariant boundary. */
export class CustomBlendRuleError extends Error {
  readonly code: CustomBlendRuleFailureCode;
  readonly maxPercentage?: number;
  readonly actualPercentage?: number;

  constructor(failure: Exclude<CustomBlendRuleFailure, { readonly ok: true }>) {
    super(failure.code);
    this.name = 'CustomBlendRuleError';
    this.code = failure.code;
    if (failure.code === 'CUSTOM_BLEND_PIGMENT_CAP_EXCEEDED') {
      this.maxPercentage = failure.maxPercentage;
      this.actualPercentage = failure.actualPercentage;
    }
  }
}

export interface CanonicalCustomBlendSpec {
  ingredients: CustomBlendIngredientInput[];
  basePercentage: number;
  canonicalJson: string;
  configKey: string;
}

export interface CustomBlendLinePricing {
  materialSubtotalCents: number;
  blendingFeeCents: number;
  discountableTotalCents: number;
  lineTotalCents: number;
}

function requirePositiveSafeInteger(value: unknown, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer.`);
  }
}

function requireNonNegativeSafeInteger(value: unknown, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer.`);
  }
}

function requirePercentage(value: unknown, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 100) {
    throw new RangeError(`${name} must be an integer between 1 and 100.`);
  }
}

/** Multiplies non-negative safe integers while rejecting unsafe intermediates. */
function safeProduct(left: number, right: number, name: string): number {
  requireNonNegativeSafeInteger(left, `${name} left operand`);
  requireNonNegativeSafeInteger(right, `${name} right operand`);
  if (left !== 0 && right > Math.floor(Number.MAX_SAFE_INTEGER / left)) {
    throw new RangeError(`${name} is outside the safe integer range.`);
  }
  const product = left * right;
  if (!Number.isSafeInteger(product))
    throw new RangeError(`${name} is outside the safe integer range.`);
  return product;
}

/** Adds non-negative safe integers while rejecting an unsafe total. */
function safeSum(values: readonly number[], name: string): number {
  let total = 0;
  for (const value of values) {
    requireNonNegativeSafeInteger(value, `${name} value`);
    if (value > Number.MAX_SAFE_INTEGER - total) {
      throw new RangeError(`${name} is outside the safe integer range.`);
    }
    total += value;
  }
  return total;
}

function isKnownMixingGroup(value: unknown): value is MixingGroup {
  return typeof value === 'string' && MIXING_GROUP_SET.has(value);
}

/** Returns whether a catalog mixing group is allowed to act as a Custom Blend base. */
export function isCustomBlendBaseGroup(value: unknown): value is MixingGroup {
  return isKnownMixingGroup(value) && value !== 'pigments' && value !== 'absorbents';
}

/** Returns the directional base -> ingredient compatibility verdict. */
export function isIngredientGroupAllowed(
  baseGroup: unknown,
  ingredientGroup: unknown,
): ingredientGroup is MixingGroup {
  return (
    isCustomBlendBaseGroup(baseGroup) &&
    isKnownMixingGroup(ingredientGroup) &&
    INGREDIENT_GROUPS_BY_BASE[baseGroup].includes(ingredientGroup)
  );
}

/** Compatibility alias used by resolver-facing code. */
export const isCustomBlendIngredientAllowed = isIngredientGroupAllowed;
export const isCustomBlendIngredientGroupAllowed = isIngredientGroupAllowed;

/**
 * Validates every requested ingredient against the directional matrix. A caller receives a stable
 * domain identity rather than an exception message, so route layers can localise it safely.
 */
export function validateCustomBlendCompatibility(
  baseGroup: unknown,
  ingredientGroups: readonly unknown[],
): CustomBlendRuleResult<true> {
  const candidate: unknown = ingredientGroups;
  if (!Array.isArray(candidate)) return { ok: false, code: 'CUSTOM_BLEND_INCOMPATIBLE' };
  if (ingredientGroups.some((group) => !isIngredientGroupAllowed(baseGroup, group))) {
    return { ok: false, code: 'CUSTOM_BLEND_INCOMPATIBLE' };
  }
  return { ok: true, value: true };
}

/** Exception-style compatibility assertion for invariant boundaries. */
export function assertCustomBlendCompatibility(
  baseGroup: unknown,
  ingredientGroups: readonly unknown[],
): void {
  const result = validateCustomBlendCompatibility(baseGroup, ingredientGroups);
  if (!result.ok) throw new CustomBlendRuleError(result);
}

export interface CustomBlendGroupPercentage {
  mixingGroup: string;
  percentage: number;
}

/** Sums only pigment ingredient percentages; non-pigment components do not affect the cap. */
export function combinedCustomBlendPigmentPercentage(
  components: readonly CustomBlendGroupPercentage[],
): number {
  const candidate: unknown = components;
  if (!Array.isArray(candidate)) throw new TypeError('components must be an array.');
  let total = 0;
  for (const [index, component] of components.entries()) {
    if (typeof component !== 'object' || component === null || Array.isArray(component)) {
      throw new TypeError(`components[${index}] must be an object.`);
    }
    if (!isKnownMixingGroup(component.mixingGroup)) {
      throw new RangeError(`components[${index}].mixingGroup is not supported.`);
    }
    requireNonNegativeSafeInteger(component.percentage, `components[${index}].percentage`);
    if (component.mixingGroup === 'pigments') {
      total = safeSum([total, component.percentage], 'pigment percentage total');
    }
  }
  return total;
}

/** Compatibility alias for callers that need the aggregate dosage before validation. */
export const customBlendPigmentPercentage = combinedCustomBlendPigmentPercentage;
export const getCustomBlendPigmentPercentage = combinedCustomBlendPigmentPercentage;

/** Validates the combined (rather than per-component) pigment dosage cap. */
export function validateCustomBlendPigmentCap(
  components: readonly CustomBlendGroupPercentage[],
): CustomBlendRuleResult<true> {
  const actualPercentage = combinedCustomBlendPigmentPercentage(components);
  if (actualPercentage > CUSTOM_BLEND_MAX_PIGMENT_PERCENTAGE) {
    return {
      ok: false,
      code: 'CUSTOM_BLEND_PIGMENT_CAP_EXCEEDED',
      maxPercentage: CUSTOM_BLEND_MAX_PIGMENT_PERCENTAGE,
      actualPercentage,
    };
  }
  return { ok: true, value: true };
}

/** Compatibility alias retaining the shorter policy vocabulary. */
export const validatePigmentCap = validateCustomBlendPigmentCap;
export const validateCustomBlendPigmentPercentage = validateCustomBlendPigmentCap;

/** Exception-style pigment cap assertion for invariant boundaries. */
export function assertCustomBlendPigmentCap(
  components: readonly CustomBlendGroupPercentage[],
): void {
  const result = validateCustomBlendPigmentCap(components);
  if (!result.ok) throw new CustomBlendRuleError(result);
}

/**
 * Reduces component classifications to the public two-value result. `caution` is intentionally
 * not propagated: only an all-food recipe is food, and every other recipe is non-food.
 */
export function resolveCustomBlendClassification(
  classifications: readonly ConsumptionClassification[],
): CustomBlendResultClassification;
export function resolveCustomBlendClassification(
  baseClassification: ConsumptionClassification,
  ingredientClassifications?: readonly ConsumptionClassification[],
): CustomBlendResultClassification;
export function resolveCustomBlendClassification(
  baseOrClassifications: ConsumptionClassification | readonly ConsumptionClassification[],
  ingredientClassifications: readonly ConsumptionClassification[] = [],
): CustomBlendResultClassification {
  const allClassifications =
    typeof baseOrClassifications === 'string'
      ? [baseOrClassifications, ...ingredientClassifications]
      : [...baseOrClassifications];
  return allClassifications.length > 0 && allClassifications.every((value) => value === 'food')
    ? 'food'
    : 'non-food';
}

/** Compatibility aliases for resolver and tests. */
export const reduceCustomBlendClassification = resolveCustomBlendClassification;
export const resolveCustomBlendResultClassification = resolveCustomBlendClassification;
export const classifyCustomBlend = resolveCustomBlendClassification;

/** Presentation facts optionally carried through when a priced component is assembled. */
export interface CustomBlendComponentFacts {
  role?: CustomBlendComponentRole;
  variantId?: number;
  productId?: string | number;
  productName?: string;
  productDescription?: string;
  sku?: string;
  variantLabel?: string;
  mixingGroup?: MixingGroup;
  consumptionClassification?: ConsumptionClassification;
}

/**
 * Inputs for one component's quantity-specific price. `sourceUnitPriceCents` is already the
 * list/clearance source selected by the caller unless a clearance resolution/input is supplied.
 * The aliases keep this pure function convenient for both repository rows and resolved contracts.
 */
export interface CustomBlendComponentPricingInput extends CustomBlendComponentFacts {
  percentage: number;
  /** Optional on collection inputs; aggregate pricing supplies the request quantity. */
  quantity?: number;
  priceCents?: number;
  basePriceCents?: number;
  sourceUnitPriceCents?: number;
  clearance?: ClearanceWindow | null;
  clearanceResolution?: ClearanceResolution;
  resolvedClearance?: ClearanceResolution;
  clearanceInput?: ResolveClearanceParams;
  clearanceParams?: ResolveClearanceParams;
  tiers?: readonly PriceTier[];
}

/** One component's resolved weight, source, discount, and integer-pence contribution. */
export interface CustomBlendPricedComponent extends CustomBlendComponentFacts {
  percentage: number;
  weightGrams: number;
  sourceUnitPriceCents: number;
  clearance?: ClearanceWindow;
  tierDiscountPct: number;
  nextTierProgress?: ResolvedCustomBlendNextTierProgress;
  unitContributionCents: number;
  subtotalCents: number;
}

/** Quantity-specific material totals for a complete blend. */
export interface CustomBlendComponentPricingTotals {
  quantity: number;
  lineWeightGrams: number;
  components: CustomBlendPricedComponent[];
  materialUnitPriceCents: number;
  materialSubtotalCents: number;
  discountableTotalCents: number;
  blendingFeeCents: number;
  lineTotalCents: number;
  resultClassification?: CustomBlendResultClassification;
}

export type CustomBlendComponentPrice = CustomBlendPricedComponent;
export type CustomBlendPricing = CustomBlendComponentPricingTotals;

/** Inputs for all components, or the equivalent base + ingredients split. */
export interface CustomBlendPricingInput {
  quantity: number;
  components?: readonly CustomBlendComponentPricingInput[];
  base?: CustomBlendComponentPricingInput;
  ingredients?: readonly CustomBlendComponentPricingInput[];
  blendingFeeCents?: number;
  tiers?: readonly PriceTier[];
}

/** Finished blend weight for a quantity of the canonical 25 kg purchase unit. */
export function customBlendLineWeightGrams(quantity: number): number {
  requirePositiveSafeInteger(quantity, 'quantity');
  return safeProduct(quantity, SACK_WEIGHT_GRAMS, 'line weight');
}

/** Finished weight represented by one component percentage of a configured line. */
export function customBlendComponentWeightGrams(quantity: number, percentage: number): number {
  requirePercentage(percentage, 'percentage');
  const lineWeightGrams = customBlendLineWeightGrams(quantity);
  const weightNumerator = safeProduct(lineWeightGrams, percentage, 'component weight');
  if (weightNumerator % 100 !== 0) {
    throw new RangeError('Component weight must resolve to a whole gram.');
  }
  const weightGrams = weightNumerator / 100;
  requirePositiveSafeInteger(weightGrams, 'component weight');
  return weightGrams;
}

export const calculateCustomBlendLineWeightGrams = customBlendLineWeightGrams;
export const calculateCustomBlendComponentWeightGrams = customBlendComponentWeightGrams;

function resolveComponentSource(input: CustomBlendComponentPricingInput): {
  sourceUnitPriceCents: number;
  clearance: ClearanceWindow | null;
} {
  const dynamicClearance = input.clearanceInput ?? input.clearanceParams;
  if (dynamicClearance !== undefined) {
    const resolution = resolveClearance(dynamicClearance);
    return {
      sourceUnitPriceCents: resolution.clearance?.priceCents ?? resolution.basePriceCents,
      clearance: resolution.clearance,
    };
  }

  const suppliedResolution = input.clearanceResolution ?? input.resolvedClearance;
  if (suppliedResolution !== undefined) {
    return {
      sourceUnitPriceCents:
        suppliedResolution.clearance?.priceCents ?? suppliedResolution.basePriceCents,
      clearance: suppliedResolution.clearance,
    };
  }

  // A supplied active clearance always wins over the list/source fallback. This keeps the
  // source price selected before tier math, even when repository callers provide both fields.
  if (input.clearance !== undefined && input.clearance !== null) {
    return { sourceUnitPriceCents: input.clearance.priceCents, clearance: input.clearance };
  }

  const sourceUnitPriceCents =
    input.sourceUnitPriceCents ?? input.priceCents ?? input.basePriceCents;
  if (sourceUnitPriceCents === undefined) {
    throw new RangeError('A component source unit price is required.');
  }
  return { sourceUnitPriceCents, clearance: null };
}

function copyComponentFacts(input: CustomBlendComponentPricingInput): CustomBlendComponentFacts {
  const facts: CustomBlendComponentFacts = {};
  if (input.role !== undefined) facts.role = input.role;
  if (input.variantId !== undefined) facts.variantId = input.variantId;
  if (input.productId !== undefined) facts.productId = String(input.productId);
  if (input.productName !== undefined) facts.productName = input.productName;
  if (input.productDescription !== undefined) facts.productDescription = input.productDescription;
  if (input.sku !== undefined) facts.sku = input.sku;
  if (input.variantLabel !== undefined) facts.variantLabel = input.variantLabel;
  if (input.mixingGroup !== undefined) facts.mixingGroup = input.mixingGroup;
  if (input.consumptionClassification !== undefined) {
    facts.consumptionClassification = input.consumptionClassification;
  }
  return facts;
}

/**
 * Resolves one component independently. Tier qualification uses only this component's finished
 * weight, never the aggregate blend weight; clearance is selected before applying the tier.
 */
export function calculateCustomBlendComponentPricing(
  input: CustomBlendComponentPricingInput,
): CustomBlendPricedComponent {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new TypeError('component pricing input must be an object.');
  }
  requirePositiveSafeInteger(input.quantity, 'quantity');
  requirePercentage(input.percentage, 'percentage');

  const weightGrams = customBlendComponentWeightGrams(input.quantity, input.percentage);

  const source = resolveComponentSource(input);
  requireNonNegativeSafeInteger(source.sourceUnitPriceCents, 'sourceUnitPriceCents');
  if (source.clearance !== null) {
    requireNonNegativeSafeInteger(source.clearance.priceCents, 'clearance priceCents');
    requireNonNegativeSafeInteger(source.clearance.perTonneCents, 'clearance perTonneCents');
  }

  const tiers = input.tiers ?? TIER_LADDER;
  const tierDiscountPct = resolveTierDiscountPctForWeight(weightGrams, tiers);
  const nextProgress = nextTierProgress(1, weightGrams, tiers);

  const afterDiscount = 100 - tierDiscountPct;
  const pricePercentage = safeProduct(
    source.sourceUnitPriceCents,
    input.percentage,
    'component contribution',
  );
  const contributionNumerator = safeProduct(
    pricePercentage,
    afterDiscount,
    'component contribution',
  );
  const unitContributionCents = roundHalfUp(contributionNumerator, 10_000);
  const subtotalCents = safeProduct(unitContributionCents, input.quantity, 'component subtotal');

  return {
    ...copyComponentFacts(input),
    percentage: input.percentage,
    weightGrams,
    sourceUnitPriceCents: source.sourceUnitPriceCents,
    ...(source.clearance === null ? {} : { clearance: source.clearance }),
    tierDiscountPct,
    ...(nextProgress === null ? {} : { nextTierProgress: nextProgress }),
    unitContributionCents,
    subtotalCents,
  };
}

/** Short singular alias for resolver-facing code. */
export const calculateCustomBlendComponentPrice = calculateCustomBlendComponentPricing;
export const resolveCustomBlendComponentPricing = calculateCustomBlendComponentPricing;

function completePricingComponents(
  input: CustomBlendPricingInput,
): CustomBlendComponentPricingInput[] {
  if (input.components !== undefined) {
    const candidate: unknown = input.components;
    if (!Array.isArray(candidate)) throw new TypeError('components must be an array.');
    if (input.base !== undefined || input.ingredients !== undefined) {
      throw new RangeError('Provide components or base + ingredients, not both.');
    }
    return [...input.components];
  }
  if (input.base === undefined || input.ingredients === undefined) {
    throw new TypeError('Pricing requires components or base + ingredients.');
  }
  const candidate: unknown = input.ingredients;
  if (!Array.isArray(candidate)) throw new TypeError('ingredients must be an array.');
  return [input.base, ...input.ingredients];
}

/**
 * Resolves all component prices and totals. The fee is added once after material calculations and
 * is never included in a component's weight, tier, contribution, or discountable subtotal.
 */
export function calculateCustomBlendPricing(
  input: CustomBlendPricingInput,
): CustomBlendComponentPricingTotals {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new TypeError('blend pricing input must be an object.');
  }
  requirePositiveSafeInteger(input.quantity, 'quantity');
  const components = completePricingComponents(input);
  if (components.length === 0) throw new RangeError('At least one component is required.');

  const percentages = components.map((component, index) => {
    requirePercentage(component.percentage, `components[${index}].percentage`);
    return component.percentage;
  });
  if (safeSum(percentages, 'component percentage total') !== 100) {
    throw new RangeError('component percentage total must equal 100.');
  }

  const lineWeightGrams = customBlendLineWeightGrams(input.quantity);
  const tiers = input.tiers ?? TIER_LADDER;
  const pricedComponents = components.map((component) =>
    calculateCustomBlendComponentPricing({
      ...component,
      quantity: input.quantity,
      tiers: component.tiers ?? tiers,
    }),
  );
  const materialUnitPriceCents = safeSum(
    pricedComponents.map((component) => component.unitContributionCents),
    'material unit price',
  );
  const materialSubtotalCents = safeSum(
    pricedComponents.map((component) => component.subtotalCents),
    'material subtotal',
  );
  const expectedMaterialSubtotal = safeProduct(
    materialUnitPriceCents,
    input.quantity,
    'material subtotal',
  );
  if (expectedMaterialSubtotal !== materialSubtotalCents) {
    throw new RangeError('Material subtotal does not match material unit price and quantity.');
  }

  const blendingFeeCents = input.blendingFeeCents ?? CUSTOM_BLEND_FEE_CENTS;
  requireNonNegativeSafeInteger(blendingFeeCents, 'blendingFeeCents');
  const lineTotalCents = safeSum([materialSubtotalCents, blendingFeeCents], 'line total');
  const classifications = components
    .map((component) => component.consumptionClassification)
    .filter((value): value is ConsumptionClassification => value !== undefined);

  return {
    quantity: input.quantity,
    lineWeightGrams,
    components: pricedComponents,
    materialUnitPriceCents,
    materialSubtotalCents,
    discountableTotalCents: materialSubtotalCents,
    blendingFeeCents,
    lineTotalCents,
    ...(classifications.length === components.length
      ? {
          resultClassification: resolveCustomBlendClassification(
            classifications[0]!,
            classifications.slice(1),
          ),
        }
      : {}),
  };
}

/** Plural aliases for callers that name the operation after its component collection. */
export const calculateCustomBlendComponentPrices = calculateCustomBlendPricing;
export const priceCustomBlendComponents = calculateCustomBlendPricing;
export const resolveCustomBlendPricing = calculateCustomBlendPricing;

/**
 * Validates and sorts ingredient ratios without changing caller-owned input.
 * Canonical order is ascending numeric variant ID.
 */
export function canonicalizeCustomBlendIngredients(
  ingredients: readonly CustomBlendIngredientInput[],
): CustomBlendIngredientInput[] {
  // Array-ness is checked through an `unknown` alias: narrowing `Array.isArray` against the
  // declared readonly array would collapse the element type to `any` and silently drop
  // ingredient typing for the whole canonicalization path.
  const candidate: unknown = ingredients;
  if (
    !Array.isArray(candidate) ||
    ingredients.length < MIN_INGREDIENTS ||
    ingredients.length > MAX_INGREDIENTS
  ) {
    throw new RangeError(`ingredients must contain ${MIN_INGREDIENTS}-${MAX_INGREDIENTS} entries.`);
  }

  const seenVariantIds = new Set<number>();
  const normalized = ingredients.map((ingredient, index) => {
    if (typeof ingredient !== 'object' || ingredient === null || Array.isArray(ingredient)) {
      throw new TypeError(`ingredients[${index}] must be an object.`);
    }

    const { variantId, percentage } = ingredient;
    requirePositiveSafeInteger(variantId, `ingredients[${index}].variantId`);
    if (
      typeof percentage !== 'number' ||
      !Number.isSafeInteger(percentage) ||
      percentage < MIN_PERCENTAGE ||
      percentage > MAX_INGREDIENT_PERCENTAGE
    ) {
      throw new RangeError(
        `ingredients[${index}].percentage must be an integer between ${MIN_PERCENTAGE} and ${MAX_INGREDIENT_PERCENTAGE}.`,
      );
    }
    if (seenVariantIds.has(variantId)) {
      throw new RangeError(`ingredients contains duplicate variantId ${variantId}.`);
    }
    seenVariantIds.add(variantId);
    return { variantId, percentage };
  });

  const ingredientTotal = normalized.reduce(
    (total, ingredient) => total + ingredient.percentage,
    0,
  );
  if (ingredientTotal > MAX_INGREDIENT_TOTAL) {
    throw new RangeError(`ingredient percentage total must not exceed ${MAX_INGREDIENT_TOTAL}.`);
  }

  return normalized.sort((left, right) => left.variantId - right.variantId);
}

/** Serializes normalized ingredients with stable property and array order for identity hashing. */
export function canonicalCustomBlendJson(
  canonicalIngredients: readonly CustomBlendIngredientInput[],
): string {
  const normalized = canonicalizeCustomBlendIngredients(canonicalIngredients);
  return JSON.stringify(normalized);
}

/** Computes lowercase SHA-256 identity key from canonical ingredient JSON only. */
export function hashCustomBlendCanonicalJson(canonicalJson: string): string {
  return createHash('sha256').update(canonicalJson).digest('hex');
}

/** Validates full input, rejects base-as-ingredient, and derives canonical blend facts. */
export function normalizeCustomBlendSpec(
  baseVariantId: number,
  ingredients: readonly CustomBlendIngredientInput[],
): CanonicalCustomBlendSpec {
  requirePositiveSafeInteger(baseVariantId, 'baseVariantId');
  const normalizedIngredients = canonicalizeCustomBlendIngredients(ingredients);
  if (normalizedIngredients.some((ingredient) => ingredient.variantId === baseVariantId)) {
    throw new RangeError('baseVariantId must not also be an ingredient variantId.');
  }

  const ingredientTotal = normalizedIngredients.reduce(
    (total, ingredient) => total + ingredient.percentage,
    0,
  );
  const basePercentage = 100 - ingredientTotal;
  if (
    basePercentage < CUSTOM_BLEND_MIN_BASE_PERCENTAGE ||
    basePercentage > CUSTOM_BLEND_MAX_BASE_PERCENTAGE
  ) {
    throw new RangeError(
      `base percentage must be between ${CUSTOM_BLEND_MIN_BASE_PERCENTAGE} and ${CUSTOM_BLEND_MAX_BASE_PERCENTAGE}.`,
    );
  }

  const canonicalJson = canonicalCustomBlendJson(normalizedIngredients);
  return {
    ingredients: normalizedIngredients,
    basePercentage,
    canonicalJson,
    configKey: hashCustomBlendCanonicalJson(canonicalJson),
  };
}

/**
 * Calculates configured-line totals. Fee applies once per line, never per sack,
 * and only material subtotal remains discountable.
 */
export function calculateCustomBlendLinePricing(
  resolvedUnitPriceCents: number,
  quantity: number,
  blendingFeeCents: number = CUSTOM_BLEND_FEE_CENTS,
): CustomBlendLinePricing {
  requireNonNegativeSafeInteger(resolvedUnitPriceCents, 'resolvedUnitPriceCents');
  requirePositiveSafeInteger(quantity, 'quantity');
  requireNonNegativeSafeInteger(blendingFeeCents, 'blendingFeeCents');
  if (resolvedUnitPriceCents > Number.MAX_SAFE_INTEGER / quantity) {
    throw new RangeError('Material subtotal is outside the safe integer range.');
  }

  const materialSubtotalCents = resolvedUnitPriceCents * quantity;
  if (materialSubtotalCents > Number.MAX_SAFE_INTEGER - blendingFeeCents) {
    throw new RangeError('Line total is outside the safe integer range.');
  }
  const lineTotalCents = materialSubtotalCents + blendingFeeCents;
  return {
    materialSubtotalCents,
    blendingFeeCents,
    discountableTotalCents: materialSubtotalCents,
    lineTotalCents,
  };
}
