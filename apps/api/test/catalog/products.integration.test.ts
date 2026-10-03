import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  ProductListPaginatedResponse,
  ProductWithVariants,
  type ProductFilterOptionsResponse,
  SimilarProductsResponse,
} from '@shop/contracts/products';
import type { ProductWithVariants as ProductWithVariantsType } from '@shop/contracts/products';
import { Value } from '@sinclair/typebox/value';
import { buildApp } from '../../src/app.js';
import { closeDatabase, openDatabase, seedDatabase } from '../../src/db/index.js';
import { createSeededAppFixture } from '../support/seededDatabase.js';

void test('product detail returns variants and persisted facts without packaging', async (t) => {
  const { app } = await createSeededAppFixture(t);

  const response = await app.inject({ method: 'GET', url: '/api/products/1' });
  assert.equal(response.statusCode, 200);

  const product = response.json<ProductWithVariantsType>();
  assert.equal(Value.Check(ProductWithVariants, product), true);
  assert.equal('packaging' in product, false);
  assert.equal('images' in product, false);
  assert.ok(product.variants.length >= 1);
  assert.ok(product.defaultVariantId > 0);
  assert.ok(typeof product.categoryFacts === 'object');
  assert.ok(['food', 'non-food', 'caution'].includes(product.consumptionClassification));
  assert.ok(product.priceRange.min > 0);
  assert.ok(product.priceRange.max >= product.priceRange.min);
  assert.ok(
    ['in_stock', 'low_stock', 'out_of_stock', 'backorder'].includes(product.baseAvailability),
  );
  assert.match(product.createdAt ?? '', /^2025-\d{2}-\d{2}T00:00:00\.000Z$/);
  assert.equal(product.available, true);
  assert.ok((product.tags?.length ?? 0) > 0);
  assert.ok((product.specificationGroups?.length ?? 0) > 0);
});

void test('customer catalog endpoints exclude inactive products', async (t) => {
  const { db, app } = await createSeededAppFixture(t);
  db.prepare('UPDATE products SET active = 0 WHERE id = 1').run();

  assert.equal((await app.inject({ method: 'GET', url: '/api/products/1' })).statusCode, 404);
  assert.equal(
    (await app.inject({ method: 'GET', url: '/api/products/1/similar' })).statusCode,
    404,
  );
  assert.equal(
    (await app.inject({ method: 'GET', url: '/api/products/1/related' })).statusCode,
    404,
  );
  const list = await app.inject({ method: 'GET', url: '/api/products?pageSize=48' });
  assert.equal(list.statusCode, 200);
  const body = list.json<ProductListPaginatedResponse>();
  assert.equal(Value.Check(ProductListPaginatedResponse, body), true);
  assert.equal(body.total, 99);
  assert.equal(
    body.items.some((product) => product.id === '1'),
    false,
  );
});

void test('Trade catalogue list has contract-valid specification keys', async (t) => {
  const { app } = await createSeededAppFixture(t);

  const response = await app.inject({
    method: 'GET',
    url: '/api/products?category=Trade%20%26%20Creative%20Materials',
  });
  assert.equal(response.statusCode, 200);
  const body = response.json<ProductListPaginatedResponse>();
  assert.equal(Value.Check(ProductListPaginatedResponse, body), true);
  assert.equal(body.total, 15);
});

void test('similar products endpoint is deterministic and related remains its compatibility alias', async (t) => {
  const { db, app } = await createSeededAppFixture(t);
  const candidate = (
    db.prepare('SELECT id FROM products WHERE id != 1 ORDER BY id ASC LIMIT 1').get() as {
      id: number;
    }
  ).id;
  db.prepare('UPDATE products SET active = 0 WHERE id NOT IN (?, ?)').run(1, candidate);
  db.prepare(
    'UPDATE products SET category = (SELECT category FROM products WHERE id = 1), price_cents = (SELECT price_cents FROM products WHERE id = 1), active = 1 WHERE id = ?',
  ).run(candidate);
  db.prepare('UPDATE product_variants SET stock_count = 0 WHERE product_id = ?').run(candidate);

  const similar = await app.inject({ method: 'GET', url: '/api/products/1/similar' });
  const repeated = await app.inject({ method: 'GET', url: '/api/products/1/similar' });
  const related = await app.inject({ method: 'GET', url: '/api/products/1/related' });
  assert.equal(similar.statusCode, 200);
  assert.equal(repeated.statusCode, 200);
  assert.equal(related.statusCode, 200);
  assert.equal(similar.body, repeated.body);
  assert.equal(similar.body, related.body);
  const products = similar.json<SimilarProductsResponse>();
  assert.equal(Value.Check(SimilarProductsResponse, products), true);
  assert.deepEqual(
    products.map((product) => product.id),
    [String(candidate)],
  );
  assert.equal(products[0].available, false);
  assert.equal(
    products.some((product) => product.id === '1'),
    false,
  );

  assert.equal(
    (await app.inject({ method: 'GET', url: '/api/products/999/similar' })).statusCode,
    404,
  );
  assert.equal(
    (await app.inject({ method: 'GET', url: '/api/products/999/related' })).statusCode,
    404,
  );
  db.prepare('UPDATE products SET active = 0 WHERE id = 1').run();
  assert.equal(
    (await app.inject({ method: 'GET', url: '/api/products/1/similar' })).statusCode,
    404,
  );
  assert.equal(
    (await app.inject({ method: 'GET', url: '/api/products/1/related' })).statusCode,
    404,
  );
});

