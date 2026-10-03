import type { Migration } from '../migrate.js';

type MigrationDb = Parameters<Migration['up']>[0];

function hasActiveSortOrderIndex(db: MigrationDb): boolean {
  return (
    db.prepare("PRAGMA index_list('product_variants')").all() as Array<{ name: string }>
  ).some((index) => index.name === 'product_variants_active_sort_order_idx');
}

function assertForeignKeysClean(db: MigrationDb): void {
  const violations = db.pragma('foreign_key_check') as unknown[];
  if (violations.length > 0) {
    throw new Error(`Foreign key violations after migration 028: ${JSON.stringify(violations)}`);
  }
}

/** Retired variants share sort_order 0; live sort positions remain unique per product. */
export const retiredVariantSortOrderMigration: Migration = {
  version: '028',
  name: 'retired variant sort order',
  up(db) {
    if (!hasActiveSortOrderIndex(db)) {
      db.exec(`
        CREATE TABLE product_variants_new (
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
          moq_sacks INTEGER NOT NULL DEFAULT 4,
          clearance_price_cents INTEGER CHECK (clearance_price_cents IS NULL OR clearance_price_cents > 0),
          clearance_starts_at TEXT,
          clearance_ends_at TEXT CHECK (
            (clearance_price_cents IS NULL
              AND clearance_starts_at IS NULL
              AND clearance_ends_at IS NULL)
            OR (
              clearance_price_cents IS NOT NULL
              AND clearance_price_cents > 0
              AND clearance_price_cents < price_cents
              AND clearance_starts_at IS NOT NULL
              AND clearance_ends_at IS NOT NULL
              AND clearance_starts_at < clearance_ends_at
            )
          )
        );

        INSERT INTO product_variants_new
          (id, product_id, sku, label, weight_grams, price_cents, compare_at_price_cents,
           stock_count, backorderable, backorder_lead_days, delivery_class, active, sort_order,
           created_at, updated_at, moq_sacks, clearance_price_cents, clearance_starts_at,
           clearance_ends_at)
        SELECT id, product_id, sku, label, weight_grams, price_cents, compare_at_price_cents,
               stock_count, backorderable, backorder_lead_days, delivery_class, active, sort_order,
               created_at, updated_at, moq_sacks, clearance_price_cents, clearance_starts_at,
               clearance_ends_at
        FROM product_variants;

        DROP TABLE product_variants;
        ALTER TABLE product_variants_new RENAME TO product_variants;
        CREATE UNIQUE INDEX product_variants_active_sort_order_idx
          ON product_variants(product_id, sort_order) WHERE active = 1;
      `);
    }

    assertForeignKeysClean(db);
  },
};
