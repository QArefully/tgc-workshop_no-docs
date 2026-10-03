import { Type, type Static } from '@sinclair/typebox';
import { TypeSystem } from '@sinclair/typebox/system';
import { MoneyCents, PositiveIntegerString } from './common.js';
import {
  CatalogVariant,
  CategoryFacts,
  ConsumptionClassification,
  MixingGroup,
} from './products.js';
import { ClearanceWindow, CUSTOM_BLEND_FEE_CENTS } from './pricing.js';

/**
 * Structural Custom Blend bounds are shared by the API and web drafts. They are deliberately
 * separate from the compatibility matrix and pigment policy, which belong to the API domain.
 */
export const CUSTOM_BLEND_MIN_INGREDIENTS = 1;
export const CUSTOM_BLEND_MAX_INGREDIENTS = 4;
export const CUSTOM_BLEND_MIN_INGREDIENT_PERCENTAGE = 5;
export const CUSTOM_BLEND_MAX_INGREDIENT_PERCENTAGE = 50;
export const CUSTOM_BLEND_MAX_INGREDIENT_TOTAL_PERCENTAGE = 50;
export const CUSTOM_BLEND_MIN_BASE_PERCENTAGE = 50;
export const CUSTOM_BLEND_MAX_BASE_PERCENTAGE = 95;
export const CUSTOM_BLEND_RULE_VERSION = 1;
export const CUSTOM_BLEND_MAX_PIGMENT_PERCENTAGE = 10;

// Short aliases retain the names used by the original configurator while making the prefixed
// constants available to new clients. Constants, rather than mutable schema metadata, are the
// source of truth for structural draft bounds.
export const MIN_INGREDIENTS = CUSTOM_BLEND_MIN_INGREDIENTS;
export const MAX_INGREDIENTS = CUSTOM_BLEND_MAX_INGREDIENTS;
export const MIN_INGREDIENT_PERCENTAGE = CUSTOM_BLEND_MIN_INGREDIENT_PERCENTAGE;
export const MAX_INGREDIENT_PERCENTAGE = CUSTOM_BLEND_MAX_INGREDIENT_PERCENTAGE;
export const MAX_INGREDIENT_TOTAL = CUSTOM_BLEND_MAX_INGREDIENT_TOTAL_PERCENTAGE;
export const MIN_BASE_PERCENTAGE = CUSTOM_BLEND_MIN_BASE_PERCENTAGE;
export const MAX_BASE_PERCENTAGE = CUSTOM_BLEND_MAX_BASE_PERCENTAGE;

// Explicitly prefixed aliases for callers that keep all shared policy constants in one import.
// Keep the historical short names above for the configurator's existing imports.
export const CUSTOM_BLEND_MAX_INGREDIENT_TOTAL = CUSTOM_BLEND_MAX_INGREDIENT_TOTAL_PERCENTAGE;
export const CUSTOM_BLEND_MIN_PERCENTAGE = CUSTOM_BLEND_MIN_INGREDIENT_PERCENTAGE;
export const CUSTOM_BLEND_MAX_PERCENTAGE = CUSTOM_BLEND_MAX_INGREDIENT_PERCENTAGE;

const SafePositiveInteger = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
const SafeNonNegativeInteger = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const SafePercentage = Type.Integer({
  minimum: CUSTOM_BLEND_MIN_INGREDIENT_PERCENTAGE,
  maximum: CUSTOM_BLEND_MAX_INGREDIENT_PERCENTAGE,
});
const SafeBasePercentage = Type.Integer({
  minimum: CUSTOM_BLEND_MIN_BASE_PERCENTAGE,
  maximum: CUSTOM_BLEND_MAX_BASE_PERCENTAGE,
});
const SafeDiscountPercentage = Type.Integer({ minimum: 0, maximum: 100 });
const ResultClassification = Type.Union([Type.Literal('food'), Type.Literal('non-food')]);
export const CustomBlendResultClassification = ResultClassification;
export type CustomBlendResultClassification = Static<typeof CustomBlendResultClassification>;

