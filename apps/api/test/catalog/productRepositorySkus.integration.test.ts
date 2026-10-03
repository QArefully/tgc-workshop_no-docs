import assert from 'node:assert/strict';
import test from 'node:test';
import { createProductRepository } from '../../src/features/catalog/productRepository.js';
import { openSeededDatabase } from '../support/seededDatabase.js';

void test('SKU lookup returns product names, includes retired variants, and preserves SKU matching', (t) => {
  const { db } = openSeededDatabase(t);
  const repository = createProductRepository(db);
  // The saved-list seed retires exactly one lot so its add-to-cart journey always shows a
  // partial success; every other seeded variant stays live.
  assert.deepEqual(
    db.prepare('SELECT sku FROM product_variants WHERE active = 0 ORDER BY sku').pluck().all(),
    ['SPN-0009-002'],
  );
  const variants = db
    .prepare(
      `SELECT v.id, v.sku, v.active, p.name AS product_name
       FROM product_variants v
       INNER JOIN products p ON p.id = v.product_id
       WHERE v.active = 1
       ORDER BY v.id ASC
       LIMIT 2`,
    )
    .all() as Array<{ id: number; sku: string; active: number; product_name: string }>;
  assert.equal(variants.length, 2);

  const active = repository.findVariantsBySkus([variants[1].sku, variants[0].sku]);
  assert.deepEqual(
    active.map((variant) => [variant.id, variant.sku, variant.product_name, variant.active]),
    variants.map((variant) => [variant.id, variant.sku, variant.product_name, variant.active]),
  );
  assert.deepEqual(repository.findVariantsBySkus(['UNKNOWN-SKU']), []);
  assert.deepEqual(repository.findVariantsBySkus([]), []);
  assert.deepEqual(repository.findVariantsBySkus([variants[0].sku.toLowerCase()]), []);

  db.prepare('UPDATE product_variants SET active = 0 WHERE id = ?').run(variants[0].id);
  assert.deepEqual(
    repository
      .findVariantsBySkus([variants[0].sku])
      .map((variant) => [variant.id, variant.product_name, variant.active]),
    [[variants[0].id, variants[0].product_name, 0]],
  );
});
