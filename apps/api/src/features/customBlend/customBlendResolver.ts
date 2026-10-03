import { MIXING_GROUPS, type MixingGroup } from '@shop/catalog';
import type { Country } from '@shop/contracts/country';
import {
  CategoryFacts,
  CUSTOM_BLEND_FEE_CENTS,
  CUSTOM_BLEND_RULE_VERSION,
  TIER_LADDER,
  type CatalogVariant,
  type ConsumptionClassification,
  type CustomBlendBaseListQuery,
  type CustomBlendBaseListResponse,
  type CustomBlendBasePresentation,
  type CustomBlendIngredientInput,
  type CustomBlendIngredientSnapshot,
  type CustomBlendOption,
  type CustomBlendSnapshot,
  type LegacyCustomBlendSnapshot,
  type ResolvedCustomBlendComponent,
  type ResolvedCustomBlendSnapshot,
} from '@shop/contracts';
import { countryProfile } from '@shop/contracts/country-profiles';
import { Value } from '@sinclair/typebox/value';
import {
  calculateCustomBlendPricing,
  isCustomBlendBaseGroup,
  isIngredientGroupAllowed,
  normalizeCustomBlendSpec,
  validateCustomBlendCompatibility,
  validateCustomBlendPigmentCap,
} from './customBlendRules.js';
import type {
  CustomBlendCandidateQuery,
  CustomBlendFactRow,
  CustomBlendRepository,
} from './customBlendRepository.js';
import { resolveClearance } from '../pricing/clearanceRules.js';
import { minimumOrderQuantity, perTonneCents } from '../pricing/pricingRules.js';

const KNOWN_MIXING_GROUPS = new Set<string>(MIXING_GROUPS);

/** Internal resolution failure identities. Routes map these to public error identities. */
export type CustomBlendResolverErrorCode =
  | 'CUSTOM_BLEND_UNAVAILABLE'
  | 'CUSTOM_BLEND_INCOMPATIBLE'
  | 'CUSTOM_BLEND_PIGMENT_CAP_EXCEEDED'
  | 'CUSTOM_BLEND_CORRUPT_SNAPSHOT';

export type CustomBlendResolutionErrorCode = CustomBlendResolverErrorCode;

export type CustomBlendResolverErrorKind =
  'unavailable' | 'incompatible' | 'cap' | 'corrupt-snapshot';

export interface CustomBlendResolverErrorMetadata {
  maxPercentage?: number;
  actualPercentage?: number;
}

/**
 * Typed resolver failure. The public code is retained separately because unavailable and corrupt
 * snapshots intentionally share the legacy `CUSTOM_BLEND_INVALID` HTTP response for now.
 */
export class CustomBlendResolverError extends Error {
  readonly kind: CustomBlendResolverErrorKind;
  readonly failureKind: CustomBlendResolverErrorKind;
  readonly reason: CustomBlendResolverErrorKind;
  readonly publicCode:
    'CUSTOM_BLEND_INVALID' | 'CUSTOM_BLEND_INCOMPATIBLE' | 'CUSTOM_BLEND_PIGMENT_CAP_EXCEEDED';
  readonly maxPercentage?: number;
  readonly actualPercentage?: number;

  constructor(
    readonly code: CustomBlendResolverErrorCode,
    message?: string,
    metadata: CustomBlendResolverErrorMetadata = {},
  ) {
    super(message ?? code);
    this.name = 'CustomBlendResolverError';
    this.kind = resolverErrorKind(code);
    this.failureKind = this.kind;
    this.reason = this.kind;
    this.publicCode =
      code === 'CUSTOM_BLEND_INCOMPATIBLE'
        ? 'CUSTOM_BLEND_INCOMPATIBLE'
        : code === 'CUSTOM_BLEND_PIGMENT_CAP_EXCEEDED'
          ? 'CUSTOM_BLEND_PIGMENT_CAP_EXCEEDED'
          : 'CUSTOM_BLEND_INVALID';
    if (metadata.maxPercentage !== undefined) this.maxPercentage = metadata.maxPercentage;
    if (metadata.actualPercentage !== undefined) this.actualPercentage = metadata.actualPercentage;
  }
}

