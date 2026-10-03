import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import {
  closeDatabase,
  migrateDatabase,
  openDatabase,
  resetDatabase,
  seedDatabase,
  type Migration,
} from '../../src/db/index.js';
import { migrations } from '../../src/db/migrations/index.js';
import { toProductContract } from '../../src/mappers/product.js';
import type { ProductRow } from '../../src/features/catalog/productRepository.js';
import { Product } from '@shop/contracts/products';
import { CURATED_BUNDLES } from '@shop/catalog';
import { Value } from '@sinclair/typebox/value';

const expectedVersions = [
  '001',
  '002',
  '003',
  '004',
  '005',
  '006',
  '007',
  '008',
  '009',
  '010',
  '011',
  '012',
  '013',
  '014',
  '015',
  '016',
  '017',
  '018',
  '019',
  '020',
  '021',
  '022',
  '023',
  '024',
  '025',
  '026',
  '027',
  '028',
  '029',
  '030',
  '031',
  '032',
  '033',
  '034',
  '035',
  '036',
  '037',
  '038',
];

/** Every migration up to but excluding `021`, i.e. the schema powderizer still existed in. */
const prePowderizerRemoval = migrations.filter((migration) => migration.version < '021');
const preCustomBlendsMigration = migrations.filter((migration) => migration.version < '022');
const preCheckoutDepthMigration = migrations.filter((migration) => migration.version < '023');
const prePricingPromotionsMigration = migrations.filter((migration) => migration.version < '024');

function migrationVersions(db: Database.Database): string[] {
  return db
    .prepare('SELECT version FROM schema_migrations ORDER BY version')
    .all()
    .map((row) => (row as { version: string }).version);
}

function tableExists(db: Database.Database, table: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table),
  );
}

function columnNames(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
    (column) => column.name,
  );
}

