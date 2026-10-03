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
    throw new Error(`Foreign key violations after migration 030: ${JSON.stringify(violations)}`);
  }
}

/** Establishes durable local queue, notification, webhook, and standing-order state. */
export const asyncBehaviorMigration: Migration = {
  version: '030',
  name: 'async behavior',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        dedupe_key TEXT UNIQUE,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'dead')),
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (typeof(attempts) = 'integer' AND attempts >= 0),
        max_attempts INTEGER NOT NULL CHECK (typeof(max_attempts) = 'integer' AND max_attempts > 0),
        run_at TEXT NOT NULL,
        lease_expires_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS job_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        attempt_number INTEGER NOT NULL CHECK (typeof(attempt_number) = 'integer' AND attempt_number > 0),
        started_at TEXT,
        finished_at TEXT,
        outcome TEXT NOT NULL CHECK (outcome IN ('succeeded', 'failed', 'abandoned')),
        error TEXT,
        UNIQUE(job_id, attempt_number)
      );

      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        title TEXT,
        body TEXT,
        entity_type TEXT,
        entity_id TEXT,
        dedupe_key TEXT UNIQUE,
        created_at TEXT NOT NULL,
        read_at TEXT
      );

      CREATE TABLE IF NOT EXISTS captured_webhooks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL CHECK (source = 'simulated_payments'),
        event_id TEXT NOT NULL UNIQUE,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        request_fingerprint TEXT NOT NULL,
        received_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('captured', 'processed', 'ignored_stale', 'rejected')),
        processed_at TEXT,
        failure_reason TEXT,
        job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS standing_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        source_kind TEXT NOT NULL CHECK (source_kind IN ('saved_list', 'order')),
        source_list_id INTEGER REFERENCES saved_lists(id) ON DELETE CASCADE,
        source_order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
        cadence TEXT NOT NULL CHECK (cadence IN ('weekly', 'fortnightly', 'monthly')),
        next_run_at TEXT NOT NULL,
        last_run_at TEXT,
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (
          (source_kind = 'saved_list' AND source_list_id IS NOT NULL AND source_order_id IS NULL)
          OR (source_kind = 'order' AND source_list_id IS NULL AND source_order_id IS NOT NULL)
        )
      );

      CREATE TABLE IF NOT EXISTS standing_order_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        standing_order_id INTEGER NOT NULL REFERENCES standing_orders(id) ON DELETE CASCADE,
        job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
        cart_id TEXT,
        run_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
        added_line_count INTEGER NOT NULL DEFAULT 0 CHECK (typeof(added_line_count) = 'integer' AND added_line_count >= 0),
        skipped_line_count INTEGER NOT NULL DEFAULT 0 CHECK (typeof(skipped_line_count) = 'integer' AND skipped_line_count >= 0),
        outcomes_json TEXT,
        failure_reason TEXT
      );

      CREATE INDEX IF NOT EXISTS jobs_status_run_at_idx ON jobs(status, run_at);
      CREATE INDEX IF NOT EXISTS notifications_user_created_at_idx
        ON notifications(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS standing_orders_active_next_run_at_idx
        ON standing_orders(active, next_run_at);
      CREATE INDEX IF NOT EXISTS standing_order_runs_order_run_at_idx
        ON standing_order_runs(standing_order_id, run_at DESC);
      CREATE INDEX IF NOT EXISTS captured_webhooks_status_received_at_idx
        ON captured_webhooks(status, received_at DESC);

      CREATE TRIGGER IF NOT EXISTS job_attempts_no_update
      BEFORE UPDATE ON job_attempts
      BEGIN
        SELECT RAISE(ABORT, 'job_attempts are immutable');
      END;

      CREATE TRIGGER IF NOT EXISTS job_attempts_no_delete
      BEFORE DELETE ON job_attempts
      WHEN EXISTS (SELECT 1 FROM jobs WHERE id = OLD.job_id)
      BEGIN
        SELECT RAISE(ABORT, 'job_attempts are immutable');
      END;
    `);

    for (const table of [
      'jobs',
      'job_attempts',
      'notifications',
      'captured_webhooks',
      'standing_orders',
      'standing_order_runs',
    ]) {
      if (!hasTable(db, table)) throw new Error(`Migration 030 did not create ${table}`);
    }
    assertForeignKeysClean(db);
  },
};