/** Safe transport form of component progress; pricing.ts keeps the historic wider shape. */
export const ResolvedCustomBlendNextTierProgress = Type.Object(
  {
    minTonnes: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
    discountPct: Type.Integer({ minimum: 0, maximum: 100 }),
    sacksToNextTier: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
    weightToNextTierGrams: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  },
  { additionalProperties: false },
);
export type ResolvedCustomBlendNextTierProgress = Static<
  typeof ResolvedCustomBlendNextTierProgress
>;
export const CustomBlendNextTierProgress = ResolvedCustomBlendNextTierProgress;
export type CustomBlendNextTierProgress = ResolvedCustomBlendNextTierProgress;

/** Lowercase SHA-256 hex encoding of a canonical ingredient specification. */
export const CustomBlendConfigKey = Type.String({ pattern: '^[a-f0-9]{64}$' });
export type CustomBlendConfigKey = Static<typeof CustomBlendConfigKey>;

/** Config key for an ordinary cart line (`''`) or a configured Custom Blend line. */
export const CartLineConfigKey = Type.Union([Type.Literal(''), CustomBlendConfigKey]);
export type CartLineConfigKey = Static<typeof CartLineConfigKey>;

export const CustomBlendIngredientInput = Type.Object(
  {
    variantId: SafePositiveInteger,
    percentage: SafePercentage,
  },
  { additionalProperties: false },
);
export type CustomBlendIngredientInput = Static<typeof CustomBlendIngredientInput>;

/** Immutable ingredient facts persisted with a configured line and checkout quote. */
export const CustomBlendIngredientSnapshot = Type.Object(
  {
    variantId: SafePositiveInteger,
    productId: PositiveIntegerString,
    productName: Type.String({ minLength: 1, maxLength: 160 }),
    productDescription: Type.String({ minLength: 1, maxLength: 2_000 }),
    mixingGroup: MixingGroup,
    percentage: SafePercentage,
  },
  { additionalProperties: false },
);
export type CustomBlendIngredientSnapshot = Static<typeof CustomBlendIngredientSnapshot>;

/**
 * Frozen, presentation-only facts for the base material. This is deliberately excluded from the
 * canonical blend specification: it must never affect the configuration hash, eligibility, or
 * money. It is optional so snapshots written before this field was introduced remain readable.
 */
export const CustomBlendBasePresentation = Type.Object(
  {
    category: Type.String(),
    consumptionClassification: ConsumptionClassification,
    categoryFacts: CategoryFacts,
  },
  { additionalProperties: false },
);
export type CustomBlendBasePresentation = Static<typeof CustomBlendBasePresentation>;

/**
 * Historical Custom Blend snapshot. Keep this shape byte-compatible: order rows and V8 checkout
 * intents written before resolved pricing was introduced must remain readable.
 */
export const LegacyCustomBlendSnapshot = Type.Object(
  {
    configKey: CustomBlendConfigKey,
    basePercentage: SafeBasePercentage,
    mixingGroup: MixingGroup,
    basePresentation: Type.Optional(CustomBlendBasePresentation),
    ingredients: Type.Array(CustomBlendIngredientSnapshot, {
      minItems: CUSTOM_BLEND_MIN_INGREDIENTS,
      maxItems: CUSTOM_BLEND_MAX_INGREDIENTS,
    }),
    blendingFeeCents: MoneyCents,
    madeToOrder: Type.Literal(true),
    returnable: Type.Literal(false),
  },
  { additionalProperties: false },
);
export type LegacyCustomBlendSnapshot = Static<typeof LegacyCustomBlendSnapshot>;

/** Component role in the resolved recipe. The base is the only inventory-demand component. */
export const CustomBlendComponentRole = Type.Union([
  Type.Literal('base'),
  Type.Literal('ingredient'),
]);
export type CustomBlendComponentRole = Static<typeof CustomBlendComponentRole>;