/** Compatibility alias for callers that name the boundary error after its resolution phase. */
export const CustomBlendResolutionError = CustomBlendResolverError;

export interface CustomBlendResolverClock {
  now(): Date;
}

/** Country catalogue policy used by all Custom Blend read/evaluation paths. */
export interface CustomBlendCountryAvailability {
  isCategoryBlocked(country: Country, category: string): boolean;
  isProductBlocked(country: Country, slug: string): boolean;
}

/** Fallback keeps direct resolver callers country-aware without requiring app composition. */
const defaultCountryAvailability: CustomBlendCountryAvailability = {
  isCategoryBlocked(country, category) {
    return countryProfile(country).blockedCategories.includes(category);
  },
  isProductBlocked(country, slug) {
    return countryProfile(country).blockedProductSlugs.includes(slug);
  },
};

export interface CustomBlendResolver {
  listBases(query?: CustomBlendBaseListQuery, country?: Country): CustomBlendBaseListResponse;
  listOptions(
    baseVariantId: number,
    country?: Country,
  ): { base: CustomBlendOption; ingredients: CustomBlendOption[] };
  evaluate(
    baseVariantId: number,
    ingredients: readonly CustomBlendIngredientInput[],
    quantity?: number,
    country?: Country,
  ): ResolvedCustomBlendSnapshot;
  rehydrate(
    baseVariantId: number,
    persistedSpec: unknown,
    quantity: number,
    country?: Country,
  ): ResolvedCustomBlendSnapshot;
  toPersistedSpec(
    resolved: ResolvedCustomBlendSnapshot | CustomBlendSnapshot,
  ): LegacyCustomBlendSnapshot;
}

interface NormalizedBaseListQuery {
  q?: string;
  category?: string;
  page: number;
  pageSize: number;
}

interface NormalizedPersistedSpec {
  configKey: string;
  ingredients: CustomBlendIngredientInput[];
}

function resolverErrorKind(code: CustomBlendResolverErrorCode): CustomBlendResolverErrorKind {
  switch (code) {
    case 'CUSTOM_BLEND_UNAVAILABLE':
      return 'unavailable';
    case 'CUSTOM_BLEND_INCOMPATIBLE':
      return 'incompatible';
    case 'CUSTOM_BLEND_PIGMENT_CAP_EXCEEDED':
      return 'cap';
    case 'CUSTOM_BLEND_CORRUPT_SNAPSHOT':
      return 'corrupt-snapshot';
  }
}

function fail(
  code: CustomBlendResolverErrorCode,
  message: string,
  metadata?: CustomBlendResolverErrorMetadata,
): never {
  throw new CustomBlendResolverError(code, message, metadata);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isConsumptionClassification(value: unknown): value is ConsumptionClassification {
  return value === 'food' || value === 'non-food' || value === 'caution';
}

function factClassification(row: CustomBlendFactRow): ConsumptionClassification {
  // Every caller has passed through isUsableFact; this cast keeps the closed fact type local to
  // the repository boundary rather than widening the transport contract with arbitrary strings.
  return row.consumption_classification as ConsumptionClassification;
}

function factMixingGroup(row: CustomBlendFactRow): MixingGroup {
  return row.mixing_group as MixingGroup;
}

function normalizeBaseListQuery(query?: CustomBlendBaseListQuery): NormalizedBaseListQuery {
  if (
    query !== undefined &&
    (typeof query !== 'object' || query === null || Array.isArray(query))
  ) {
    throw new TypeError('Custom Blend base query must be an object.');
  }
  const raw = query ?? {};
  const q = typeof raw.q === 'string' ? raw.q.trim() : undefined;
  const category = typeof raw.category === 'string' ? raw.category.trim() : undefined;
  if (raw.q !== undefined && q === undefined) {
    throw new TypeError('Custom Blend base query q must be a string.');
  }
  if (raw.category !== undefined && category === undefined) {
    throw new TypeError('Custom Blend base query category must be a string.');
  }
  if (q !== undefined && q.length > 200) {
    throw new RangeError('Custom Blend base query q is too long.');
  }
  if (category !== undefined && category.length > 100) {
    throw new RangeError('Custom Blend base query category is too long.');
  }
  const page = raw.page ?? 1;
  const pageSize = raw.pageSize ?? 12;
  if (!Number.isSafeInteger(page) || page < 1 || page > 10_000) {
    throw new RangeError('Custom Blend base query page is invalid.');
  }
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 48) {
    throw new RangeError('Custom Blend base query pageSize is invalid.');
  }
  return {
    ...(q ? { q } : {}),
    ...(category ? { category } : {}),
    page,
    pageSize,
  };
}

