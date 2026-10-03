import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createProductRepository,
  type ProductRow,
} from '../../src/features/catalog/productRepository.js';
import {
  CatalogQueryError,
  normalizeCatalogQuery,
} from '../../src/features/catalog/catalogQuery.js';
import { buildCatalogPredicate, catalogOrderBy } from '../../src/features/catalog/catalogSql.js';
import { openSeededDatabase } from '../support/seededDatabase.js';

void test('product repository owns catalog SQL and variant methods', (t) => {
  const { db } = openSeededDatabase(t);
  const products = createProductRepository(db);

  assert.ok(products.listCategories().length >= 4);

  const seededCatalog = products.list({ pageSize: 200 });
  assert.equal(seededCatalog.total, 100);
  assert.equal(seededCatalog.items.length, seededCatalog.total);
  assert.ok(seededCatalog.items.every((product) => (product.available_to_sell ?? 0) > 0));

  const searchResult = products.list({ q: 'whey', sort: 'newest' });
  assert.ok(searchResult.items.some((product) => product.name.includes('Whey')));

  const baking = CATALOG_CATEGORY_FROM_DB(products, 'Baking & Pantry');
  assert.ok(baking > 0);

  const onSaleItems = products.list({ onSale: true, sort: 'newest', pageSize: 48 });
  // onSale covers both legacy compare-at pricing and an active variant clearance window.
  const hasActiveClearance = db.prepare(
    `SELECT 1
     FROM product_variants pv
     WHERE pv.product_id = ?
       AND pv.active = 1
       AND pv.clearance_price_cents IS NOT NULL
       AND pv.clearance_price_cents > 0
       AND pv.clearance_price_cents < pv.price_cents
       AND pv.clearance_starts_at IS NOT NULL
       AND pv.clearance_ends_at IS NOT NULL
       AND julianday(pv.clearance_starts_at) <= julianday('now')
       AND julianday(pv.clearance_ends_at) > julianday('now')
     LIMIT 1`,
  );
  assert.ok(
    onSaleItems.items.every(
      (product) =>
        product.compare_at_price_cents !== null || hasActiveClearance.get(product.id) !== undefined,
    ),
  );

  db.prepare('UPDATE products SET active = 0 WHERE id IN (1, 2)').run();
  assert.equal(products.findById(1)?.active, 0);
  assert.equal(products.findActiveById(1), undefined);
  assert.equal(products.list({ sort: 'newest', pageSize: 48 }).total, 98);

  // Variant methods
  const variants = products.findAllVariants(8);
  assert.ok(variants.length >= 1);
  for (const v of variants) {
    assert.equal(v.product_id, 8);
    assert.equal(v.active, 1);
  }

  const variant = products.findVariantById(variants[0].id);
  assert.ok(variant);
  assert.equal(variant.sku, variants[0].sku);

  const defaultVar = products.findDefaultVariant(8);
  assert.ok(defaultVar);
  assert.equal(defaultVar.sort_order, 1);

  const batchVariants = products.findVariantsByIds([variants[0].id]);
  assert.equal(batchVariants.length, 1);
  assert.equal(batchVariants[0].id, variants[0].id);
});

function CATALOG_CATEGORY_FROM_DB(
  products: ReturnType<typeof createProductRepository>,
  category: string,
): number {
  return products.list({ category, sort: 'newest', pageSize: 48 }).total;
}