/**
 * Quantity-specific, server-resolved pricing facts for one blend component. Product description,
 * SKU, and label are optional compatibility presentation fields; when present they are frozen,
 * but the identity and all pricing fields are always required.
 */
const ResolvedCustomBlendComponentFields = {
  role: CustomBlendComponentRole,
  variantId: SafePositiveInteger,
  productId: PositiveIntegerString,
  productName: Type.String({ minLength: 1, maxLength: 160 }),
  productDescription: Type.Optional(Type.String({ minLength: 1, maxLength: 2_000 })),
  sku: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  variantLabel: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
  mixingGroup: MixingGroup,
  consumptionClassification: ConsumptionClassification,
  percentage: Type.Integer({ minimum: 1, maximum: CUSTOM_BLEND_MAX_BASE_PERCENTAGE }),
  weightGrams: SafePositiveInteger,
  sourceUnitPriceCents: MoneyCents,
  clearance: Type.Optional(ClearanceWindow),
  tierDiscountPct: SafeDiscountPercentage,
  nextTierProgress: Type.Optional(ResolvedCustomBlendNextTierProgress),
  unitContributionCents: MoneyCents,
  subtotalCents: MoneyCents,
} as const;

const ResolvedCustomBlendBaseComponent = Type.Object(
  {
    ...ResolvedCustomBlendComponentFields,
    role: Type.Literal('base'),
    percentage: SafeBasePercentage,
  },
  { additionalProperties: false },
);

const ResolvedCustomBlendIngredientComponent = Type.Object(
  {
    ...ResolvedCustomBlendComponentFields,
    role: Type.Literal('ingredient'),
    percentage: SafePercentage,
  },
  { additionalProperties: false },
);

/** One resolved base or ingredient component, with role-specific percentage bounds. */
export const ResolvedCustomBlendComponent = Type.Union([
  ResolvedCustomBlendBaseComponent,
  ResolvedCustomBlendIngredientComponent,
]);
export type ResolvedCustomBlendComponent = Static<typeof ResolvedCustomBlendComponent>;

export const CustomBlendComponent = ResolvedCustomBlendComponent;
export type CustomBlendComponent = ResolvedCustomBlendComponent;

/** Compatibility aliases for consumers that name this record as a component snapshot. */
export const CustomBlendResolvedComponent = ResolvedCustomBlendComponent;
export type CustomBlendResolvedComponent = ResolvedCustomBlendComponent;
export const CustomBlendComponentSnapshot = ResolvedCustomBlendComponent;
export type CustomBlendComponentSnapshot = ResolvedCustomBlendComponent;

const ResolvedCustomBlendSnapshotFields = {
  ...LegacyCustomBlendSnapshot.properties,
  // Resolved V1 outcomes always charge the configured blend fee. Keep the legacy schema above
  // broad for historical snapshots, but make the current resolved policy explicit here.
  blendingFeeCents: Type.Literal(CUSTOM_BLEND_FEE_CENTS),
  ruleVersion: Type.Literal(CUSTOM_BLEND_RULE_VERSION),
  resultClassification: ResultClassification,
  quantity: SafePositiveInteger,
  components: Type.Array(ResolvedCustomBlendComponent, {
    minItems: CUSTOM_BLEND_MIN_INGREDIENTS + 1,
    maxItems: CUSTOM_BLEND_MAX_INGREDIENTS + 1,
  }),
  materialUnitPriceCents: MoneyCents,
  materialSubtotalCents: MoneyCents,
  discountableTotalCents: MoneyCents,
  lineTotalCents: MoneyCents,
};

/**
 * Quantity-specific resolved outcome. Derived facts never participate in `configKey`; they are
 * re-resolved for current carts and frozen only in checkout/order snapshots.
 */
const ResolvedCustomBlendSnapshotFieldsSchema = Type.Object(ResolvedCustomBlendSnapshotFields, {
  additionalProperties: false,
});

