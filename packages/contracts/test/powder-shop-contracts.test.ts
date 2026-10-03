import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import {
  CURRENT_PERSISTED_CHECKOUT_QUOTE_VERSION,
  PersistedCheckoutQuoteV7,
  PersistedCheckoutQuoteV8,
  PersistedCheckoutQuoteV9,
  parsePersistedCheckoutQuote,
} from '../src/payments.js';
import {
  CatalogVariant,
  ProductWithVariants,
  BaseProductFacts,
  SportsFacts,
  GardenFacts,
  CleaningFacts,
  TradeFacts,
  TheatricalFacts,
  ConsumptionClassification,
  PriceRange,
  BaseAvailability,
  CategoryFacts,
} from '../src/products.js';
import {
  MOQ_DEFAULT_SACKS,
  PALLET_WEIGHT_GRAMS,
  PriceTier,
  SACKS_PER_PALLET,
  SACK_WEIGHT_GRAMS,
  TIER_LADDER,
  TierLadder,
} from '../src/pricing.js';
import {
  DeliverySummary,
  DeliveryMode,
  DeliveryQuoteInput,
  FREIGHT_WEIGHT_THRESHOLD_GRAMS,
  FREIGHT_CHARGE_CENTS,
  PARCEL_CHARGE_CENTS,
} from '../src/delivery.js';
import {
  AddToCartBody,
  BelowMoqError,
  CartLine,
  CartLineVariantSnap,
  RemoveFromCartBody,
  UpdateCartLineBody,
} from '../src/cart.js';

const uuid = '123e4567-e89b-42d3-a456-426614174000';
const utc = '2026-07-14T00:00:00.000Z';

const deliveryAddress = {
  line1: '1 Example Street',
  city: 'London',
  postcode: 'EC1A 1BB',
  countryCode: 'GB',
};

const baseQuote = {
  cartId: uuid,
  customer: {
    name: 'Ada Shopper',
    email: 'ada@example.test',
    deliveryAddress,
    shippingAddress: '1 Example Street, London, EC1A 1BB, GB',
  },
  userId: null,
  promoCode: null,
  subtotalCents: 2500,
  discountCents: 0,
  totalCents: 2500,
  lines: [],
  createdAt: utc,
  billingEntity: {
    legalName: 'Example Trading Ltd',
    registrationNumber: null,
    vatNumber: null,
    address: deliveryAddress,
  },
  deliverySlot: { date: '2026-08-03', window: 'am' },
  purchaseOrderReference: null,
};

const product = {
  id: '1',
  name: 'Protein Powder',
  description: 'A test product',
  priceCents: 2500,
  imageSetId: 'protein-powder',
  category: 'Sports Nutrition',
  stock: 5,
  availability: 'in_stock',
  backorderable: false,
  backorderLeadDays: null,
  slug: 'protein-powder',
  salesCount: 10,
  createdAt: utc,
  available: true,
  tags: [],
  specificationGroups: [],
};

// ---------------------------------------------------------------------------
// G0 config constants
// ---------------------------------------------------------------------------

void test('G0 freight constants match spec', () => {
  assert.equal(FREIGHT_WEIGHT_THRESHOLD_GRAMS, 100_000);
  assert.equal(FREIGHT_CHARGE_CENTS, 999);
  assert.equal(PARCEL_CHARGE_CENTS, 0);
});

void test('pricing constants and tier transport match materials pricing policy', () => {
  assert.equal(SACK_WEIGHT_GRAMS, 25_000);
  assert.equal(PALLET_WEIGHT_GRAMS, 1_000_000);
  assert.equal(SACKS_PER_PALLET, 40);
  assert.equal(MOQ_DEFAULT_SACKS, 4);
  assert.deepEqual(TIER_LADDER, [
    { minTonnes: 1, discountPct: 0 },
    { minTonnes: 5, discountPct: 5 },
    { minTonnes: 10, discountPct: 10 },
  ]);
  assert.equal(Value.Check(PriceTier, TIER_LADDER[0]), true);
  assert.equal(Value.Check(TierLadder, TIER_LADDER), true);
  assert.equal(Value.Check(PriceTier, { minTonnes: 1, discountPct: 101 }), false);
  assert.equal(Value.Check(PriceTier, { minTonnes: 1, discountPct: 0, extra: true }), false);
});

