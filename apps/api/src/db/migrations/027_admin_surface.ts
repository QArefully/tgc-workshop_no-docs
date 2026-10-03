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
    throw new Error(`Foreign key violations after migration 027: ${JSON.stringify(violations)}`);
  }
}

/** Adds admin-only account state, feature flags, and immutable standalone refund records. */
export const adminSurfaceMigration: Migration = {
  version: '027',
  name: 'admin surface',
  up(db) {
    addColumnIfMissing(db, 'users', 'suspended_at', 'TEXT');
    addColumnIfMissing(db, 'users', 'suspension_reason', 'TEXT');
    addColumnIfMissing(db, 'users', 'suspended_by_user_id', 'INTEGER REFERENCES users(id)');

    db.exec(`
      CREATE TABLE IF NOT EXISTS feature_flags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_by_user_id INTEGER REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS admin_refunds (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payment_id INTEGER NOT NULL REFERENCES payments(id),
        order_id INTEGER NOT NULL REFERENCES orders(id),
        actor_user_id INTEGER NOT NULL REFERENCES users(id),
        amount_cents INTEGER NOT NULL CHECK (typeof(amount_cents) = 'integer' AND amount_cents > 0),
        reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
        idempotency_key TEXT NOT NULL UNIQUE,
        processor TEXT NOT NULL DEFAULT 'simulated' CHECK (processor = 'simulated'),
        simulated_reference TEXT NOT NULL CHECK (length(simulated_reference) >= 1),
        created_at TEXT NOT NULL
      );

      CREATE TRIGGER IF NOT EXISTS admin_refunds_no_update
      BEFORE UPDATE ON admin_refunds
      BEGIN
        SELECT RAISE(ABORT, 'admin_refunds are immutable');
      END;

      CREATE TRIGGER IF NOT EXISTS admin_refunds_no_delete
      BEFORE DELETE ON admin_refunds
      BEGIN
        SELECT RAISE(ABORT, 'admin_refunds are immutable');
      END;

      CREATE INDEX IF NOT EXISTS admin_refunds_payment_idx ON admin_refunds(payment_id);
      CREATE INDEX IF NOT EXISTS idx_orders_admin ON orders(created_at DESC, user_id);
    `);

    assertForeignKeysClean(db);
  },
};