type ResolvedCustomBlendSnapshotValue = {
  basePercentage?: unknown;
  mixingGroup?: unknown;
  ingredients?: unknown;
  blendingFeeCents?: unknown;
  resultClassification?: unknown;
  quantity?: unknown;
  components?: unknown;
  materialUnitPriceCents?: unknown;
  materialSubtotalCents?: unknown;
  discountableTotalCents?: unknown;
  lineTotalCents?: unknown;
};

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isSafePositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function safeProduct(left: number, right: number): number | undefined {
  if (!isSafeNonNegativeInteger(left) || !isSafeNonNegativeInteger(right)) return undefined;
  if (left > Math.floor(Number.MAX_SAFE_INTEGER / Math.max(1, right))) return undefined;
  const result = left * right;
  return Number.isSafeInteger(result) ? result : undefined;
}

function safeSum(values: readonly number[]): number | undefined {
  let total = 0;
  for (const value of values) {
    if (!isSafeNonNegativeInteger(value) || value > Number.MAX_SAFE_INTEGER - total)
      return undefined;
    total += value;
  }
  return total;
}

/** Half-up integer contribution, with BigInt keeping validation safe near MAX_SAFE_INTEGER. */
function expectedUnitContribution(
  sourceUnitPriceCents: number,
  percentage: number,
  tierDiscountPct: number,
): number | undefined {
  if (
    !isSafeNonNegativeInteger(sourceUnitPriceCents) ||
    !isSafePositiveInteger(percentage) ||
    !isSafeNonNegativeInteger(tierDiscountPct) ||
    tierDiscountPct > 100
  ) {
    return undefined;
  }
  const numerator =
    BigInt(sourceUnitPriceCents) * BigInt(percentage) * BigInt(100 - tierDiscountPct);
  const rounded = (numerator + 5_000n) / 10_000n;
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
  return Number(rounded);
}