function indexNames(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA index_list(${table})`).all() as { name: string }[])
    .map((index) => index.name)
    .sort();
}

function primaryKeyColumns(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string; pk: number }[])
    .filter((column) => column.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((column) => column.name);
}

function createLegacyFixture(db: Database.Database): void {
  db.exec(`
    CREATE TABLE products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      price_cents INTEGER NOT NULL,
      category TEXT NOT NULL,
      stock_count INTEGER NOT NULL DEFAULT 0,
      image_url TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE promo_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      discount_percent INTEGER NOT NULL,
      min_item_count INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name TEXT NOT NULL,
      customer_email TEXT NOT NULL,
      shipping_address TEXT NOT NULL,
      promo_code_applied TEXT,
      subtotal_cents INTEGER NOT NULL,
      discount_cents INTEGER NOT NULL DEFAULT 0,
      total_cents INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER,
      idempotency_key TEXT NOT NULL UNIQUE,
      request_fingerprint TEXT NOT NULL,
      status TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      card_last4 TEXT NOT NULL,
      card_brand TEXT NOT NULL,
      failure_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      response_json TEXT
    );
    INSERT INTO products (id, name, description, price_cents, category, stock_count, created_at)
    VALUES (99, 'Legacy powder', 'Preserve me', 1234, 'Legacy', 3, '2024-12-31 23:59:59');
    INSERT INTO promo_codes (code, discount_percent) VALUES ('LEGACY10', 10);
    INSERT INTO orders (customer_name, customer_email, shipping_address, subtotal_cents, total_cents)
    VALUES ('Legacy customer', 'legacy@example.test', '99 Legacy Lane', 1234, 1234);
    INSERT INTO payments
      (idempotency_key, request_fingerprint, status, amount_cents, card_last4, card_brand, response_json)
    VALUES ('legacy-payment', 'safe-fingerprint', 'success', 1234, '4242', 'Visa', '{"success":true}');
  `);
}

void test('migrations create a fresh schema, record every version, and remain idempotent', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'shop-migrations-fresh-'));
  const db = openDatabase({ path: join(directory, 'shop.db') });
  t.after(() => {
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  });

  assert.deepEqual(migrationVersions(db), expectedVersions);
  assert.deepEqual(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'products'").get(),
    { name: 'products' },
  );
  const moqColumn = (
    db.prepare('PRAGMA table_info(product_variants)').all() as {
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
    }[]
  ).find((column) => column.name === 'moq_sacks');
  assert.deepEqual(
    moqColumn && {
      name: moqColumn.name,
      type: moqColumn.type,
      notnull: moqColumn.notnull,
      dflt_value: moqColumn.dflt_value,
    },
    { name: 'moq_sacks', type: 'INTEGER', notnull: 1, dflt_value: '4' },
  );
  assert.ok(
    (db.prepare('PRAGMA table_info(payments)').all() as { name: string }[]).some(
      (column) => column.name === 'response_json',
    ),
  );
  for (const table of ['company_credit_events', 'credit_exposure_holds']) {
    assert.deepEqual(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table),
      { name: table },
    );
  }
  for (const [table, columns] of [
    [
      'company_accounts',
      ['credit_limit_cents', 'credit_terms_days', 'credit_state', 'credit_version'],
    ],
    ['payments', ['payment_method', 'company_id', 'user_id']],
    [
      'orders',
      [
        'payment_method',
        'company_id',
        'net_cents',
        'vat_rate_basis_points',
        'vat_cents',
        'gross_cents',
      ],
    ],
  ] as const) {
    const actual = new Set(
      (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
        (column) => column.name,
      ),
    );
    for (const column of columns) assert.ok(actual.has(column), `${table}.${column}`);
  }
  assert.deepEqual(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'audit_events'")
      .get(),
    { name: 'audit_events' },
  );
  assert.deepEqual(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'reviews'").get(),
    { name: 'reviews' },
  );
  for (const table of ['review_rating_aggregates', 'review_helpful_votes', 'review_reports']) {
    assert.deepEqual(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table),
      { name: table },
    );
  }
  for (const index of [
    'audit_events_occurred_at_id_idx',
    'audit_events_action_occurred_at_id_idx',
    'audit_events_entity_occurred_at_id_idx',
    'audit_events_actor_user_occurred_at_id_idx',
    'audit_events_request_occurred_at_id_idx',
  ]) {
    assert.deepEqual(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?").get(index),
      { name: index },
    );
  }
  for (const index of [
    'reviews_product_status_created_at_id_idx',
    'orders_user_id_id_idx',
    'order_line_items_product_id_order_id_idx',
    'payments_order_id_status_idx',
  ]) {
    assert.deepEqual(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?").get(index),
      { name: index },
    );
  }
  for (const trigger of ['audit_events_no_update', 'audit_events_no_delete']) {
    assert.deepEqual(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = ?").get(trigger),
      { name: trigger },
    );
  }
  for (const trigger of [
    'reviews_aggregate_after_insert',
    'reviews_aggregate_after_update',
    'reviews_aggregate_after_delete',
  ]) {
    assert.deepEqual(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = ?").get(trigger),
      { name: trigger },
    );
  }
  assert.ok(
    (db.prepare('PRAGMA table_info(products)').all() as { name: string }[]).some(
      (column) => column.name === 'active',
    ),
  );
  for (const table of ['catalog_tags', 'product_tags', 'product_specifications']) {
    assert.deepEqual(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table),
      { name: table },
    );
  }
  for (const table of ['curated_bundles', 'curated_bundle_components']) {
    assert.deepEqual(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table),
      { name: table },
    );
  }
  for (const table of ['delivery_sites', 'billing_entities']) {
    assert.deepEqual(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table),
      { name: table },
    );
  }
  for (const table of [
    'order_shipments',
    'order_shipment_items',
    'order_lifecycle_events',
    'order_access_grants',
  ]) {
    assert.deepEqual(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table),
      { name: table },
    );
  }
  for (const index of [
    'orders_demo_seed_key_idx',
    'orders_user_created_at_id_idx',
    'order_shipments_order_number_idx',
    'order_shipment_items_order_line_item_idx',
    'order_lifecycle_events_order_occurred_id_idx',
    'order_lifecycle_events_shipment_occurred_id_idx',
    'order_access_grants_expires_at_idx',
    'order_access_grants_order_id_idx',
  ]) {
    assert.deepEqual(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?").get(index),
      { name: index },
    );
  }
  assert.deepEqual(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = ?")
      .get('order_lifecycle_events_no_update'),
    { name: 'order_lifecycle_events_no_update' },
  );
  assert.deepEqual(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
      .get('curated_bundle_components_product_bundle_idx'),
    { name: 'curated_bundle_components_product_bundle_idx' },
  );
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO curated_bundles (id, key, name, description, active, sort_order)
           VALUES (100, 'invalid-bundle', 'Invalid', 'Invalid', 2, 1)`,
        )
        .run(),
    /CHECK constraint failed/,
  );
  db.prepare(
    `INSERT INTO curated_bundles (id, key, name, description, active, sort_order)
     VALUES (100, 'migration-test-bundle', 'Migration test', 'Migration test bundle', 1, 1)`,
  ).run();
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO curated_bundle_components (bundle_id, product_id, quantity, sort_order)
           VALUES (100, 99999, 1, 1)`,
        )
        .run(),
    /FOREIGN KEY constraint failed/,
  );
  for (const index of [
    'products_active_created_at_id_idx',
    'products_active_price_cents_id_idx',
    'product_tags_tag_key_product_id_idx',
    'product_specifications_key_value_product_id_idx',
  ]) {
    assert.deepEqual(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?").get(index),
      { name: index },
    );
  }
  // Migration 021 removed the powderizer feature outright: a fresh schema has no trace of it.
  for (const table of [
    'powder_mixes',
    'powder_mix_components',
    'order_powder_mix_items',
    'powder_mix_stock_reservations',
  ]) {
    assert.equal(tableExists(db, table), false, `${table} should not exist after 021`);
  }
  assert.equal(columnNames(db, 'products').includes('mixable'), false);
  assert.equal(columnNames(db, 'products').includes('mix_unit_grams'), false);
  assert.equal(columnNames(db, 'inventory_reservations').includes('demand_kind'), false);
  assert.equal(columnNames(db, 'order_shipment_items').includes('order_powder_mix_item_id'), false);
  for (const table of [
    'inventory_reservations',
    'order_inventory_allocations',
    'inventory_receipts',
    'inventory_stock_movements',
  ]) {
    assert.deepEqual(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table),
      { name: table },
    );
  }
  assert.ok(
    (db.prepare('PRAGMA table_info(payments)').all() as { name: string }[]).some(
      (column) => column.name === 'quote_json',
    ),
  );

  migrateDatabase(db);
  assert.deepEqual(migrationVersions(db), expectedVersions);
});

void test('customer review constraints reject invalid scalar and duplicate data', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'shop-migrations-reviews-'));
  const db = openDatabase({ path: join(directory, 'shop.db') });
  t.after(() => {
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  });

  db.prepare(
    `INSERT INTO products
      (name, description, price_cents, category, stock_count, image_set_id)
     VALUES ('Review product', 'Review migration fixture', 1000, 'Test', 1, 'review-product')`,
  ).run();
  db.prepare(
    `INSERT INTO users (email, display_name, password_hash, password_salt, role)
     VALUES ('reviewer@example.test', 'Reviewer', 'hash', 'salt', 'customer')`,
  ).run();
  db.prepare(
    `INSERT INTO users (email, display_name, password_hash, password_salt, role)
     VALUES ('reviewer-two@example.test', 'Reviewer two', 'hash', 'salt', 'customer')`,
  ).run();

  const insertReview = db.prepare(
    'INSERT INTO reviews (product_id, user_id, rating, body, status) VALUES (1, ?, ?, ?, ?)',
  );
  insertReview.run(1, 5, '12345678901234567890', 'published');

  assert.throws(
    () => insertReview.run(1, 5, '12345678901234567890', 'published'),
    /UNIQUE constraint failed/,
  );
  assert.throws(
    () => insertReview.run(2, 0, '12345678901234567890', 'published'),
    /CHECK constraint failed/,
  );
  assert.throws(
    () => insertReview.run(2, 1.5, '12345678901234567890', 'published'),
    /CHECK constraint failed/,
  );
  assert.throws(
    () => insertReview.run(2, 1, '1234567890123456789', 'published'),
    /CHECK constraint failed/,
  );
  assert.throws(
    () => insertReview.run(2, 1, 'x'.repeat(4001), 'published'),
    /CHECK constraint failed/,
  );
  assert.throws(
    () => insertReview.run(2, 1, ' 12345678901234567890', 'published'),
    /CHECK constraint failed/,
  );
  insertReview.run(2, 1, 'x'.repeat(4000), 'hidden');
  assert.throws(
    () => insertReview.run(2, 1, '12345678901234567890', 'removed'),
    /CHECK constraint failed/,
  );
});

void test('review depth backfills and trigger-maintains published aggregates', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'shop-migrations-review-depth-'));
  const db = new Database(join(directory, 'shop.db'));
  db.pragma('foreign_keys = ON');
  t.after(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  migrateDatabase(
    db,
    migrations.filter((migration) => migration.version < '016'),
  );
  db.exec(`
    INSERT INTO products (id, name, description, price_cents, category, stock_count, image_set_id)
    VALUES (801, 'Aggregate product', 'Aggregate migration fixture', 1000, 'Test', 1, 'aggregate-product');
    INSERT INTO users (id, email, display_name, password_hash, password_salt, role)
    VALUES
      (801, 'aggregate-one@example.test', 'Aggregate one', 'hash', 'salt', 'customer'),
      (802, 'aggregate-two@example.test', 'Aggregate two', 'hash', 'salt', 'customer'),
      (803, 'aggregate-admin@example.test', 'Aggregate admin', 'hash', 'salt', 'admin');
    INSERT INTO reviews (id, product_id, user_id, rating, body, status)
    VALUES
      (801, 801, 801, 5, 'Published review fixture body.', 'published'),
      (802, 801, 802, 2, 'Hidden review fixture body...', 'hidden');
  `);

  migrateDatabase(db);
  const aggregate = () =>
    db
      .prepare(
        'SELECT published_count, rating_sum, stars_1, stars_2, stars_3, stars_4, stars_5 FROM review_rating_aggregates WHERE product_id = 801',
      )
      .get();
  assert.deepEqual(aggregate(), {
    published_count: 1,
    rating_sum: 5,
    stars_1: 0,
    stars_2: 0,
    stars_3: 0,
    stars_4: 0,
    stars_5: 1,
  });

  db.prepare(
    `INSERT INTO reviews (id, product_id, user_id, rating, body, status)
     VALUES (803, 801, 803, 1, 'Inserted published review body.', 'published')`,
  ).run();
  assert.deepEqual(aggregate(), {
    published_count: 2,
    rating_sum: 6,
    stars_1: 1,
    stars_2: 0,
    stars_3: 0,
    stars_4: 0,
    stars_5: 1,
  });

  db.prepare("UPDATE reviews SET status = 'published' WHERE id = 802").run();
  assert.deepEqual(aggregate(), {
    published_count: 3,
    rating_sum: 8,
    stars_1: 1,
    stars_2: 1,
    stars_3: 0,
    stars_4: 0,
    stars_5: 1,
  });

  db.prepare("UPDATE reviews SET status = 'hidden' WHERE id = 802").run();
  assert.deepEqual(aggregate(), {
    published_count: 2,
    rating_sum: 6,
    stars_1: 1,
    stars_2: 0,
    stars_3: 0,
    stars_4: 0,
    stars_5: 1,
  });

  db.prepare("UPDATE reviews SET status = 'published', rating = 4 WHERE id = 802").run();
  assert.deepEqual(aggregate(), {
    published_count: 3,
    rating_sum: 10,
    stars_1: 1,
    stars_2: 0,
    stars_3: 0,
    stars_4: 1,
    stars_5: 1,
  });

  db.prepare('UPDATE reviews SET rating = 3 WHERE id = 801').run();
  assert.deepEqual(aggregate(), {
    published_count: 3,
    rating_sum: 8,
    stars_1: 1,
    stars_2: 0,
    stars_3: 1,
    stars_4: 1,
    stars_5: 0,
  });

  db.prepare('DELETE FROM reviews WHERE id = 802').run();
  assert.deepEqual(aggregate(), {
    published_count: 2,
    rating_sum: 4,
    stars_1: 1,
    stars_2: 0,
    stars_3: 1,
    stars_4: 0,
    stars_5: 0,
  });

  db.prepare('DELETE FROM reviews WHERE id = 803').run();
  assert.deepEqual(aggregate(), {
    published_count: 1,
    rating_sum: 3,
    stars_1: 0,
    stars_2: 0,
    stars_3: 1,
    stars_4: 0,
    stars_5: 0,
  });
  assert.throws(
    () =>
      db
        .prepare('UPDATE review_rating_aggregates SET published_count = 2 WHERE product_id = 801')
        .run(),
    /CHECK constraint failed/,
  );
});

void test('review engagement tables enforce report state and cascade before reset', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'shop-migrations-review-engagement-'));
  const db = openDatabase({ path: join(directory, 'shop.db') });
  t.after(() => {
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  });
  db.exec(`
    INSERT INTO products (id, name, description, price_cents, category, stock_count, image_set_id)
    VALUES (811, 'Engagement product', 'Engagement migration fixture', 1000, 'Test', 1, 'engagement-product');
    INSERT INTO users (id, email, display_name, password_hash, password_salt, role)
    VALUES
      (811, 'engagement-author@example.test', 'Author', 'hash', 'salt', 'customer'),
      (812, 'engagement-reporter@example.test', 'Reporter', 'hash', 'salt', 'customer'),
      (813, 'engagement-admin@example.test', 'Admin', 'hash', 'salt', 'admin');
    INSERT INTO reviews (id, product_id, user_id, rating, body, status)
    VALUES (811, 811, 811, 4, 'Engagement review fixture body.', 'published');
    INSERT INTO review_helpful_votes (review_id, user_id) VALUES (811, 812);
    INSERT INTO review_reports (review_id, user_id, reason, detail) VALUES (811, 812, 'other', 'Explained concern');
  `);
  assert.throws(
    () => db.prepare("UPDATE review_reports SET status = 'dismissed' WHERE review_id = 811").run(),
    /CHECK constraint failed/,
  );
  db.prepare('DELETE FROM reviews WHERE id = 811').run();
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS count FROM review_helpful_votes').get() as { count: number })
      .count,
    0,
  );
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS count FROM review_reports').get() as { count: number }).count,
    0,
  );
  resetDatabase(db);
});

void test('migrations upgrade the legacy schema without losing known data', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'shop-migrations-legacy-'));
  const db = new Database(join(directory, 'shop.db'));
  db.pragma('foreign_keys = ON');
  createLegacyFixture(db);
  t.after(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  migrateDatabase(db);

  assert.deepEqual(migrationVersions(db), expectedVersions);
  assert.deepEqual(
    db
      .prepare('SELECT name, image_set_id, slug, active, created_at FROM products WHERE id = 99')
      .get(),
    {
      name: 'Legacy powder',
      image_set_id: 'legacy-product-99',
      slug: '',
      active: 1,
      created_at: '2024-12-31 23:59:59',
    },
  );
  // The 021 products rebuild carries the legacy row across intact, minus the mixing columns.
  assert.deepEqual(columnNames(db, 'products'), [
    'id',
    'name',
    'description',
    'price_cents',
    'category',
    'stock_count',
    'image_url',
    'created_at',
    'slug',
    'compare_at_price_cents',
    'sales_count',
    'image_set_id',
    'active',
    'backorderable',
    'backorder_lead_days',
    'consumption_classification',
    'mixing_group',
    'details_json',
    'default_variant_id',
    'blend_source_variant_id',
  ]);
  const legacyRow = db.prepare('SELECT * FROM products WHERE id = 99').get() as ProductRow;
  const legacyProduct = toProductContract(legacyRow);
  assert.equal(legacyProduct.createdAt, '2024-12-31T23:59:59.000Z');
  assert.equal(
    Value.Check(Product, {
      ...legacyProduct,
      availability: 'in_stock',
      backorderable: false,
      backorderLeadDays: null,
    }),
    true,
  );
  assert.deepEqual(
    db
      .prepare('SELECT code, kind, redemption_count FROM promo_codes WHERE code = ?')
      .get('LEGACY10'),
    { code: 'LEGACY10', kind: 'percent', redemption_count: 0 },
  );
  assert.deepEqual(db.prepare('SELECT customer_name, user_id FROM orders').get(), {
    customer_name: 'Legacy customer',
    user_id: null,
  });
  assert.deepEqual(
    db.prepare('SELECT lifecycle_status, version, cancelled_at, demo_seed_key FROM orders').get(),
    { lifecycle_status: 'processing', version: 0, cancelled_at: null, demo_seed_key: null },
  );
  assert.deepEqual(
    db
      .prepare(
        `SELECT event_type, title, shipment_id, occurred_at
         FROM order_lifecycle_events WHERE order_id = 1`,
      )
      .all(),
    [
      {
        event_type: 'order_created',
        title: 'Order created',
        shipment_id: null,
        occurred_at: db.prepare('SELECT created_at FROM orders WHERE id = 1').pluck().get(),
      },
    ],
  );
  assert.deepEqual(
    db
      .prepare(
        'SELECT status, response_json, cart_id, quote_json FROM payments WHERE idempotency_key = ?',
      )
      .get('legacy-payment'),
    { status: 'success', response_json: '{"success":true}', cart_id: null, quote_json: null },
  );
  assert.deepEqual(
    db
      .prepare(
        `SELECT payment_method, company_id, card_last4, card_brand
         FROM payments WHERE idempotency_key = ?`,
      )
      .get('legacy-payment'),
    { payment_method: 'card', company_id: null, card_last4: '4242', card_brand: 'Visa' },
  );
  assert.deepEqual(
    db
      .prepare(
        `SELECT payment_method, company_id, net_cents, vat_rate_basis_points, vat_cents, gross_cents
         FROM orders WHERE id = 1`,
      )
      .get(),
    {
      payment_method: 'card',
      company_id: null,
      net_cents: 1234,
      vat_rate_basis_points: 0,
      vat_cents: 0,
      gross_cents: 1234,
    },
  );
});

void test('inventory migration copies legacy mix reservations into unified lease rows', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'shop-migrations-inventory-upgrade-'));
  const db = new Database(join(directory, 'shop.db'));
  db.pragma('foreign_keys = ON');
  t.after(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  migrateDatabase(
    db,
    migrations.filter((migration) => migration.version < '015'),
  );
  db.prepare(
    `INSERT INTO products (id, name, description, price_cents, category, stock_count)
     VALUES (99, 'Legacy mix product', 'Preserve reservation', 100, 'Legacy', 3)`,
  ).run();
  db.prepare(
    `INSERT INTO payments
      (idempotency_key, request_fingerprint, status, amount_cents, card_last4, card_brand,
       created_at, updated_at)
     VALUES ('legacy-prepared', 'safe', 'prepared', 100, '4242', 'Visa',
       '2026-07-19T12:00:00.000Z', '2026-07-19T12:05:00.000Z')`,
  ).run();
  db.prepare(
    `INSERT INTO powder_mix_stock_reservations
      (payment_idempotency_key, product_id, bag_equivalents)
     VALUES ('legacy-prepared', 99, 2)`,
  ).run();
  db.prepare(
    `INSERT INTO payments
      (idempotency_key, request_fingerprint, status, amount_cents, card_last4, card_brand,
       created_at, updated_at)
     VALUES ('legacy-terminal', 'safe-terminal', 'succeeded', 100, '4242', 'Visa',
       '2026-07-19T12:00:00.000Z', '2026-07-19T12:05:00.000Z')`,
  ).run();
  db.prepare(
    `INSERT INTO powder_mix_stock_reservations
      (payment_idempotency_key, product_id, bag_equivalents)
     VALUES ('legacy-terminal', 99, 1)`,
  ).run();

  migrateDatabase(db, prePowderizerRemoval);

  assert.equal(tableExists(db, 'powder_mix_stock_reservations'), false);
  assert.deepEqual(
    db
      .prepare(
        `SELECT payment_idempotency_key, variant_id, demand_kind, reserved_quantity,
                backordered_quantity, expires_at
         FROM inventory_reservations`,
      )
      .get(),
    {
      payment_idempotency_key: 'legacy-prepared',
      variant_id: 1,
      demand_kind: 'powder_mix',
      reserved_quantity: 2,
      backordered_quantity: 0,
      expires_at: '2026-07-19T12:20:00.000Z',
    },
  );
  assert.equal(
    db
      .prepare(
        `SELECT 1 FROM inventory_reservations
         WHERE payment_idempotency_key = 'legacy-terminal'`,
      )
      .get(),
    undefined,
  );
  assert.deepEqual(
    db
      .prepare('SELECT reservation_expires_at FROM payments WHERE idempotency_key = ?')
      .get('legacy-prepared'),
    { reservation_expires_at: '2026-07-19T12:20:00.000Z' },
  );

  // 021 removes the demand kind entirely; the mix lease it carried goes with it.
  migrateDatabase(db);
  assert.equal(columnNames(db, 'inventory_reservations').includes('demand_kind'), false);
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS count FROM inventory_reservations').get() as { count: number })
      .count,
    0,
  );
  assert.deepEqual(
    db
      .prepare('SELECT reservation_expires_at FROM payments WHERE idempotency_key = ?')
      .get('legacy-prepared'),
    { reservation_expires_at: '2026-07-19T12:20:00.000Z' },
  );
});

void test('lifecycle migration preserves pre-existing order lines, and 021 drops mix snapshots', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'shop-migrations-lifecycle-upgrade-'));
  const db = new Database(join(directory, 'shop.db'));
  db.pragma('foreign_keys = ON');
  t.after(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  migrateDatabase(
    db,
    migrations.filter((migration) => migration.version < '014'),
  );
  db.prepare(
    `INSERT INTO orders
      (customer_name, customer_email, shipping_address, subtotal_cents, discount_cents, total_cents, created_at)
     VALUES ('Snapshot customer', 'snapshot@example.test', '2 Snapshot Lane', 2500, 250, 2250, '2026-07-18T12:00:00.000Z')`,
  ).run();
  const orderId = Number(
    db
      .prepare("SELECT id FROM orders WHERE customer_email = 'snapshot@example.test'")
      .pluck()
      .get(),
  );
  db.prepare(
    `INSERT INTO products (id, name, description, price_cents, category, stock_count)
     VALUES (77, 'Snapshot product', 'Snapshot product', 2500, 'Snapshot', 1)`,
  ).run();
  db.prepare(
    `INSERT INTO order_line_items
      (order_id, product_id, product_name, product_price_cents, quantity, line_total_cents)
     VALUES (?, 77, 'Snapshot product', 2500, 1, 2500)`,
  ).run(orderId);
  const snapshotJson = '{"snapshotVersion":2,"mixId":"preserved-snapshot"}';
  db.prepare('INSERT INTO order_powder_mix_items (order_id, snapshot_json) VALUES (?, ?)').run(
    orderId,
    snapshotJson,
  );

  migrateDatabase(db, prePowderizerRemoval);
  assert.deepEqual(
    db.prepare('SELECT snapshot_json FROM order_powder_mix_items WHERE order_id = ?').get(orderId),
    { snapshot_json: snapshotJson },
  );

  migrateDatabase(db);

  assert.deepEqual(
    db
      .prepare(
        `SELECT customer_name, customer_email, subtotal_cents, discount_cents, total_cents,
                lifecycle_status, version, cancelled_at
         FROM orders WHERE id = ?`,
      )
      .get(orderId),
    {
      customer_name: 'Snapshot customer',
      customer_email: 'snapshot@example.test',
      subtotal_cents: 2500,
      discount_cents: 250,
      total_cents: 2250,
      lifecycle_status: 'processing',
      version: 0,
      cancelled_at: null,
    },
  );
  assert.deepEqual(
    db
      .prepare(
        'SELECT product_id, product_name, product_price_cents, quantity, line_total_cents FROM order_line_items WHERE order_id = ?',
      )
      .get(orderId),
    {
      product_id: 77,
      product_name: 'Snapshot product',
      product_price_cents: 2500,
      quantity: 1,
      line_total_cents: 2500,
    },
  );
  assert.equal(tableExists(db, 'order_powder_mix_items'), false);
  assert.deepEqual(
    db
      .prepare('SELECT event_type, occurred_at FROM order_lifecycle_events WHERE order_id = ?')
      .get(orderId),
    { event_type: 'order_created', occurred_at: '2026-07-18T12:00:00.000Z' },
  );
});

void test('order lifecycle constraints reject invalid data and lifecycle-event updates', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'shop-migrations-lifecycle-'));
  const db = openDatabase({ path: join(directory, 'shop.db') });
  t.after(() => {
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  });

  db.prepare(
    `INSERT INTO orders
      (customer_name, customer_email, shipping_address, subtotal_cents, total_cents, created_at)
     VALUES ('Lifecycle', 'lifecycle@example.test', '1 Test Road', 1000, 1000, '2026-07-19T12:00:00.000Z')`,
  ).run();
  db.prepare(
    `INSERT INTO order_line_items
      (order_id, product_id, product_name, product_price_cents, quantity, line_total_cents)
     VALUES (1, 1, 'Product', 1000, 1, 1000)`,
  ).run();
  db.prepare(
    `INSERT INTO order_shipments
      (order_id, shipment_number, status, tracking_reference, created_at, updated_at)
     VALUES (1, 1, 'packed', 'SIM-001', '2026-07-19T12:00:00.000Z', '2026-07-19T12:00:00.000Z')`,
  ).run();
  db.prepare(
    `INSERT INTO order_lifecycle_events (order_id, event_type, title, occurred_at)
     VALUES (1, 'order_created', 'Order created', '2026-07-19T12:00:00.000Z')`,
  ).run();

  assert.throws(
    () => db.prepare("UPDATE orders SET lifecycle_status = 'invalid' WHERE id = 1").run(),
    /CHECK constraint failed/,
  );
  // After 021 a shipment line always names a product line: the either/or CHECK is gone and
  // order_line_item_id is NOT NULL.
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO order_shipment_items (shipment_id, quantity)
           VALUES (1, 1)`,
        )
        .run(),
    /NOT NULL constraint failed/,
  );
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO order_shipment_items (shipment_id, order_line_item_id, quantity)
           VALUES (1, 1, 0)`,
        )
        .run(),
    /CHECK constraint failed/,
  );
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO order_shipments
            (order_id, shipment_number, status, created_at, updated_at)
           VALUES (1, 2, 'processing', '2026-07-19T12:00:00.000Z', '2026-07-19T12:00:00.000Z')`,
        )
        .run(),
    /CHECK constraint failed/,
  );
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO order_lifecycle_events (order_id, event_type, title, occurred_at)
           VALUES (1, 'invalid_event', 'Invalid event', '2026-07-19T12:00:00.000Z')`,
        )
        .run(),
    /CHECK constraint failed/,
  );
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO order_lifecycle_events
            (order_id, event_type, tracking_code, title, occurred_at)
           VALUES (1, 'shipment_tracking_updated', 'unknown_code', 'Unknown code', '2026-07-19T12:00:00.000Z')`,
        )
        .run(),
    /CHECK constraint failed/,
  );
  db.prepare(
    `INSERT INTO order_shipment_items (shipment_id, order_line_item_id, quantity)
     VALUES (1, 1, 1)`,
  ).run();
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO order_shipment_items (shipment_id, order_line_item_id, quantity)
           VALUES (1, 1, 1)`,
        )
        .run(),
    /UNIQUE constraint failed/,
  );
  assert.deepEqual(
    db
      .prepare(
        `SELECT order_line_item_id, quantity
         FROM order_shipment_items WHERE shipment_id = 1 ORDER BY order_line_item_id`,
      )
      .all(),
    [{ order_line_item_id: 1, quantity: 1 }],
  );
  const createdEventId = Number(
    db
      .prepare(
        "SELECT id FROM order_lifecycle_events WHERE order_id = 1 AND event_type = 'order_created'",
      )
      .pluck()
      .get(),
  );
  assert.throws(
    () =>
      db
        .prepare('UPDATE order_lifecycle_events SET title = ? WHERE id = ?')
        .run('Changed', createdEventId),
    /order_lifecycle_events are immutable/,
  );
});

void test('migration failure rolls back schema changes and propagates', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'shop-migrations-failure-'));
  const db = new Database(join(directory, 'shop.db'));
  t.after(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const failingMigration: Migration = {
    version: '001',
    name: 'failing migration',
    up(database) {
      database.exec('CREATE TABLE should_rollback (id INTEGER PRIMARY KEY)');
      throw new Error('intentional migration failure');
    },
  };

  assert.throws(() => migrateDatabase(db, [failingMigration]), /intentional migration failure/);
  assert.equal(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'should_rollback'")
      .get(),
    undefined,
  );
  assert.deepEqual(migrationVersions(db), []);
});

void test('password reset migration revokes legacy raw tokens and removes their column', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'shop-migrations-reset-token-'));
  const db = new Database(join(directory, 'shop.db'));
  t.after(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  migrateDatabase(db, migrations.slice(0, 5));
  db.exec(`
    ALTER TABLE password_reset_tokens RENAME TO password_reset_tokens_current;
    CREATE TABLE password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    DROP TABLE password_reset_tokens_current;
  `);
  db.prepare(
    `INSERT INTO users (email, display_name, password_hash, password_salt, role)
     VALUES ('legacy-reset@example.test', 'Legacy reset', 'salt.hash', '', 'customer')`,
  ).run();
  db.prepare(
    `INSERT INTO password_reset_tokens (user_id, token, expires_at)
     VALUES (1, 'legacy-plaintext-token', '2099-01-01T00:00:00.000Z')`,
  ).run();

  migrateDatabase(db);
  const columns = db.prepare('PRAGMA table_info(password_reset_tokens)').all() as {
    name: string;
  }[];
  assert.equal(
    columns.some((column) => column.name === 'token'),
    false,
  );
  assert.equal(
    columns.some((column) => column.name === 'token_digest'),
    true,
  );
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS count FROM password_reset_tokens').get() as { count: number })
      .count,
    0,
  );
});

void test('powderizer expansion upgrades 008 mixes with default scheme and rejects corrupt values', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'shop-migrations-powderizer-expansion-'));
  const db = new Database(join(directory, 'shop.db'));
  db.pragma('foreign_keys = ON');
  t.after(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  migrateDatabase(db, migrations.slice(0, 8));
  db.prepare("INSERT INTO carts (id) VALUES ('legacy-mix-cart')").run();
  db.prepare(
    `INSERT INTO powder_mixes
      (id, cart_id, quantity, bag_size_grams, fineness, custom_label, price_version,
       quoted_unit_price_cents, created_at, updated_at)
     VALUES ('legacy-mix', 'legacy-mix-cart', 1, 500, 'standard', NULL, 'powderizer-v1', 1000, 'now', 'now')`,
  ).run();

  // 009's backfill and CHECK are asserted at the version that owns them; the powderizer repository
  // that used to drive this case was deleted with the feature, so the assertions run on raw SQL.
  migrateDatabase(
    db,
    migrations.filter((migration) => migration.version <= '009'),
  );
  assert.deepEqual(
    db.prepare('SELECT bag_colour_scheme FROM powder_mixes WHERE id = ?').get('legacy-mix'),
    { bag_colour_scheme: 'ultraviolet-cyan' },
  );
  assert.throws(
    () =>
      db
        .prepare(
          "UPDATE powder_mixes SET bag_colour_scheme = 'brown-paper' WHERE id = 'legacy-mix'",
        )
        .run(),
    /CHECK constraint failed/,
  );
  db.prepare(
    `INSERT INTO powder_mixes
      (id, cart_id, quantity, bag_size_grams, fineness, bag_colour_scheme, custom_label,
       price_version, quoted_unit_price_cents, created_at, updated_at)
     VALUES ('new-mix', 'legacy-mix-cart', 1, 500, 'standard', 'solar-flare', NULL,
             'powderizer-v1', 1000, 'now', 'now')`,
  ).run();
  assert.deepEqual(
    db.prepare('SELECT bag_colour_scheme FROM powder_mixes WHERE id = ?').get('new-mix'),
    { bag_colour_scheme: 'solar-flare' },
  );

  // The whole feature then leaves in 021.
  migrateDatabase(db);
  assert.deepEqual(migrationVersions(db), expectedVersions);
  assert.equal(tableExists(db, 'powder_mixes'), false);
  assert.equal(tableExists(db, 'powder_mix_components'), false);
});

void test('v017 migration creates return tables and extends inventory movements', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'shop-migrations-returns-'));
  const db = openDatabase({ path: join(directory, 'shop.db') });
  t.after(() => {
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  });

  // Verify all expected return/refund tables exist
  for (const table of [
    'return_requests',
    'return_request_items',
    'return_events',
    'refunds',
    'refund_items',
  ]) {
    assert.deepEqual(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table),
      { name: table },
    );
  }

  // Verify return_events and refunds have immutable triggers
  for (const trigger of [
    'return_events_no_update',
    'return_events_no_delete',
    'refunds_no_update',
    'refunds_no_delete',
    'refund_items_no_update',
    'refund_items_no_delete',
  ]) {
    assert.deepEqual(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = ?").get(trigger),
      { name: trigger },
    );
  }

  // Verify inventory_stock_movements has return_received enum and return_request_id column
  const movementColumns = db.prepare('PRAGMA table_info(inventory_stock_movements)').all() as {
    name: string;
  }[];
  assert.ok(movementColumns.some((col) => col.name === 'return_request_id'));

  // Verify movement_type check includes return_received
  // Insert valid return_received movement (requires return_request)
  db.exec(`
    INSERT INTO products (name, description, price_cents, category, stock_count, image_set_id)
    VALUES ('Test product', 'For return test', 1000, 'Test', 10, 'test-product');
    INSERT INTO product_variants
      (product_id, sku, label, weight_grams, price_cents, stock_count, delivery_class, active, sort_order, created_at, updated_at)
    VALUES (1, 'TEST-RETURN-001', 'Test product (Legacy)', 1000, 1000, 10, 'parcel', 1, 0, datetime('now'), datetime('now'));
    UPDATE products SET default_variant_id = 1 WHERE id = 1;
    INSERT INTO users (email, display_name, password_hash, password_salt, role)
    VALUES ('return-test@example.test', 'Return tester', 'hash', 'salt', 'customer');
    INSERT INTO orders
      (customer_name, customer_email, shipping_address, subtotal_cents, total_cents, created_at, lifecycle_status)
    VALUES ('Return test', 'return-test@example.test', '1 Test Rd', 1000, 1000, '2026-07-01T12:00:00.000Z', 'delivered');
  `);
  const orderId = (
    db.prepare("SELECT id FROM orders WHERE customer_email = 'return-test@example.test'").get() as {
      id: number;
    }
  ).id;

  db.exec(`
    INSERT INTO order_line_items
      (order_id, product_id, product_name, product_price_cents, quantity, line_total_cents)
    VALUES (${orderId}, 1, 'Test product', 1000, 1, 1000);
    INSERT INTO return_requests
      (order_id, user_id, status, reason, version, requested_at, approved_at, received_at)
    VALUES (${orderId}, 1, 'received', 'damaged', 2, '2026-07-02T12:00:00.000Z', '2026-07-02T13:00:00.000Z', '2026-07-03T12:00:00.000Z');
  `);
  const returnId = (
    db.prepare('SELECT id FROM return_requests WHERE order_id = ?').get(orderId) as { id: number }
  ).id;

  // Insert a return_received movement
  db.prepare(
    `
    INSERT INTO inventory_stock_movements
      (variant_id, movement_type, quantity_delta, order_id, order_line_item_id, return_request_id, occurred_at)
    VALUES (1, 'return_received', 1, ${orderId}, 1, ${returnId}, '2026-07-03T12:00:00.000Z')
  `,
  ).run();

  // Verify FK check is clean
  const fkViolations = db.pragma('foreign_key_check') as unknown[];
  assert.equal(fkViolations.length, 0);

  // Verify movement is immutable
  assert.throws(
    () =>
      db
        .prepare('UPDATE inventory_stock_movements SET quantity_delta = 2 WHERE movement_type = ?')
        .run('return_received'),
    /inventory_stock_movements are immutable/,
  );

  // Verify return event immutability
  db.prepare(
    `
    INSERT INTO return_events
      (return_request_id, order_id, event_type, actor_user_id, idempotency_key, request_fingerprint, occurred_at)
    VALUES (${returnId}, ${orderId}, 'return.received', 1, '550e8400-e29b-41d4-a716-446655440000', 'abc123', '2026-07-03T12:00:00.000Z')
  `,
  ).run();
  assert.throws(
    () =>
      db
        .prepare(
          "UPDATE return_events SET event_type = 'return.approved' WHERE idempotency_key = ?",
        )
        .run('550e8400-e29b-41d4-a716-446655440000'),
    /return_events are immutable/,
  );
});

void test('seed and reset operate on a migrated database', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'shop-migrations-seed-'));
  const db = openDatabase({ path: join(directory, 'shop.db') });
  t.after(() => {
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  });

  seedDatabase(db);
  db.prepare("INSERT INTO carts (id) VALUES ('migration-test-cart')").run();
  resetDatabase(db);
  seedDatabase(db);

  assert.equal(
    (db.prepare('SELECT COUNT(*) AS count FROM products').get() as { count: number }).count,
    100,
  );
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS count FROM curated_bundles').get() as { count: number }).count,
    CURATED_BUNDLES.length,
  );
  assert.equal(
    (
      db.prepare('SELECT COUNT(*) AS count FROM curated_bundle_components').get() as {
        count: number;
      }
    ).count,
    CURATED_BUNDLES.reduce((count, bundle) => count + bundle.components.length, 0),
  );
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS count FROM product_tags').get() as { count: number }).count > 0,
    true,
  );
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS count FROM product_specifications').get() as { count: number })
      .count > 0,
    true,
  );
  // Reset clears every cart; the canonical seed then re-creates its UK and DE Alice fixtures, so
  // the post-seed table holds seeded carts only and never the row this test inserted before reset.
  assert.equal(db.prepare("SELECT 1 FROM carts WHERE id = 'migration-test-cart'").get(), undefined);
  assert.deepEqual(
    db.prepare('SELECT DISTINCT country FROM carts ORDER BY country').pluck().all(),
    ['DE', 'UK'],
  );
  assert.deepEqual(migrationVersions(db), expectedVersions);
});

void test('v18 migration backfills variants, rebuilds tables, and preserves data', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'shop-migrations-v18-'));
  const db = new Database(join(directory, 'shop.db'));
  db.pragma('foreign_keys = ON');
  t.after(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  migrateDatabase(
    db,
    migrations.filter((migration) => migration.version < '018'),
  );

  db.exec(`
    INSERT INTO products (id, name, description, price_cents, category, stock_count, image_set_id)
    VALUES
      (51, 'Custom product 51', 'User-created', 999, 'Custom', 10, 'custom-51'),
      (100, 'Custom product 100', 'User-created', 4999, 'Custom', 25, 'custom-100'),
      (1000, 'Custom product 1000', 'User-created', 99, 'Custom', 100, 'custom-1000');
    INSERT INTO users (id, email, display_name, password_hash, password_salt, role)
    VALUES (51, 'v18-user@example.test', 'V18 user', 'hash', 'salt', 'customer');
    INSERT INTO carts (id) VALUES ('v18-cart');
    INSERT INTO cart_line_items (cart_id, product_id, quantity)
    VALUES ('v18-cart', 51, 2), ('v18-cart', 100, 1), ('v18-cart', 1000, 5);
    INSERT INTO orders
      (id, customer_name, customer_email, shipping_address, subtotal_cents, total_cents, lifecycle_status, version)
    VALUES (51, 'V18 customer', 'v18@example.test', '51 Test Rd', 999, 999, 'processing', 0);
    INSERT INTO order_line_items
      (order_id, product_id, product_name, product_price_cents, quantity, line_total_cents)
    VALUES (51, 51, 'Custom product 51', 999, 2, 1998);
    INSERT INTO payments
      (id, idempotency_key, request_fingerprint, status, amount_cents, card_last4, card_brand)
    VALUES (51, 'v18-payment-key', 'v18-fingerprint', 'succeeded', 999, '4242', 'Visa');
    INSERT INTO curated_bundles (id, key, name, description, active, sort_order)
    VALUES (51, 'v18-bundle', 'V18 bundle', 'V18 test bundle', 1, 51);
    INSERT INTO curated_bundle_components (bundle_id, product_id, quantity, sort_order)
    VALUES (51, 51, 1, 51);
    INSERT INTO powder_mixes
      (id, cart_id, quantity, bag_size_grams, fineness, custom_label, price_version,
       quoted_unit_price_cents, created_at, updated_at)
    VALUES ('v18-mix', 'v18-cart', 1, 500, 'standard', NULL, 'powderizer-v1', 1000,
            datetime('now'), datetime('now'));
    INSERT INTO powder_mix_components (mix_id, product_id, percentage, allocated_grams)
    VALUES ('v18-mix', 51, 100, 500);
  `);

  const orderCountBefore = (
    db.prepare('SELECT COUNT(*) AS count FROM orders').get() as { count: number }
  ).count;
  const paymentCountBefore = (
    db.prepare('SELECT COUNT(*) AS count FROM payments').get() as { count: number }
  ).count;
  const cartLineCountBefore = (
    db.prepare('SELECT COUNT(*) AS count FROM cart_line_items').get() as { count: number }
  ).count;
  const productRowCountBefore = (
    db.prepare('SELECT COUNT(*) AS count FROM products').get() as { count: number }
  ).count;
  const mixCountBefore = (
    db.prepare('SELECT COUNT(*) AS count FROM powder_mixes').get() as { count: number }
  ).count;

  migrateDatabase(db, prePowderizerRemoval);

  assert.deepEqual(
    db.prepare('SELECT moq_sacks FROM product_variants WHERE product_id = ?').get(51),
    { moq_sacks: 4 },
  );

  // Verify all products have default variants
  assert.equal(
    (
      db
        .prepare('SELECT COUNT(*) AS count FROM products WHERE default_variant_id IS NULL')
        .get() as { count: number }
    ).count,
    0,
  );
  // 018 backfills exactly one default variant per product, so the variant count starts equal to
  // the pre-migration product count. Tracked separately from here on: the two tables are distinct
  // invariants and a later migration could move one without the other.
  const variantRowCountAfterV18 = (
    db.prepare('SELECT COUNT(*) AS count FROM product_variants').get() as { count: number }
  ).count;
  assert.equal(variantRowCountAfterV18, productRowCountBefore);

  // Verify product 51's variant
  const variant51 = db
    .prepare(
      `SELECT v.sku, v.label, v.weight_grams, v.price_cents, v.stock_count, v.delivery_class, v.active, v.sort_order
       FROM product_variants v
       JOIN products p ON p.default_variant_id = v.id
       WHERE p.id = 51`,
    )
    .get() as Record<string, unknown>;
  assert.equal(variant51.sku, 'LEGACY-51-001');
  assert.equal(variant51.label, 'Custom product 51 (Legacy)');
  assert.equal(variant51.weight_grams, 1000);
  assert.equal(variant51.price_cents, 999);
  assert.equal(variant51.stock_count, 10);
  assert.equal(variant51.delivery_class, 'parcel');
  assert.equal(variant51.active, 1);

  // Verify product 1000's variant
  const variant1000 = db
    .prepare(
      `SELECT sku FROM product_variants v
       JOIN products p ON p.default_variant_id = v.id
       WHERE p.id = 1000`,
    )
    .get() as { sku: string };
  assert.equal(variant1000.sku, 'LEGACY-1000-001');

  // Verify cart_line_items rebuilt with variant_id
  const cartLines = db
    .prepare(
      `SELECT cart_id, variant_id, quantity FROM cart_line_items
       WHERE cart_id = 'v18-cart' ORDER BY variant_id`,
    )
    .all() as Array<{ cart_id: string; variant_id: number; quantity: number }>;
  assert.equal(cartLines.length, cartLineCountBefore);

  // Verify UNIQUE(cart_id, variant_id) constraint
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO cart_line_items (cart_id, variant_id, quantity, created_at, updated_at)
           VALUES ('v18-cart', ?, 1, datetime('now'), datetime('now'))`,
        )
        .run(cartLines[0].variant_id),
    /UNIQUE constraint failed/,
  );

  // Powder mixes survive
  assert.equal(
    (
      db.prepare("SELECT COUNT(*) AS count FROM powder_mixes WHERE id = 'v18-mix'").get() as {
        count: number;
      }
    ).count,
    1,
  );
  assert.equal(
    (
      db
        .prepare("SELECT COUNT(*) AS count FROM powder_mix_components WHERE mix_id = 'v18-mix'")
        .get() as { count: number }
    ).count,
    1,
  );

  // Order/payment counts unchanged
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS count FROM orders').get() as { count: number }).count,
    orderCountBefore,
  );
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS count FROM payments').get() as { count: number }).count,
    paymentCountBefore,
  );

  // New product columns exist
  const productColumns = db.prepare('PRAGMA table_info(products)').all() as { name: string }[];
  for (const col of [
    'consumption_classification',
    'mixing_group',
    'details_json',
    'default_variant_id',
    'blend_source_variant_id',
  ]) {
    assert.ok(
      productColumns.some((c) => c.name === col),
      `Missing column: ${col}`,
    );
  }

  // New order columns exist
  const orderColumns = db.prepare('PRAGMA table_info(orders)').all() as { name: string }[];
  for (const col of ['delivery_mode', 'delivery_charge_cents', 'delivery_weight_grams']) {
    assert.ok(
      orderColumns.some((c) => c.name === col),
      `Missing column: ${col}`,
    );
  }

  // New order_line_items columns exist
  const oliColumns = db.prepare('PRAGMA table_info(order_line_items)').all() as { name: string }[];
  for (const col of [
    'variant_id',
    'sku',
    'variant_label',
    'weight_grams',
    'consumption_classification',
    'delivery_class',
  ]) {
    assert.ok(
      oliColumns.some((c) => c.name === col),
      `Missing column: ${col}`,
    );
  }

  // bundle_components has variant_id
  const bundleCols = db.prepare('PRAGMA table_info(curated_bundle_components)').all() as {
    name: string;
  }[];
  assert.ok(bundleCols.some((c) => c.name === 'variant_id'));

  // PRAGMA foreign_key_check is clean
  const fkViolations = db.pragma('foreign_key_check') as unknown[];
  assert.equal(fkViolations.length, 0);

  assert.equal(
    (db.prepare('SELECT COUNT(*) AS count FROM powder_mixes').get() as { count: number }).count,
    mixCountBefore,
  );

  // 021 lands on top of the same fixture: the mixes go, everything else stays.
  migrateDatabase(db);
  assert.deepEqual(migrationVersions(db), expectedVersions);
  assert.equal(tableExists(db, 'powder_mixes'), false);
  assert.equal(tableExists(db, 'powder_mix_components'), false);
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS count FROM product_variants').get() as { count: number }).count,
    variantRowCountAfterV18,
  );
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS count FROM products').get() as { count: number }).count,
    productRowCountBefore,
  );
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS count FROM orders').get() as { count: number }).count,
    orderCountBefore,
  );
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS count FROM payments').get() as { count: number }).count,
    paymentCountBefore,
  );

  // Idempotency: running migration again doesn't corrupt
  migrateDatabase(db);
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS count FROM product_variants').get() as { count: number }).count,
    variantRowCountAfterV18,
  );
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS count FROM orders').get() as { count: number }).count,
    orderCountBefore,
  );
  const fkViolations2 = db.pragma('foreign_key_check') as unknown[];
  assert.equal(fkViolations2.length, 0);
});