void test('customer reads hydrate persisted metadata in stable catalog order', (t) => {
  const { db } = openSeededDatabase(t);
  const products = createProductRepository(db);
  const persistedTag = db
    .prepare(
      'SELECT product_id, tag_key FROM product_tags ORDER BY product_id ASC, tag_key ASC LIMIT 1',
    )
    .get() as { product_id: number; tag_key: string };
  db.prepare('UPDATE catalog_tags SET label = ? WHERE key = ?').run(
    'Persisted alpha',
    persistedTag.tag_key,
  );
  db.prepare(
    `INSERT INTO products
      (id, name, description, price_cents, category, stock_count, image_set_id, slug,
       compare_at_price_cents, sales_count, active, created_at)
     VALUES (99, 'Local powder', 'Local metadata', 999, 'Baking & Pantry', 3, NULL, 'local-powder',
       NULL, 0, 1, '2026-07-01T00:00:00.000Z')`,
  ).run();
  db.prepare('INSERT INTO catalog_tags (key, label) VALUES (?, ?), (?, ?)').run(
    'z-local',
    'Zulu',
    'a-local',
    'Alpha',
  );
  db.prepare('INSERT INTO product_tags (product_id, tag_key) VALUES (99, ?), (99, ?)').run(
    'z-local',
    'a-local',
  );
  db.prepare(
    `INSERT INTO product_specifications (product_id, specification_key, value_key, display_value)
     VALUES (99, 'source', 'local-source', 'Local source'),
            (99, 'texture', 'fine', 'Fine'),
            (99, 'unknown-future-key', 'ignored', 'Ignored')`,
  ).run();
  db.prepare('UPDATE products SET active = 0 WHERE id = 2').run();

  const changedCanonical = products.findActiveById(persistedTag.product_id);
  assert.ok(changedCanonical?.tags.some((tag) => tag.label === 'Persisted alpha'));

  const local = products.findActiveById(99);
  assert.deepEqual(local?.tags, [
    { key: 'a-local', label: 'Alpha' },
    { key: 'z-local', label: 'Zulu' },
  ]);
  assert.deepEqual(
    local?.specificationGroups.map((group) => [
      group.key,
      group.specifications.map((fact) => fact.key),
    ]),
    [
      ['appearance', ['texture']],
      ['origin-and-use', ['source']],
    ],
  );

  assert.equal(products.findActiveById(2), undefined);
  assert.deepEqual(
    products.listByIds([99, 2]).map((product) => [product.id, product.active]),
    [
      [2, 0],
      [99, 1],
    ],
  );
  const candidates = products.listActiveCandidatesExcluding(1);
  assert.equal(
    candidates.some((product) => product.id === 1 || product.id === 2),
    false,
  );
  assert.ok(candidates.some((product) => product.id === 99 && product.tags.length === 2));
});

