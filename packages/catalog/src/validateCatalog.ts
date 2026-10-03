import {
  CATALOG_CATEGORIES,
  CATALOG_CREATED_AT_BY_ID,
  isNormalizedCatalogKey,
  isUtcIsoInstant,
  type CatalogCategory,
  type CatalogProduct,
} from './model.js';
import { CURATED_BUNDLES, type CatalogBundle } from './bundles.js';
import { CATALOG_PRODUCTS } from './catalog.js';

const CATEGORY_TARGET_COUNTS: Readonly<Record<CatalogCategory, number>> = {
  'Sports Nutrition': 20,
  'Baking & Pantry': 20,
  Drinks: 15,
  'Household & Cleaning': 15,
  'Garden & Outdoors': 15,
  'Trade & Creative Materials': 15,
};

const CANONICAL_IDS_LEGACY = new Set(Array.from({ length: 50 }, (_, i) => i + 1));
const CANONICAL_IDS_NEW = new Set(Array.from({ length: 50 }, (_, i) => 1001 + i));
const ALL_CANONICAL_IDS = new Set([...CANONICAL_IDS_LEGACY, ...CANONICAL_IDS_NEW]);

const assertUnique = (label: string, values: readonly (string | number)[]) => {
  if (new Set(values).size !== values.length) throw new Error(`Catalog has duplicate ${label}`);
};

const isPositiveSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

const isNonNegativeSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const ALLOWED_CONSUMPTION_CLASSIFICATIONS = new Set(['food', 'non-food', 'caution']);
const ALLOWED_MIXING_GROUPS = new Set([
  'food-grade',
  'cleaning',
  'garden-treatment',
  'cementitious-materials',
  'casting-materials',
  'pigments',
  'theatrical-effects',
  'absorbents',
]);

const REQUIRED_SPORTS_FACTS = [
  'flavour',
  'servings',
  'proteinPerServing',
  'carbsPerServing',
  'ingredients',
  'allergens',
  'nutrition',
  'servingSize',
  'dietaryAttributes',
] as const;

const REQUIRED_EDIBLE_FACTS = [
  'ingredients',
  'allergens',
  'nutrition',
  'servingSize',
  'dietaryAttributes',
] as const;

const REQUIRED_GARDEN_FACTS = ['npk', 'coverage', 'application', 'handling'] as const;

const REQUIRED_CLEANING_FACTS = ['surfaces', 'dosage', 'hazardStatement', 'handling'] as const;

const REQUIRED_TRADE_FACTS = [
  'composition',
  'waterRatio',
  'coverage',
  'settingTime',
  'ppe',
] as const;

const REQUIRED_BASE_FACTS = [
  'texture',
  'colour',
  'source',
  'intendedUse',
  'storage',
  'consumptionClassification',
] as const;

const validateBaseFacts = (product: CatalogProduct): void => {
  for (const key of REQUIRED_BASE_FACTS) {
    const value = (product.baseFacts as Record<string, unknown>)[key];
    if (typeof value !== 'string' || !value.trim())
      throw new Error(`Missing or invalid base fact '${key}' for ${product.slug}`);
  }
  if (!ALLOWED_CONSUMPTION_CLASSIFICATIONS.has(product.baseFacts.consumptionClassification))
    throw new Error(`Invalid base fact consumptionClassification for ${product.slug}`);
  if (product.baseFacts.consumptionClassification !== product.consumptionClassification)
    throw new Error(`Base facts consumptionClassification mismatch for ${product.slug}`);
};