function repositoryQuery(query: NormalizedBaseListQuery): CustomBlendCandidateQuery {
  return {
    ...(query.q ? { q: query.q } : {}),
    ...(query.category ? { category: query.category } : {}),
  };
}

/**
 * Runtime fact gate kept at the resolver boundary as a defence against non-SQL repositories and
 * malformed rows. Stock is intentionally absent: a sold-out ingredient remains a valid recipe
 * fact because made-to-order inventory demand is base-only.
 */
function isUsableFact(row: CustomBlendFactRow): boolean {
  return (
    typeof row === 'object' &&
    row !== null &&
    isPositiveSafeInteger(row.product_id) &&
    typeof row.product_name === 'string' &&
    row.product_name.length > 0 &&
    row.product_name.length <= 160 &&
    typeof row.product_description === 'string' &&
    row.product_description.length > 0 &&
    row.product_description.length <= 2_000 &&
    typeof row.category === 'string' &&
    typeof row.product_slug === 'string' &&
    row.product_slug.length > 0 &&
    row.product_slug.length <= 200 &&
    isConsumptionClassification(row.consumption_classification) &&
    (row.details_json === null || typeof row.details_json === 'string') &&
    typeof row.mixing_group === 'string' &&
    KNOWN_MIXING_GROUPS.has(row.mixing_group) &&
    isPositiveSafeInteger(row.variant_id) &&
    typeof row.sku === 'string' &&
    row.sku.length > 0 &&
    row.sku.length <= 64 &&
    typeof row.label === 'string' &&
    row.label.length > 0 &&
    row.label.length <= 160 &&
    row.weight_grams === 25_000 &&
    isNonNegativeSafeInteger(row.price_cents) &&
    isPositiveSafeInteger(row.moq_sacks) &&
    (row.compare_at_price_cents === null || isNonNegativeSafeInteger(row.compare_at_price_cents)) &&
    isNonNegativeSafeInteger(row.stock_count) &&
    (row.backorderable === 0 || row.backorderable === 1) &&
    (row.backorder_lead_days === null || isNonNegativeSafeInteger(row.backorder_lead_days)) &&
    (row.delivery_class === 'parcel' || row.delivery_class === 'freight') &&
    row.variant_active === 1 &&
    row.sort_order === 1
  );
}

function parseCategoryFacts(
  detailsJson: string | null,
  consumptionClassification: ConsumptionClassification,
): CategoryFacts {
  if (detailsJson) {
    try {
      const parsed: unknown = JSON.parse(detailsJson);
      if (Value.Check(CategoryFacts, parsed)) return parsed;
    } catch {
      // A malformed optional presentation field receives the canonical safe fallback.
    }
  }
  return {
    texture: 'Not specified',
    colour: 'Not specified',
    source: 'Not specified',
    intendedUse: 'Not specified',
    storage: 'Not specified',
    consumptionClassification,
  };
}

function factClearanceInput(row: CustomBlendFactRow, now: Date) {
  return {
    priceCents: row.price_cents,
    clearancePriceCents: row.clearance_price_cents,
    clearanceStartsAt: row.clearance_starts_at,
    clearanceEndsAt: row.clearance_ends_at,
    weightGrams: row.weight_grams,
    now,
  };
}