void test('advanced catalog predicates are inclusive, composable, and stable', (t) => {
  const { db } = openSeededDatabase(t);
  const products = createProductRepository(db);
  db.prepare("INSERT INTO catalog_tags (key, label) VALUES ('test-only', 'Test only')").run();
  db.prepare("INSERT INTO product_tags (product_id, tag_key) VALUES (1, 'test-only')").run();
  const product = db
    .prepare(
      `SELECT p.*, pt.tag_key, ps.specification_key, ps.value_key
       FROM products p
       INNER JOIN product_tags pt ON pt.product_id = p.id
       INNER JOIN product_specifications ps ON ps.product_id = p.id
       WHERE p.id = 1 AND ps.specification_key IN ('texture', 'colour')
       ORDER BY ps.specification_key ASC LIMIT 1`,
    )
    .get() as ProductRow & { tag_key: string; specification_key: string; value_key: string };
  const secondSpecification = db
    .prepare(
      `SELECT specification_key, value_key FROM product_specifications
       WHERE product_id = 1 AND specification_key IN ('texture', 'colour', 'source', 'intended-use')
       AND specification_key != ? LIMIT 1`,
    )
    .get(product.specification_key) as { specification_key: string; value_key: string };
  const tagRows = [
    { tag_key: 'test-only' },
    db
      .prepare(
        "SELECT tag_key FROM product_tags WHERE product_id = 1 AND tag_key != 'test-only' LIMIT 1",
      )
      .get() as { tag_key: string },
  ];
  db.prepare(
    `UPDATE products SET compare_at_price_cents = price_cents + 100,
      created_at = '2025-01-10T00:00:00.000Z' WHERE id = 1`,
  ).run();
  db.prepare(
    `UPDATE product_variants SET stock_count = CASE WHEN sort_order = 1 THEN 2 ELSE 0 END
     WHERE product_id = 1`,
  ).run();

  const combined = products.list({
    q: product.name.slice(0, 6),
    category: product.category,
    onSale: true,
    minPriceCents: product.price_cents,
    maxPriceCents: product.price_cents,
    addedFrom: '2025-01-10',
    addedTo: '2025-01-10',
    tag: tagRows.map((row) => row.tag_key),
    spec: [
      `${product.specification_key}:${product.value_key}`,
      `${secondSpecification.specification_key}:${secondSpecification.value_key}`,
    ],
    availability: 'available',
    sort: 'newest',
    pageSize: 48,
  });
  assert.ok(combined.items.some((row) => row.id === 1));
  assert.ok(combined.items.every((row) => row.active === 1 && (row.available_to_sell ?? 0) > 0));
  assert.ok(
    products
      .list({
        minPriceCents: product.price_cents,
        maxPriceCents: product.price_cents,
        pageSize: 48,
      })
      .items.some((row) => row.id === 1),
  );
  assert.ok(
    products
      .list({ addedFrom: '2025-01-10', addedTo: '2025-01-10', pageSize: 48 })
      .items.some((row) => row.id === 1),
  );
  db.prepare("UPDATE products SET created_at = '2025-01-10 12:00:00' WHERE id = 1").run();
  assert.ok(
    products
      .list({ addedFrom: '2025-01-10', addedTo: '2025-01-10', pageSize: 48 })
      .items.some((row) => row.id === 1),
  );

  db.prepare('UPDATE product_variants SET stock_count = 0 WHERE product_id = 2').run();
  db.prepare('UPDATE products SET active = 0 WHERE id = 3').run();
  assert.ok(
    products
      .list({ availability: 'available', pageSize: 48 })
      .items.every((row) => (row.available_to_sell ?? 0) > 0),
  );
  assert.ok(
    products
      .list({ availability: 'out_of_stock', pageSize: 48 })
      .items.every((row) => (row.available_to_sell ?? 0) === 0),
  );
  assert.equal(
    products.list({ availability: 'out_of_stock', pageSize: 48 }).items.some((row) => row.id === 3),
    false,
  );

  assert.throws(() => products.list({ minPriceCents: 2, maxPriceCents: 1 }), CatalogQueryError);
  assert.throws(() => products.list({ addedFrom: '2025-02-30' }), CatalogQueryError);
  assert.throws(
    () => products.list({ addedFrom: '2025-02-02', addedTo: '2025-02-01' }),
    CatalogQueryError,
  );
  assert.throws(
    () => products.list({ spec: ['texture:fine', 'texture:coarse'] }),
    CatalogQueryError,
  );
  assert.throws(() => products.list({ spec: ['pack-weight:900g'] }), CatalogQueryError);

  const full = products.list({ category: product.category, sort: 'price_asc', pageSize: 48 });
  const pageSize = 2;
  const pageCount = Math.ceil(full.total / pageSize);
  const slices = Array.from({ length: pageCount }, (_, i) => i + 1).flatMap(
    (page) =>
      products.list({ category: product.category, sort: 'price_asc', page, pageSize }).items,
  );
  assert.equal(full.total, full.items.length);
  assert.deepEqual(
    slices.map((row) => row.id),
    full.items.map((row) => row.id),
  );

  const tieId = (
    db
      .prepare('SELECT id FROM products WHERE active = 1 AND id != 1 ORDER BY id ASC LIMIT 1')
      .get() as { id: number }
  ).id;
  db.prepare(
    "UPDATE products SET active = 1, name = 'Tie', price_cents = 777, sales_count = 88, created_at = '2025-03-01T00:00:00.000Z' WHERE id IN (?, ?)",
  ).run(1, tieId);
  for (const sort of [
    'newest',
    'oldest',
    'name_asc',
    'price_asc',
    'price_desc',
    'bestselling',
  ] as const) {
    const pageSize = 48;
    const pageCount = Math.ceil(products.list({ sort, pageSize }).total / pageSize);
    const ties = Array.from({ length: pageCount }, (_, index) => index + 1)
      .flatMap((page) => products.list({ sort, page, pageSize }).items)
      .filter((row) => row.id === 1 || row.id === tieId);
    assert.deepEqual(
      ties.map((row) => row.id),
      [1, tieId],
    );
  }

  db.prepare("UPDATE products SET name = 'literal 100%_\\\\ token' WHERE id = 1").run();
  assert.deepEqual(
    products.list({ q: '100%_\\', pageSize: 48 }).items.map((row) => row.id),
    [1],
  );

  const options = products.listFilterOptions();
  assert.ok(options.tags.length > 0);
  assert.ok(options.specificationGroups.length > 0);
  db.prepare('UPDATE products SET active = 0 WHERE id = 1').run();
  assert.equal(
    products.listFilterOptions().tags.some((tag) => tag.key === 'test-only'),
    false,
  );
});

