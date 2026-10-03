import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import {
  CartLineConfigKey,
  CustomBlendBaseListQuery,
  CustomBlendBaseListResponse,
  CustomBlendEvaluationBody,
  CustomBlendEvaluationResponse,
  CreateCustomBlendBody,
  CustomBlendOption,
  CustomBlendSnapshot,
  LegacyCustomBlendSnapshot,
  ResolvedCustomBlendSnapshot,
  ReplaceCustomBlendBody,
} from '../src/customBlends.js';
import { Cart, CartLine, RemoveFromCartBody, UpdateCartLineBody } from '../src/cart.js';
import { OrderLineItem } from '../src/orders.js';
import {
  PersistedCheckoutQuoteV8,
  PersistedCheckoutQuoteV9,
  parsePersistedCheckoutQuote,
} from '../src/payments.js';
import { CUSTOM_BLEND_FEE_CENTS, TIER_LADDER } from '../src/pricing.js';

const uuid = '123e4567-e89b-42d3-a456-426614174000';
const configKey = 'a'.repeat(64);

const customBlend = {
  configKey,
  basePercentage: 80,
  mixingGroup: 'food-grade',
  ingredients: [
    {
      variantId: 2,
      productId: '2',
      productName: 'Cocoa powder',
      productDescription: 'Unsweetened cocoa powder',
      mixingGroup: 'food-grade',
      percentage: 20,
    },
  ],
  blendingFeeCents: CUSTOM_BLEND_FEE_CENTS,
  madeToOrder: true,
  returnable: false,
};

const resolvedCustomBlend = {
  ...customBlend,
  ruleVersion: 1,
  resultClassification: 'food',
  quantity: 4,
  components: [
    {
      role: 'base',
      variantId: 1,
      productId: '1',
      productName: 'Protein powder',
      productDescription: 'Base material',
      sku: 'SN-0001-001',
      variantLabel: '25kg Sack',
      mixingGroup: 'food-grade',
      consumptionClassification: 'food',
      percentage: 80,
      weightGrams: 80_000,
      sourceUnitPriceCents: 2500,
      tierDiscountPct: 0,
      nextTierProgress: {
        minTonnes: 1,
        discountPct: 0,
        sacksToNextTier: 37,
        weightToNextTierGrams: 920_000,
      },
      unitContributionCents: 2000,
      subtotalCents: 8000,
    },
    {
      role: 'ingredient',
      variantId: 2,
      productId: '2',
      productName: 'Cocoa powder',
      productDescription: 'Unsweetened cocoa powder',
      sku: 'CO-0002-001',
      variantLabel: '25kg Sack',
      mixingGroup: 'food-grade',
      consumptionClassification: 'food',
      percentage: 20,
      weightGrams: 20_000,
      sourceUnitPriceCents: 1500,
      tierDiscountPct: 0,
      nextTierProgress: {
        minTonnes: 1,
        discountPct: 0,
        sacksToNextTier: 40,
        weightToNextTierGrams: 980_000,
      },
      unitContributionCents: 300,
      subtotalCents: 1200,
    },
  ],
  materialUnitPriceCents: 2300,
  materialSubtotalCents: 9200,
  discountableTotalCents: 9200,
  lineTotalCents: 11_700,
};

const zeroFeeResolvedCustomBlend = {
  ...resolvedCustomBlend,
  blendingFeeCents: 0,
  lineTotalCents: resolvedCustomBlend.materialSubtotalCents,
};

const product = {
  id: '1',
  name: 'Protein powder',
  description: 'Base material',
  priceCents: 2500,
  imageSetId: 'protein-powder',
  category: 'Sports Nutrition',
  stock: 10,
  availability: 'in_stock',
  backorderable: false,
  backorderLeadDays: null,
  slug: 'protein-powder',
  salesCount: 1,
  createdAt: '2026-07-25T00:00:00.000Z',
  available: true,
  tags: [],
  specificationGroups: [],
};

