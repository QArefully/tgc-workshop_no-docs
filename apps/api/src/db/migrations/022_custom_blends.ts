import type { Migration } from '../migrate.js';

type MigrationDb = Parameters<Migration['up']>[0];

function hasColumn(db: MigrationDb, table: string, column: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return columns.some((existing) => existing.name === column);
}

function countRows(db: MigrationDb, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}

function preserveSequence(db: MigrationDb, table: string, sequence: number | undefined): void {
  if (sequence === undefined) return;
  db.prepare(
    `INSERT INTO sqlite_sequence (name, seq) SELECT ?, ?
     WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = ?)`,
  ).run(table, sequence, table);
  db.prepare('UPDATE sqlite_sequence SET seq = ? WHERE name = ? AND seq < ?').run(
    sequence,
    table,
    sequence,
  );
}

function assertForeignKeysClean(db: MigrationDb, step: string): void {
  const violations = db.pragma('foreign_key_check') as unknown[];
  if (violations.length > 0) {
    throw new Error(
      `Foreign key violations after migration 022 ${step}: ${JSON.stringify(violations)}`,
    );
  }
}

/** Adds configured-line identity and persisted Custom Blend order snapshots. */
export const customBlendsMigration: Migration = {
  version: '022',
  name: 'custom blends',
  up(db) {
    // The runner owns FK suspension for this transaction. Do not toggle foreign_keys here:
    // cart/order rebuilds must retain rows referenced by shipment, allocation, movement, and return tables.
    if (!hasColumn(db, 'cart_line_items', 'config_key')) {
      const existingCount = countRows(db, 'cart_line_items');
      const sequence = db
        .prepare("SELECT seq FROM sqlite_sequence WHERE name = 'cart_line_items'")
        .get() as { seq: number } | undefined;

      db.exec(`
        CREATE TABLE cart_line_items_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          cart_id TEXT NOT NULL,
          variant_id INTEGER NOT NULL,
          quantity INTEGER NOT NULL DEFAULT 1 CHECK (
            typeof(quantity) = 'integer' AND quantity > 0
          ),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          config_key TEXT NOT NULL DEFAULT '' CHECK (
            (config_key = '' AND custom_blend_json IS NULL)
            OR (
              length(config_key) = 64
              AND config_key NOT GLOB '*[^a-f0-9]*'
              AND custom_blend_json IS NOT NULL
              AND json_valid(custom_blend_json)
              AND json_type(custom_blend_json) = 'object'
              AND json_type(custom_blend_json, '$.configKey') = 'text'
              AND json_extract(custom_blend_json, '$.configKey') = config_key
            )
          ),
          custom_blend_json TEXT,
          FOREIGN KEY (cart_id) REFERENCES carts(id) ON DELETE CASCADE,
          FOREIGN KEY (variant_id) REFERENCES product_variants(id),
          UNIQUE(cart_id, variant_id, config_key)
        );

        INSERT INTO cart_line_items_new
          (id, cart_id, variant_id, quantity, created_at, updated_at, config_key, custom_blend_json)
        SELECT id, cart_id, variant_id, quantity, created_at, updated_at, '', NULL
        FROM cart_line_items
        ORDER BY id;
      `);

      const copiedCount = countRows(db, 'cart_line_items_new');
      if (copiedCount !== existingCount) {
        throw new Error(
          `cart_line_items rebuild count mismatch: ${existingCount} existing vs ${copiedCount} copied`,
        );
      }

      db.exec('DROP TABLE cart_line_items');
      db.exec('ALTER TABLE cart_line_items_new RENAME TO cart_line_items');
      preserveSequence(db, 'cart_line_items', sequence?.seq);
      assertForeignKeysClean(db, 'cart_line_items rebuild');
    }

    if (!hasColumn(db, 'order_line_items', 'discountable_total_cents')) {
      const existingCount = countRows(db, 'order_line_items');
      const sequence = db
        .prepare("SELECT seq FROM sqlite_sequence WHERE name = 'order_line_items'")
        .get() as { seq: number } | undefined;

      db.exec(`
        CREATE TABLE order_line_items_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
          product_id INTEGER NOT NULL,
          product_name TEXT NOT NULL,
          product_price_cents INTEGER NOT NULL,
          quantity INTEGER NOT NULL,
          line_total_cents INTEGER NOT NULL,
          variant_id INTEGER,
          sku TEXT,
          variant_label TEXT,
          weight_grams INTEGER,
          consumption_classification TEXT,
          delivery_class TEXT DEFAULT 'parcel',
          discountable_total_cents INTEGER NOT NULL DEFAULT 0 CHECK (
            typeof(discountable_total_cents) = 'integer' AND discountable_total_cents >= 0
          ),
          blending_fee_cents INTEGER NOT NULL DEFAULT 0 CHECK (
            typeof(blending_fee_cents) = 'integer' AND blending_fee_cents >= 0
          ),
          custom_blend_json TEXT CHECK (
            custom_blend_json IS NULL
            OR (json_valid(custom_blend_json) AND json_type(custom_blend_json) = 'object')
          )
        );

        INSERT INTO order_line_items_new
          (id, order_id, product_id, product_name, product_price_cents, quantity, line_total_cents,
           variant_id, sku, variant_label, weight_grams, consumption_classification, delivery_class,
           discountable_total_cents, blending_fee_cents, custom_blend_json)
        SELECT id, order_id, product_id, product_name, product_price_cents, quantity, line_total_cents,
               variant_id, sku, variant_label, weight_grams, consumption_classification, delivery_class,
               line_total_cents, 0, NULL
        FROM order_line_items
        ORDER BY id;
      `);

      const copiedCount = countRows(db, 'order_line_items_new');
      if (copiedCount !== existingCount) {
        throw new Error(
          `order_line_items rebuild count mismatch: ${existingCount} existing vs ${copiedCount} copied`,
        );
      }

      db.exec('DROP TABLE order_line_items');
      db.exec('ALTER TABLE order_line_items_new RENAME TO order_line_items');
      preserveSequence(db, 'order_line_items', sequence?.seq);
      db.exec(`
        CREATE INDEX order_line_items_product_id_order_id_idx
          ON order_line_items(product_id, order_id);
      `);
      assertForeignKeysClean(db, 'order_line_items rebuild');
    }
  },
};
