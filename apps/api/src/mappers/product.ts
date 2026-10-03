import type {
  CatalogVariant,
  CategoryFacts,
  PriceRange,
  Product,
  ProductWithVariants,
} from '@shop/contracts/products';
import type { BaseAvailability } from '@shop/contracts/products';
import { TIER_LADDER } from '@shop/contracts/pricing';
import { perTonneCents } from '../features/pricing/pricingRules.js';
import { resolveClearance } from '../features/pricing/clearanceRules.js';
import type {
  CustomerProductRow,
  ProductRow,
  VariantRow,
} from '../features/catalog/productRepository.js';

function toUtcIsoInstant(value: string): string {
  const sqliteDateTime = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/.exec(value);
  if (sqliteDateTime) return `${sqliteDateTime[1]}T${sqliteDateTime[2]}.000Z`;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : value;
}

function parseDetailsJson(json: string | null): CategoryFacts | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed as CategoryFacts;
  } catch {
    return null;
  }
}

function computePriceRange(variants: readonly VariantRow[]): PriceRange {
  const activeVariants = variants.filter((v) => v.active === 1);
  if (activeVariants.length === 0) return { min: 0, max: 0 };
  let min = activeVariants[0]!.price_cents;
  let max = activeVariants[0]!.price_cents;
  for (const v of activeVariants) {
    if (v.price_cents < min) min = v.price_cents;
    if (v.price_cents > max) max = v.price_cents;
  }
  return { min, max };
}

function computeBaseAvailability(
  row: ProductRow,
  variants: readonly VariantRow[],
): BaseAvailability {
  const activeVariants = variants.filter((v) => v.active === 1);
  const inStock = activeVariants.some((v) => v.stock_count > 0);
  const anyBackorder = activeVariants.some((v) => v.backorderable === 1);
  if (inStock) {
    const totalStock = activeVariants.reduce((sum, v) => sum + v.stock_count, 0);
    if (totalStock <= 5) return 'low_stock';
    return 'in_stock';
  }
  if (anyBackorder && row.active === 1) return 'backorder';
  return 'out_of_stock';
}

function mapVariant(v: VariantRow, now: Date): CatalogVariant {
  const { clearance } = resolveClearance({
    priceCents: v.price_cents,
    clearancePriceCents: v.clearance_price_cents,
    clearanceStartsAt: v.clearance_starts_at,
    clearanceEndsAt: v.clearance_ends_at,
    weightGrams: v.weight_grams,
    now,
  });
  return {
    variantId: v.id,
    productId: v.product_id,
    sku: v.sku,
    label: v.label,
    weightGrams: v.weight_grams,
    priceCents: v.price_cents,
    moqSacks: v.moq_sacks,
    perTonneCents: perTonneCents(v.price_cents, v.weight_grams),
    priceTiers: TIER_LADDER,
    ...(v.compare_at_price_cents !== null ? { compareAtPriceCents: v.compare_at_price_cents } : {}),
    ...(clearance ? { clearance } : {}),
    stockCount: v.stock_count,
    backorderable: v.backorderable === 1,
    backorderLeadDays: v.backorderable === 1 ? (v.backorder_lead_days ?? null) : null,
    deliveryClass: v.delivery_class as CatalogVariant['deliveryClass'],
    active: v.active === 1,
    sortOrder: v.sort_order,
  };
}

export function toProductContract(row: ProductRow | CustomerProductRow): Product {
  const tags = 'tags' in row ? row.tags : [];
  const specificationGroups = 'specificationGroups' in row ? row.specificationGroups : [];
  const stock = row.available_to_sell ?? row.stock_count;
  const backorderable = row.backorderable === 1;
  const availability =
    stock > 0 ? 'in_stock' : backorderable && row.active === 1 ? 'backorder' : 'out_of_stock';

  return {
    id: String(row.id),
    name: row.name,
    description: row.description,
    priceCents: row.price_cents,
    imageSetId: row.image_set_id ?? 'unknown',
    category: row.category,
    stock,
    availability,
    backorderable,
    backorderLeadDays: backorderable ? (row.backorder_lead_days ?? null) : null,
    slug: row.slug ?? '',
    compareAtPriceCents: row.compare_at_price_cents ?? undefined,
    ...('has_active_clearance' in row
      ? { hasActiveClearance: row.has_active_clearance === 1 }
      : {}),
    salesCount: row.sales_count ?? 0,
    createdAt: toUtcIsoInstant(row.created_at),
    available: row.active === 1 && (stock > 0 || backorderable),
    tags,
    specificationGroups,
    consumptionClassification:
      (row.consumption_classification as Product['consumptionClassification']) || undefined,
    mixingGroup: (row as { mixing_group?: string | null }).mixing_group ?? null,
  };
}

export function toProductWithVariantsContract(
  row: ProductRow | CustomerProductRow,
  variants: readonly VariantRow[],
  now: Date,
): ProductWithVariants {
  const base = toProductContract(row);
  const categoryFacts = parseDetailsJson(row.details_json);
  const priceRange = computePriceRange(variants);
  const baseAvailability = computeBaseAvailability(row, variants);

  const activeVariantsForAvailable = variants.filter((v) => v.active === 1);
  const variantStock = activeVariantsForAvailable.reduce((sum, v) => sum + v.stock_count, 0);

  return {
    ...base,
    available:
      row.active === 1 &&
      (variantStock > 0 || activeVariantsForAvailable.some((v) => v.backorderable === 1)),
    variants: variants.map((variant) => mapVariant(variant, now)),
    defaultVariantId:
      row.default_variant_id ??
      variants.find((v) => v.sort_order === 1)?.id ??
      variants[0]?.id ??
      0,
    categoryFacts: categoryFacts ?? {
      texture: 'Not specified',
      colour: 'Not specified',
      source: 'Not specified',
      intendedUse: 'Not specified',
      storage: 'Not specified',
      consumptionClassification:
        (row.consumption_classification as CategoryFacts['consumptionClassification']) ||
        'non-food',
    },
    consumptionClassification:
      (row.consumption_classification as ProductWithVariants['consumptionClassification']) ||
      'non-food',
    mixingGroup: row.mixing_group ?? null,
    priceRange,
    baseAvailability,
  };
}