void test('Custom Blend inputs enforce integer percentage bounds and strict config keys', () => {
  const create = { baseVariantId: 1, ingredients: [{ variantId: 2, percentage: 20 }] };
  assert.equal(Value.Check(CreateCustomBlendBody, create), true);
  assert.equal(Value.Check(CreateCustomBlendBody, { ...create, ingredients: [] }), false);
  assert.equal(
    Value.Check(CreateCustomBlendBody, {
      ...create,
      ingredients: [{ variantId: 2, percentage: 4 }],
    }),
    false,
  );
  assert.equal(
    Value.Check(CreateCustomBlendBody, {
      ...create,
      ingredients: [{ variantId: 2, percentage: 20.5 }],
    }),
    false,
  );
  assert.equal(Value.Check(CartLineConfigKey, ''), true);
  assert.equal(Value.Check(CartLineConfigKey, configKey), true);
  assert.equal(Value.Check(CartLineConfigKey, configKey.toUpperCase()), false);
  assert.equal(Value.Check(CartLineConfigKey, 'not-a-config-key'), false);
  assert.equal(
    Value.Check(ReplaceCustomBlendBody, { ...create, configKey, unexpected: true }),
    false,
  );
});

void test('Custom Blend snapshot carries fee and non-returnable made-to-order facts', () => {
  assert.equal(CUSTOM_BLEND_FEE_CENTS, 2500);
  assert.equal(Value.Check(LegacyCustomBlendSnapshot, customBlend), true);
  assert.equal(Value.Check(CustomBlendSnapshot, customBlend), true);
  assert.equal(
    Value.Check(CustomBlendSnapshot, {
      ...customBlend,
      blendingFeeCents: Number.MAX_SAFE_INTEGER + 1,
    }),
    false,
  );
  assert.equal(Value.Check(CustomBlendSnapshot, { ...customBlend, madeToOrder: false }), false);
  assert.equal(Value.Check(CustomBlendSnapshot, { ...customBlend, returnable: true }), false);
});

void test('resolved Custom Blend snapshots freeze component facts and reject tampering', () => {
  assert.equal(Value.Check(ResolvedCustomBlendSnapshot, resolvedCustomBlend), true);
  assert.equal(
    Value.Check(ResolvedCustomBlendSnapshot, {
      ...resolvedCustomBlend,
      resultClassification: 'non-food',
    }),
    false,
  );
  assert.equal(Value.Check(CustomBlendSnapshot, resolvedCustomBlend), true);
  assert.equal(Value.Check(ResolvedCustomBlendSnapshot, zeroFeeResolvedCustomBlend), false);
  assert.equal(Value.Check(CustomBlendSnapshot, zeroFeeResolvedCustomBlend), false);
  assert.equal(
    Value.Check(ResolvedCustomBlendSnapshot, {
      ...resolvedCustomBlend,
      materialSubtotalCents: 9201,
    }),
    false,
  );
  assert.equal(
    Value.Check(ResolvedCustomBlendSnapshot, {
      ...resolvedCustomBlend,
      components: [
        { ...resolvedCustomBlend.components[0], unexpected: true },
        resolvedCustomBlend.components[1],
      ],
    }),
    false,
  );
  assert.equal(
    Value.Check(ResolvedCustomBlendSnapshot, {
      ...resolvedCustomBlend,
      components: [
        { ...resolvedCustomBlend.components[0], sourceUnitPriceCents: Number.MAX_SAFE_INTEGER + 1 },
        resolvedCustomBlend.components[1],
      ],
    }),
    false,
  );
  assert.equal(
    Value.Check(ResolvedCustomBlendSnapshot, {
      ...resolvedCustomBlend,
      components: [
        resolvedCustomBlend.components[0],
        { ...resolvedCustomBlend.components[1], subtotalCents: 1201 },
      ],
    }),
    false,
  );
  assert.equal(
    Value.Check(ResolvedCustomBlendSnapshot, {
      ...resolvedCustomBlend,
      components: [null, resolvedCustomBlend.components[1]],
    }),
    false,
  );
});

void test('Custom Blend base presentation is optional for legacy snapshots and strict when present', () => {
  const basePresentation = {
    category: 'Trade & Creative Materials',
    consumptionClassification: 'non-food',
    categoryFacts: {
      texture: 'Fine powder',
      colour: 'White',
      source: 'Mineral',
      intendedUse: 'Construction',
      storage: 'Cool dry',
      consumptionClassification: 'non-food',
    },
  };
  assert.equal(Value.Check(CustomBlendSnapshot, customBlend), true);
  assert.equal(Value.Check(CustomBlendSnapshot, { ...customBlend, basePresentation }), true);
  assert.equal(
    Value.Check(CustomBlendSnapshot, {
      ...customBlend,
      basePresentation: { ...basePresentation, unexpected: true },
    }),
    false,
  );
  assert.equal(
    Value.Check(CustomBlendSnapshot, {
      ...customBlend,
      basePresentation: { ...basePresentation, categoryFacts: { texture: 'incomplete' } },
    }),
    false,
  );
});