void test('v18 migration rollback on corrupt product data', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'shop-migrations-v18-rollback-'));
  const db = new Database(join(directory, 'shop.db'));
  db.pragma('foreign_keys = ON');
  t.after(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  migrateDatabase(
    db,
    migrations.filter((migration) => migration.version < '018'),
  );

  db.exec(`
    INSERT INTO products (id, name, description, price_cents, category, stock_count, image_set_id)
    VALUES (51, 'Good product', 'Ok', 1000, 'Test', 5, 'good');
    INSERT INTO products (id, name, description, price_cents, category, stock_count, image_set_id)
    VALUES (100, 'Another', 'Ok', 500, 'Test', 1, 'another');
  `);

  // Corrupt: pre-create product_variants with a SKU that will conflict with backfill
  db.exec(`
    CREATE TABLE product_variants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id),
      sku TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      weight_grams INTEGER NOT NULL,
      price_cents INTEGER NOT NULL,
      compare_at_price_cents INTEGER,
      stock_count INTEGER NOT NULL DEFAULT 0,
      backorderable INTEGER NOT NULL DEFAULT 0,
      backorder_lead_days INTEGER,
      delivery_class TEXT NOT NULL DEFAULT 'parcel',
      active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(product_id, sort_order)
    );
    INSERT INTO product_variants
      (product_id, sku, label, weight_grams, price_cents, stock_count, delivery_class, active, sort_order, created_at, updated_at)
    VALUES (51, 'LEGACY-51-001', 'Conflicting variant', 1000, 999, 5, 'parcel', 1, 0, datetime('now'), datetime('now'));
  `);

  // Migration should fail on duplicate SKU
  assert.throws(() => migrateDatabase(db), /UNIQUE constraint failed/);

  // DB should still have the corrupt variant row, unchanged
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS count FROM product_variants').get() as { count: number }).count,
    1,
  );
  // Products table was rolled back — no v18 columns exist
  const productCols = db.prepare('PRAGMA table_info(products)').all() as { name: string }[];
  assert.ok(!productCols.some((c) => c.name === 'consumption_classification'));
});

