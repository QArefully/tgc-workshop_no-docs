import type { Migration } from '../migrate.js';

type MigrationDb = Parameters<Migration['up']>[0];

function hasColumn(db: MigrationDb, table: string, column: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return columns.some((existing) => existing.name === column);
}

function addSessionColumnIfMissing(db: MigrationDb, column: string, definition: string): void {
  if (!hasColumn(db, 'sessions', column)) {
    db.exec(`ALTER TABLE sessions ADD COLUMN ${column} ${definition}`);
  }
}

function assertForeignKeysClean(db: MigrationDb): void {
  const violations = db.pragma('foreign_key_check') as unknown[];
  if (violations.length > 0) {
    throw new Error(`Foreign key violations after migration 025: ${JSON.stringify(violations)}`);
  }
}

/**
 * Adds account self-service persistence. Session metadata remains nullable because sessions are
 * created by existing authentication paths and historic rows must upgrade without a table rebuild.
 */
export const accountSelfServiceMigration: Migration = {
  version: '025',
  name: 'account self service',
  up(db) {
    // The migration runner owns FK suspension for this transaction. Do not toggle it here.
    addSessionColumnIfMissing(db, 'user_agent', 'TEXT');
    addSessionColumnIfMissing(db, 'ip_address_hash', 'TEXT');
    addSessionColumnIfMissing(db, 'last_seen_at', 'TEXT');
    db.prepare('UPDATE sessions SET last_seen_at = created_at WHERE last_seen_at IS NULL').run();

    db.exec(`
      CREATE TABLE IF NOT EXISTS user_preferences (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        order_updates_email INTEGER NOT NULL DEFAULT 1 CHECK (order_updates_email IN (0, 1)),
        marketing_email INTEGER NOT NULL DEFAULT 0 CHECK (marketing_email IN (0, 1)),
        approval_request_email INTEGER NOT NULL DEFAULT 1 CHECK (approval_request_email IN (0, 1)),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS account_deletion_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        requested_at TEXT NOT NULL,
        completed_at TEXT NOT NULL,
        tombstone_email TEXT NOT NULL,
        tombstone_display_name TEXT NOT NULL
      );
    `);

    assertForeignKeysClean(db);
  },
};