const validateCategoryFacts = (product: CatalogProduct): void => {
  const category = product.category;
  const facts = product.categoryFacts as Record<string, unknown>;

  validateBaseFacts(product);

  if (category === 'Sports Nutrition') {
    for (const key of REQUIRED_SPORTS_FACTS) {
      if (!(key in facts)) throw new Error(`Missing sports fact '${key}' for ${product.slug}`);
    }
    if (!Array.isArray(facts.ingredients) || facts.ingredients.length === 0)
      throw new Error(`Missing ingredients for ${product.slug}`);
    if (!Array.isArray(facts.allergens))
      throw new Error(`Missing allergens array for ${product.slug}`);
    if (typeof facts.nutrition !== 'object' || facts.nutrition === null)
      throw new Error(`Missing nutrition facts for ${product.slug}`);
    if (typeof facts.servingSize !== 'string' || !facts.servingSize.trim())
      throw new Error(`Missing serving size for ${product.slug}`);
    if (!Array.isArray(facts.dietaryAttributes))
      throw new Error(`Missing dietaryAttributes for ${product.slug}`);
    if (typeof facts.flavour !== 'string' || !facts.flavour.trim())
      throw new Error(`Missing flavour for ${product.slug}`);
    if (
      typeof facts.servings !== 'number' ||
      !Number.isInteger(facts.servings) ||
      facts.servings < 1
    )
      throw new Error(`Invalid servings for ${product.slug}`);
    if (typeof facts.proteinPerServing !== 'number' || facts.proteinPerServing < 0)
      throw new Error(`Invalid proteinPerServing for ${product.slug}`);
    if (typeof facts.carbsPerServing !== 'number' || facts.carbsPerServing < 0)
      throw new Error(`Invalid carbsPerServing for ${product.slug}`);
  } else if (category === 'Baking & Pantry' || category === 'Drinks') {
    for (const key of REQUIRED_EDIBLE_FACTS) {
      if (!(key in facts)) throw new Error(`Missing edible fact '${key}' for ${product.slug}`);
    }
    if (!Array.isArray(facts.ingredients) || facts.ingredients.length === 0)
      throw new Error(`Missing ingredients for ${product.slug}`);
    if (!Array.isArray(facts.allergens))
      throw new Error(`Missing allergens array for ${product.slug}`);
    if (typeof facts.nutrition !== 'object' || facts.nutrition === null)
      throw new Error(`Missing nutrition facts for ${product.slug}`);
    if (typeof facts.servingSize !== 'string' || !facts.servingSize.trim())
      throw new Error(`Missing serving size for ${product.slug}`);
    if (!Array.isArray(facts.dietaryAttributes))
      throw new Error(`Missing dietaryAttributes for ${product.slug}`);
  } else if (category === 'Garden & Outdoors') {
    for (const key of REQUIRED_GARDEN_FACTS) {
      if (!(key in facts)) throw new Error(`Missing garden fact '${key}' for ${product.slug}`);
    }
    if (typeof facts.npk !== 'string' || !facts.npk.trim())
      throw new Error(`Missing NPK for ${product.slug}`);
    if (typeof facts.coverage !== 'string' || !facts.coverage.trim())
      throw new Error(`Missing coverage for ${product.slug}`);
    if (typeof facts.application !== 'string' || !facts.application.trim())
      throw new Error(`Missing application for ${product.slug}`);
    if (typeof facts.handling !== 'string' || !facts.handling.trim())
      throw new Error(`Missing handling for ${product.slug}`);
  } else if (category === 'Household & Cleaning') {
    for (const key of REQUIRED_CLEANING_FACTS) {
      if (!(key in facts)) throw new Error(`Missing cleaning fact '${key}' for ${product.slug}`);
    }
    if (!Array.isArray(facts.surfaces) || facts.surfaces.length === 0)
      throw new Error(`Missing surfaces for ${product.slug}`);
    if (typeof facts.dosage !== 'string' || !facts.dosage.trim())
      throw new Error(`Missing dosage for ${product.slug}`);
    if (typeof facts.hazardStatement !== 'string' || !facts.hazardStatement.trim())
      throw new Error(`Missing hazard statement for ${product.slug}`);
    if (typeof facts.handling !== 'string' || !facts.handling.trim())
      throw new Error(`Missing handling for ${product.slug}`);
  } else if (category === 'Trade & Creative Materials') {
    for (const key of REQUIRED_TRADE_FACTS) {
      if (!(key in facts)) throw new Error(`Missing trade fact '${key}' for ${product.slug}`);
    }
    if (typeof facts.composition !== 'string' || !facts.composition.trim())
      throw new Error(`Missing composition for ${product.slug}`);
    if (typeof facts.waterRatio !== 'string' || !facts.waterRatio.trim())
      throw new Error(`Missing water ratio for ${product.slug}`);
    if (typeof facts.coverage !== 'string' || !facts.coverage.trim())
      throw new Error(`Missing coverage for ${product.slug}`);
    if (typeof facts.settingTime !== 'string' || !facts.settingTime.trim())
      throw new Error(`Missing setting time for ${product.slug}`);
    if (!Array.isArray(facts.ppe)) throw new Error(`Missing PPE for ${product.slug}`);
  }
};