// ---------------------------------------------------------------------------
// Delivery schemas
// ---------------------------------------------------------------------------

void test('DeliveryMode accepts parcel and freight only', () => {
  assert.equal(Value.Check(DeliveryMode, 'parcel'), true);
  assert.equal(Value.Check(DeliveryMode, 'freight'), true);
  assert.equal(Value.Check(DeliveryMode, 'express'), false);
  assert.equal(Value.Check(DeliveryMode, ''), false);
});

void test('DeliverySummary validates and rejects extra fields', () => {
  const delivery = {
    mode: 'freight',
    chargeCents: 999,
    weightGrams: 150_000,
    reason: 'Over 100kg threshold',
  };
  assert.equal(Value.Check(DeliverySummary, delivery), true);
  assert.equal(Value.Check(DeliverySummary, { ...delivery, chargeCents: -1 }), false);
  assert.equal(Value.Check(DeliverySummary, { ...delivery, weightGrams: -1 }), false);
  assert.equal(Value.Check(DeliverySummary, { ...delivery, reason: '' }), false);
  assert.equal(Value.Check(DeliverySummary, { ...delivery, extra: true }), false);
});

void test('DeliveryQuoteInput validates lines and rejects unknown properties', () => {
  assert.equal(
    Value.Check(DeliveryQuoteInput, {
      lines: [
        { deliveryClass: 'parcel', unitWeightGrams: 500, quantity: 2 },
        { deliveryClass: 'freight', unitWeightGrams: 25000, quantity: 5 },
      ],
    }),
    true,
  );
  assert.equal(Value.Check(DeliveryQuoteInput, { lines: [] }), true);
  assert.equal(
    Value.Check(DeliveryQuoteInput, {
      lines: [],
      customMixWeightGrams: 1000,
    }),
    false,
  );
  assert.equal(
    Value.Check(DeliveryQuoteInput, {
      lines: [{ deliveryClass: 'parcel', unitWeightGrams: 0, quantity: 1 }],
    }),
    false,
  );
});

// ---------------------------------------------------------------------------
// Product variant and facts schemas
// ---------------------------------------------------------------------------

void test('ConsumptionClassification accepts food, non-food, caution', () => {
  assert.equal(Value.Check(ConsumptionClassification, 'food'), true);
  assert.equal(Value.Check(ConsumptionClassification, 'non-food'), true);
  assert.equal(Value.Check(ConsumptionClassification, 'caution'), true);
  assert.equal(Value.Check(ConsumptionClassification, 'edible'), false);
  assert.equal(Value.Check(ConsumptionClassification, ''), false);
});

void test('BaseProductFacts requires all base fields', () => {
  const facts = {
    texture: 'Fine powder',
    colour: 'White',
    source: 'Plant-derived',
    intendedUse: 'Mix with water',
    storage: 'Cool dry place',
    consumptionClassification: 'food',
  };
  assert.equal(Value.Check(BaseProductFacts, facts), true);
  assert.equal(
    Value.Check(BaseProductFacts, { ...facts, consumptionClassification: 'unknown' }),
    false,
  );
  const missing = { ...facts };
  delete (missing as Record<string, unknown>).texture;
  assert.equal(Value.Check(BaseProductFacts, missing), false);
});

