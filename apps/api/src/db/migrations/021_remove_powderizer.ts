import type { Migration } from '../migrate.js';

type MigrationDb = Parameters<Migration['up']>[0];

function hasTable(db: MigrationDb, table: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table),
  );
}

function hasColumn(db: MigrationDb, table: string, column: string): boolean {
  if (!hasTable(db, table)) return false;
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return columns.some((existing) => existing.name === column);
}

function countRows(db: MigrationDb, sql: string): number {
  return (db.prepare(sql).get() as { count: number }).count;
}

function assertForeignKeysClean(db: MigrationDb, step: string): void {
  const violations = db.pragma('foreign_key_check') as unknown[];
  if (violations && violations.length > 0) {
    throw new Error(
      `Foreign key violations after migration 021 ${step}: ${JSON.stringify(violations)}`,
    );
  }
}

/**
 * Physically removes the retired powderizer feature from persistence.
 *
 * Destructive by design: the
 * powder-mix tables, the `demand_kind` discriminator, and the `products` mixing columns carry
 * no preservation obligation, so `021` deletes rather than retires them. Rows that survive the
 * feature — product lines, product-demand reservations, catalogue rows — are still copied
 * faithfully, because `npm run seed` promises to preserve non-seed rows.
 *
 * Step order encodes FK dependency and must not be reordered: `order_shipment_items` loses its
 * reference to `order_powder_mix_items` before that table is dropped, and `powder_mix_components`
 * is dropped before its `powder_mixes` parent.
 *
 * Unlike `018`, this migration rebuilds a parent table. It relies on the runner having suspended
 * foreign key enforcement for the duration of the run (see `migrate.ts`): with enforcement live,
 * `DROP TABLE products` runs an implicit `DELETE` that cascades into every child, and `ALTER TABLE
 * ... RENAME` rewrites child `REFERENCES` clauses to follow the temporary name. Neither happens
 * with enforcement off. Do not add a local `PRAGMA foreign_keys` wrapper — it is a documented no-op
 * inside the transaction the runner opens around `up()`.
 */
