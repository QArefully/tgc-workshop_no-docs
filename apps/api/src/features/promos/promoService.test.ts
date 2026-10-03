import assert from 'node:assert/strict';
import test from 'node:test';
import type { Cart } from '@shop/contracts/cart';
import type { Country } from '@shop/contracts/country';
import type { CartRepository, CartLineRow } from '../cart/cartRepository.js';
import type { PromoRecord, PromoRepository } from './promoRepository.js';

import { calculateDiscount, resolvePromoScope, validatePromo } from './promoService.js';

function cartForScope(
  lines: ReadonlyArray<{ category: string; quantity: number; discountableTotalCents: number }>,
): Cart {
  const discountableSubtotalCents = lines.reduce(
    (total, line) => total + line.discountableTotalCents,
    0,
  );
  return {
    id: 'cart',
    items: lines.map((line) => ({
      product: { category: line.category },
      quantity: line.quantity,
      discountableTotalCents: line.discountableTotalCents,
    })),
    subtotalCents: discountableSubtotalCents,
    discountableSubtotalCents,
    blendingFeeTotalCents: 0,
    totalItems: lines.reduce((total, line) => total + line.quantity, 0),
  } as Cart;
}

function cartLine(category: string, quantity: number, priceCents: number): CartLineRow {
  return {
    variant_id: 1,
    config_key: '',
    custom_blend_json: null,
    product_id: 1,
    quantity,
    price_cents: priceCents,
    product_name: 'Test product',
    product_description: 'Test product description',
    product_category: category,
    product_image_set_id: null,
    product_slug: 'test-product',
    product_compare_at_price_cents: null,
    product_sales_count: 0,
    product_active: 1,
    product_created_at: '2026-01-01 00:00:00',
    product_consumption_classification: 'non-food',
    variant_sku: 'TEST-001',
    variant_label: '25 kg',
    variant_weight_grams: 25_000,
    variant_moq_sacks: 1,
    variant_delivery_class: 'parcel',
    variant_backorderable: 0,
    variant_backorder_lead_days: null,
    variant_active: 1,
    product_default_variant_id: 1,
    product_blend_source_variant_id: null,
  };
}

function cartsWithCountry(country: Country, ...lines: CartLineRow[]): CartRepository {
  return {
    exists: () => true,
    country: () => country,
    listLines: () => lines,
  } as unknown as CartRepository;
}

function cartsWith(...lines: CartLineRow[]): CartRepository {
  return cartsWithCountry('UK', ...lines);
}

function promo(overrides: Partial<PromoRecord> = {}): PromoRecord {
  return {
    code: 'TEST',
    discountPercent: 10,
    minItemCount: 0,
    active: true,
    kind: 'percent',
    amountCents: null,
    minSubtotalCents: null,
    categoryScope: null,
    startAt: null,
    endAt: null,
    maxRedemptions: null,
    redemptionCount: 0,
    perUserLimit: null,
    ...overrides,
  };
}

function promosWith(record: PromoRecord): PromoRepository {
  return {
    findByCode: () => record,
    targetedCountries: () => record.countries ?? [],
    redemptionCountForUser: () => 0,
    activeReservationCount: () => 0,
    activeReservationCountForUser: () => 0,
  } as unknown as PromoRepository;
}

void test('targeted promos apply only for the persisted cart country and disclose no scope', () => {
  const targeted = promo({ code: 'LOCAL10', countries: ['UK'] });
  const dependencies = {
    carts: cartsWith(cartLine('Drinks', 1, 100)),
    promos: promosWith(targeted),
  };
  assert.equal(
    validatePromo(
      {
        code: 'LOCAL10',
        cartId: 'cart',
        userId: null,
        country: 'UK',
        now: new Date('2026-07-28T00:00:00.000Z'),
      },
      dependencies,
    ).valid,
    true,
  );
  const outside = validatePromo(
    {
      code: 'LOCAL10',
      cartId: 'cart',
      userId: null,
      country: 'US',
      now: new Date('2026-07-28T00:00:00.000Z'),
    },
    { ...dependencies, carts: cartsWithCountry('US', cartLine('Drinks', 1, 100)) },
  );
  const unknown = validatePromo(
    {
      code: 'UNKNOWN',
      cartId: 'cart',
      userId: null,
      country: 'US',
      now: new Date('2026-07-28T00:00:00.000Z'),
    },
    {
      ...dependencies,
      promos: {
        ...promosWith(promo({ code: 'UNKNOWN' })),
        findByCode: () => undefined,
      },
    },
  );
  assert.deepEqual(outside, unknown);
});

void test('percentage discount uses integer cents and rounds down', () => {
  assert.equal(
    calculateDiscount({
      promo: { kind: 'percent', discountPercent: 15 },
      discountableSubtotalCents: 999,
    }),
    149,
  );
});