void test('v18 migration creates fresh inventory tables when 015 skipped', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'shop-migrations-v18-015skip-'));
  const db = new Database(join(directory, 'shop.db'));
  db.pragma('foreign_keys = ON');
  t.after(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  migrateDatabase(
    db,
    migrations.filter((migration) => migration.version < '015'),
  );

  db.exec(`
    INSERT INTO products (id, name, description, price_cents, category, stock_count)
    VALUES (51, 'Skip test', 'Skip test', 500, 'Test', 3);
    INSERT INTO users (email, display_name, password_hash, password_salt, role)
    VALUES ('skip@example.test', 'Skip user', 'hash', 'salt', 'customer');
  `);

  migrateDatabase(db);

  // v18 should create inventory tables with variant_id
  const tables = [
    'inventory_reservations',
    'order_inventory_allocations',
    'inventory_stock_movements',
  ];
  for (const table of tables) {
    assert.deepEqual(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table),
      { name: table },
    );
  }

  // Verify variant_id column exists (not product_id)
  const resCols = db.prepare('PRAGMA table_info(inventory_reservations)').all() as {
    name: string;
  }[];
  assert.ok(resCols.some((c) => c.name === 'variant_id'));
  assert.ok(!resCols.some((c) => c.name === 'product_id'));

  // FK check clean
  const fkViolations = db.pragma('foreign_key_check') as unknown[];
  assert.equal(fkViolations.length, 0);
});

