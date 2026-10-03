import type { Migration } from '../migrate.js';

type MigrationDb = Parameters<Migration['up']>[0];

function hasColumn(db: MigrationDb, table: string, column: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return columns.some((existing) => existing.name === column);
}

function addColumnIfMissing(
  db: MigrationDb,
  table: string,
  column: string,
  definition: string,
): void {
  if (!hasColumn(db, table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function assertForeignKeysClean(db: MigrationDb): void {
  const violations = db.pragma('foreign_key_check') as unknown[];
  if (violations.length > 0) {
    throw new Error(`Foreign key violations after migration 024: ${JSON.stringify(violations)}`);
  }
}

const CATEGORY_SCOPE_CHECK = `CHECK (
  category_scope IS NULL OR category_scope IN (
    'Sports Nutrition',
    'Baking & Pantry',
    'Drinks',
    'Household & Cleaning',
    'Garden & Outdoors',
    'Trade & Creative Materials'
  )
)`;

const ORDER_PROMO_CATEGORY_SCOPE_CHECK = `CHECK (
  promo_category_scope IS NULL OR promo_category_scope IN (
    'Sports Nutrition',
    'Baking & Pantry',
    'Drinks',
    'Household & Cleaning',
    'Garden & Outdoors',
    'Trade & Creative Materials'
  )
)`;

const CLEARANCE_WINDOW_CHECK = `CHECK (
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
)`;

/**
 * Adds optional clearance pricing, category-scoped offers, and the order snapshot fields that
 * disclose the promo scope and its eligible discount base at checkout. The migration is strictly
 * additive: historic catalog, promo, and order rows retain NULL in every new column.
 */
export const pricingPromotionsMigration: Migration = {
  version: '024',
  name: 'pricing promotions',
  up(db) {
    addColumnIfMissing(
      db,
      'product_variants',
      'clearance_price_cents',
      'INTEGER CHECK (clearance_price_cents IS NULL OR clearance_price_cents > 0)',
    );
    addColumnIfMissing(db, 'product_variants', 'clearance_starts_at', 'TEXT');
    addColumnIfMissing(
      db,
      'product_variants',
      'clearance_ends_at',
      `TEXT ${CLEARANCE_WINDOW_CHECK}`,
    );

    // SQLite accepts CHECK constraints on ADD COLUMN for the supported runtime. Keeping this
    // literal category list at persistence boundaries prevents bypassing writers from recording
    // a scope which catalog and checkout cannot interpret.
    addColumnIfMissing(db, 'promo_codes', 'category_scope', `TEXT ${CATEGORY_SCOPE_CHECK}`);
    addColumnIfMissing(
      db,
      'orders',
      'promo_category_scope',
      `TEXT ${ORDER_PROMO_CATEGORY_SCOPE_CHECK}`,
    );
    addColumnIfMissing(
      db,
      'orders',
      'discount_base_cents',
      'INTEGER CHECK (discount_base_cents IS NULL OR discount_base_cents >= 0)',
    );

    assertForeignKeysClean(db);
  },
};