void test('catalog SQL builder only emits allowlisted identifiers', () => {
  const normalized = normalizeCatalogQuery({
    tag: ['plant-based', 'plant-based'],
    spec: ['texture:fine'],
    sort: 'name_asc',
  });
  const predicate = buildCatalogPredicate(normalized, '2026-07-19T12:00:00.000Z');
  assert.match(predicate.where, /EXISTS \(SELECT 1 FROM product_tags/);
  assert.match(predicate.where, /EXISTS \(SELECT 1 FROM product_specifications/);
  assert.deepEqual(predicate.params, ['plant-based', 'texture', 'fine']);
  assert.equal(catalogOrderBy(normalized.sort), 'ORDER BY p.name COLLATE NOCASE ASC, p.id ASC');
  assert.throws(() => normalizeCatalogQuery({ spec: ['not-real:any'] }), CatalogQueryError);
});

void test('reservation-aware availability filters count and paginate against one instant', (t) => {
  const { db } = openSeededDatabase(t);
  const products = createProductRepository(db);
  const now = '2026-07-19T12:00:00.000Z';
  const future = '2026-07-19T12:01:00.000Z';
  const expired = '2026-07-19T11:59:59.000Z';
  const variant1Id = (
    db.prepare('SELECT id FROM product_variants WHERE product_id = 1 AND sort_order = 1').get() as {
      id: number;
    }
  ).id;
  const variant3Id = (
    db.prepare('SELECT id FROM product_variants WHERE product_id = 3 AND sort_order = 1').get() as {
      id: number;
    }
  ).id;
  db.prepare('UPDATE product_variants SET stock_count = 0 WHERE product_id IN (1, 2, 3)').run();
  db.prepare('UPDATE product_variants SET stock_count = 1 WHERE id IN (?, ?)').run(
    variant1Id,
    variant3Id,
  );
  db.prepare(
    `UPDATE products
     SET backorderable = CASE id WHEN 2 THEN 1 ELSE 0 END,
         backorder_lead_days = CASE id WHEN 2 THEN 14 ELSE NULL END
     WHERE id IN (1, 2, 3)`,
  ).run();
  const payment = db.prepare(
    `INSERT INTO payments
      (idempotency_key, request_fingerprint, status, amount_cents, card_last4, card_brand)
     VALUES (?, ?, 'prepared', 1, '4242', 'Visa')`,
  );
  const reservation = db.prepare(
    `INSERT INTO inventory_reservations
      (payment_idempotency_key, variant_id, reserved_quantity, backordered_quantity, expires_at, created_at)
     VALUES (?, ?, 1, 0, ?, ?)`,
  );
  payment.run('catalog-live', 'catalog-live');
  reservation.run('catalog-live', variant1Id, future, now);
  payment.run('catalog-expired', 'catalog-expired');
  reservation.run('catalog-expired', variant3Id, expired, now);

  const available = products.list({ availability: 'available', pageSize: 200 }, now);
  const backorder = products.list({ availability: 'backorder', pageSize: 200 }, now);
  const unavailable = products.list({ availability: 'out_of_stock', pageSize: 200 }, now);
  assert.equal(
    available.items.some((product) => product.id === 1),
    false,
  );
  assert.equal(
    available.items.some((product) => product.id === 3),
    true,
  );
  assert.deepEqual(
    backorder.items.map((product) => product.id),
    [2],
  );
  assert.equal(
    unavailable.items.some((product) => product.id === 1),
    true,
  );
  assert.equal(
    unavailable.items.some((product) => product.id === 2),
    false,
  );

  const full = products.list({ availability: 'out_of_stock', pageSize: 200 }, now);
  const pageSize = 2;
  const pageCount = Math.ceil(full.total / pageSize);
  const pages = Array.from({ length: pageCount }, (_, i) => i + 1).flatMap(
    (page) => products.list({ availability: 'out_of_stock', page, pageSize }, now).items,
  );
  assert.equal(full.total, full.items.length);
  assert.deepEqual(
    pages.map((product) => product.id),
    full.items.map((product) => product.id),
  );
});
