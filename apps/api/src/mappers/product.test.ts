import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import { ProductWithVariants } from '@shop/contracts/products';
import { TIER_LADDER } from '@shop/contracts/pricing';

import { toProductContract, toProductWithVariantsContract } from './product.js';
import type { ProductRow, VariantRow } from '../features/catalog/productRepository.js';

const MAPPING_NOW = new Date('2026-07-28T12:00:00.000Z');

const canonicalRow: ProductRow = {
  id: 1,
  name: 'All-Purpose Flour',
  description: 'Test product',
  price_cents: 1299,
  category: 'Baking & Pantry',
  stock_count: 4,
  image_set_id: 'all-purpose-flour',
  slug: 'all-purpose-flour',
  compare_at_price_cents: null,
  sales_count: 8,
  active: 1,
  created_at: '2025-01-01T00:00:00.000Z',
  consumption_classification: 'food',
  mixing_group: 'food-grade',
  details_json: JSON.stringify({
    texture: 'Fine soft powder',
    colour: 'White to off-white',
    source: 'Milled wheat endosperm',
    intendedUse: 'General-purpose baking and cooking flour',
    storage: 'Store in a cool dry place.',
    consumptionClassification: 'food',
    ingredients: ['Wheat flour'],
    allergens: ['Gluten (wheat)'],
    nutrition: { energy: '364 kcal' },
    servingSize: '100 g',
    dietaryAttributes: [],
  }),
  default_variant_id: 1,
  blend_source_variant_id: null,
};

const sampleVariants: VariantRow[] = [
  {
    id: 1,
    product_id: 1,
    sku: 'BKP-0001-001',
    label: '1 kg Bag',
    weight_grams: 1000,
    price_cents: 799,
    moq_sacks: 4,
    compare_at_price_cents: null,
    clearance_price_cents: null,
    clearance_starts_at: null,
    clearance_ends_at: null,
    stock_count: 10,
    backorderable: 0,
    backorder_lead_days: null,
    delivery_class: 'parcel',
    active: 1,
    sort_order: 1,
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
  },
  {
    id: 2,
    product_id: 1,
    sku: 'BKP-0001-002',
    label: '5 kg Bag',
    weight_grams: 5000,
    price_cents: 2499,
    moq_sacks: 4,
    compare_at_price_cents: 2999,
    clearance_price_cents: null,
    clearance_starts_at: null,
    clearance_ends_at: null,
    stock_count: 5,
    backorderable: 1,
    backorder_lead_days: 7,
    delivery_class: 'parcel',
    active: 1,
    sort_order: 2,
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
  },
  {
    id: 3,
    product_id: 1,
    sku: 'BKP-0001-003',
    label: '25 kg Bag',
    weight_grams: 25000,
    price_cents: 8499,
    moq_sacks: 4,
    compare_at_price_cents: null,
    clearance_price_cents: null,
    clearance_starts_at: null,
    clearance_ends_at: null,
    stock_count: 0,
    backorderable: 0,
    backorder_lead_days: null,
    delivery_class: 'parcel',
    active: 1,
    sort_order: 3,
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
  },
];

void test('toProductContract maps persisted metadata without packaging', () => {
  const product = toProductContract({
    ...canonicalRow,
    tags: [{ key: 'local-tag', label: 'Local tag' }],
    specificationGroups: [
      {
        key: 'appearance',
        label: 'Appearance',
        order: 1,
        specifications: [{ key: 'texture', label: 'Texture', valueKey: 'local', value: 'Local' }],
      },
    ],
  });

  assert.equal('packaging' in product, false);
  assert.equal('images' in product, false);
  assert.equal(product.createdAt, canonicalRow.created_at);
  assert.equal(product.available, true);
  assert.deepEqual(product.tags, [{ key: 'local-tag', label: 'Local tag' }]);
  assert.deepEqual(product.specificationGroups[0]?.specifications[0]?.valueKey, 'local');
});

void test('raw internal rows remain valid with empty metadata and UTC normalization', () => {
  const product = toProductContract({ ...canonicalRow, image_set_id: 'retired-artwork' });

  assert.equal(product.imageSetId, 'retired-artwork');
  assert.deepEqual(product.tags, []);
  assert.deepEqual(product.specificationGroups, []);
  assert.equal(product.createdAt, '2025-01-01T00:00:00.000Z');
  assert.equal(toProductContract({ ...canonicalRow, stock_count: 0 }).available, false);
  assert.equal(
    toProductContract({ ...canonicalRow, created_at: '2025-01-01 12:00:00' }).createdAt,
    '2025-01-01T12:00:00.000Z',
  );
});

void test('reservation-aware projection never exposes on-hand stock as customer availability', () => {
  const product = toProductContract({
    ...canonicalRow,
    stock_count: 9,
    available_to_sell: 0,
    backorderable: 1,
    backorder_lead_days: 14,
  });

  assert.equal(product.stock, 0);
  assert.equal(product.availability, 'backorder');
  assert.equal(product.backorderable, true);
  assert.equal(product.backorderLeadDays, 14);
  assert.equal(product.available, true);

  const unavailable = toProductContract({
    ...canonicalRow,
    stock_count: 9,
    available_to_sell: 0,
    backorderable: 0,
    backorder_lead_days: null,
  });
  assert.equal(unavailable.stock, 0);
  assert.equal(unavailable.availability, 'out_of_stock');
  assert.equal(unavailable.available, false);
});