void test('product API normalizes legacy SQLite creation timestamps for the transport contract', async (t) => {
  const { db, app } = await createSeededAppFixture(t);
  db.prepare("UPDATE products SET created_at = '2024-12-31 23:59:59' WHERE id = 1").run();

  const response = await app.inject({ method: 'GET', url: '/api/products/1' });
  assert.equal(response.statusCode, 200);
  const product = response.json<ProductWithVariantsType>();
  assert.equal(product.createdAt, '2024-12-31T23:59:59.000Z');
  assert.equal(Value.Check(ProductWithVariants, product), true);
});

void test('catalog query validation reports deterministic 400 responses and exposes active filter options', async (t) => {
  const { db, app } = await createSeededAppFixture(t);
  db.prepare('UPDATE products SET active = 0 WHERE id = 1').run();

  const options = await app.inject({ method: 'GET', url: '/api/products/filter-options' });
  assert.equal(options.statusCode, 200);
  const detail = await app.inject({ method: 'GET', url: '/api/products/2' });
  assert.equal(detail.statusCode, 200);
  assert.equal(Value.Check(ProductWithVariants, detail.json()), true);
  const optionBody = options.json<ProductFilterOptionsResponse>();
  assert.ok(optionBody.tags.length > 0);
  assert.ok(optionBody.specificationGroups.length > 0);
  const specification = optionBody.specificationGroups[0]?.specifications[0];
  assert.ok(specification?.values[0]);
  const repeatedFilters = await app.inject({
    method: 'GET',
    url: `/api/products?tag=${optionBody.tags[0].key}&tag=${optionBody.tags[0].key}&spec=${specification.key}:${specification.values[0].key}`,
  });
  assert.equal(repeatedFilters.statusCode, 200);

  for (const url of [
    '/api/products?minPriceCents=2&maxPriceCents=1',
    '/api/products?addedFrom=2025-02-30',
    '/api/products?addedFrom=2025-02-02&addedTo=2025-02-01',
    '/api/products?spec=texture:fine&spec=texture:coarse',
    '/api/products?spec=pack-weight:900g',
  ]) {
    const response = await app.inject({ method: 'GET', url });
    assert.equal(response.statusCode, 400, url);
    assert.equal(response.json<{ code?: unknown }>().code, 'INVALID_QUERY');
  }
});