void test('v20 migration retires legacy sort_order < 1 variants once a canonical variant exists', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'shop-migrations-v20-'));
  const db = new Database(join(directory, 'shop.db'));
  db.pragma('foreign_keys = ON');
  t.after(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  migrateDatabase(
    db,
    migrations.filter((migration) => migration.version < '018'),
  );

  db.exec(`
    INSERT INTO products (id, name, description, price_cents, category, stock_count, image_set_id)
    VALUES
      (9001, 'Gains a canonical variant', 'v20 legacy retirement fixture', 5000, 'Test', 20, 'v20-canonical'),
      (9002, 'Legacy only', 'v20 legacy retirement fixture', 3000, 'Test', 10, 'v20-legacy-only');
  `);

  // Run up through 018 so the legacy sort_order 0 backfill happens before either product has a
  // canonical (sort_order >= 1) variant, reproducing the real defect shape.
  migrateDatabase(
    db,
    migrations.filter((migration) => migration.version <= '018'),
  );

  const legacyVariant9001 = db
    .prepare('SELECT id FROM product_variants WHERE product_id = 9001 AND sort_order = 0')
    .get() as { id: number };
  const legacyVariant9002 = db
    .prepare('SELECT id FROM product_variants WHERE product_id = 9002 AND sort_order = 0')
    .get() as { id: number };

  db.exec(`
    INSERT INTO carts (id) VALUES ('v20-cart');
    INSERT INTO cart_line_items (cart_id, variant_id, quantity, created_at, updated_at)
    VALUES ('v20-cart', ${legacyVariant9001.id}, 3, datetime('now'), datetime('now'));
  `);

  // Product 9001 now gains a real catalog variant while its default_variant_id still points at
  // the legacy row -- the exact state 020 must repair.
  const canonicalCreatedAt = '2026-01-01T00:00:00.000Z';
  db.prepare(
    `INSERT INTO product_variants
       (product_id, sku, label, weight_grams, price_cents, stock_count, delivery_class,
        active, sort_order, created_at, updated_at)
     VALUES (?, 'V20-CANONICAL-001', 'Canonical pallet', 25000, 6000, 15, 'pallet', 1, 1, ?, ?)`,
  ).run(9001, canonicalCreatedAt, canonicalCreatedAt);

  migrateDatabase(db);

  assert.deepEqual(migrationVersions(db), expectedVersions);

  // Legacy variant for product 9001 deactivated; row and its identity are retained.
  assert.deepEqual(
    db.prepare('SELECT active, sku FROM product_variants WHERE id = ?').get(legacyVariant9001.id),
    { active: 0, sku: 'LEGACY-9001-001' },
  );

  // default_variant_id repointed at the surviving canonical variant.
  const canonicalVariant = db
    .prepare('SELECT id FROM product_variants WHERE product_id = 9001 AND sort_order = 1')
    .get() as { id: number };
  assert.equal(
    (
      db.prepare('SELECT default_variant_id FROM products WHERE id = 9001').get() as {
        default_variant_id: number;
      }
    ).default_variant_id,
    canonicalVariant.id,
  );

  // Legacy-only product 9002 is untouched: its sole variant stays active and default.
  assert.deepEqual(
    db.prepare('SELECT active FROM product_variants WHERE id = ?').get(legacyVariant9002.id),
    { active: 1 },
  );
  assert.equal(
    (
      db.prepare('SELECT default_variant_id FROM products WHERE id = 9002').get() as {
        default_variant_id: number;
      }
    ).default_variant_id,
    legacyVariant9002.id,
  );

  // FK reference from the cart line survives deactivation -- retired, never deleted.
  assert.deepEqual(
    db
      .prepare('SELECT variant_id, quantity FROM cart_line_items WHERE cart_id = ?')
      .get('v20-cart'),
    { variant_id: legacyVariant9001.id, quantity: 3 },
  );

  const fkViolationsAfter = db.pragma('foreign_key_check') as unknown[];
  assert.equal(fkViolationsAfter.length, 0);

  // Mapped product 9001 still satisfies the Product contract.
  const productRow9001 = db.prepare('SELECT * FROM products WHERE id = 9001').get() as ProductRow;
  const mappedProduct9001 = toProductContract(productRow9001);
  assert.equal(
    Value.Check(Product, {
      ...mappedProduct9001,
      availability: 'in_stock',
      backorderable: false,
      backorderLeadDays: null,
    }),
    true,
  );

  // Idempotent: re-running the migration body directly changes nothing further.
  const retireMigration = migrations.find((migration) => migration.version === '020')!;
  assert.doesNotThrow(() => retireMigration.up(db));
  assert.deepEqual(
    db.prepare('SELECT active FROM product_variants WHERE id = ?').get(legacyVariant9001.id),
    { active: 0 },
  );
  assert.equal(
    (
      db.prepare('SELECT default_variant_id FROM products WHERE id = 9001').get() as {
        default_variant_id: number;
      }
    ).default_variant_id,
    canonicalVariant.id,
  );
  const fkViolationsIdempotent = db.pragma('foreign_key_check') as unknown[];
  assert.equal(fkViolationsIdempotent.length, 0);
});