void test('Custom Blend options require presentation facts and reject unknown properties', () => {
  const option = {
    productId: '1',
    productName: product.name,
    productDescription: product.description,
    category: 'Sports Nutrition',
    consumptionClassification: 'food',
    categoryFacts: {
      texture: 'Fine powder',
      colour: 'White',
      source: 'Plant',
      intendedUse: 'Supplement',
      storage: 'Cool dry',
      consumptionClassification: 'food',
    },
    mixingGroup: 'food-grade',
    variant: {
      variantId: 1,
      productId: 1,
      sku: 'SN-0001-001',
      label: '25kg Sack',
      weightGrams: 25_000,
      priceCents: 2500,
      moqSacks: 1,
      perTonneCents: 100_000,
      priceTiers: TIER_LADDER,
      stockCount: 10,
      backorderable: false,
      backorderLeadDays: null,
      deliveryClass: 'parcel',
      active: true,
      sortOrder: 1,
    },
  };

  assert.equal(Value.Check(CustomBlendOption, option), true);
  assert.equal(Value.Check(CustomBlendOption, { ...option, category: '' }), true);
  assert.equal(Value.Check(CustomBlendOption, { ...option, category: 'x'.repeat(161) }), true);
  assert.equal(Value.Check(CustomBlendOption, { ...option, category: undefined }), false);
  assert.equal(
    Value.Check(CustomBlendOption, { ...option, consumptionClassification: undefined }),
    false,
  );
  assert.equal(Value.Check(CustomBlendOption, { ...option, categoryFacts: undefined }), false);
  assert.equal(Value.Check(CustomBlendOption, { ...option, unexpected: true }), false);

  assert.equal(Value.Check(CustomBlendBaseListQuery, {}), true);
  assert.equal(
    Value.Check(CustomBlendBaseListQuery, {
      q: 'cement',
      category: 'Trade',
      page: 1,
      pageSize: 24,
    }),
    true,
  );
  assert.equal(Value.Check(CustomBlendBaseListQuery, { unexpected: true }), false);
  assert.equal(Value.Check(CustomBlendBaseListQuery, { page: 0 }), false);
  assert.equal(
    Value.Check(CustomBlendBaseListQuery, { pageSize: Number.MAX_SAFE_INTEGER + 1 }),
    false,
  );
  assert.equal(
    Value.Check(CustomBlendBaseListResponse, { items: [option], total: 1, page: 1, pageSize: 48 }),
    true,
  );
  assert.equal(
    Value.Check(CustomBlendBaseListResponse, {
      items: [option],
      total: 1,
      page: 1,
      pageSize: 48,
      unexpected: true,
    }),
    false,
  );

  const evaluationBody = {
    baseVariantId: 1,
    ingredients: [{ variantId: 2, percentage: 20 }],
    quantity: 4,
  };
  assert.equal(Value.Check(CustomBlendEvaluationBody, evaluationBody), true);
  assert.equal(Value.Check(CustomBlendEvaluationBody, { ...evaluationBody, unknown: true }), false);
  assert.equal(
    Value.Check(CustomBlendEvaluationBody, {
      ...evaluationBody,
      quantity: Number.MAX_SAFE_INTEGER + 1,
    }),
    false,
  );
  assert.equal(
    Value.Check(CustomBlendEvaluationResponse, { quantity: 4, customBlend: resolvedCustomBlend }),
    true,
  );
  assert.equal(
    Value.Check(CustomBlendEvaluationResponse, {
      quantity: 5,
      customBlend: resolvedCustomBlend,
    }),
    false,
  );
});