void test('catalog onSale includes only a clearance active at the request clock', async (t) => {
  const activeAt = '2037-07-28T12:00:00.000Z';
  const { db, app } = await createSeededAppFixture({
    testContext: t,
    app: { clock: { now: () => new Date(activeAt) } },
  });
  const insertProduct = db.prepare(`
    INSERT INTO products
      (id, name, description, price_cents, category, stock_count, image_set_id, slug,
       compare_at_price_cents, sales_count, active, backorderable, backorder_lead_days,
       created_at, consumption_classification, mixing_group, details_json)
    VALUES (?, ?, 'Test-only clearance filter product', 1_000, 'Baking & Pantry', 10,
            'test-clearance-filter', ?, NULL, 0, 1, 0, NULL,
            '2026-07-01T00:00:00.000Z', 'food', NULL, NULL)
  `);
  const insertVariant = db.prepare(`
    INSERT INTO product_variants
      (product_id, sku, label, weight_grams, price_cents, compare_at_price_cents,
       clearance_price_cents, clearance_starts_at, clearance_ends_at, stock_count,
       backorderable, backorder_lead_days, delivery_class, active, sort_order, moq_sacks,
       created_at, updated_at)
    VALUES (?, ?, 'Test-only clearance filter variant', 1_000, 1_000, NULL, 750, ?, ?, 10,
            0, NULL, 'parcel', 1, 1, 1, '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z')
  `);
  const fixtures = [
    {
      id: 9_000_001,
      state: 'active',
      startsAt: '2037-07-28T11:30:00.000+01:00',
      endsAt: '2037-07-28T13:30:00.000+01:00',
    },
    {
      id: 9_000_002,
      state: 'expired',
      startsAt: '2037-07-28T10:00:00.000+02:00',
      endsAt: '2037-07-28T13:00:00.000+02:00',
    },
    {
      id: 9_000_003,
      state: 'future',
      startsAt: '2037-07-28T11:00:00.000-02:00',
      endsAt: '2037-07-28T12:01:00.000-02:00',
    },
  ];
  for (const fixture of fixtures) {
    const name = `P5 clearance filter ${fixture.state}`;
    insertProduct.run(fixture.id, name, `p5-clearance-filter-${fixture.state}`);
    insertVariant.run(
      fixture.id,
      `P5-CLEARANCE-${fixture.state.toUpperCase()}`,
      fixture.startsAt,
      fixture.endsAt,
    );
  }

  const response = await app.inject({
    method: 'GET',
    url: '/api/products?q=P5%20clearance%20filter&onSale=true&pageSize=48',
  });
  assert.equal(response.statusCode, 200);
  const body = response.json<ProductListPaginatedResponse>();
  assert.equal(Value.Check(ProductListPaginatedResponse, body), true);
  assert.deepEqual(
    body.items.map((product) => product.id),
    ['9000001'],
  );
  assert.equal(body.total, 1);
  assert.equal(body.items[0]?.hasActiveClearance, true);

  const unfilteredResponse = await app.inject({
    method: 'GET',
    url: '/api/products?q=P5%20clearance%20filter&pageSize=48',
  });
  assert.equal(unfilteredResponse.statusCode, 200);
  const unfiltered = unfilteredResponse.json<ProductListPaginatedResponse>();
  assert.equal(Value.Check(ProductListPaginatedResponse, unfiltered), true);
  assert.deepEqual(
    unfiltered.items.map((product) => [product.id, product.hasActiveClearance]),
    [
      ['9000001', true],
      ['9000002', false],
      ['9000003', false],
    ],
  );

  const detail = await app.inject({ method: 'GET', url: '/api/products/9000001' });
  assert.equal(detail.statusCode, 200);
  const activeProduct = detail.json<ProductWithVariantsType>();
  assert.equal(activeProduct.variants[0]?.priceCents, 1_000);
  assert.deepEqual(activeProduct.variants[0]?.clearance, {
    priceCents: 750,
    perTonneCents: 750_000,
    startsAt: '2037-07-28T11:30:00.000+01:00',
    endsAt: '2037-07-28T13:30:00.000+01:00',
  });
});

void test('legacy sort_order 0 variant reintroduced before seed is retired and product detail stays contract-valid', async (t) => {
  const tempDir = mkdtempSync(join(tmpdir(), 'shop-product-legacy-variant-'));
  const db = openDatabase({ path: join(tempDir, 'shop.db') });
  seedDatabase(db);

  const product = db.prepare('SELECT id, created_at FROM products WHERE id = 31').get() as {
    id: number;
    created_at: string;
  };

  // Reintroduce the pre-020 defect shape: an active sort_order < 1 variant sitting alongside
  // product 31's real canonical variants, as migration 018's backfill used to leave behind.
  db.prepare(
    `INSERT INTO product_variants
       (product_id, sku, label, weight_grams, price_cents, stock_count, backorderable,
        backorder_lead_days, delivery_class, active, sort_order, moq_sacks, created_at, updated_at)
     VALUES (?, 'LEGACY-31-001', 'Legacy garden treatment (Legacy)', 1000, 495, 55, 0,
             NULL, 'parcel', 1, 0, 1, ?, ?)`,
  ).run(product.id, product.created_at, product.created_at);

  assert.equal(
    (
      db
        .prepare(
          'SELECT COUNT(*) AS count FROM product_variants WHERE product_id = ? AND sort_order < 1 AND active = 1',
        )
        .get(product.id) as { count: number }
    ).count,
    1,
  );

  // Reseeding is the documented self-heal path (`npm run seed`); it must retire the row again.
  seedDatabase(db);

  assert.equal(
    (
      db
        .prepare(
          'SELECT COUNT(*) AS count FROM product_variants WHERE product_id = ? AND sort_order < 1 AND active = 1',
        )
        .get(product.id) as { count: number }
    ).count,
    0,
  );
  assert.deepEqual(
    db.prepare('SELECT active FROM product_variants WHERE sku = ?').get('LEGACY-31-001'),
    { active: 0 },
  );

  const app = await buildApp({ db, resetBaseUrl: 'http://web.test' });
  t.after(async () => {
    await app.close();
    closeDatabase(db);
    rmSync(tempDir, { recursive: true, force: true });
  });

  const response = await app.inject({ method: 'GET', url: '/api/products/31' });
  assert.equal(response.statusCode, 200);
  const detail = response.json<ProductWithVariantsType>();
  assert.equal(Value.Check(ProductWithVariants, detail), true);
  assert.ok(detail.variants.length >= 1);
  for (const variant of detail.variants) {
    assert.ok(variant.sortOrder >= 1, `variant ${variant.sku} has sortOrder ${variant.sortOrder}`);
  }
});
