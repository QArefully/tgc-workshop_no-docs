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
    throw new Error(`Foreign key violations after migration 031: ${JSON.stringify(violations)}`);
  }
}

/**
 * Adds variant-scoped back-in-stock subscriptions. The partial unique index is the invariant
 * carrier: a buyer may hold at most one `pending` subscription per variant, while historical
 * `notified` and `cancelled` rows accumulate freely as an audit trail.
 */
export const backInStockMigration: Migration = {
  version: '031',
  name: 'back in stock',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS back_in_stock_subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        variant_id INTEGER NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('pending', 'notified', 'cancelled')),
        requested_at TEXT NOT NULL,
        notified_at TEXT,
        cancelled_at TEXT,
        notification_id INTEGER REFERENCES notifications(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS back_in_stock_pending_idx
        ON back_in_stock_subscriptions(user_id, variant_id) WHERE status = 'pending';
      CREATE INDEX IF NOT EXISTS back_in_stock_variant_status_idx
        ON back_in_stock_subscriptions(variant_id, status);
      CREATE INDEX IF NOT EXISTS back_in_stock_user_requested_idx
        ON back_in_stock_subscriptions(user_id, requested_at DESC);
    `);

    if (!hasTable(db, 'back_in_stock_subscriptions')) {
      throw new Error('Migration 031 did not create back_in_stock_subscriptions');
    }
    assertForeignKeysClean(db);
  },
};
