import assert from 'node:assert/strict';
import test from 'node:test';
import { CATALOG_PRODUCTS, validateCatalog } from '@shop/catalog';

void test('canonical powder catalog satisfies grounded catalog constraints', () => {
  assert.doesNotThrow(() => validateCatalog());
  assert.equal(CATALOG_PRODUCTS.length, 100);
  assert.equal(CATALOG_PRODUCTS.filter((product) => product.onSale).length > 0, true);
  assert.equal(
    CATALOG_PRODUCTS.find((product) => product.slug === 'all-purpose-flour')?.category,
    'Baking & Pantry',
  );
  assert.equal(
    new Set(CATALOG_PRODUCTS.map((product) => product.imageSetId)).size,
    CATALOG_PRODUCTS.length,
  );
  for (const product of CATALOG_PRODUCTS) {
    assert.ok(product.variants.length >= 1, `Product ${product.slug} needs at least one variant`);
    const defaultVariant = product.variants.find((v) => v.sortOrder === 1 && v.active);
    assert.ok(defaultVariant, `Product ${product.slug} needs an active default variant`);
  }
});