void test('fixed discount does not exceed subtotal', () => {
  assert.equal(
    calculateDiscount({
      promo: { kind: 'fixed', discountPercent: 0, amountCents: 1_000 },
      discountableSubtotalCents: 499,
    }),
    499,
  );
});

void test('percentage discount ignores blending fees excluded from the discountable base', () => {
  // Cart subtotal 12_500 = 10_000 material + 2_500 blending fee. Only material is discountable.
  assert.equal(
    calculateDiscount({
      promo: { kind: 'percent', discountPercent: 10 },
      discountableSubtotalCents: 10_000,
    }),
    1_000,
  );
});

void test('fixed discount is capped by the discountable subtotal, not the fee-inclusive subtotal', () => {
  assert.equal(
    calculateDiscount({
      promo: { kind: 'fixed', discountPercent: 0, amountCents: 11_000 },
      discountableSubtotalCents: 10_000,
    }),
    10_000,
  );
});

void test('unscoped promos preserve cart totals exactly, including SAVE10 five-item eligibility', () => {
  const cart = cartForScope([{ category: 'Drinks', quantity: 5, discountableTotalCents: 12_345 }]);
  assert.deepEqual(resolvePromoScope({ promo: {}, cart }), {
    qualifyingItemCount: 5,
    discountBaseCents: 12_345,
  });

  const result = validatePromo(
    { code: 'SAVE10', cartId: 'cart', userId: null, now: new Date('2026-07-28T00:00:00.000Z') },
    {
      carts: cartsWith(cartLine('Drinks', 5, 12_345)),
      promos: promosWith(promo({ code: 'SAVE10', minItemCount: 5 })),
    },
  );
  assert.deepEqual(result, {
    valid: true,
    promoCode: {
      code: 'SAVE10',
      discountPercent: 10,
      minItemCount: 5,
      kind: 'percent',
      amountCents: undefined,
      minSubtotalCents: undefined,
    },
  });
});

void test('scoped promos match categories case-insensitively and exclude blending fees from the base', () => {
  const cart = cartForScope([
    { category: 'garden & outdoors', quantity: 2, discountableTotalCents: 8_000 },
    { category: 'Drinks', quantity: 4, discountableTotalCents: 12_000 },
  ]);
  assert.deepEqual(resolvePromoScope({ promo: { categoryScope: 'Garden & Outdoors' }, cart }), {
    qualifyingItemCount: 2,
    discountBaseCents: 8_000,
  });

  assert.equal(
    calculateDiscount({
      promo: { kind: 'fixed', discountPercent: 0, amountCents: 9_000 },
      discountableSubtotalCents: 8_000,
    }),
    8_000,
  );
});

void test('category mismatch takes precedence over scoped item and subtotal gates', () => {
  const result = validatePromo(
    { code: 'GARDEN', cartId: 'cart', userId: null, now: new Date('2026-07-28T00:00:00.000Z') },
    {
      carts: cartsWith(cartLine('Drinks', 1, 100)),
      promos: promosWith(
        promo({
          code: 'GARDEN',
          categoryScope: 'Garden & Outdoors',
          minItemCount: 5,
          minSubtotalCents: 10_000,
        }),
      ),
    },
  );
  assert.deepEqual(result, {
    valid: false,
    error: 'This promo code applies only to Garden & Outdoors products',
    errorCode: 'CATEGORY_MISMATCH',
  });
});

void test('scoped gates use matching lines only', () => {
  const result = validatePromo(
    { code: 'GARDEN', cartId: 'cart', userId: null, now: new Date('2026-07-28T00:00:00.000Z') },
    {
      carts: cartsWith(cartLine('Garden & Outdoors', 1, 100), cartLine('Drinks', 10, 50_000)),
      promos: promosWith(
        promo({ code: 'GARDEN', categoryScope: 'Garden & Outdoors', minItemCount: 2 }),
      ),
    },
  );
  assert.equal(result.valid, false);
  if (result.valid) return;
  assert.equal(result.errorCode, 'MIN_ITEMS');
});

void test('scoped subtotal gate ignores nonmatching merchandise', () => {
  const result = validatePromo(
    { code: 'GARDEN', cartId: 'cart', userId: null, now: new Date('2026-07-28T00:00:00.000Z') },
    {
      carts: cartsWith(cartLine('Garden & Outdoors', 2, 500), cartLine('Drinks', 10, 50_000)),
      promos: promosWith(
        promo({
          code: 'GARDEN',
          categoryScope: 'Garden & Outdoors',
          minSubtotalCents: 10_000,
        }),
      ),
    },
  );
  assert.equal(result.valid, false);
  if (result.valid) return;
  assert.equal(result.errorCode, 'MIN_SUBTOTAL');
  assert.equal(result.minSubtotalCents, 10_000);
  assert.doesNotMatch(result.error, /[$£€]/);
});