function toOption(row: CustomBlendFactRow, now: Date): CustomBlendOption {
  const clearance = resolveClearance(factClearanceInput(row, now)).clearance;
  const variant: CatalogVariant = {
    variantId: row.variant_id,
    productId: row.product_id,
    sku: row.sku,
    label: row.label,
    weightGrams: row.weight_grams,
    priceCents: row.price_cents,
    moqSacks: row.moq_sacks,
    // The list figure is intentionally based on the canonical price; active clearance is a
    // separate fact and is selected again by component pricing at evaluation time.
    perTonneCents: perTonneCents(row.price_cents, row.weight_grams),
    priceTiers: TIER_LADDER,
    ...(row.compare_at_price_cents === null
      ? {}
      : { compareAtPriceCents: row.compare_at_price_cents }),
    ...(clearance ? { clearance } : {}),
    stockCount: row.stock_count,
    backorderable: row.backorderable === 1,
    backorderLeadDays: row.backorderable === 1 ? (row.backorder_lead_days ?? null) : null,
    deliveryClass: row.delivery_class as CatalogVariant['deliveryClass'],
    active: row.variant_active === 1,
    sortOrder: row.sort_order,
  };
  return {
    productId: String(row.product_id),
    productName: row.product_name,
    productDescription: row.product_description,
    category: row.category,
    consumptionClassification: factClassification(row),
    categoryFacts: parseCategoryFacts(row.details_json, factClassification(row)),
    mixingGroup: row.mixing_group,
    variant,
  };
}

function sortFacts(left: CustomBlendFactRow, right: CustomBlendFactRow): number {
  return (
    left.mixing_group.localeCompare(right.mixing_group) ||
    left.product_name.localeCompare(right.product_name) ||
    left.variant_id - right.variant_id
  );
}

function basePresentation(row: CustomBlendFactRow): CustomBlendBasePresentation {
  return {
    category: row.category,
    consumptionClassification: factClassification(row),
    categoryFacts: parseCategoryFacts(row.details_json, factClassification(row)),
  };
}

function ingredientSnapshot(
  fact: CustomBlendFactRow,
  percentage: number,
): CustomBlendIngredientSnapshot {
  return {
    variantId: fact.variant_id,
    productId: String(fact.product_id),
    productName: fact.product_name,
    productDescription: fact.product_description,
    mixingGroup: factMixingGroup(fact),
    percentage,
  };
}

function pricingComponentInput(
  fact: CustomBlendFactRow,
  role: 'base' | 'ingredient',
  percentage: number,
  now: Date,
) {
  return {
    role,
    variantId: fact.variant_id,
    productId: String(fact.product_id),
    productName: fact.product_name,
    productDescription: fact.product_description,
    sku: fact.sku,
    variantLabel: fact.label,
    mixingGroup: factMixingGroup(fact),
    consumptionClassification: factClassification(fact),
    percentage,
    priceCents: fact.price_cents,
    clearanceInput: factClearanceInput(fact, now),
  } as const;
}

function pricedComponent(
  fact: CustomBlendFactRow,
  role: 'base' | 'ingredient',
  priced: ReturnType<typeof calculateCustomBlendPricing>['components'][number],
): ResolvedCustomBlendComponent {
  return {
    role,
    variantId: fact.variant_id,
    productId: String(fact.product_id),
    productName: fact.product_name,
    productDescription: fact.product_description,
    sku: fact.sku,
    variantLabel: fact.label,
    mixingGroup: factMixingGroup(fact),
    consumptionClassification: factClassification(fact),
    percentage: priced.percentage,
    weightGrams: priced.weightGrams,
    sourceUnitPriceCents: priced.sourceUnitPriceCents,
    ...(priced.clearance ? { clearance: priced.clearance } : {}),
    tierDiscountPct: priced.tierDiscountPct,
    ...(priced.nextTierProgress ? { nextTierProgress: priced.nextTierProgress } : {}),
    unitContributionCents: priced.unitContributionCents,
    subtotalCents: priced.subtotalCents,
  };
}