function isValidResolvedCustomBlendSnapshot(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const snapshot = value as ResolvedCustomBlendSnapshotValue;
  if (
    !isSafePositiveInteger(snapshot.quantity) ||
    !Array.isArray(snapshot.components) ||
    snapshot.components.length < CUSTOM_BLEND_MIN_INGREDIENTS + 1 ||
    snapshot.components.length > CUSTOM_BLEND_MAX_INGREDIENTS + 1
  ) {
    return false;
  }

  const components = snapshot.components as Array<
    ResolvedCustomBlendComponent & Record<string, unknown>
  >;
  if (
    components.some(
      (component) =>
        typeof component !== 'object' || component === null || Array.isArray(component),
    )
  ) {
    return false;
  }
  const baseComponents = components.filter((component) => component.role === 'base');
  const ingredientComponents = components.filter((component) => component.role === 'ingredient');
  if (baseComponents.length !== 1 || ingredientComponents.length < CUSTOM_BLEND_MIN_INGREDIENTS) {
    return false;
  }
  const expectedClassification = components.every(
    (component) => component.consumptionClassification === 'food',
  )
    ? 'food'
    : 'non-food';
  if (snapshot.resultClassification !== expectedClassification) return false;

  const base = baseComponents[0]!;
  if (
    base.percentage !== snapshot.basePercentage ||
    base.mixingGroup !== snapshot.mixingGroup ||
    !isSafePositiveInteger(base.weightGrams)
  ) {
    return false;
  }

  // The base inventory variant is represented by the surrounding cart/order line; it cannot
  // also appear as an ingredient component.
  if (ingredientComponents.some((component) => component.variantId === base.variantId)) {
    return false;
  }

  const ingredientByVariant = new Map(
    ingredientComponents.map((component) => [component.variantId, component]),
  );
  if (
    ingredientByVariant.size !== ingredientComponents.length ||
    !Array.isArray(snapshot.ingredients)
  ) {
    return false;
  }
  if (
    snapshot.ingredients.length !== ingredientComponents.length ||
    snapshot.ingredients.some(
      (ingredient) =>
        typeof ingredient !== 'object' || ingredient === null || Array.isArray(ingredient),
    )
  ) {
    return false;
  }

  const expectedTotalWeight = safeProduct(snapshot.quantity, 25_000);
  if (expectedTotalWeight === undefined) return false;
  const componentWeights = components.map((component) => component.weightGrams);
  const summedWeight = safeSum(componentWeights);
  if (summedWeight !== expectedTotalWeight) return false;

  const allPercentages = components.map((component) => component.percentage);
  const percentageTotal = safeSum(allPercentages);
  if (percentageTotal !== 100) return false;

  const snapshotIngredientVariants = new Set<number>();
  for (const ingredient of snapshot.ingredients as Array<Record<string, unknown>>) {
    if (
      !isSafePositiveInteger(ingredient.variantId) ||
      snapshotIngredientVariants.has(ingredient.variantId)
    ) {
      return false;
    }
    snapshotIngredientVariants.add(ingredient.variantId);
    const component = ingredientByVariant.get(ingredient.variantId);
    if (
      !component ||
      ingredient.percentage !== component.percentage ||
      ingredient.productId !== component.productId ||
      ingredient.productName !== component.productName ||
      (component.productDescription !== undefined &&
        ingredient.productDescription !== component.productDescription) ||
      ingredient.mixingGroup !== component.mixingGroup
    ) {
      return false;
    }
  }
  if (
    snapshotIngredientVariants.size !== ingredientByVariant.size ||
    [...snapshotIngredientVariants].some((variantId) => !ingredientByVariant.has(variantId))
  ) {
    return false;
  }

  const subtotals: number[] = [];
  const contributions: number[] = [];
  for (const component of components) {
    if (
      !isSafePositiveInteger(component.variantId) ||
      !isSafePositiveInteger(component.percentage) ||
      !isSafePositiveInteger(component.weightGrams) ||
      !isSafeNonNegativeInteger(component.sourceUnitPriceCents) ||
      !isSafeNonNegativeInteger(component.tierDiscountPct) ||
      !isSafeNonNegativeInteger(component.unitContributionCents) ||
      !isSafeNonNegativeInteger(component.subtotalCents)
    ) {
      return false;
    }
    const expectedWeight = safeProduct(expectedTotalWeight, component.percentage);
    if (expectedWeight === undefined || expectedWeight % 100 !== 0) return false;
    if (component.weightGrams !== expectedWeight / 100) return false;
    const expectedContribution = expectedUnitContribution(
      component.sourceUnitPriceCents,
      component.percentage,
      component.tierDiscountPct,
    );
    if (
      expectedContribution === undefined ||
      component.unitContributionCents !== expectedContribution
    ) {
      return false;
    }
    const expectedSubtotal = safeProduct(component.unitContributionCents, snapshot.quantity);
    if (expectedSubtotal === undefined || component.subtotalCents !== expectedSubtotal)
      return false;
    contributions.push(component.unitContributionCents);
    subtotals.push(component.subtotalCents);
  }

  const expectedUnitPrice = safeSum(contributions);
  const expectedSubtotal = safeSum(subtotals);
  if (
    expectedUnitPrice === undefined ||
    expectedSubtotal === undefined ||
    snapshot.materialUnitPriceCents !== expectedUnitPrice ||
    snapshot.materialSubtotalCents !== expectedSubtotal ||
    snapshot.discountableTotalCents !== expectedSubtotal
  ) {
    return false;
  }
  const expectedMaterialSubtotal = safeProduct(expectedUnitPrice, snapshot.quantity);
  if (expectedMaterialSubtotal === undefined || expectedMaterialSubtotal !== expectedSubtotal) {
    return false;
  }
  if (snapshot.blendingFeeCents !== CUSTOM_BLEND_FEE_CENTS) return false;
  const expectedLineTotal = safeSum([expectedSubtotal, snapshot.blendingFeeCents]);
  return expectedLineTotal !== undefined && snapshot.lineTotalCents === expectedLineTotal;
}