void test('SportsFacts extends EdibleFacts extends BaseProductFacts', () => {
  const sports = {
    texture: 'Fine powder',
    colour: 'White',
    source: 'Plant-derived',
    intendedUse: 'Mix with water',
    storage: 'Cool dry place',
    consumptionClassification: 'food',
    ingredients: ['Creatine Monohydrate'],
    allergens: [],
    nutrition: { protein: '20g' },
    servingSize: '30g',
    dietaryAttributes: ['vegetarian', 'gluten-free'],
    flavour: 'Unflavoured',
    servings: 30,
    proteinPerServing: 20,
    carbsPerServing: 0,
  };
  assert.equal(Value.Check(SportsFacts, sports), true);
  assert.equal(Value.Check(SportsFacts, { ...sports, flavour: '' }), false);
  assert.equal(Value.Check(SportsFacts, { ...sports, proteinPerServing: -1 }), false);
});

void test('GardenFacts extends BaseProductFacts', () => {
  const garden = {
    texture: 'Granular',
    colour: 'White',
    source: 'Mineral',
    intendedUse: 'Soil amendment',
    storage: 'Keep dry',
    consumptionClassification: 'caution',
    npk: '0-0-22',
    coverage: '2kg per 100m²',
    application: 'Spread evenly',
    handling: 'Wear gloves',
  };
  assert.equal(Value.Check(GardenFacts, garden), true);
  assert.equal(Value.Check(GardenFacts, { ...garden, npk: '' }), false);
});

void test('CleaningFacts extends BaseProductFacts', () => {
  const cleaning = {
    texture: 'Powder',
    colour: 'White',
    source: 'Mineral',
    intendedUse: 'General cleaning',
    storage: 'Keep dry',
    consumptionClassification: 'non-food',
    surfaces: ['Kitchen', 'Bathroom'],
    dosage: '2 tbsp per litre',
    hazardStatement: 'Do not mix with acids',
    handling: 'Wear gloves',
  };
  assert.equal(Value.Check(CleaningFacts, cleaning), true);
  assert.equal(Value.Check(CleaningFacts, { ...cleaning, surfaces: [] }), false);
});

void test('TradeFacts extends BaseProductFacts with ppe', () => {
  const trade = {
    texture: 'Fine powder',
    colour: 'Grey',
    source: 'Mineral',
    intendedUse: 'Cementitious repair',
    storage: 'Keep dry',
    consumptionClassification: 'caution',
    composition: 'Portland cement, aggregates',
    waterRatio: '3:1',
    coverage: '1kg per m²',
    settingTime: '4-6 hours',
    ppe: ['Mask', 'Gloves', 'Goggles'],
  };
  assert.equal(Value.Check(TradeFacts, trade), true);
  assert.equal(Value.Check(TradeFacts, { ...trade, ppe: [] }), true);
});

void test('TheatricalFacts extends BaseProductFacts with colourProfile', () => {
  const theatrical = {
    texture: 'Fine powder',
    colour: 'Red',
    source: 'Synthetic',
    intendedUse: 'Special effects',
    storage: 'Cool dry place',
    consumptionClassification: 'non-food',
    approvedApplication: 'Stage use only',
    cleanup: 'Water soluble',
    colourProfile: 'Vibrant red, matte',
    particleAppearance: 'Fine uniform particles',
    ppe: ['Mask'],
  };
  assert.equal(Value.Check(TheatricalFacts, theatrical), true);
});

void test('CategoryFacts union discriminates typed fact shapes', () => {
  const sports = {
    texture: 'Fine powder',
    colour: 'White',
    source: 'Plant',
    intendedUse: 'Supplement',
    storage: 'Cool dry',
    consumptionClassification: 'food',
    ingredients: ['Protein'],
    allergens: [],
    nutrition: {},
    servingSize: '30g',
    dietaryAttributes: [],
    flavour: 'Chocolate',
    servings: 20,
    proteinPerServing: 25,
    carbsPerServing: 5,
  };
  assert.equal(Value.Check(CategoryFacts, sports), true);

  const base = {
    texture: 'Powder',
    colour: 'White',
    source: 'Mineral',
    intendedUse: 'Cleaning',
    storage: 'Dry',
    consumptionClassification: 'non-food',
  };
  assert.equal(Value.Check(CategoryFacts, base), true);
});