const validateVariants = (product: CatalogProduct, allSkus: Set<string>): void => {
  if (!product.variants || product.variants.length < 1)
    throw new Error(`Product ${product.slug} must have at least one variant`);

  const hasDefault = product.variants.some((v) => v.sortOrder === 1 && v.active);
  if (!hasDefault)
    throw new Error(`Product ${product.slug} must have an active default variant (sortOrder=1)`);

  for (const variant of product.variants) {
    if (typeof variant.sku !== 'string' || !variant.sku.trim())
      throw new Error(`Missing SKU for variant of ${product.slug}`);
    if (allSkus.has(variant.sku)) throw new Error(`Duplicate SKU ${variant.sku}`);
    allSkus.add(variant.sku);
    if (!/^[A-Z]{3}-\d{4}-\d{3}$/.test(variant.sku))
      throw new Error(`Invalid SKU format: ${variant.sku}`);
    if (typeof variant.label !== 'string' || !variant.label.trim())
      throw new Error(`Missing label for variant ${variant.sku}`);
    if (!isPositiveSafeInteger(variant.weightGrams))
      throw new Error(`Invalid weight for variant ${variant.sku}`);
    if (variant.weightGrams > 1_000_000)
      throw new Error(`Variant ${variant.sku} exceeds max weight of 1,000,000 g`);
    if (!isPositiveSafeInteger(variant.priceCents))
      throw new Error(`Invalid price for variant ${variant.sku}`);
    if (!isNonNegativeSafeInteger(variant.stockCount))
      throw new Error(`Invalid stock for variant ${variant.sku}`);
    if (typeof variant.active !== 'boolean')
      throw new Error(`Invalid active state for variant ${variant.sku}`);
    if (!isPositiveSafeInteger(variant.sortOrder))
      throw new Error(`Invalid sort order for variant ${variant.sku}`);
    if (variant.compareAtPriceCents !== undefined) {
      if (!isPositiveSafeInteger(variant.compareAtPriceCents))
        throw new Error(`Invalid compare-at price for variant ${variant.sku}`);
      if (variant.compareAtPriceCents <= variant.priceCents)
        throw new Error(`Compare-at price must exceed price for variant ${variant.sku}`);
    }
    if (variant.clearancePriceCents !== undefined) {
      if (!isPositiveSafeInteger(variant.clearancePriceCents))
        throw new Error(`Invalid clearance price for variant ${variant.sku}`);
      if (variant.clearancePriceCents >= variant.priceCents)
        throw new Error(`Clearance price must be below price for variant ${variant.sku}`);
    }
    if (variant.clearanceStartsAt !== undefined && !isUtcIsoInstant(variant.clearanceStartsAt))
      throw new Error(`Invalid clearance start for variant ${variant.sku}`);
    if (variant.clearanceEndsAt !== undefined && !isUtcIsoInstant(variant.clearanceEndsAt))
      throw new Error(`Invalid clearance end for variant ${variant.sku}`);
    if (
      variant.clearanceStartsAt !== undefined &&
      variant.clearanceEndsAt !== undefined &&
      variant.clearanceStartsAt >= variant.clearanceEndsAt
    )
      throw new Error(`Clearance window must be ordered for variant ${variant.sku}`);
    if (typeof variant.backorderable !== 'boolean')
      throw new Error(`Invalid backorderable state for variant ${variant.sku}`);
    if (variant.backorderable && variant.backorderLeadDays !== undefined) {
      if (!isPositiveSafeInteger(variant.backorderLeadDays))
        throw new Error(`Invalid backorder lead days for variant ${variant.sku}`);
    }
    if (!variant.backorderable && variant.backorderLeadDays !== undefined)
      throw new Error(`Backorder lead days set on non-backorderable variant ${variant.sku}`);
    if (variant.deliveryClass !== 'parcel' && variant.deliveryClass !== 'freight')
      throw new Error(`Invalid delivery class for variant ${variant.sku}`);
    if (variant.weightGrams >= 100_000 && variant.deliveryClass !== 'freight')
      throw new Error(`Variant ${variant.sku} is >= 100 kg but not marked freight`);
  }
};