void test('configured cart and order lines expose money split and specification', () => {
  const line = {
    productId: '1',
    configKey,
    product,
    variantSnap: {
      variantId: 1,
      sku: 'SN-0001-001',
      label: '25kg Sack',
      weightGrams: 25_000,
      deliveryClass: 'parcel',
    },
    perTonneCents: 100_000,
    resolvedUnitPriceCents: 2300,
    quantity: 4,
    materialSubtotalCents: 9200,
    blendingFeeCents: 2500,
    discountableTotalCents: 9200,
    lineTotalCents: 11_700,
    customBlend: resolvedCustomBlend,
  };
  assert.equal(Value.Check(CartLine, line), true);
  const zeroFeeLine = {
    ...line,
    blendingFeeCents: 0,
    lineTotalCents: line.materialSubtotalCents,
    customBlend: zeroFeeResolvedCustomBlend,
  };
  assert.equal(Value.Check(CartLine, zeroFeeLine), false);
  assert.equal(
    Value.Check(CartLine, {
      ...line,
      nextTierProgress: {
        minTonnes: 1,
        discountPct: 0,
        sacksToNextTier: 36,
        weightToNextTierGrams: 900_000,
      },
    }),
    false,
  );
  assert.equal(
    Value.Check(CartLine, {
      ...line,
      nextTierProgress: {
        minTonnes: 1,
        discountPct: 0,
        sacksToNextTier: 0,
        weightToNextTierGrams: 900_000,
      },
    }),
    false,
  );
  assert.equal(
    Value.Check(CartLine, { ...line, materialSubtotalCents: Number.MAX_SAFE_INTEGER + 1 }),
    false,
  );
  assert.equal(
    Value.Check(CartLine, { ...line, blendingFeeCents: Number.MAX_SAFE_INTEGER + 1 }),
    false,
  );
  assert.equal(
    Value.Check(CartLine, { ...line, discountableTotalCents: Number.MAX_SAFE_INTEGER + 1 }),
    false,
  );
  assert.equal(
    Value.Check(CartLine, { ...line, lineTotalCents: Number.MAX_SAFE_INTEGER + 1 }),
    false,
  );
  assert.equal(Value.Check(CartLine, { ...line, configKey: '' }), false);
  assert.equal(Value.Check(CartLine, { ...line, customBlend: undefined }), false);
  assert.equal(
    Value.Check(CartLine, { ...line, customBlend: { ...customBlend, configKey: 'b'.repeat(64) } }),
    false,
  );
  const plainLine = { ...line, configKey: '' };
  delete (plainLine as { customBlend?: unknown }).customBlend;
  assert.equal(Value.Check(CartLine, plainLine), true);
  const cart = {
    id: uuid,
    items: [line],
    subtotalCents: 11_700,
    discountableSubtotalCents: 9200,
    blendingFeeTotalCents: 2500,
    totalItems: 4,
  };
  assert.equal(Value.Check(Cart, cart), true);
  assert.equal(
    Value.Check(Cart, {
      ...cart,
      items: [zeroFeeLine],
      subtotalCents: line.materialSubtotalCents,
      blendingFeeTotalCents: 0,
    }),
    false,
  );
  assert.equal(
    Value.Check(Cart, { ...cart, discountableSubtotalCents: Number.MAX_SAFE_INTEGER + 1 }),
    false,
  );
  assert.equal(
    Value.Check(Cart, { ...cart, blendingFeeTotalCents: Number.MAX_SAFE_INTEGER + 1 }),
    false,
  );
  assert.equal(Value.Check(UpdateCartLineBody, { productId: '1', configKey, quantity: 4 }), true);
  assert.equal(Value.Check(RemoveFromCartBody, { productId: '1', configKey }), true);
  assert.equal(
    Value.Check(UpdateCartLineBody, { productId: '1', quantity: 4, unexpected: true }),
    false,
  );
  assert.equal(Value.Check(RemoveFromCartBody, { productId: '1', unexpected: true }), false);
  const orderLine = {
    lineId: '1',
    productId: '1',
    productName: product.name,
    unitPriceCents: 2500,
    quantity: 4,
    discountableTotalCents: 10_000,
    blendingFeeCents: 2500,
    lineTotalCents: 12_500,
    inventoryStatus: 'allocated',
    allocatedQuantity: 4,
    backorderedQuantity: 0,
    customBlend,
  };
  assert.equal(Value.Check(OrderLineItem, orderLine), true);
  assert.equal(
    Value.Check(OrderLineItem, {
      ...orderLine,
      discountableTotalCents: Number.MAX_SAFE_INTEGER + 1,
    }),
    false,
  );
  assert.equal(
    Value.Check(OrderLineItem, { ...orderLine, blendingFeeCents: Number.MAX_SAFE_INTEGER + 1 }),
    false,
  );
  assert.equal(
    Value.Check(OrderLineItem, { ...orderLine, lineTotalCents: Number.MAX_SAFE_INTEGER + 1 }),
    false,
  );
});