export const removePowderizerMigration: Migration = {
  version: '021',
  name: 'remove powderizer',
  up(db) {
    // -----------------------------------------------------------------------
    // 1. Rebuild order_shipment_items without order_powder_mix_item_id.
    //    Mix allocations are dropped; product allocations are copied verbatim.
    // -----------------------------------------------------------------------
    if (hasColumn(db, 'order_shipment_items', 'order_powder_mix_item_id')) {
      const keptCount = countRows(
        db,
        'SELECT COUNT(*) AS count FROM order_shipment_items WHERE order_powder_mix_item_id IS NULL',
      );

      db.exec(`
        CREATE TABLE order_shipment_items_new (
          shipment_id INTEGER NOT NULL REFERENCES order_shipments(id) ON DELETE CASCADE,
          order_line_item_id INTEGER NOT NULL REFERENCES order_line_items(id) ON DELETE CASCADE,
          quantity INTEGER NOT NULL CHECK (typeof(quantity) = 'integer' AND quantity > 0),
          UNIQUE (shipment_id, order_line_item_id)
        );
      `);

      db.exec(`
        INSERT INTO order_shipment_items_new (shipment_id, order_line_item_id, quantity)
        SELECT shipment_id, order_line_item_id, quantity
        FROM order_shipment_items
        WHERE order_powder_mix_item_id IS NULL
      `);

      const copiedCount = countRows(db, 'SELECT COUNT(*) AS count FROM order_shipment_items_new');
      if (copiedCount !== keptCount) {
        throw new Error(
          `order_shipment_items rebuild count mismatch: ${keptCount} product allocations vs ${copiedCount} copied`,
        );
      }

      db.exec('DROP TABLE order_shipment_items');
      db.exec('ALTER TABLE order_shipment_items_new RENAME TO order_shipment_items');

      // Recreate every surviving index. The mix-item index goes with the column.
      db.exec(`
        CREATE INDEX order_shipment_items_order_line_item_idx
          ON order_shipment_items(order_line_item_id);
      `);

      assertForeignKeysClean(db, 'order_shipment_items rebuild');
    }

    // -----------------------------------------------------------------------
    // 2-5. Drop the powder-mix tables, children before parents.
    //      powder_mix_stock_reservations may already be absent; the guard is unconditional.
    // -----------------------------------------------------------------------
    db.exec('DROP TABLE IF EXISTS order_powder_mix_items');
    db.exec('DROP TABLE IF EXISTS powder_mix_components');
    db.exec('DROP TABLE IF EXISTS powder_mixes');
    db.exec('DROP TABLE IF EXISTS powder_mix_stock_reservations');

    // -----------------------------------------------------------------------
    // 6. Rebuild inventory_reservations without demand_kind.
    //    One demand kind remains, so the discriminator leaves the primary key and the
    //    `demand_kind = 'product' OR backordered_quantity = 0` CHECK becomes vacuous.
    // -----------------------------------------------------------------------
    if (hasColumn(db, 'inventory_reservations', 'demand_kind')) {
      const keptCount = countRows(
        db,
        "SELECT COUNT(*) AS count FROM inventory_reservations WHERE demand_kind = 'product'",
      );

      db.exec(`
        CREATE TABLE inventory_reservations_new (
          payment_idempotency_key TEXT NOT NULL REFERENCES payments(idempotency_key) ON DELETE CASCADE,
          variant_id INTEGER NOT NULL REFERENCES product_variants(id),
          reserved_quantity INTEGER NOT NULL DEFAULT 0 CHECK (
            typeof(reserved_quantity) = 'integer' AND reserved_quantity >= 0
          ),
          backordered_quantity INTEGER NOT NULL DEFAULT 0 CHECK (
            typeof(backordered_quantity) = 'integer' AND backordered_quantity >= 0
          ),
          expires_at TEXT,
          created_at TEXT NOT NULL,
          PRIMARY KEY (payment_idempotency_key, variant_id),
          CHECK (reserved_quantity > 0 OR backordered_quantity > 0)
        );
      `);

      db.exec(`
        INSERT INTO inventory_reservations_new
          (payment_idempotency_key, variant_id, reserved_quantity,
           backordered_quantity, expires_at, created_at)
        SELECT payment_idempotency_key, variant_id, reserved_quantity,
               backordered_quantity, expires_at, created_at
        FROM inventory_reservations
        WHERE demand_kind = 'product'
      `);

      const copiedCount = countRows(db, 'SELECT COUNT(*) AS count FROM inventory_reservations_new');
      if (copiedCount !== keptCount) {
        throw new Error(
          `inventory_reservations rebuild count mismatch: ${keptCount} product reservations vs ${copiedCount} copied`,
        );
      }

      db.exec('DROP TABLE inventory_reservations');
      db.exec('ALTER TABLE inventory_reservations_new RENAME TO inventory_reservations');

      db.exec(`
        CREATE INDEX inventory_reservations_variant_expiry_idx
          ON inventory_reservations(variant_id, expires_at);
        CREATE INDEX inventory_reservations_payment_idx
          ON inventory_reservations(payment_idempotency_key);
      `);

      assertForeignKeysClean(db, 'inventory_reservations rebuild');
    }

    // -----------------------------------------------------------------------
    // 7. Rebuild products without mixable / mix_unit_grams.
    //    SQLite refuses DROP COLUMN on a CHECK-bound column, so the table is rebuilt.
    //    products is the most FK-referenced table in the schema: every child row must still
    //    resolve, and the AUTOINCREMENT high-water mark must not regress.
    // -----------------------------------------------------------------------
    if (hasColumn(db, 'products', 'mixable') || hasColumn(db, 'products', 'mix_unit_grams')) {
      const existingCount = countRows(db, 'SELECT COUNT(*) AS count FROM products');
      const sequence = db
        .prepare("SELECT seq FROM sqlite_sequence WHERE name = 'products'")
        .get() as { seq: number } | undefined;

      db.exec(`
        DROP TABLE IF EXISTS products_new;
        CREATE TABLE products_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          description TEXT NOT NULL,
          price_cents INTEGER NOT NULL,
          category TEXT NOT NULL,
          stock_count INTEGER NOT NULL DEFAULT 0,
          image_url TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          slug TEXT NOT NULL DEFAULT '',
          compare_at_price_cents INTEGER,
          sales_count INTEGER NOT NULL DEFAULT 0,
          image_set_id TEXT,
          active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
          backorderable INTEGER NOT NULL DEFAULT 0 CHECK (backorderable IN (0, 1)),
          backorder_lead_days INTEGER,
          consumption_classification TEXT NOT NULL DEFAULT 'non-food',
          mixing_group TEXT,
          details_json TEXT,
          default_variant_id INTEGER,
          blend_source_variant_id INTEGER
        );
      `);

      db.exec(`
        INSERT INTO products_new
          (id, name, description, price_cents, category, stock_count, image_url, created_at,
           slug, compare_at_price_cents, sales_count, image_set_id, active, backorderable,
           backorder_lead_days, consumption_classification, mixing_group, details_json,
           default_variant_id, blend_source_variant_id)
        SELECT
           id, name, description, price_cents, category, stock_count, image_url, created_at,
           slug, compare_at_price_cents, sales_count, image_set_id, active, backorderable,
           backorder_lead_days, consumption_classification, mixing_group, details_json,
           default_variant_id, blend_source_variant_id
        FROM products
        ORDER BY id
      `);

      const copiedCount = countRows(db, 'SELECT COUNT(*) AS count FROM products_new');
      if (copiedCount !== existingCount) {
        throw new Error(
          `products rebuild count mismatch: ${existingCount} existing vs ${copiedCount} copied`,
        );
      }

      db.exec('DROP TABLE products');
      db.exec('ALTER TABLE products_new RENAME TO products');

      db.exec(`
        CREATE INDEX products_active_price_cents_id_idx
          ON products(active, price_cents, id);
        CREATE INDEX products_active_created_at_id_idx
          ON products(active, created_at, id);
      `);

      db.exec(`
        CREATE TRIGGER products_stock_count_insert_valid
        BEFORE INSERT ON products
        WHEN typeof(NEW.stock_count) <> 'integer' OR NEW.stock_count < 0
        BEGIN SELECT RAISE(ABORT, 'products.stock_count must be a nonnegative integer'); END;
        CREATE TRIGGER products_stock_count_update_valid
        BEFORE UPDATE OF stock_count ON products
        WHEN typeof(NEW.stock_count) <> 'integer' OR NEW.stock_count < 0
        BEGIN SELECT RAISE(ABORT, 'products.stock_count must be a nonnegative integer'); END;
        CREATE TRIGGER products_backorder_insert_valid
        BEFORE INSERT ON products
        WHEN NEW.backorderable NOT IN (0, 1)
          OR (NEW.backorderable = 0 AND NEW.backorder_lead_days IS NOT NULL)
          OR (NEW.backorderable = 1 AND (
            typeof(NEW.backorder_lead_days) <> 'integer'
            OR NEW.backorder_lead_days < 1 OR NEW.backorder_lead_days > 365
          ))
        BEGIN SELECT RAISE(ABORT, 'invalid product backorder policy'); END;
        CREATE TRIGGER products_backorder_update_valid
        BEFORE UPDATE OF backorderable, backorder_lead_days ON products
        WHEN NEW.backorderable NOT IN (0, 1)
          OR (NEW.backorderable = 0 AND NEW.backorder_lead_days IS NOT NULL)
          OR (NEW.backorderable = 1 AND (
            typeof(NEW.backorder_lead_days) <> 'integer'
            OR NEW.backorder_lead_days < 1 OR NEW.backorder_lead_days > 365
          ))
        BEGIN SELECT RAISE(ABORT, 'invalid product backorder policy'); END;
      `);

      // Rebuilding resets the AUTOINCREMENT counter to max(id); restore the recorded
      // high-water mark so ids of deleted products are never handed out again.
      if (sequence) {
        db.prepare(
          `INSERT INTO sqlite_sequence (name, seq) SELECT 'products', ?
           WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'products')`,
        ).run(sequence.seq);
        db.prepare("UPDATE sqlite_sequence SET seq = ? WHERE name = 'products' AND seq < ?").run(
          sequence.seq,
          sequence.seq,
        );
      }

      assertForeignKeysClean(db, 'products rebuild');
    }
  },
};