function throwRuleFailure(
  result:
    | { readonly ok: false; readonly code: 'CUSTOM_BLEND_INCOMPATIBLE' }
    | {
        readonly ok: false;
        readonly code: 'CUSTOM_BLEND_PIGMENT_CAP_EXCEEDED';
        readonly maxPercentage: number;
        readonly actualPercentage: number;
      },
): never {
  if (result.code === 'CUSTOM_BLEND_PIGMENT_CAP_EXCEEDED') {
    return fail(result.code, result.code, {
      maxPercentage: result.maxPercentage,
      actualPercentage: result.actualPercentage,
    });
  }
  return fail(result.code, result.code);
}

function normalizeEvaluationIngredients(
  baseVariantId: number,
  ingredients: readonly CustomBlendIngredientInput[],
) {
  try {
    return normalizeCustomBlendSpec(baseVariantId, ingredients);
  } catch {
    return fail(
      'CUSTOM_BLEND_INCOMPATIBLE',
      'Custom Blend ingredient specification is incompatible.',
    );
  }
}

function resolveQuantity(
  base: CustomBlendFactRow,
  quantity: number | undefined,
  failureCode: 'CUSTOM_BLEND_INCOMPATIBLE' | 'CUSTOM_BLEND_CORRUPT_SNAPSHOT',
): number {
  if (quantity !== undefined) {
    if (!isPositiveSafeInteger(quantity)) {
      return fail(failureCode, 'Custom Blend quantity is invalid.');
    }
    return quantity;
  }
  const minimum = minimumOrderQuantity(base.weight_grams, base.moq_sacks);
  if (minimum === undefined) {
    return fail('CUSTOM_BLEND_UNAVAILABLE', 'Custom Blend base MOQ is unavailable.');
  }
  return minimum;
}

function readPersistedSpec(value: unknown): NormalizedPersistedSpec {
  let candidate: unknown = value;
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return fail('CUSTOM_BLEND_CORRUPT_SNAPSHOT', 'Custom Blend snapshot JSON is corrupt.');
    }
  }
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    return fail('CUSTOM_BLEND_CORRUPT_SNAPSHOT', 'Custom Blend snapshot is corrupt.');
  }
  const record = candidate as Record<string, unknown>;
  if (typeof record.configKey !== 'string' || !Array.isArray(record.ingredients)) {
    return fail('CUSTOM_BLEND_CORRUPT_SNAPSHOT', 'Custom Blend snapshot specification is corrupt.');
  }
  const ingredients: CustomBlendIngredientInput[] = [];
  for (const ingredient of record.ingredients) {
    if (typeof ingredient !== 'object' || ingredient === null || Array.isArray(ingredient)) {
      return fail('CUSTOM_BLEND_CORRUPT_SNAPSHOT', 'Custom Blend ingredient snapshot is corrupt.');
    }
    const item = ingredient as Record<string, unknown>;
    if (!isPositiveSafeInteger(item.variantId) || !Number.isSafeInteger(item.percentage)) {
      return fail(
        'CUSTOM_BLEND_CORRUPT_SNAPSHOT',
        'Custom Blend ingredient specification is corrupt.',
      );
    }
    const variantId = item.variantId;
    const percentage = item.percentage;
    if (!isPositiveSafeInteger(variantId) || !Number.isSafeInteger(percentage)) {
      return fail(
        'CUSTOM_BLEND_CORRUPT_SNAPSHOT',
        'Custom Blend ingredient specification is corrupt.',
      );
    }
    ingredients.push({ variantId, percentage: percentage as number });
  }
  return { configKey: record.configKey, ingredients };
}

function projectPersistedSpec(
  resolved: ResolvedCustomBlendSnapshot | CustomBlendSnapshot,
): LegacyCustomBlendSnapshot {
  return {
    configKey: resolved.configKey,
    basePercentage: resolved.basePercentage,
    mixingGroup: resolved.mixingGroup,
    ...(resolved.basePresentation ? { basePresentation: resolved.basePresentation } : {}),
    ingredients: resolved.ingredients.map((ingredient) => ({
      variantId: ingredient.variantId,
      productId: ingredient.productId,
      productName: ingredient.productName,
      productDescription: ingredient.productDescription,
      mixingGroup: ingredient.mixingGroup,
      percentage: ingredient.percentage,
    })),
    blendingFeeCents: CUSTOM_BLEND_FEE_CENTS,
    madeToOrder: true,
    returnable: false,
  };
}

