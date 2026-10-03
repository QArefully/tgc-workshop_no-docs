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

function countRows(db: MigrationDb, sql: string): number {
  return (db.prepare(sql).get() as { count: number }).count;
}

function assertForeignKeysClean(db: MigrationDb): void {
  const violations = db.pragma('foreign_key_check') as unknown[];
  if (violations.length > 0) {
    throw new Error(`Foreign key violations after migration 032: ${JSON.stringify(violations)}`);
  }
}

const COUNTRY_DEFINITION =
  "TEXT NOT NULL DEFAULT 'UK' CHECK (country IN ('UK','US','CN','PL','ES','DE','FR'))";

/**
 * Rebuilds users with composite (email, country) uniqueness, drops the old inline UNIQUE(email),
 * and backfills country = 'UK' on existing rows. Adds country to orders, carts, and
 * company_accounts for multi-region partitioning.
 */
export const countryLocalisationMigration: Migration = {
  version: '032',
  name: 'country localisation',
  up(db) {
    if (!hasColumn(db, 'users', 'country')) {
      const existingCount = countRows(db, 'SELECT COUNT(*) AS count FROM users');
      const sequence = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'users'").get() as
        { seq: number } | undefined;

      db.exec('DROP TABLE IF EXISTS users_new');
      db.exec(`
        CREATE TABLE users_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          email TEXT NOT NULL,
          display_name TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          password_salt TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'customer',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          suspended_at TEXT,
          suspension_reason TEXT,
          suspended_by_user_id INTEGER REFERENCES users(id),
          country ${COUNTRY_DEFINITION},
          UNIQUE (email, country)
        );
      `);

      db.exec(`
        INSERT INTO users_new
          (id, email, display_name, password_hash, password_salt, role, created_at,
           suspended_at, suspension_reason, suspended_by_user_id)
        SELECT id, email, display_name, password_hash, password_salt, role, created_at,
               suspended_at, suspension_reason, suspended_by_user_id
        FROM users
        ORDER BY id
      `);

      const copiedCount = countRows(db, 'SELECT COUNT(*) AS count FROM users_new');
      if (copiedCount !== existingCount) {
        throw new Error(
          `users rebuild count mismatch: ${existingCount} existing vs ${copiedCount} copied`,
        );
      }

      db.exec('DROP TABLE users');
      db.exec('ALTER TABLE users_new RENAME TO users');

      if (sequence) {
        db.prepare(
          `INSERT INTO sqlite_sequence (name, seq) SELECT 'users', ?
           WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'users')`,
        ).run(sequence.seq);
        db.prepare("UPDATE sqlite_sequence SET seq = ? WHERE name = 'users' AND seq < ?").run(
          sequence.seq,
          sequence.seq,
        );
      }
    }

    addColumnIfMissing(db, 'orders', 'country', COUNTRY_DEFINITION);
    addColumnIfMissing(db, 'carts', 'country', COUNTRY_DEFINITION);
    addColumnIfMissing(db, 'company_accounts', 'country', COUNTRY_DEFINITION);

    assertForeignKeysClean(db);
  },
};