const ResolvedCustomBlendSnapshotIntegrity = TypeSystem.Type<unknown>(
  'ResolvedCustomBlendSnapshotIntegrity',
  (_options, value) => isValidResolvedCustomBlendSnapshot(value),
);

/** Strict resolved snapshot with role, component pricing, result classification, and total checks. */
export const ResolvedCustomBlendSnapshot = Type.Intersect([
  ResolvedCustomBlendSnapshotFieldsSchema,
  ResolvedCustomBlendSnapshotIntegrity(),
]);
export type ResolvedCustomBlendSnapshot = Static<typeof ResolvedCustomBlendSnapshot>;
export const CustomBlendResolvedSnapshot = ResolvedCustomBlendSnapshot;
export type CustomBlendResolvedSnapshot = ResolvedCustomBlendSnapshot;

/** Historic snapshots and current resolved outcomes share one public name. */
export const CustomBlendSnapshot = Type.Union([
  LegacyCustomBlendSnapshot,
  ResolvedCustomBlendSnapshot,
]);
export type CustomBlendSnapshot = Static<typeof CustomBlendSnapshot>;

/** One active 25 kg base or compatible ingredient candidate. */
export const CustomBlendOption = Type.Object(
  {
    productId: PositiveIntegerString,
    productName: Type.String({ minLength: 1, maxLength: 160 }),
    productDescription: Type.String({ minLength: 1, maxLength: 2_000 }),
    category: Type.String(),
    consumptionClassification: ConsumptionClassification,
    categoryFacts: CategoryFacts,
    mixingGroup: MixingGroup,
    variant: CatalogVariant,
  },
  { additionalProperties: false },
);
export type CustomBlendOption = Static<typeof CustomBlendOption>;

export const CustomBlendOptionsResponse = Type.Object(
  {
    base: CustomBlendOption,
    ingredients: Type.Array(CustomBlendOption),
  },
  { additionalProperties: false },
);
export type CustomBlendOptionsResponse = Static<typeof CustomBlendOptionsResponse>;

export const CustomBlendOptionsQuery = Type.Object(
  { baseVariantId: SafePositiveInteger },
  { additionalProperties: false },
);
export type CustomBlendOptionsQuery = Static<typeof CustomBlendOptionsQuery>;

/** Search filters for server-authoritative, eligible Custom Blend bases. */
export const CustomBlendBaseListQuery = Type.Object(
  {
    q: Type.Optional(Type.String({ maxLength: 200 })),
    category: Type.Optional(Type.String({ maxLength: 100 })),
    page: Type.Optional(Type.Integer({ minimum: 1, maximum: 10_000 })),
    pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 48 })),
  },
  { additionalProperties: false },
);
export type CustomBlendBaseListQuery = Static<typeof CustomBlendBaseListQuery>;

export const CustomBlendBaseListResponse = Type.Object(
  {
    items: Type.Array(CustomBlendOption),
    total: SafeNonNegativeInteger,
    page: Type.Integer({ minimum: 1, maximum: 10_000 }),
    pageSize: Type.Integer({ minimum: 1, maximum: 48 }),
  },
  { additionalProperties: false },
);
export type CustomBlendBaseListResponse = Static<typeof CustomBlendBaseListResponse>;

// Naming aliases make the endpoint vocabulary explicit to clients without duplicating schemas.
export const CustomBlendBasesQuery = CustomBlendBaseListQuery;
export type CustomBlendBasesQuery = CustomBlendBaseListQuery;
export const CustomBlendBasesResponse = CustomBlendBaseListResponse;
export type CustomBlendBasesResponse = CustomBlendBaseListResponse;
export const CustomBlendBaseListRequest = CustomBlendBaseListQuery;
export type CustomBlendBaseListRequest = CustomBlendBaseListQuery;
export const CustomBlendBaseListResult = CustomBlendBaseListResponse;
export type CustomBlendBaseListResult = CustomBlendBaseListResponse;

