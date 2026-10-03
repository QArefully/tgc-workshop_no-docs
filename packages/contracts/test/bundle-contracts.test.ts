import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import {
  AddBundleToCartBody,
  BundleMutationConflictResponse,
  BundleUnavailableConflictResponse,
  CuratedBundle,
  CuratedBundleListQuery,
  CuratedBundleListResponse,
} from '../src/bundles.js';

const product = {
  id: '1',
  name: 'Protein Powder',
  description: 'A test product',
  priceCents: 2500,
  imageSetId: 'protein-powder',
  category: 'Performance',
  stock: 5,
  availability: 'in_stock',
  backorderable: false,
  backorderLeadDays: null,
  slug: 'protein-powder',
  salesCount: 10,
  createdAt: '2026-07-14T00:00:00.000Z',
  available: true,
  tags: [],
  specificationGroups: [],
};

const bundle = {
  id: '1',
  key: 'powder-starter-set',
  name: 'Powder starter set',
  description: 'Three everyday powders.',
  components: [
    { product, quantity: 1, lineTotalCents: 2500 },
    { product: { ...product, id: '2', slug: 'powdered-oats' }, quantity: 1, lineTotalCents: 900 },
  ],
  totalCents: 3400,
  available: true,
};

void test('curated bundle read transport accepts current component facts', () => {
  assert.equal(Value.Check(CuratedBundle, bundle), true);
  assert.equal(Value.Check(CuratedBundleListResponse, [bundle]), true);
  assert.equal(Value.Check(CuratedBundle, { ...bundle, totalCents: -1 }), false);
  assert.equal(
    Value.Check(CuratedBundle, { ...bundle, components: bundle.components.slice(0, 1) }),
    false,
  );
  assert.equal(
    Value.Check(CuratedBundle, {
      ...bundle,
      components: [{ ...bundle.components[0], quantity: 0 }],
    }),
    false,
  );
  assert.equal(Value.Check(CuratedBundle, { ...bundle, priceCents: 1 }), false);
});

void test('bundle list query is product-id-only and strict', () => {
  assert.equal(Value.Check(CuratedBundleListQuery, {}), true);
  assert.equal(Value.Check(CuratedBundleListQuery, { productId: '27' }), true);
  assert.equal(Value.Check(CuratedBundleListQuery, { productId: '0' }), false);
  assert.equal(Value.Check(CuratedBundleListQuery, { productId: '27', active: true }), false);
});

void test('bundle cart mutation accepts only bundle ID', () => {
  assert.equal(Value.Check(AddBundleToCartBody, { bundleId: '1' }), true);
  for (const body of [
    { bundleId: '0' },
    { bundleId: '1', priceCents: 1 },
    { bundleId: '1', components: [] },
    { bundleId: '1', quantity: 2 },
    { bundleId: '1', discountCents: 100 },
    { bundleId: '1', available: true },
  ]) {
    assert.equal(Value.Check(AddBundleToCartBody, body), false);
  }
});

void test('bundle unavailable conflict reports unique affected product IDs', () => {
  const unavailable = {
    code: 'BUNDLE_UNAVAILABLE',
    error: 'One or more bundle products are unavailable',
    productIds: ['2', '7'],
  };
  assert.equal(Value.Check(BundleUnavailableConflictResponse, unavailable), true);
  assert.equal(Value.Check(BundleMutationConflictResponse, unavailable), true);
  assert.equal(
    Value.Check(BundleUnavailableConflictResponse, { ...unavailable, productIds: ['2', '2'] }),
    false,
  );
  assert.equal(
    Value.Check(BundleUnavailableConflictResponse, { ...unavailable, productIds: [] }),
    false,
  );
  assert.equal(
    Value.Check(BundleUnavailableConflictResponse, { ...unavailable, code: 'OUT_OF_STOCK' }),
    false,
  );
  assert.equal(
    Value.Check(BundleUnavailableConflictResponse, { ...unavailable, quantity: 1 }),
    false,
  );
  assert.equal(Value.Check(BundleMutationConflictResponse, { error: 'Cart is reserved' }), true);
});