void test('v21 migration removes powderizer persistence and rebuilds the tables it touched', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'shop-migrations-v21-'));
  const db = new Database(join(directory, 'shop.db'));
  db.pragma('foreign_keys = ON');
  t.after(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  migrateDatabase(db, prePowderizerRemoval);

  // Fixture spans every surface 021 touches: a product with mixing columns, a mix-bearing order
  // with both allocation kinds on one shipment, and both reservation demand kinds on one payment.
  db.exec(`
    INSERT INTO products (id, name, description, price_cents, category, stock_count, image_set_id, mixable, mix_unit_grams)
    VALUES (901, 'V21 lot', 'v21 fixture', 5000, 'Test', 12, 'v21-lot', 1, 25000);
    INSERT INTO product_variants
      (id, product_id, sku, label, weight_grams, price_cents, stock_count, delivery_class, active, sort_order, created_at, updated_at)
    VALUES (901, 901, 'V21-LOT-001', 'V21 sack', 25000, 5000, 12, 'freight', 1, 1, '2026-01-01', '2026-01-01');
    UPDATE products SET default_variant_id = 901 WHERE id = 901;
    INSERT INTO users (id, email, display_name, password_hash, password_salt, role)
    VALUES (901, 'v21@example.test', 'V21 user', 'hash', 'salt', 'customer');
    INSERT INTO orders
      (id, customer_name, customer_email, shipping_address, subtotal_cents, total_cents, created_at, lifecycle_status, version)
    VALUES (901, 'V21 customer', 'v21@example.test', '9 V21 Road', 5000, 5000, '2026-07-01T12:00:00.000Z', 'shipped', 1);
    INSERT INTO order_line_items
      (id, order_id, product_id, product_name, product_price_cents, quantity, line_total_cents, variant_id)
    VALUES (901, 901, 901, 'V21 lot', 5000, 1, 5000, 901);
    INSERT INTO order_powder_mix_items (id, order_id, snapshot_json)
    VALUES (901, 901, '{"snapshotVersion":2}');
    INSERT INTO order_shipments
      (id, order_id, shipment_number, status, tracking_reference, version, created_at, updated_at)
    VALUES (901, 901, 1, 'shipped', 'V21-TRACK-01', 1, '2026-07-01T12:00:00.000Z', '2026-07-01T12:00:00.000Z');
    INSERT INTO order_shipment_items (shipment_id, order_line_item_id, quantity) VALUES (901, 901, 1);
    INSERT INTO order_shipment_items (shipment_id, order_powder_mix_item_id, quantity) VALUES (901, 901, 1);
    INSERT INTO payments
      (order_id, idempotency_key, request_fingerprint, status, amount_cents, card_last4, card_brand, created_at)
    VALUES (901, 'v21-payment', 'v21-fingerprint', 'succeeded', 5000, '4242', 'Visa', '2026-07-01T12:00:00.000Z');
    INSERT INTO inventory_reservations
      (payment_idempotency_key, variant_id, demand_kind, reserved_quantity, backordered_quantity, expires_at, created_at)
    VALUES ('v21-payment', 901, 'product', 3, 0, NULL, '2026-07-01T12:00:00.000Z'),
           ('v21-payment', 901, 'powder_mix', 2, 0, NULL, '2026-07-01T12:00:00.000Z');
    INSERT INTO carts (id) VALUES ('v21-cart');
    INSERT INTO powder_mixes
      (id, cart_id, quantity, bag_size_grams, fineness, bag_colour_scheme, custom_label,
       price_version, quoted_unit_price_cents, created_at, updated_at)
    VALUES ('v21-mix', 'v21-cart', 1, 500, 'standard', 'solar-flare', NULL, 'powderizer-v1', 1000, 'now', 'now');
    INSERT INTO powder_mix_components (mix_id, product_id, percentage, allocated_grams)
    VALUES ('v21-mix', 901, 100, 500);
    -- Children of products that cascade on delete. The products rebuild drops the parent table, so
    -- these are exactly the rows a broken FK suspension would silently take with it while the
    -- products count still came out right.
    INSERT INTO reviews (id, product_id, user_id, rating, body, status)
    VALUES (901, 901, 901, 5, 'V21 fixture review body, long enough to pass the length check.', 'published');
    -- review_rating_aggregates is filled by the 016 triggers on the insert above, not by hand.
    INSERT INTO favourites (id, user_id, product_id) VALUES (901, 901, 901);
    INSERT INTO catalog_tags (key, label) VALUES ('v21-tag', 'V21 tag');
    INSERT INTO product_tags (product_id, tag_key) VALUES (901, 'v21-tag');
    INSERT INTO product_specifications (product_id, specification_key, value_key, display_value)
    VALUES (901, 'v21-spec', 'v21-value', 'V21 value');
  `);

  const productSequenceBefore = db
    .prepare("SELECT seq FROM sqlite_sequence WHERE name = 'products'")
    .pluck()
    .get();
  const productCountBefore = (
    db.prepare('SELECT COUNT(*) AS count FROM products').get() as { count: number }
  ).count;

  migrateDatabase(db);
  assert.deepEqual(migrationVersions(db), expectedVersions);

  for (const table of [
    'powder_mixes',
    'powder_mix_components',
    'order_powder_mix_items',
    'powder_mix_stock_reservations',
  ]) {
    assert.equal(tableExists(db, table), false, `${table} should be dropped by 021`);
  }

  // order_shipment_items: product allocation survives, mix allocation is gone, indexes rebuilt.
  assert.deepEqual(columnNames(db, 'order_shipment_items'), [
    'shipment_id',
    'order_line_item_id',
    'quantity',
  ]);
  assert.deepEqual(indexNames(db, 'order_shipment_items'), [
    'order_shipment_items_order_line_item_idx',
    'sqlite_autoindex_order_shipment_items_1',
  ]);
  assert.deepEqual(db.prepare('SELECT * FROM order_shipment_items').all(), [
    { shipment_id: 901, order_line_item_id: 901, quantity: 1 },
  ]);
  assert.throws(
    () =>
      db.prepare('INSERT INTO order_shipment_items (shipment_id, quantity) VALUES (901, 1)').run(),
    /NOT NULL constraint failed/,
  );

  // inventory_reservations: demand_kind gone, PK narrowed, mix lease dropped, indexes rebuilt.
  assert.deepEqual(columnNames(db, 'inventory_reservations'), [
    'payment_idempotency_key',
    'variant_id',
    'reserved_quantity',
    'backordered_quantity',
    'expires_at',
    'created_at',
  ]);
  assert.deepEqual(primaryKeyColumns(db, 'inventory_reservations'), [
    'payment_idempotency_key',
    'variant_id',
  ]);
  assert.deepEqual(indexNames(db, 'inventory_reservations'), [
    'inventory_reservations_payment_idx',
    'inventory_reservations_variant_expiry_idx',
    'sqlite_autoindex_inventory_reservations_1',
  ]);
  assert.deepEqual(
    db
      .prepare(
        'SELECT payment_idempotency_key, variant_id, reserved_quantity FROM inventory_reservations',
      )
      .all(),
    [{ payment_idempotency_key: 'v21-payment', variant_id: 901, reserved_quantity: 3 }],
  );
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO inventory_reservations
             (payment_idempotency_key, variant_id, reserved_quantity, backordered_quantity, created_at)
           VALUES ('v21-payment', 901, 1, 0, '2026-07-01T12:00:00.000Z')`,
        )
        .run(),
    /UNIQUE constraint failed/,
  );

  // products: mixing columns dropped, rows preserved, indexes/triggers/sequence restored.
  assert.equal(columnNames(db, 'products').includes('mixable'), false);
  assert.equal(columnNames(db, 'products').includes('mix_unit_grams'), false);
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS count FROM products').get() as { count: number }).count,
    productCountBefore,
  );
  assert.deepEqual(
    db
      .prepare('SELECT id, name, stock_count, default_variant_id FROM products WHERE id = 901')
      .get(),
    { id: 901, name: 'V21 lot', stock_count: 12, default_variant_id: 901 },
  );
  assert.deepEqual(indexNames(db, 'products'), [
    'products_active_created_at_id_idx',
    'products_active_price_cents_id_idx',
  ]);
  assert.deepEqual(
    (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'products'")
        .all() as { name: string }[]
    )
      .map((row) => row.name)
      .sort(),
    [
      'products_backorder_insert_valid',
      'products_backorder_update_valid',
      'products_stock_count_insert_valid',
      'products_stock_count_update_valid',
    ],
  );
  assert.throws(
    () => db.prepare('UPDATE products SET stock_count = -1 WHERE id = 901').run(),
    /products.stock_count must be a nonnegative integer/,
  );
  assert.equal(
    db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'products'").pluck().get(),
    productSequenceBefore,
  );

  // The products rebuild must not cascade-wipe the tables hanging off products. Asserted per table
  // because the products row count alone stays correct even when every child is gone.
  for (const [table, expected] of [
    ['reviews', 1],
    ['review_rating_aggregates', 1],
    ['product_tags', 1],
    ['product_specifications', 1],
  ] as const) {
    assert.equal(
      (
        db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE product_id = 901`).get() as {
          count: number;
        }
      ).count,
      expected,
      `${table} rows for product 901 must survive the products rebuild`,
    );
  }
  assert.deepEqual(
    db.prepare('SELECT COUNT(*) AS count FROM saved_list_items WHERE variant_id = 901').get(),
    { count: 1 },
  );
  assert.deepEqual(
    db
      .prepare('SELECT product_id, published_count, rating_sum FROM review_rating_aggregates')
      .all(),
    [{ product_id: 901, published_count: 1, rating_sum: 5 }],
  );

  assert.equal((db.pragma('foreign_key_check') as unknown[]).length, 0);

  // Re-applying the migration body directly is a no-op.
  const removal = migrations.find((migration) => migration.version === '021')!;
  assert.doesNotThrow(() => removal.up(db));
  assert.deepEqual(columnNames(db, 'order_shipment_items'), [
    'shipment_id',
    'order_line_item_id',
    'quantity',
  ]);
  assert.equal(columnNames(db, 'products').includes('mixable'), false);
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS count FROM products').get() as { count: number }).count,
    productCountBefore,
  );
  assert.equal((db.pragma('foreign_key_check') as unknown[]).length, 0);

  // And the whole chain is idempotent through the runner too.
  migrateDatabase(db);
  assert.deepEqual(migrationVersions(db), expectedVersions);
  assert.equal((db.pragma('foreign_key_check') as unknown[]).length, 0);
});