/** Side-effect-free draft evaluation request. Quantity is optional so the server can apply MOQ. */
export const CustomBlendEvaluationBody = Type.Object(
  {
    baseVariantId: SafePositiveInteger,
    ingredients: Type.Array(CustomBlendIngredientInput, {
      minItems: CUSTOM_BLEND_MIN_INGREDIENTS,
      maxItems: CUSTOM_BLEND_MAX_INGREDIENTS,
    }),
    quantity: Type.Optional(SafePositiveInteger),
  },
  { additionalProperties: false },
);
export type CustomBlendEvaluationBody = Static<typeof CustomBlendEvaluationBody>;

const CustomBlendEvaluationResponseFields = Type.Object(
  {
    quantity: SafePositiveInteger,
    customBlend: ResolvedCustomBlendSnapshot,
  },
  { additionalProperties: false },
);

const CustomBlendEvaluationResponseIntegrity = TypeSystem.Type<unknown>(
  'CustomBlendEvaluationResponseIntegrity',
  (_options, value) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const response = value as {
      quantity?: unknown;
      customBlend?: { quantity?: unknown };
    };
    return response.quantity === response.customBlend?.quantity;
  },
);

export const CustomBlendEvaluationResponse = Type.Intersect([
  CustomBlendEvaluationResponseFields,
  CustomBlendEvaluationResponseIntegrity(),
]);
export type CustomBlendEvaluationResponse = Static<typeof CustomBlendEvaluationResponse>;

export const EvaluateCustomBlendBody = CustomBlendEvaluationBody;
export type EvaluateCustomBlendBody = CustomBlendEvaluationBody;
export const EvaluateCustomBlendResponse = CustomBlendEvaluationResponse;
export type EvaluateCustomBlendResponse = CustomBlendEvaluationResponse;
export const CustomBlendEvaluateBody = CustomBlendEvaluationBody;
export type CustomBlendEvaluateBody = CustomBlendEvaluationBody;
export const CustomBlendEvaluateResponse = CustomBlendEvaluationResponse;
export type CustomBlendEvaluateResponse = CustomBlendEvaluationResponse;

export const CreateCustomBlendBody = Type.Object(
  {
    baseVariantId: SafePositiveInteger,
    ingredients: Type.Array(CustomBlendIngredientInput, {
      minItems: CUSTOM_BLEND_MIN_INGREDIENTS,
      maxItems: CUSTOM_BLEND_MAX_INGREDIENTS,
    }),
    quantity: Type.Optional(SafePositiveInteger),
  },
  { additionalProperties: false },
);
export type CreateCustomBlendBody = Static<typeof CreateCustomBlendBody>;

export const ReplaceCustomBlendBody = Type.Object(
  {
    baseVariantId: SafePositiveInteger,
    configKey: CustomBlendConfigKey,
    ingredients: Type.Array(CustomBlendIngredientInput, {
      minItems: CUSTOM_BLEND_MIN_INGREDIENTS,
      maxItems: CUSTOM_BLEND_MAX_INGREDIENTS,
    }),
  },
  { additionalProperties: false },
);
export type ReplaceCustomBlendBody = Static<typeof ReplaceCustomBlendBody>;

/** The legacy options endpoint still reports an unavailable/invalid base with this identity. */
export const CustomBlendErrorCode = Type.Literal('CUSTOM_BLEND_INVALID');
export type CustomBlendErrorCode = Static<typeof CustomBlendErrorCode>;

export const CustomBlendErrorResponse = Type.Object(
  {
    code: CustomBlendErrorCode,
    error: Type.String({ minLength: 1, maxLength: 500 }),
  },
  { additionalProperties: false },
);
export type CustomBlendErrorResponse = Static<typeof CustomBlendErrorResponse>;
