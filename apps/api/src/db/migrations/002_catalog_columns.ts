import type { Migration } from '../migrate.js';

function addColumnIfMissing(
  db: Parameters<Migration['up']>[0],
  table: string,
  column: string,
  definition: string,
): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!columns.some((existing) => existing.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export const catalogColumnsMigration: Migration = {
  version: '002',
  name: 'catalog product columns',
  up(db) {
    addColumnIfMissing(db, 'products', 'slug', "TEXT NOT NULL DEFAULT ''");
    addColumnIfMissing(db, 'products', 'compare_at_price_cents', 'INTEGER');
    addColumnIfMissing(db, 'products', 'sales_count', 'INTEGER NOT NULL DEFAULT 0');
    addColumnIfMissing(db, 'products', 'image_set_id', 'TEXT');

    db.exec(`
      UPDATE products
      SET image_set_id = 'legacy-product-' || id
      WHERE image_set_id IS NULL OR image_set_id = ''
    `);
  },
};