void test('CatalogVariant requires variantId, deliveryClass, sortOrder', () => {
  const variant = {
    variantId: 1,
    productId: 1,
    sku: 'SN-0001-001',
    label: '500g Tub',
    weightGrams: 500,
    priceCents: 2500,
    moqSacks: 4,
    perTonneCents: 5_000_000,
    priceTiers: TIER_LADDER,
    stockCount: 10,
    backorderable: false,
    backorderLeadDays: null,
    deliveryClass: 'parcel',
    active: true,
    sortOrder: 1,
  };
  assert.equal(Value.Check(CatalogVariant, variant), true);
  assert.equal(Value.Check(CatalogVariant, { ...variant, deliveryClass: 'express' }), false);
  assert.equal(
    Value.Check(CatalogVariant, {
      ...variant,
      compareAtPriceCents: 3000,
    }),
    true,
  );
  assert.equal(
    Value.Check(CatalogVariant, {
      ...variant,
      extra: true,
    }),
    false,
  );
});

void test('PriceRange enforces min <= max shape', () => {
  assert.equal(Value.Check(PriceRange, { min: 1000, max: 5000 }), true);
  assert.equal(Value.Check(PriceRange, { min: -1, max: 100 }), false);
});

void test('BaseAvailability rejects legacy-only status', () => {
  assert.equal(Value.Check(BaseAvailability, 'in_stock'), true);
  assert.equal(Value.Check(BaseAvailability, 'low_stock'), true);
  assert.equal(Value.Check(BaseAvailability, 'out_of_stock'), true);
  assert.equal(Value.Check(BaseAvailability, 'backorder'), true);
});

void test('ProductWithVariants requires variants, defaultVariantId, categoryFacts', () => {
  const pwv = {
    ...product,
    variants: [
      {
        variantId: 1,
        productId: 1,
        sku: 'SN-0001-001',
        label: '500g Tub',
        weightGrams: 500,
        priceCents: 2500,
        moqSacks: 4,
        perTonneCents: 5_000_000,
        priceTiers: TIER_LADDER,
        stockCount: 10,
        backorderable: false,
        backorderLeadDays: null,
        deliveryClass: 'parcel',
        active: true,
        sortOrder: 1,
      },
    ],
    defaultVariantId: 1,
    categoryFacts: {
      texture: 'Fine powder',
      colour: 'White',
      source: 'Plant',
      intendedUse: 'Supplement',
      storage: 'Cool dry',
      consumptionClassification: 'food',
      ingredients: ['Protein'],
      allergens: [],
      nutrition: {},
      servingSize: '30g',
      dietaryAttributes: [],
      flavour: 'Chocolate',
      servings: 20,
      proteinPerServing: 25,
      carbsPerServing: 5,
    },
    consumptionClassification: 'food',
    mixingGroup: 'food-grade',
    priceRange: { min: 2500, max: 5000 },
    baseAvailability: 'in_stock',
  };
  assert.equal(Value.Check(ProductWithVariants, pwv), true);
  assert.equal(Value.Check(ProductWithVariants, { ...pwv, mixingGroup: null }), true);
  assert.equal(Value.Check(ProductWithVariants, { ...pwv, variants: [] }), false);
  assert.equal(Value.Check(ProductWithVariants, { ...pwv, extra: true }), false);
});

// ---------------------------------------------------------------------------
// Cart variant snap and mixing group mismatch
// ---------------------------------------------------------------------------

void test('CartLineVariantSnap validates variant details', () => {
  const snap = {
    variantId: 1,
    sku: 'SN-0001-001',
    label: '500g Tub',
    weightGrams: 500,
    deliveryClass: 'parcel',
  };
  assert.equal(Value.Check(CartLineVariantSnap, snap), true);
  assert.equal(Value.Check(CartLineVariantSnap, { ...snap, deliveryClass: 'express' }), false);
});