void test('v22 migration preserves populated 021 cart/order rows and dependent references', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'shop-migrations-v22-'));
  const db = new Database(join(directory, 'shop.db'));
  db.pragma('foreign_keys = ON');
  t.after(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  migrateDatabase(db, preCustomBlendsMigration);
  db.exec(`
    INSERT INTO products (id, name, description, price_cents, category, stock_count, image_set_id)
    VALUES (2201, 'V22 lot', 'V22 fixture', 5000, 'Test', 12, 'v22-lot');
    INSERT INTO product_variants
      (id, product_id, sku, label, weight_grams, price_cents, stock_count, delivery_class, active, sort_order, created_at, updated_at)
    VALUES (2201, 2201, 'V22-LOT-001', 'V22 sack', 25000, 5000, 12, 'freight', 1, 1, '2026-01-01', '2026-01-01');
    UPDATE products SET default_variant_id = 2201 WHERE id = 2201;
    INSERT INTO users (id, email, display_name, password_hash, password_salt, role)
    VALUES (2201, 'v22@example.test', 'V22 user', 'hash', 'salt', 'customer');
    INSERT INTO carts (id, created_at, updated_at)
    VALUES ('00000000-0000-4000-8000-000000002201', '2026-07-01T12:00:00.000Z', '2026-07-01T12:00:00.000Z');
    INSERT INTO cart_line_items (id, cart_id, variant_id, quantity, created_at, updated_at)
    VALUES (2201, '00000000-0000-4000-8000-000000002201', 2201, 3, '2026-07-01T12:00:00.000Z', '2026-07-02T12:00:00.000Z');
    INSERT INTO orders
      (id, customer_name, customer_email, shipping_address, subtotal_cents, total_cents, created_at, lifecycle_status, version)
    VALUES (2201, 'V22 customer', 'v22-order@example.test', '22 V22 Road', 15000, 15000, '2026-07-01T12:00:00.000Z', 'shipped', 1);
    INSERT INTO order_line_items
      (id, order_id, product_id, product_name, product_price_cents, quantity, line_total_cents,
       variant_id, sku, variant_label, weight_grams, consumption_classification, delivery_class)
    VALUES (2201, 2201, 2201, 'V22 lot', 5000, 3, 15000,
            2201, 'V22-LOT-001', 'V22 sack', 25000, 'non-food', 'freight');
    INSERT INTO order_shipments
      (id, order_id, shipment_number, status, tracking_reference, version, created_at, updated_at)
    VALUES (2201, 2201, 1, 'delivered', 'V22-TRACK-01', 1, '2026-07-02T12:00:00.000Z', '2026-07-02T12:00:00.000Z');
    INSERT INTO order_shipment_items (shipment_id, order_line_item_id, quantity)
    VALUES (2201, 2201, 3);
    INSERT INTO order_inventory_allocations
      (order_line_item_id, variant_id, allocated_quantity, backordered_quantity, cancelled_quantity,
       stock_debited_quantity, created_at, updated_at)
    VALUES (2201, 2201, 3, 0, 0, 3, '2026-07-01T12:00:00.000Z', '2026-07-01T12:00:00.000Z');
    INSERT INTO inventory_stock_movements
      (id, variant_id, movement_type, quantity_delta, order_id, order_line_item_id, occurred_at)
    VALUES (2201, 2201, 'checkout_consumed', -3, 2201, 2201, '2026-07-01T12:00:00.000Z');
    INSERT INTO return_requests
      (id, order_id, user_id, status, reason, version, requested_at)
    VALUES (2201, 2201, 2201, 'requested', 'damaged', 0, '2026-07-03T12:00:00.000Z');
    INSERT INTO return_request_items
      (id, return_request_id, shipment_id, order_line_item_id, quantity, product_name, delivered_at, window_closes_at)
    VALUES (2201, 2201, 2201, 2201, 1, 'V22 lot', '2026-07-02T12:00:00.000Z', '2026-08-01T12:00:00.000Z');
  `);

  migrateDatabase(db);
  assert.deepEqual(migrationVersions(db), expectedVersions);
  assert.deepEqual(
    db
      .prepare(
        `SELECT id, cart_id, variant_id, quantity, created_at, updated_at, config_key, custom_blend_json
         FROM cart_line_items WHERE id = 2201`,
      )
      .get(),
    {
      id: 2201,
      cart_id: '00000000-0000-4000-8000-000000002201',
      variant_id: 2201,
      quantity: 3,
      created_at: '2026-07-01T12:00:00.000Z',
      updated_at: '2026-07-02T12:00:00.000Z',
      config_key: '',
      custom_blend_json: null,
    },
  );
  assert.deepEqual(
    db
      .prepare(
        `SELECT id, order_id, product_id, product_name, product_price_cents, quantity, line_total_cents,
                variant_id, sku, variant_label, weight_grams, consumption_classification, delivery_class,
                discountable_total_cents, blending_fee_cents, custom_blend_json
         FROM order_line_items WHERE id = 2201`,
      )
      .get(),
    {
      id: 2201,
      order_id: 2201,
      product_id: 2201,
      product_name: 'V22 lot',
      product_price_cents: 5000,
      quantity: 3,
      line_total_cents: 15000,
      variant_id: 2201,
      sku: 'V22-LOT-001',
      variant_label: 'V22 sack',
      weight_grams: 25000,
      consumption_classification: 'non-food',
      delivery_class: 'freight',
      discountable_total_cents: 15000,
      blending_fee_cents: 0,
      custom_blend_json: null,
    },
  );
  for (const [table, column] of [
    ['order_shipment_items', 'order_line_item_id'],
    ['order_inventory_allocations', 'order_line_item_id'],
    ['inventory_stock_movements', 'order_line_item_id'],
    ['return_request_items', 'order_line_item_id'],
  ] as const) {
    assert.deepEqual(
      db.prepare(`SELECT ${column} FROM ${table} WHERE ${column} = 2201`).get(),
      { [column]: 2201 },
      `${table} must retain its order line reference`,
    );
  }
  assert.ok(
    indexNames(db, 'order_line_items').includes('order_line_items_product_id_order_id_idx'),
  );
  assert.equal((db.pragma('foreign_key_check') as unknown[]).length, 0);

  const configKey = 'a'.repeat(64);
  const customBlendJson = JSON.stringify({ configKey });
  db.prepare(
    `INSERT INTO cart_line_items
      (cart_id, variant_id, quantity, created_at, updated_at, config_key, custom_blend_json)
     VALUES (?, 2201, 1, '2026-07-03T12:00:00.000Z', '2026-07-03T12:00:00.000Z', ?, ?)`,
  ).run('00000000-0000-4000-8000-000000002201', configKey, customBlendJson);
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO cart_line_items
            (cart_id, variant_id, quantity, created_at, updated_at, config_key, custom_blend_json)
           VALUES ('00000000-0000-4000-8000-000000002201', 2201, 1, '2026-07-03', '2026-07-03', '', '{}')`,
        )
        .run(),
    /CHECK constraint failed|malformed JSON/,
  );
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO cart_line_items
            (cart_id, variant_id, quantity, created_at, updated_at, config_key, custom_blend_json)
           VALUES ('00000000-0000-4000-8000-000000002201', 2201, 1, '2026-07-03', '2026-07-03', ?, '{not-json}')`,
        )
        .run('b'.repeat(64)),
    /CHECK constraint failed|malformed JSON/,
  );
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO order_line_items
            (order_id, product_id, product_name, product_price_cents, quantity, line_total_cents,
             discountable_total_cents, blending_fee_cents, custom_blend_json)
           VALUES (2201, 2201, 'Invalid', 1, 1, 100, -1, 0, NULL)`,
        )
        .run(),
    /CHECK constraint failed|malformed JSON/,
  );
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO order_line_items
            (order_id, product_id, product_name, product_price_cents, quantity, line_total_cents,
             discountable_total_cents, blending_fee_cents, custom_blend_json)
           VALUES (2201, 2201, 'Invalid JSON', 1, 1, 100, 100, 0, '{not-json}')`,
        )
        .run(),
    /CHECK constraint failed|malformed JSON/,
  );
});

void test('v23 adds trade account tables and additive order checkout-depth columns', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'shop-migrations-v23-'));
  const db = new Database(join(directory, 'shop.db'));
  db.pragma('foreign_keys = ON');
  t.after(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  migrateDatabase(db, preCheckoutDepthMigration);
  assert.equal(tableExists(db, 'delivery_sites'), false);
  assert.equal(tableExists(db, 'billing_entities'), false);
  db.exec(`
    INSERT INTO users (id, email, display_name, password_hash, password_salt, role)
    VALUES
      (2301, 'v23-buyer@example.test', 'V23 buyer', 'hash', 'salt', 'customer'),
      (2302, 'v23-other@example.test', 'V23 other', 'hash', 'salt', 'customer');
    INSERT INTO orders
      (id, customer_name, customer_email, shipping_address, subtotal_cents, total_cents,
       created_at, lifecycle_status, version)
    VALUES (2301, 'V23 legacy customer', 'v23-order@example.test', '23 Legacy Road',
            15000, 15000, '2026-07-01T12:00:00.000Z', 'shipped', 1);
  `);

  migrateDatabase(db);
  assert.deepEqual(migrationVersions(db), expectedVersions);

  // Pre-existing orders survive untouched and carry NULL in every new column.
  assert.deepEqual(
    db
      .prepare(
        `SELECT customer_name, shipping_address, subtotal_cents, total_cents, lifecycle_status,
                delivery_site_id, delivery_address_json, billing_entity_json,
                delivery_slot_date, delivery_slot_window, purchase_order_reference
         FROM orders WHERE id = 2301`,
      )
      .get(),
    {
      customer_name: 'V23 legacy customer',
      shipping_address: '23 Legacy Road',
      subtotal_cents: 15000,
      total_cents: 15000,
      lifecycle_status: 'shipped',
      delivery_site_id: null,
      delivery_address_json: null,
      billing_entity_json: null,
      delivery_slot_date: null,
      delivery_slot_window: null,
      purchase_order_reference: null,
    },
  );

  for (const column of [
    'user_id',
    'label',
    'contact_name',
    'contact_phone',
    'address_line1',
    'address_line2',
    'address_city',
    'address_region',
    'address_postcode',
    'address_country_code',
    'is_default',
    'active',
    'created_at',
    'updated_at',
  ]) {
    assert.ok(columnNames(db, 'delivery_sites').includes(column), `delivery_sites.${column}`);
  }
  for (const column of [
    'user_id',
    'legal_name',
    'registration_number',
    'vat_number',
    'address_line1',
    'address_city',
    'address_postcode',
    'address_country_code',
    'is_default',
    'active',
    'created_at',
    'updated_at',
  ]) {
    assert.ok(columnNames(db, 'billing_entities').includes(column), `billing_entities.${column}`);
  }
  for (const index of [
    'delivery_sites_user_label_active_idx',
    'delivery_sites_user_default_idx',
    'delivery_sites_user_active_idx',
    'billing_entities_user_legal_name_active_idx',
    'billing_entities_user_default_idx',
    'billing_entities_user_active_idx',
    'orders_purchase_order_reference_idx',
  ]) {
    assert.deepEqual(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?").get(index),
      { name: index },
      `${index} must exist`,
    );
  }

  const insertSite = db.prepare(
    `INSERT INTO delivery_sites
      (user_id, label, contact_name, contact_phone, address_line1, address_line2, address_city,
       address_region, address_postcode, address_country_code, is_default, active,
       created_at, updated_at)
     VALUES (?, ?, 'Yard supervisor', '01234 567890', 'Unit 4 Trade Park', NULL, 'Leeds',
             NULL, 'LS10 1AA', ?, ?, ?, '2026-07-01T12:00:00.000Z', '2026-07-01T12:00:00.000Z')`,
  );
  insertSite.run(2301, 'Main yard', 'GB', 1, 1);

  // One active default per user, enforced by the partial unique index.
  assert.throws(() => insertSite.run(2301, 'Second yard', 'GB', 1, 1), /UNIQUE constraint failed/);
  // A retired default never blocks a live one, and another user is unaffected.
  insertSite.run(2301, 'Retired yard', 'GB', 1, 0);
  insertSite.run(2302, 'Other buyer yard', 'GB', 1, 1);
  // Labels are unique per user, and reused freely across users.
  assert.throws(() => insertSite.run(2301, 'Main yard', 'GB', 0, 1), /UNIQUE constraint failed/);
  insertSite.run(2302, 'Main yard', 'GB', 0, 1);
  // Country codes are stored upper case; booleans stay 0/1.
  assert.throws(() => insertSite.run(2301, 'Lower case', 'gb', 0, 1), /CHECK constraint failed/);
  assert.throws(() => insertSite.run(2301, 'Too long', 'GBR', 0, 1), /CHECK constraint failed/);
  assert.throws(() => insertSite.run(2301, 'Bad boolean', 'GB', 2, 1), /CHECK constraint failed/);
  assert.throws(() => insertSite.run(2301, 'Bad active', 'GB', 0, 2), /CHECK constraint failed/);

  const insertEntity = db.prepare(
    `INSERT INTO billing_entities
      (user_id, legal_name, registration_number, vat_number, address_line1, address_city,
       address_postcode, address_country_code, is_default, active, created_at, updated_at)
     VALUES (?, ?, '01234567', 'GB123456789', 'Finance House', 'Leeds', 'LS1 4AP', ?, ?, ?,
             '2026-07-01T12:00:00.000Z', '2026-07-01T12:00:00.000Z')`,
  );
  insertEntity.run(2301, 'Northern Builders Ltd', 'GB', 1, 1);
  assert.throws(
    () => insertEntity.run(2301, 'Southern Builders Ltd', 'GB', 1, 1),
    /UNIQUE constraint failed/,
  );
  assert.throws(
    () => insertEntity.run(2301, 'Northern Builders Ltd', 'GB', 0, 1),
    /UNIQUE constraint failed/,
  );
  assert.throws(() => insertEntity.run(2301, 'Bad country', 'gb', 0, 1), /CHECK constraint failed/);

  const siteId = Number(
    db
      .prepare("SELECT id FROM delivery_sites WHERE user_id = 2301 AND label = 'Main yard'")
      .pluck()
      .get(),
  );
  const insertOrder = db.prepare(
    `INSERT INTO orders
      (customer_name, customer_email, shipping_address, subtotal_cents, total_cents, created_at,
       lifecycle_status, version, delivery_site_id, delivery_address_json, billing_entity_json,
       delivery_slot_date, delivery_slot_window, purchase_order_reference)
     VALUES ('V23 depth customer', 'v23-depth@example.test', 'Unit 4 Trade Park, Leeds, LS10 1AA, GB',
             15000, 15000, '2026-07-05T12:00:00.000Z', 'processing', 0, ?, ?, ?, ?, ?, ?)`,
  );
  const addressJson = JSON.stringify({
    line1: 'Unit 4 Trade Park',
    city: 'Leeds',
    postcode: 'LS10 1AA',
    countryCode: 'GB',
  });
  const billingJson = JSON.stringify({ legalName: 'Northern Builders Ltd' });
  insertOrder.run(siteId, addressJson, billingJson, '2026-08-03', 'am', 'PO-2026-0042');
  assert.deepEqual(
    db
      .prepare(
        `SELECT delivery_site_id, delivery_address_json, billing_entity_json, delivery_slot_date,
                delivery_slot_window, purchase_order_reference
         FROM orders WHERE customer_email = 'v23-depth@example.test'`,
      )
      .get(),
    {
      delivery_site_id: siteId,
      delivery_address_json: addressJson,
      billing_entity_json: billingJson,
      delivery_slot_date: '2026-08-03',
      delivery_slot_window: 'am',
      purchase_order_reference: 'PO-2026-0042',
    },
  );

  assert.throws(
    () => insertOrder.run(siteId, '{not-json}', billingJson, '2026-08-03', 'am', 'PO-1'),
    /CHECK constraint failed|malformed JSON/,
  );
  assert.throws(
    () => insertOrder.run(siteId, addressJson, '[1,2]', '2026-08-03', 'am', 'PO-1'),
    /CHECK constraint failed|malformed JSON/,
  );
  assert.throws(
    () => insertOrder.run(siteId, addressJson, billingJson, '03/08/2026', 'am', 'PO-1'),
    /CHECK constraint failed/,
  );
  assert.throws(
    () => insertOrder.run(siteId, addressJson, billingJson, '2026-08-03', 'evening', 'PO-1'),
    /CHECK constraint failed/,
  );
  assert.throws(
    () => insertOrder.run(siteId, addressJson, billingJson, '2026-08-03', 'am', 'x'.repeat(65)),
    /CHECK constraint failed/,
  );
  assert.throws(
    () => insertOrder.run(999999, addressJson, billingJson, '2026-08-03', 'pm', 'PO-2'),
    /FOREIGN KEY constraint failed/,
  );

  // Trade records belong to their user and leave with them; orders never do.
  db.prepare('DELETE FROM users WHERE id = 2302').run();
  assert.equal(
    (
      db.prepare('SELECT COUNT(*) AS count FROM delivery_sites WHERE user_id = 2302').get() as {
        count: number;
      }
    ).count,
    0,
  );
  assert.equal((db.pragma('foreign_key_check') as unknown[]).length, 0);

  // Re-applying the migration body directly is a no-op, and so is the whole chain through the runner.
  const checkoutDepth = migrations.find((migration) => migration.version === '023')!;
  assert.doesNotThrow(() => checkoutDepth.up(db));
  assert.equal(
    (
      db.prepare('SELECT COUNT(*) AS count FROM delivery_sites WHERE user_id = 2301').get() as {
        count: number;
      }
    ).count,
    2,
  );
  assert.ok(indexNames(db, 'delivery_sites').includes('delivery_sites_user_default_idx'));
  assert.ok(indexNames(db, 'orders').includes('orders_purchase_order_reference_idx'));
  migrateDatabase(db);
  assert.deepEqual(migrationVersions(db), expectedVersions);
  assert.equal((db.pragma('foreign_key_check') as unknown[]).length, 0);
});