void test('toProductWithVariantsContract maps variants, facts, price range, and availability', () => {
  const result = toProductWithVariantsContract(canonicalRow, sampleVariants, MAPPING_NOW);

  assert.equal(result.variants.length, 3);
  assert.equal(result.variants[0]!.sku, 'BKP-0001-001');
  assert.equal(result.variants[0]!.variantId, 1);
  assert.equal(result.variants[0]!.weightGrams, 1000);
  assert.equal(result.variants[0]!.moqSacks, 4);
  assert.equal(result.variants[0]!.perTonneCents, 799000);
  assert.deepEqual(result.variants[0]!.priceTiers, TIER_LADDER);
  assert.equal(result.variants[0]!.backorderable, false);
  assert.equal(result.variants[1]!.backorderable, true);
  assert.equal(result.variants[1]!.backorderLeadDays, 7);
  assert.equal(result.variants[1]!.compareAtPriceCents, 2999);
  assert.equal(result.defaultVariantId, 1);
  assert.equal(result.priceRange.min, 799);
  assert.equal(result.priceRange.max, 8499);
  assert.equal(result.baseAvailability, 'in_stock');
  assert.equal(result.consumptionClassification, 'food');
  assert.equal(result.mixingGroup, 'food-grade');
  assert.ok(typeof result.categoryFacts === 'object');
  assert.equal((result.categoryFacts as Record<string, unknown>).texture, 'Fine soft powder');
  assert.equal(Value.Check(ProductWithVariants, result), true);
});

void test('toProductWithVariantsContract exposes an active clearance without replacing list pricing', () => {
  const result = toProductWithVariantsContract(
    canonicalRow,
    [
      {
        ...sampleVariants[0]!,
        clearance_price_cents: 599,
        clearance_starts_at: '2026-07-27T12:00:00.000Z',
        clearance_ends_at: '2026-07-29T12:00:00.000Z',
      },
      {
        ...sampleVariants[1]!,
        clearance_price_cents: 1_999,
        clearance_starts_at: '2026-07-29T12:00:00.000Z',
        clearance_ends_at: '2026-07-30T12:00:00.000Z',
      },
      {
        ...sampleVariants[2]!,
        clearance_price_cents: 7_999,
        clearance_starts_at: '2026-07-26T12:00:00.000Z',
        clearance_ends_at: '2026-07-27T12:00:00.000Z',
      },
    ],
    MAPPING_NOW,
  );

  assert.equal(result.variants[0]?.priceCents, 799);
  assert.equal(result.variants[0]?.perTonneCents, 799_000);
  assert.deepEqual(result.variants[0]?.clearance, {
    priceCents: 599,
    perTonneCents: 599_000,
    startsAt: '2026-07-27T12:00:00.000Z',
    endsAt: '2026-07-29T12:00:00.000Z',
  });
  assert.equal(result.variants[1]?.clearance, undefined);
  assert.equal(result.variants[2]?.clearance, undefined);
  assert.equal(Value.Check(ProductWithVariants, result), true);
});

void test('toProductWithVariantsContract handles null details_json and baseAvailability edge cases', () => {
  const allOutOfStock: VariantRow[] = [
    { ...sampleVariants[0]!, stock_count: 0, backorderable: 0 },
    { ...sampleVariants[1]!, stock_count: 0, backorderable: 0 },
  ] as VariantRow[];

  const result = toProductWithVariantsContract(
    { ...canonicalRow, details_json: null },
    allOutOfStock,
    MAPPING_NOW,
  );

  assert.equal(result.baseAvailability, 'out_of_stock');
  assert.ok(typeof result.categoryFacts === 'object');
  assert.equal(result.categoryFacts.texture, 'Not specified');

  const backorderOnly = toProductWithVariantsContract(
    { ...canonicalRow, details_json: null },
    [
      {
        ...sampleVariants[0]!,
        stock_count: 0,
        backorderable: 1,
        backorder_lead_days: 14,
      },
    ] as VariantRow[],
    MAPPING_NOW,
  );
  assert.equal(backorderOnly.baseAvailability, 'backorder');

  const inStock = toProductWithVariantsContract(
    canonicalRow,
    [{ ...sampleVariants[0]!, stock_count: 20 }] as VariantRow[],
    MAPPING_NOW,
  );
  assert.equal(inStock.baseAvailability, 'in_stock');
});

void test('toProductWithVariantsContract handles invalid details_json', () => {
  const result = toProductWithVariantsContract(
    { ...canonicalRow, details_json: 'not valid json{' },
    [sampleVariants[0]!],
    MAPPING_NOW,
  );

  assert.ok(typeof result.categoryFacts === 'object');
  assert.equal(result.categoryFacts.consumptionClassification, 'food');
});

void test('toProductWithVariantsContract uses variants for defaultVariantId when column is null', () => {
  const result = toProductWithVariantsContract(
    { ...canonicalRow, default_variant_id: null },
    sampleVariants,
    MAPPING_NOW,
  );

  assert.equal(result.defaultVariantId, 1);
});
