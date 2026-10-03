import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ProductComparisonResponse,
  type ProductComparisonResponse as ComparisonResponse,
} from '@shop/contracts/products';
import { Value } from '@sinclair/typebox/value';
import { createSeededAppFixture } from '../support/seededDatabase.js';

void test('anonymous comparison preserves requested order and safely reports unavailable rows', async (t) => {
  const fixture = await createSeededAppFixture(t);
  const { db, app } = fixture;
  db.prepare('UPDATE products SET active = 0 WHERE id = 2').run();
  db.prepare(
    `INSERT INTO products
      (id, name, description, price_cents, category, stock_count, image_set_id, slug,
       compare_at_price_cents, sales_count, active, created_at)
     VALUES (99, 'Local comparison powder', 'Persisted local metadata', 999, 'Performance', 3,
       NULL, 'local-comparison-powder', NULL, 0, 1, '2026-07-01T00:00:00.000Z')`,
  ).run();
  db.prepare('INSERT INTO catalog_tags (key, label) VALUES (?, ?)').run(
    'comparison-local',
    'Local',
  );
  db.prepare('INSERT INTO product_tags (product_id, tag_key) VALUES (?, ?)').run(
    99,
    'comparison-local',
  );
  db.prepare(
    `INSERT INTO product_specifications (product_id, specification_key, value_key, display_value)
     VALUES (99, 'texture', 'fine', 'Fine')`,
  ).run();
  const response = await app.inject({
    method: 'GET',
    url: '/api/products/compare?ids=99,404,2,1',
  });
  assert.equal(response.statusCode, 200);
  const body = response.json<ComparisonResponse>();
  assert.equal(Value.Check(ProductComparisonResponse, body), true);
  assert.deepEqual(
    body.items.map((item) => [item.id, item.status]),
    [
      ['99', 'available'],
      ['404', 'missing'],
      ['2', 'inactive'],
      ['1', 'available'],
    ],
  );
  const inactive = body.items[2];
  assert.deepEqual(inactive, { id: '2', status: 'inactive' });
  const local = body.items[0];
  assert.equal(local?.status, 'available');
  if (local?.status === 'available') {
    assert.deepEqual(local.product.tags, [{ key: 'comparison-local', label: 'Local' }]);
    assert.deepEqual(local.product.specificationGroups[0]?.specifications, [
      { key: 'texture', label: 'Texture', valueKey: 'fine', value: 'Fine' },
    ]);
  }
});

void test('comparison accepts bounded selections and rejects malformed or unsafe IDs', async (t) => {
  const fixture = await createSeededAppFixture(t);
  const { app } = fixture;

  for (const ids of ['1,2', '1,2,3,4']) {
    const response = await app.inject({ method: 'GET', url: `/api/products/compare?ids=${ids}` });
    assert.equal(response.statusCode, 200, ids);
  }
  for (const ids of [
    '1',
    '1,2,3,4,5',
    '1,1',
    '0,1',
    '9007199254740992,1',
    '1,,2',
    '1,%202',
    '+1,2',
    'one,2',
  ]) {
    const response = await app.inject({ method: 'GET', url: `/api/products/compare?ids=${ids}` });
    assert.equal(response.statusCode, 400, ids);
    assert.equal(typeof response.json<{ error?: unknown }>().error, 'string', ids);
  }
});
