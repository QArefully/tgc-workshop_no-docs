import type Database from 'better-sqlite3';
import { migrations } from './migrations/index.js';

export interface Migration {
  version: string;
  name: string;
  up(db: Database.Database): void;
}

function validateMigrations(available: readonly Migration[], applied: readonly string[]): void {
  const versions = available.map((migration) => migration.version);
  if (new Set(versions).size !== versions.length) {
    throw new Error('Migration versions must be unique');
  }

  for (const version of applied) {
    if (!versions.includes(version)) {
      throw new Error(`Database has unknown migration version ${version}`);
    }
  }

  let expectedIndex = 0;
  for (const version of applied) {
    const index = versions.indexOf(version);
    if (index !== expectedIndex) {
      throw new Error(`Database migration history is not ordered at version ${version}`);
    }
    expectedIndex += 1;
  }
}

/**
 * Apply each unrecorded migration once. Each schema change and ledger entry share one transaction.
 *
 * Foreign key enforcement is suspended for the duration of the run and restored afterwards, which
 * is SQLite's documented procedure for schema changes (`lang_altertable.html`, "Making Other Kinds
 * Of Table Schema Changes"). Changing a column set means rebuilding the table, and rebuilding a
 * parent table drops rows its children reference: with enforcement live, `ON DELETE CASCADE` would
 * silently take the children with it, and the pragma cannot be toggled from inside a migration
 * because it is a no-op within a transaction. Integrity is not traded away — every migration runs
 * `PRAGMA foreign_key_check` over the whole database inside its own transaction, before that
 * transaction commits. `foreign_key_check` reports violations regardless of the `foreign_keys`
 * setting, so the suspension does not blind it. A violation therefore rolls back both the offending
 * schema change and its ledger row, leaving the failure deterministic and repeatable rather than
 * committed and invisible on the next run.
 */
export function migrateDatabase(
  db: Database.Database,
  availableMigrations: readonly Migration[] = migrations,
): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const applied = db
    .prepare('SELECT version FROM schema_migrations ORDER BY version')
    .all()
    .map((row) => (row as { version: string }).version);
  validateMigrations(availableMigrations, applied);

  const recorded = new Set(applied);
  const pending = availableMigrations.filter((migration) => !recorded.has(migration.version));
  if (pending.length === 0) return;

  const foreignKeysWereEnabled = Boolean(db.pragma('foreign_keys', { simple: true }));
  if (foreignKeysWereEnabled) {
    db.pragma('foreign_keys = OFF');
    if (db.pragma('foreign_keys', { simple: true })) {
      throw new Error(
        'Cannot migrate: foreign key enforcement could not be suspended. Migrations must not run inside an open transaction.',
      );
    }
  }

  try {
    for (const migration of pending) {
      db.transaction(() => {
        migration.up(db);
        db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(migration.version);
        const violations = db.pragma('foreign_key_check') as unknown[];
        if (violations.length > 0) {
          throw new Error(
            `Foreign key violations after migration ${migration.version}: ${JSON.stringify(violations)}`,
          );
        }
      })();
    }
  } finally {
    if (foreignKeysWereEnabled) db.pragma('foreign_keys = ON');
  }
}
