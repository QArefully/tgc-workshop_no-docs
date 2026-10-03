import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { closeDatabase, migrateDatabase, openDatabase } from '../../src/db/index.js';
import { migrations } from '../../src/db/migrations/index.js';

function indexNames(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA index_list(${table})`).all() as Array<{ name: string }>).map(
    (index) => index.name,
  );
}

void test('saved-list schema is present with its lookup and uniqueness indexes', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'shop-saved-lists-schema-'));
  const db = openDatabase({ path: join(directory, 'shop.db') });
  t.after(() => {
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  });

  for (const table of ['saved_lists', 'saved_list_items']) {
    assert.ok(
      db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table),
    );
  }
  assert.deepEqual(indexNames(db, 'saved_lists').sort(), [
    'saved_lists_user_default_idx',
    'saved_lists_user_name_idx',
  ]);
  assert.deepEqual(indexNames(db, 'saved_list_items').sort(), [
    'saved_list_items_list_variant_idx',
    'saved_list_items_variant_idx',
  ]);
  const defaultIndex = (
    db.prepare("PRAGMA index_list('saved_lists')").all() as Array<{
      name: string;
      unique: number;
      partial: number;
    }>
  ).find((index) => index.name === 'saved_lists_user_default_idx');
  assert.equal(defaultIndex?.unique, 1);
  assert.equal(defaultIndex?.partial, 1);
  assert.equal(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'favourites'").get(),
    undefined,
  );
});

void test('migration 029 converts live favourites, drops inactive and missing defaults, and is a runner noop after replay', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'shop-saved-lists-conversion-'));
  const databasePath = join(directory, 'shop.db');
  const db = new Database(databasePath);
  db.pragma('foreign_keys = ON');
  t.after(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  migrateDatabase(
    db,
    migrations.filter((migration) => migration.version < '029'),
  );
  // The fixture is built directly rather than through seedDatabase: the seed targets the current
  // schema and installs saved lists itself, so it cannot express a pre-029 favourites world.
  const buyerId = Number(
    db
      .prepare(
        `INSERT INTO users (email, display_name, password_hash, password_salt)
         VALUES ('conversion@example.com', 'Conversion Buyer', 'hash', 'salt')`,
      )
      .run().lastInsertRowid,
  );
  const insertProduct = db.prepare(
    `INSERT INTO products (name, description, price_cents, category)
     VALUES (?, 'conversion fixture', 1000, 'baking')`,
  );
  const insertVariant = db.prepare(
    `INSERT INTO product_variants
       (product_id, sku, label, weight_grams, price_cents, moq_sacks, active, created_at, updated_at)
     VALUES (?, ?, '25 kg sack', ?, 1000, ?, ?, '2026-08-01T09:00:00.000Z', '2026-08-01T09:00:00.000Z')`,
  );
  const setDefaultVariant = db.prepare('UPDATE products SET default_variant_id = ? WHERE id = ?');

  /** Creates a product whose default variant carries the given weight, MOQ, and active flag. */
  function createLot(sku: string, weightGrams: number, moqSacks: number, active: number) {
    const productId = Number(insertProduct.run(`Conversion ${sku}`).lastInsertRowid);
    const variantId = Number(
      insertVariant.run(productId, sku, weightGrams, moqSacks, active).lastInsertRowid,
    );
    setDefaultVariant.run(variantId, productId);
    return { productId, variantId };
  }

  // 5 sacks of 25 kg over a 30 kg lot weight rounds up to 5 units, proving the conversion
  // quantity is a ceiling rather than a truncating division.
  const nonDivisibleFavourite = createLot('CNV-0001-001', 30000, 5, 1);
  const droppedFavourite = createLot('CNV-0002-001', 25000, 1, 0);
  const missingDefault = createLot('CNV-0003-001', 25000, 1, 1);
  db.prepare('UPDATE products SET default_variant_id = NULL WHERE id = ?').run(
    missingDefault.productId,
  );

  const insertFavourite = db.prepare('INSERT INTO favourites (user_id, product_id) VALUES (?, ?)');
  for (const productId of [
    nonDivisibleFavourite.productId,
    droppedFavourite.productId,
    missingDefault.productId,
  ]) {
    insertFavourite.run(buyerId, productId);
  }

  const expectedItems = [{ variant_id: nonDivisibleFavourite.variantId, quantity: 5 }];

  migrateDatabase(db);
  assert.equal(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'favourites'").get(),
    undefined,
  );
  assert.deepEqual(
    db.prepare('SELECT variant_id, quantity FROM saved_list_items ORDER BY variant_id').all(),
    expectedItems,
  );
  assert.equal(
    db.prepare('SELECT COUNT(*) FROM saved_list_items').pluck().get(),
    1,
    'a favourite without a default variant must not create a saved-list item',
  );
  assert.equal(
    db
      .prepare('SELECT COUNT(*) FROM saved_list_items WHERE variant_id = ?')
      .pluck()
      .get(droppedFavourite.variantId),
    0,
  );
  assert.equal((db.pragma('foreign_key_check') as unknown[]).length, 0);

  migrateDatabase(db);
  assert.equal(
    db.prepare("SELECT COUNT(*) FROM schema_migrations WHERE version = '029'").pluck().get(),
    1,
  );
});