/** Strips quantity-specific outcome fields before a configured line is written to cart storage. */
export function toPersistedSpec(
  resolved: ResolvedCustomBlendSnapshot | CustomBlendSnapshot,
): LegacyCustomBlendSnapshot {
  return projectPersistedSpec(resolved);
}

/** Compatibility aliases for consumers that name the projection after its source snapshot. */
export const customBlendToPersistedSpec = toPersistedSpec;
export const projectCustomBlendSpec = toPersistedSpec;

/** Creates the single live-fact, policy, classification, and pricing authority. */
export function createCustomBlendResolver(
  repository: CustomBlendRepository,
  clock: CustomBlendResolverClock,
  countryAvailability: CustomBlendCountryAvailability = defaultCountryAvailability,
): CustomBlendResolver {
  const isAvailableInCountry = (fact: CustomBlendFactRow, country?: Country): boolean =>
    country === undefined ||
    (!countryAvailability.isCategoryBlocked(country, fact.category) &&
      !countryAvailability.isProductBlocked(country, fact.product_slug));

  const candidateFacts = (
    query?: CustomBlendCandidateQuery,
    country?: Country,
  ): CustomBlendFactRow[] =>
    repository
      .listCandidateFacts(query)
      .filter(isUsableFact)
      .filter((fact) => isAvailableInCountry(fact, country))
      .sort(sortFacts);

  const getBase = (baseVariantId: number, country?: Country): CustomBlendFactRow => {
    const base = repository.findEligibleVariant(baseVariantId);
    if (
      !base ||
      !isUsableFact(base) ||
      !isCustomBlendBaseGroup(base.mixing_group) ||
      !isAvailableInCountry(base, country)
    ) {
      return fail('CUSTOM_BLEND_UNAVAILABLE', 'Selected Custom Blend base is unavailable.');
    }
    return base;
  };

  const resolveFromNormalized = (
    base: CustomBlendFactRow,
    normalized: ReturnType<typeof normalizeCustomBlendSpec>,
    quantity: number | undefined,
    failureCode:
      'CUSTOM_BLEND_INCOMPATIBLE' | 'CUSTOM_BLEND_CORRUPT_SNAPSHOT' = 'CUSTOM_BLEND_INCOMPATIBLE',
    country?: Country,
  ): ResolvedCustomBlendSnapshot => {
    const resolvedQuantity = resolveQuantity(base, quantity, failureCode);
    const byVariantId = new Map<number, CustomBlendFactRow>();
    for (const fact of candidateFacts(undefined, country)) {
      if (!byVariantId.has(fact.variant_id)) byVariantId.set(fact.variant_id, fact);
    }

    const ingredientFacts: CustomBlendFactRow[] = [];
    for (const ingredient of normalized.ingredients) {
      const fact = byVariantId.get(ingredient.variantId);
      if (!fact) {
        return fail('CUSTOM_BLEND_UNAVAILABLE', 'Selected Custom Blend ingredient is unavailable.');
      }
      ingredientFacts.push(fact);
    }

    const compatibility = validateCustomBlendCompatibility(
      base.mixing_group,
      ingredientFacts.map((fact) => fact.mixing_group),
    );
    if (!compatibility.ok) throwRuleFailure(compatibility);

    const pigmentCap = validateCustomBlendPigmentCap(
      ingredientFacts.map((fact, index) => ({
        mixingGroup: fact.mixing_group,
        percentage: normalized.ingredients[index]!.percentage,
      })),
    );
    if (!pigmentCap.ok) throwRuleFailure(pigmentCap);

    const now = clock.now();
    let pricing: ReturnType<typeof calculateCustomBlendPricing>;
    try {
      pricing = calculateCustomBlendPricing({
        quantity: resolvedQuantity,
        components: [
          pricingComponentInput(base, 'base', normalized.basePercentage, now),
          ...ingredientFacts.map((fact, index) =>
            pricingComponentInput(
              fact,
              'ingredient',
              normalized.ingredients[index]!.percentage,
              now,
            ),
          ),
        ],
      });
    } catch {
      return fail('CUSTOM_BLEND_UNAVAILABLE', 'Custom Blend pricing facts are unavailable.');
    }
    if (!pricing.resultClassification) {
      return fail('CUSTOM_BLEND_UNAVAILABLE', 'Custom Blend classification is unavailable.');
    }

    const components = pricing.components.map((component, index) =>
      pricedComponent(
        index === 0 ? base : ingredientFacts[index - 1]!,
        index === 0 ? 'base' : 'ingredient',
        component,
      ),
    );
    return {
      configKey: normalized.configKey,
      basePercentage: normalized.basePercentage,
      mixingGroup: base.mixing_group,
      basePresentation: basePresentation(base),
      ingredients: normalized.ingredients.map((ingredient, index) =>
        ingredientSnapshot(ingredientFacts[index]!, ingredient.percentage),
      ),
      blendingFeeCents: CUSTOM_BLEND_FEE_CENTS,
      madeToOrder: true,
      returnable: false,
      ruleVersion: CUSTOM_BLEND_RULE_VERSION,
      resultClassification: pricing.resultClassification,
      quantity: pricing.quantity,
      components,
      materialUnitPriceCents: pricing.materialUnitPriceCents,
      materialSubtotalCents: pricing.materialSubtotalCents,
      discountableTotalCents: pricing.discountableTotalCents,
      lineTotalCents: pricing.lineTotalCents,
    };
  };

  return {
    listBases(query, country) {
      const normalizedQuery = normalizeBaseListQuery(query);
      const bases = candidateFacts(repositoryQuery(normalizedQuery), country)
        .filter((fact) => isCustomBlendBaseGroup(fact.mixing_group))
        .sort(sortFacts);
      const start = (normalizedQuery.page - 1) * normalizedQuery.pageSize;
      const now = clock.now();
      return {
        items: bases
          .slice(start, start + normalizedQuery.pageSize)
          .map((fact) => toOption(fact, now)),
        total: bases.length,
        page: normalizedQuery.page,
        pageSize: normalizedQuery.pageSize,
      };
    },
    listOptions(baseVariantId, country) {
      const base = getBase(baseVariantId, country);
      const now = clock.now();
      const ingredients = candidateFacts(undefined, country)
        .filter(
          (fact) =>
            fact.variant_id !== base.variant_id &&
            isIngredientGroupAllowed(base.mixing_group, fact.mixing_group),
        )
        .sort(sortFacts);
      return {
        base: toOption(base, now),
        ingredients: ingredients.map((fact) => toOption(fact, now)),
      };
    },
    evaluate(baseVariantId, ingredients, quantity, country) {
      const base = getBase(baseVariantId, country);
      const normalized = normalizeEvaluationIngredients(baseVariantId, ingredients);
      return resolveFromNormalized(
        base,
        normalized,
        quantity,
        'CUSTOM_BLEND_INCOMPATIBLE',
        country,
      );
    },
    rehydrate(baseVariantId, persistedSpec, quantity, country) {
      const persisted = readPersistedSpec(persistedSpec);
      const base = getBase(baseVariantId, country);
      let normalized: ReturnType<typeof normalizeCustomBlendSpec>;
      try {
        normalized = normalizeCustomBlendSpec(baseVariantId, persisted.ingredients);
      } catch {
        return fail(
          'CUSTOM_BLEND_CORRUPT_SNAPSHOT',
          'Custom Blend snapshot specification is corrupt.',
        );
      }
      if (normalized.configKey !== persisted.configKey) {
        return fail(
          'CUSTOM_BLEND_CORRUPT_SNAPSHOT',
          'Custom Blend snapshot config key is corrupt.',
        );
      }
      return resolveFromNormalized(
        base,
        normalized,
        quantity,
        'CUSTOM_BLEND_CORRUPT_SNAPSHOT',
        country,
      );
    },
    toPersistedSpec,
  };
}

// Avoid an accidental unused import if the resolver contract is consumed only through aliases.
void isIngredientGroupAllowed;
