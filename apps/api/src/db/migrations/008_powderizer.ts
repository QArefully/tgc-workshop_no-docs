import type { Migration } from '../migrate.js';

function addProductColumnIfMissing(
  db: Parameters<Migration['up']>[0],
  column: string,
  definition: string,
): void {
  const columns = db.prepare('PRAGMA table_info(products)').all() as { name: string }[];
  if (!columns.some((existing) => existing.name === column)) {
    db.exec(`ALTER TABLE products ADD COLUMN ${column} ${definition}`);
  }
}

/** Adds durable custom powder mixes without rebuilding existing commerce tables. */
export const powderizerMigration: Migration = {
  version: '008',
  name: 'powderizer mixes and stock reservations',
  up(db) {
    addProductColumnIfMissing(
      db,
      'mixable',
      'INTEGER NOT NULL DEFAULT 0 CHECK (mixable IN (0, 1))',
    );
    addProductColumnIfMissing(
      db,
      'mix_unit_grams',
      'INTEGER CHECK (mix_unit_grams IS NULL OR mix_unit_grams > 0)',
    );

    db.exec(`
      CREATE TABLE IF NOT EXISTS powder_mixes (
        id TEXT PRIMARY KEY,
        cart_id TEXT NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        bag_size_grams INTEGER NOT NULL CHECK (bag_size_grams IN (250, 500, 1000)),
        fineness TEXT NOT NULL CHECK (fineness IN ('coarse', 'standard', 'fine')),
        custom_label TEXT,
        price_version TEXT NOT NULL,
        quoted_unit_price_cents INTEGER NOT NULL CHECK (quoted_unit_price_cents >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS powder_mix_components (
        mix_id TEXT NOT NULL REFERENCES powder_mixes(id) ON DELETE CASCADE,
        product_id INTEGER NOT NULL REFERENCES products(id),
        percentage INTEGER NOT NULL CHECK (percentage > 0 AND percentage <= 100),
        allocated_grams INTEGER NOT NULL CHECK (allocated_grams > 0),
        PRIMARY KEY (mix_id, product_id)
      );

      CREATE TABLE IF NOT EXISTS order_powder_mix_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        snapshot_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS powder_mix_stock_reservations (
        payment_idempotency_key TEXT NOT NULL REFERENCES payments(idempotency_key) ON DELETE CASCADE,
        product_id INTEGER NOT NULL REFERENCES products(id),
        bag_equivalents INTEGER NOT NULL CHECK (bag_equivalents > 0),
        PRIMARY KEY (payment_idempotency_key, product_id)
      );

      CREATE INDEX IF NOT EXISTS powder_mixes_cart_idx ON powder_mixes(cart_id);
      CREATE INDEX IF NOT EXISTS powder_mix_components_mix_idx ON powder_mix_components(mix_id);
      CREATE INDEX IF NOT EXISTS order_powder_mix_items_order_idx
        ON order_powder_mix_items(order_id);
      CREATE INDEX IF NOT EXISTS powder_mix_stock_reservations_product_idx
        ON powder_mix_stock_reservations(product_id);
    `);
  },
};