const validateBundles = (bundles: readonly CatalogBundle[], allSkus: Set<string>): void => {
  assertUnique(
    'bundle IDs',
    bundles.map((b) => b.id),
  );
  assertUnique(
    'bundle keys',
    bundles.map((b) => b.key),
  );
  assertUnique(
    'bundle sort orders',
    bundles.map((b) => b.sortOrder),
  );
  assertUnique(
    'bundle imageSetIds',
    bundles.map((b) => b.imageSetId),
  );

  for (const bundle of bundles) {
    if (!isPositiveSafeInteger(bundle.id)) throw new Error(`Invalid bundle ID for ${bundle.key}`);
    if (!isNormalizedCatalogKey(bundle.key)) throw new Error(`Invalid bundle key ${bundle.key}`);
    if (typeof bundle.name !== 'string' || !bundle.name.trim() || bundle.name.length > 160)
      throw new Error(`Invalid bundle name for ${bundle.key}`);
    if (
      typeof bundle.description !== 'string' ||
      !bundle.description.trim() ||
      bundle.description.length > 500
    )
      throw new Error(`Invalid bundle description for ${bundle.key}`);
    if (!isPositiveSafeInteger(bundle.sortOrder))
      throw new Error(`Invalid bundle sort order for ${bundle.key}`);
    if (!isPositiveSafeInteger(bundle.discountPercent) || bundle.discountPercent > 100)
      throw new Error(`Invalid discount percent for ${bundle.key}`);
    if (!bundle.components || bundle.components.length < 2)
      throw new Error(`Bundle ${bundle.key} must contain at least two components`);

    assertUnique(
      `bundle component SKUs for ${bundle.key}`,
      bundle.components.map((c) => c.variantSku),
    );
    assertUnique(
      `bundle component sort orders for ${bundle.key}`,
      bundle.components.map((c) => c.sortOrder),
    );

    for (const component of bundle.components) {
      if (typeof component.variantSku !== 'string' || !component.variantSku.trim())
        throw new Error(`Invalid bundle component SKU for ${bundle.key}`);
      if (!allSkus.has(component.variantSku))
        throw new Error(
          `Bundle ${bundle.key} references unknown variant SKU ${component.variantSku}`,
        );
      if (!isPositiveSafeInteger(component.quantity))
        throw new Error(`Invalid bundle component quantity for ${bundle.key}`);
      if (!isPositiveSafeInteger(component.sortOrder))
        throw new Error(`Invalid bundle component sort order for ${bundle.key}`);
    }
  }
};

export function validateCatalog(
  products: readonly CatalogProduct[] = CATALOG_PRODUCTS,
  bundles: readonly CatalogBundle[] = CURATED_BUNDLES,
): void {
  if (products.length !== 100)
    throw new Error(`Catalog expected 100 products, got ${products.length}`);

  for (const category of CATALOG_CATEGORIES) {
    const count = products.filter((p) => p.category === category).length;
    const target = CATEGORY_TARGET_COUNTS[category];
    if (count !== target)
      throw new Error(
        `Category '${category}' has ${count} products, expected ${target}. Redistribution requires recorded reason.`,
      );
  }

  for (const product of products) {
    if (!ALL_CANONICAL_IDS.has(product.id))
      throw new Error(`Product ${product.slug} has non-canonical ID ${product.id}`);
    if (!CATALOG_CATEGORIES.includes(product.category))
      throw new Error(`Invalid category '${product.category}' for ${product.slug}`);
    if (!ALLOWED_CONSUMPTION_CLASSIFICATIONS.has(product.consumptionClassification))
      throw new Error(
        `Invalid consumption classification '${product.consumptionClassification}' for ${product.slug}`,
      );
    if (product.mixingGroup !== null && !ALLOWED_MIXING_GROUPS.has(product.mixingGroup))
      throw new Error(`Invalid mixing group '${product.mixingGroup}' for ${product.slug}`);
    if (!isUtcIsoInstant(product.createdAt))
      throw new Error(`Invalid creation timestamp for ${product.slug}`);
    if (product.createdAt !== CATALOG_CREATED_AT_BY_ID[product.id])
      throw new Error(`Catalog chronology differs from canonical timestamp for ${product.slug}`);
    if (product.visibility !== 'public' && product.visibility !== 'hidden')
      throw new Error(`Invalid visibility for ${product.slug}`);
    if (typeof product.onSale !== 'boolean') throw new Error(`Invalid onSale for ${product.slug}`);
    if (product.onSale && !product.variants.some((v) => v.compareAtPriceCents !== undefined))
      throw new Error(
        `Product ${product.slug} is on sale but has no variant with compare-at price`,
      );
    if (typeof product.name !== 'string' || !product.name.trim())
      throw new Error(`Invalid name for ${product.slug}`);
    if (typeof product.description !== 'string' || !product.description.trim())
      throw new Error(`Invalid description for ${product.slug}`);
    if (!Array.isArray(product.tags)) throw new Error(`Invalid tags for ${product.slug}`);
  }

  assertUnique(
    'product IDs',
    products.map((p) => p.id),
  );
  assertUnique(
    'slugs',
    products.map((p) => p.slug),
  );
  assertUnique(
    'artwork IDs',
    products.map((p) => p.imageSetId),
  );

  for (const product of products) {
    if (!isNormalizedCatalogKey(product.slug))
      throw new Error(`Invalid slug format: ${product.slug}`);
    if (!isNormalizedCatalogKey(product.imageSetId))
      throw new Error(`Invalid imageSetId format: ${product.imageSetId}`);
    validateBaseFacts(product);
    validateCategoryFacts(product);
  }

  const allSkus = new Set<string>();
  for (const product of products) {
    validateVariants(product, allSkus);
  }

  validateBundles(bundles, allSkus);
}