void test('CartLine requires server-resolved pack and base tonne prices', () => {
  const line = {
    productId: '1',
    configKey: '',
    product,
    variantSnap: {
      variantId: 1,
      sku: 'SN-0001-001',
      label: '500g Tub',
      weightGrams: 500,
      deliveryClass: 'parcel',
    },
    perTonneCents: 5_000_000,
    resolvedUnitPriceCents: 2_375,
    quantity: 10,
    materialSubtotalCents: 23_750,
    blendingFeeCents: 0,
    discountableTotalCents: 23_750,
    lineTotalCents: 23_750,
  };
  assert.equal(Value.Check(CartLine, line), true);
  const withoutResolvedPrices = { ...line };
  delete (withoutResolvedPrices as Partial<typeof withoutResolvedPrices>).perTonneCents;
  assert.equal(Value.Check(CartLine, withoutResolvedPrices), false);
  assert.equal(Value.Check(CartLine, { ...line, resolvedUnitPriceCents: -1 }), false);
});

void test('AddToCartBody accepts an optional positive quantity and rejects extras', () => {
  assert.equal(Value.Check(AddToCartBody, { productId: '1', variantId: 1 }), true);
  assert.equal(Value.Check(AddToCartBody, { productId: '1', variantId: 1, quantity: 4 }), true);
  assert.equal(Value.Check(AddToCartBody, { productId: '1', quantity: 0 }), false);
  assert.equal(
    Value.Check(AddToCartBody, { productId: '1', quantity: Number.MAX_SAFE_INTEGER }),
    true,
  );
  assert.equal(
    Value.Check(AddToCartBody, { productId: '1', quantity: Number.MAX_SAFE_INTEGER + 1 }),
    false,
  );
  assert.equal(Value.Check(AddToCartBody, { productId: '1', quantity: 1.5 }), false);
  assert.equal(Value.Check(AddToCartBody, { productId: '1', quantity: 1, extra: true }), false);
});

void test('UpdateCartLineBody allows zero removal but rejects unsafe quantities', () => {
  assert.equal(Value.Check(UpdateCartLineBody, { productId: '1', quantity: 0 }), true);
  assert.equal(
    Value.Check(UpdateCartLineBody, { productId: '1', variantId: 1, quantity: 4 }),
    true,
  );
  assert.equal(
    Value.Check(UpdateCartLineBody, { productId: '1', variantId: 0, quantity: 4 }),
    false,
  );
  assert.equal(
    Value.Check(UpdateCartLineBody, {
      productId: '1',
      variantId: Number.MAX_SAFE_INTEGER + 1,
      quantity: 4,
    }),
    false,
  );
  assert.equal(
    Value.Check(UpdateCartLineBody, { productId: '1', quantity: Number.MAX_SAFE_INTEGER }),
    true,
  );
  assert.equal(
    Value.Check(UpdateCartLineBody, { productId: '1', quantity: Number.MAX_SAFE_INTEGER + 1 }),
    false,
  );
  assert.equal(Value.Check(UpdateCartLineBody, { productId: '1', quantity: 1.5 }), false);
});

void test('RemoveFromCartBody supports optional safe variant targeting', () => {
  assert.equal(Value.Check(RemoveFromCartBody, { productId: '1' }), true);
  assert.equal(Value.Check(RemoveFromCartBody, { productId: '1', variantId: 1 }), true);
  assert.equal(Value.Check(RemoveFromCartBody, { productId: '1', variantId: 0 }), false);
  assert.equal(
    Value.Check(RemoveFromCartBody, { productId: '1', variantId: Number.MAX_SAFE_INTEGER + 1 }),
    false,
  );
});

void test('BelowMoqError exposes a strict typed cart error', () => {
  assert.equal(
    Value.Check(BelowMoqError, {
      code: 'BELOW_MOQ',
      error: 'Minimum order quantity is four sacks',
    }),
    true,
  );
  assert.equal(Value.Check(BelowMoqError, { code: 'SOME_OTHER_CODE', error: 'No' }), false);
  assert.equal(Value.Check(BelowMoqError, { code: 'BELOW_MOQ', error: 'No', extra: true }), false);
});

