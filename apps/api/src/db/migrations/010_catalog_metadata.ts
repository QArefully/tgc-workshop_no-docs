import type { Migration } from '../migrate.js';

function addColumnIfMissing(
  db: Parameters<Migration['up']>[0],
  column: string,
  definition: string,
): void {
  const columns = db.prepare('PRAGMA table_info(products)').all() as { name: string }[];
  if (!columns.some((existing) => existing.name === column)) {
    db.exec(`ALTER TABLE products ADD COLUMN ${column} ${definition}`);
  }
}

/** Adds durable catalog metadata without fabricating facts for existing products. */
export const catalogMetadataMigration: Migration = {
  version: '010',
  name: 'catalog metadata',
  up(db) {
    addColumnIfMissing(db, 'active', 'INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))');

    db.exec(`
      CREATE TABLE IF NOT EXISTS catalog_tags (
        key TEXT PRIMARY KEY,
        label TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS product_tags (
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        tag_key TEXT NOT NULL REFERENCES catalog_tags(key),
        PRIMARY KEY (product_id, tag_key)
      );

      CREATE TABLE IF NOT EXISTS product_specifications (
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        specification_key TEXT NOT NULL,
        value_key TEXT NOT NULL,
        display_value TEXT NOT NULL,
        numeric_value INTEGER,
        PRIMARY KEY (product_id, specification_key)
      );

      CREATE INDEX IF NOT EXISTS products_active_created_at_id_idx
        ON products(active, created_at, id);
      CREATE INDEX IF NOT EXISTS products_active_price_cents_id_idx
        ON products(active, price_cents, id);
      CREATE INDEX IF NOT EXISTS product_tags_tag_key_product_id_idx
        ON product_tags(tag_key, product_id);
      CREATE INDEX IF NOT EXISTS product_specifications_key_value_product_id_idx
        ON product_specifications(specification_key, value_key, product_id);
    `);
  },
};
