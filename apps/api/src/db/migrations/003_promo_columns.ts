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

export const promoColumnsMigration: Migration = {
  version: '003',
  name: 'promo rule columns',
  up(db) {
    addColumnIfMissing(db, 'promo_codes', 'kind', "TEXT NOT NULL DEFAULT 'percent'");
    addColumnIfMissing(db, 'promo_codes', 'amount_cents', 'INTEGER');
    addColumnIfMissing(db, 'promo_codes', 'min_subtotal_cents', 'INTEGER');
    addColumnIfMissing(db, 'promo_codes', 'start_at', 'TEXT');
    addColumnIfMissing(db, 'promo_codes', 'end_at', 'TEXT');
    addColumnIfMissing(db, 'promo_codes', 'max_redemptions', 'INTEGER');
    addColumnIfMissing(db, 'promo_codes', 'redemption_count', 'INTEGER NOT NULL DEFAULT 0');
    addColumnIfMissing(db, 'promo_codes', 'per_user_limit', 'INTEGER');
  },
};