// ---------------------------------------------------------------------------
// v6 persisted checkout quote
// ---------------------------------------------------------------------------

const variantLine = {
  productId: '1',
  variantId: 1,
  productName: 'Protein Powder',
  variantLabel: '500g Tub',
  unitPriceCents: 2500,
  weightGrams: 500,
  deliveryClass: 'parcel',
  consumptionClassification: 'food',
  quantity: 1,
  lineTotalCents: 2500,
};

void test('PersistedCheckoutQuoteV8 roundtrip with variant lines and delivery', () => {
  const subtotal = variantLine.lineTotalCents;
  const deliveryCharge = 999;
  const total = subtotal + deliveryCharge;

  const v8 = {
    version: 8,
    ...baseQuote,
    subtotalCents: subtotal,
    discountBaseCents: subtotal,
    promoCategoryScope: null,
    totalCents: total,
    variantLines: [variantLine],
    deliverySummary: {
      mode: 'freight',
      chargeCents: deliveryCharge,
      weightGrams: 25_500,
      reason: 'Over 100kg freight threshold',
    },
    inventoryAllocations: [{ productId: '1', reservedQuantity: 1, backorderedQuantity: 0 }],
  };
  assert.equal(Value.Check(PersistedCheckoutQuoteV8, v8), true);
  assert.deepEqual(parsePersistedCheckoutQuote(v8), v8);
  assert.equal(v8.subtotalCents, subtotal);
  assert.equal(v8.totalCents, total);
});

void test('V10 is current while prepared V8/V9 and unknown-version rejection remain enforced', () => {
  assert.equal(CURRENT_PERSISTED_CHECKOUT_QUOTE_VERSION, 10);

  const v8 = {
    version: 8,
    ...baseQuote,
    discountBaseCents: baseQuote.subtotalCents,
    promoCategoryScope: null,
    variantLines: [variantLine],
    deliverySummary: { mode: 'parcel', chargeCents: 0, weightGrams: 500, reason: 'ok' },
    inventoryAllocations: [{ productId: '1', reservedQuantity: 1, backorderedQuantity: 0 }],
  };
  assert.doesNotThrow(() => parsePersistedCheckoutQuote(v8));
  const v9 = { ...v8, version: 9 };
  assert.equal(Value.Check(PersistedCheckoutQuoteV9, v9), true);
  assert.doesNotThrow(() => parsePersistedCheckoutQuote(v9));

  for (const staleVersion of [1, 2, 3, 4, 5, 6, 7]) {
    assert.throws(() => parsePersistedCheckoutQuote({ ...v8, version: staleVersion }));
  }
  assert.throws(() => parsePersistedCheckoutQuote({ ...v9, version: 10 }));
  assert.throws(() => parsePersistedCheckoutQuote({ version: 0, ...baseQuote }));
  assert.throws(() => parsePersistedCheckoutQuote(null));
  assert.throws(() => parsePersistedCheckoutQuote(undefined));
});

void test('v7 rejects unknown persisted fields and missing variant lines', () => {
  const v7 = {
    version: 7,
    ...baseQuote,
    variantLines: [variantLine],
    deliverySummary: { mode: 'parcel', chargeCents: 0, weightGrams: 500, reason: 'ok' },
    inventoryAllocations: [{ productId: '1', reservedQuantity: 1, backorderedQuantity: 0 }],
  };
  // Any field beyond the v7 shape is rejected, including those retired with the mix line model.
  assert.equal(Value.Check(PersistedCheckoutQuoteV7, { ...v7, retiredLegacyField: [] }), false);

  const withoutVariantLines: Partial<typeof v7> = { ...v7 };
  delete withoutVariantLines.variantLines;
  assert.equal(Value.Check(PersistedCheckoutQuoteV7, withoutVariantLines), false);
});
