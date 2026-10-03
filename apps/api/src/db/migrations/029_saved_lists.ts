import type { Migration } from '../migrate.js';

type MigrationDb = Parameters<Migration['up']>[0];

function hasTable(db: MigrationDb, table: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table),
  );
}

function assertForeignKeysClean(db: MigrationDb): void {
  const violations = db.pragma('foreign_key_check') as unknown[];
  if (violations.length > 0) {
    throw new Error(`Foreign key violations after migration 029: ${JSON.stringify(violations)}`);
  }
}

/**
 * Replaces product-scoped favourites with variant-scoped saved lists. The 25 kg sack value is
 * frozen here deliberately: migration replay must retain its historical conversion semantics.
 */
export const savedListsMigration: Migration = {
  version: '029',
  name: 'saved lists',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS saved_lists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
        is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS saved_list_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        saved_list_id INTEGER NOT NULL REFERENCES saved_lists(id) ON DELETE CASCADE,
        variant_id INTEGER NOT NULL REFERENCES product_variants(id),
        quantity INTEGER NOT NULL CHECK (quantity >= 1),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS saved_lists_user_name_idx
        ON saved_lists(user_id, name COLLATE NOCASE);
      CREATE UNIQUE INDEX IF NOT EXISTS saved_lists_user_default_idx
        ON saved_lists(user_id) WHERE is_default = 1;
      CREATE UNIQUE INDEX IF NOT EXISTS saved_list_items_list_variant_idx
        ON saved_list_items(saved_list_id, variant_id);
      CREATE INDEX IF NOT EXISTS saved_list_items_variant_idx
        ON saved_list_items(variant_id);
    `);

    if (hasTable(db, 'favourites')) {
      db.exec(`
        INSERT OR IGNORE INTO saved_lists (user_id, name, is_default, created_at, updated_at)
        SELECT DISTINCT user_id, 'Favourites', 1, datetime('now'), datetime('now')
        FROM favourites;

        INSERT OR IGNORE INTO saved_list_items
          (saved_list_id, variant_id, quantity, created_at, updated_at)
        SELECT saved_list.id,
               variant.id,
               (variant.moq_sacks * 25000 + variant.weight_grams - 1) / variant.weight_grams,
               datetime('now'),
               datetime('now')
        FROM favourites favourite
        JOIN products product ON product.id = favourite.product_id
        JOIN product_variants variant
          ON variant.id = product.default_variant_id AND variant.active = 1
        JOIN saved_lists saved_list
          ON saved_list.user_id = favourite.user_id AND saved_list.is_default = 1;

        DROP TABLE favourites;
      `);
    }

    assertForeignKeysClean(db);
  },
};