void test('v23 trade-record uniqueness is scoped to live rows so a retired name is reusable', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'shop-migrations-v23-retire-'));
  const db = openDatabase({ path: join(directory, 'shop.db') });
  t.after(() => {
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  });

  db.exec(`
    INSERT INTO users (id, email, display_name, password_hash, password_salt, role)
    VALUES (2311, 'v23-retire@example.test', 'V23 retire', 'hash', 'salt', 'customer');
  `);

  const insertSite = db.prepare(
    `INSERT INTO delivery_sites
      (user_id, label, contact_name, address_line1, address_city, address_postcode,
       address_country_code, is_default, active, created_at, updated_at)
     VALUES (?, ?, 'Yard supervisor', 'Unit 4 Trade Park', 'Leeds', 'LS10 1AA', 'GB', 0, ?,
             '2026-07-01T12:00:00.000Z', '2026-07-01T12:00:00.000Z')`,
  );

  // Two live rows may not share a label.
  insertSite.run(2311, 'Main yard', 1);
  assert.throws(() => insertSite.run(2311, 'Main yard', 1), /UNIQUE constraint failed/);

  // Retiring is the only removal available once an order snapshots the site, so the label must come
  // back into play: a table-level UNIQUE(user_id, label) would let the retired row squat it forever.
  db.prepare(
    "UPDATE delivery_sites SET active = 0 WHERE user_id = 2311 AND label = 'Main yard'",
  ).run();
  assert.doesNotThrow(() => insertSite.run(2311, 'Main yard', 1));
  assert.deepEqual(
    db
      .prepare(
        `SELECT active, COUNT(*) AS count FROM delivery_sites
         WHERE user_id = 2311 AND label = 'Main yard' GROUP BY active ORDER BY active`,
      )
      .all(),
    [
      { active: 0, count: 1 },
      { active: 1, count: 1 },
    ],
  );
  // Any number of retired rows may share the label; only one live row may hold it.
  db.prepare(
    "UPDATE delivery_sites SET active = 0 WHERE user_id = 2311 AND label = 'Main yard'",
  ).run();
  insertSite.run(2311, 'Main yard', 0);
  insertSite.run(2311, 'Main yard', 1);
  assert.throws(() => insertSite.run(2311, 'Main yard', 1), /UNIQUE constraint failed/);

  const insertEntity = db.prepare(
    `INSERT INTO billing_entities
      (user_id, legal_name, address_line1, address_city, address_postcode, address_country_code,
       is_default, active, created_at, updated_at)
     VALUES (?, ?, 'Finance House', 'Leeds', 'LS1 4AP', 'GB', 0, ?,
             '2026-07-01T12:00:00.000Z', '2026-07-01T12:00:00.000Z')`,
  );

  insertEntity.run(2311, 'Northern Builders Ltd', 1);
  assert.throws(
    () => insertEntity.run(2311, 'Northern Builders Ltd', 1),
    /UNIQUE constraint failed/,
  );
  db.prepare(
    "UPDATE billing_entities SET active = 0 WHERE user_id = 2311 AND legal_name = 'Northern Builders Ltd'",
  ).run();
  assert.doesNotThrow(() => insertEntity.run(2311, 'Northern Builders Ltd', 1));
  assert.deepEqual(
    db
      .prepare(
        `SELECT active, COUNT(*) AS count FROM billing_entities
         WHERE user_id = 2311 AND legal_name = 'Northern Builders Ltd'
         GROUP BY active ORDER BY active`,
      )
      .all(),
    [
      { active: 0, count: 1 },
      { active: 1, count: 1 },
    ],
  );
  assert.throws(
    () => insertEntity.run(2311, 'Northern Builders Ltd', 1),
    /UNIQUE constraint failed/,
  );
  assert.equal((db.pragma('foreign_key_check') as unknown[]).length, 0);
});

void test('v24 adds nullable clearance, scoped-promo, and order disclosure columns', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'shop-migrations-v24-pricing-promotions-'));
  // `openDatabase` applies the current chain. Start below 024 so this test exercises the upgrade.
  const db = new Database(join(directory, 'shop.db'));
  db.pragma('foreign_keys = ON');
  t.after(() => {
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  });

  migrateDatabase(db, prePricingPromotionsMigration);
  db.exec(`
    INSERT INTO products
      (id, name, description, price_cents, category, stock_count, slug, sales_count, created_at)
    VALUES (2401, 'V24 material', 'Pre-v24 row', 12000, 'Garden & Outdoors', 4,
            'v24-material', 0, '2026-07-28T12:00:00.000Z');
    INSERT INTO product_variants
      (product_id, sku, label, weight_grams, price_cents, stock_count, backorderable,
       delivery_class, active, sort_order, moq_sacks, created_at, updated_at)
    VALUES (2401, 'V24-2401-001', '25 kg Sack', 25000, 12000, 4, 0,
            'freight', 1, 1, 4, '2026-07-28T12:00:00.000Z', '2026-07-28T12:00:00.000Z');
    INSERT INTO promo_codes (code, discount_percent, min_item_count, active)
    VALUES ('V24LEGACY', 10, 0, 1);
    INSERT INTO orders
      (id, customer_name, customer_email, shipping_address, subtotal_cents, total_cents)
    VALUES (2401, 'V24 legacy buyer', 'v24-legacy@example.test', '24 Migration Lane', 12000, 12000);
  `);

  migrateDatabase(db);
  assert.deepEqual(migrationVersions(db), expectedVersions);
  for (const column of ['clearance_price_cents', 'clearance_starts_at', 'clearance_ends_at']) {
    assert.ok(columnNames(db, 'product_variants').includes(column), `product_variants.${column}`);
  }
  assert.ok(columnNames(db, 'promo_codes').includes('category_scope'));
  assert.ok(columnNames(db, 'orders').includes('promo_category_scope'));
  assert.ok(columnNames(db, 'orders').includes('discount_base_cents'));

  assert.deepEqual(
    db
      .prepare(
        `SELECT clearance_price_cents, clearance_starts_at, clearance_ends_at
         FROM product_variants WHERE sku = 'V24-2401-001'`,
      )
      .get(),
    { clearance_price_cents: null, clearance_starts_at: null, clearance_ends_at: null },
  );
  assert.deepEqual(
    db.prepare("SELECT category_scope FROM promo_codes WHERE code = 'V24LEGACY'").get(),
    { category_scope: null },
  );
  assert.deepEqual(
    db
      .prepare(
        `SELECT promo_category_scope, discount_base_cents FROM orders
         WHERE id = 2401`,
      )
      .get(),
    { promo_category_scope: null, discount_base_cents: null },
  );

  db.prepare(
    `UPDATE product_variants
     SET clearance_price_cents = ?, clearance_starts_at = ?, clearance_ends_at = ?
     WHERE sku = 'V24-2401-001'`,
  ).run(9000, '2026-07-27T12:00:00.000Z', '2026-08-04T12:00:00.000Z');
  db.prepare(
    "UPDATE promo_codes SET category_scope = 'Garden & Outdoors' WHERE code = 'V24LEGACY'",
  ).run();
  db.prepare(
    `UPDATE orders SET promo_category_scope = 'Garden & Outdoors', discount_base_cents = 9000
     WHERE id = 2401`,
  ).run();
  assert.throws(
    () =>
      db
        .prepare("UPDATE promo_codes SET category_scope = 'Unknown' WHERE code = 'V24LEGACY'")
        .run(),
    /CHECK constraint failed/,
  );
  assert.throws(
    () =>
      db
        .prepare('UPDATE product_variants SET clearance_price_cents = 0 WHERE sku = ?')
        .run('V24-2401-001'),
    /CHECK constraint failed/,
  );
  assert.throws(
    () =>
      db
        .prepare('UPDATE product_variants SET clearance_price_cents = -1 WHERE sku = ?')
        .run('V24-2401-001'),
    /CHECK constraint failed/,
  );
  for (const [price, startsAt, endsAt] of [
    [9000, null, null],
    [9000, '2026-07-27T12:00:00.000Z', null],
    [9000, null, '2026-08-04T12:00:00.000Z'],
    [null, '2026-07-27T12:00:00.000Z', null],
    [null, null, '2026-08-04T12:00:00.000Z'],
    [null, '2026-07-27T12:00:00.000Z', '2026-08-04T12:00:00.000Z'],
    [9000, '2026-08-04T12:00:00.000Z', '2026-07-27T12:00:00.000Z'],
    [12000, '2026-07-27T12:00:00.000Z', '2026-08-04T12:00:00.000Z'],
  ]) {
    assert.throws(
      () =>
        db
          .prepare(
            `UPDATE product_variants
             SET clearance_price_cents = ?, clearance_starts_at = ?, clearance_ends_at = ?
             WHERE sku = 'V24-2401-001'`,
          )
          .run(price, startsAt, endsAt),
      /CHECK constraint failed/,
    );
  }
  assert.throws(
    () => db.prepare("UPDATE orders SET promo_category_scope = 'Unknown' WHERE id = 2401").run(),
    /CHECK constraint failed/,
  );
  assert.throws(
    () => db.prepare('UPDATE orders SET discount_base_cents = -1 WHERE id = 2401').run(),
    /CHECK constraint failed/,
  );

  const pricingPromotions = migrations.find((migration) => migration.version === '024')!;
  assert.doesNotThrow(() => pricingPromotions.up(db));
  assert.equal((db.pragma('foreign_key_check') as unknown[]).length, 0);
});