void test('V8/V9 round-trip configured variant lines and reject stale or malformed quotes', () => {
  const address = {
    line1: '1 Example Street',
    city: 'London',
    postcode: 'EC1A 1BB',
    countryCode: 'GB',
  };
  const plain = {
    version: 8,
    cartId: uuid,
    customer: {
      name: 'Ada',
      email: 'ada@example.test',
      deliveryAddress: address,
      shippingAddress: '1 Example Street, London, EC1A 1BB, GB',
    },
    userId: null,
    promoCode: null,
    subtotalCents: 2500,
    discountCents: 0,
    discountBaseCents: 2500,
    promoCategoryScope: null,
    totalCents: 2500,
    lines: [],
    createdAt: '2026-07-25T00:00:00.000Z',
    variantLines: [
      {
        productId: '1',
        variantId: 1,
        productName: product.name,
        variantLabel: '25kg Sack',
        unitPriceCents: 2500,
        weightGrams: 25_000,
        deliveryClass: 'parcel',
        quantity: 1,
        lineTotalCents: 2500,
        consumptionClassification: 'food',
      },
    ],
    deliverySummary: { mode: 'parcel', chargeCents: 0, weightGrams: 25_000, reason: 'ok' },
    inventoryAllocations: [{ productId: '1', reservedQuantity: 1, backorderedQuantity: 0 }],
    billingEntity: {
      legalName: 'Example Trading Ltd',
      registrationNumber: null,
      vatNumber: null,
      address,
    },
    deliverySlot: { date: '2026-08-03', window: 'pm' },
    purchaseOrderReference: 'PO-4471',
  };
  assert.equal(Value.Check(PersistedCheckoutQuoteV8, plain), true);
  const configured = {
    ...plain,
    subtotalCents: 12_500,
    totalCents: 12_500,
    discountBaseCents: 10_000,
    variantLines: [
      {
        ...plain.variantLines[0],
        quantity: 4,
        materialSubtotalCents: 10_000,
        blendingFeeCents: 2500,
        discountableTotalCents: 10_000,
        lineTotalCents: 12_500,
        customBlend,
      },
    ],
  };
  assert.equal(Value.Check(PersistedCheckoutQuoteV8, configured), true);
  for (const monetaryField of [
    'materialSubtotalCents',
    'blendingFeeCents',
    'discountableTotalCents',
    'lineTotalCents',
  ] as const) {
    assert.equal(
      Value.Check(PersistedCheckoutQuoteV8, {
        ...configured,
        variantLines: [
          { ...configured.variantLines[0], [monetaryField]: Number.MAX_SAFE_INTEGER + 1 },
        ],
      }),
      false,
    );
  }
  assert.deepEqual(parsePersistedCheckoutQuote(configured), configured);
  assert.throws(() => parsePersistedCheckoutQuote({ ...plain, version: 7 }));

  const configuredV9 = {
    ...configured,
    version: 9,
    subtotalCents: 11_700,
    totalCents: 11_700,
    discountBaseCents: 9200,
    variantLines: [
      {
        ...configured.variantLines[0],
        unitPriceCents: 2300,
        materialSubtotalCents: 9200,
        blendingFeeCents: 2500,
        discountableTotalCents: 9200,
        lineTotalCents: 11_700,
        customBlend: resolvedCustomBlend,
      },
    ],
  };
  assert.equal(Value.Check(PersistedCheckoutQuoteV9, configuredV9), true);
  assert.equal(
    Value.Check(PersistedCheckoutQuoteV9, {
      ...configuredV9,
      variantLines: [{ ...configuredV9.variantLines[0], productId: '2' }],
    }),
    false,
  );
  assert.deepEqual(parsePersistedCheckoutQuote(configuredV9), configuredV9);
  assert.equal(Value.Check(PersistedCheckoutQuoteV8, { ...configuredV9, version: 8 }), false);
  assert.equal(
    Value.Check(PersistedCheckoutQuoteV9, {
      ...configuredV9,
      variantLines: [{ ...configuredV9.variantLines[0], customBlend }],
    }),
    false,
  );
  const incompleteConfiguredLine = { ...configuredV9.variantLines[0] };
  Reflect.deleteProperty(incompleteConfiguredLine, 'blendingFeeCents');
  assert.equal(
    Value.Check(PersistedCheckoutQuoteV9, {
      ...configuredV9,
      variantLines: [incompleteConfiguredLine],
    }),
    false,
  );
  assert.equal(
    Value.Check(PersistedCheckoutQuoteV9, {
      ...configuredV9,
      variantLines: [{ ...configuredV9.variantLines[0], unitPriceCents: 2301 }],
    }),
    false,
  );
  assert.equal(
    Value.Check(PersistedCheckoutQuoteV9, {
      ...configuredV9,
      variantLines: [
        {
          ...configuredV9.variantLines[0],
          customBlend: { ...resolvedCustomBlend, lineTotalCents: 11_701 },
        },
      ],
    }),
    false,
  );
});
