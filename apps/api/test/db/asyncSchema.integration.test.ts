import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { closeDatabase, migrateDatabase, seedDatabase } from '../../src/db/index.js';
import { migrations } from '../../src/db/migrations/index.js';

function tableExists(db: Database.Database, table: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table),
  );
}

void test('async behavior migration creates durable, constrained schema idempotently', () => {
  const directory = mkdtempSync(join(tmpdir(), 'shop-async-schema-'));
  const db = new Database(join(directory, 'shop.db'));
  db.pragma('foreign_keys = ON');

  try {
    migrateDatabase(db);
    assert.equal(migrations.at(-1)?.version, '038');
    for (const table of [
      'jobs',
      'job_attempts',
      'notifications',
      'captured_webhooks',
      'standing_orders',
      'standing_order_runs',
    ]) {
      assert.equal(tableExists(db, table), true, `${table} must exist`);
    }

    const appliedBeforeSecondRun = db
      .prepare('SELECT COUNT(*) AS count FROM schema_migrations')
      .get() as {
      count: number;
    };
    migrateDatabase(db);
    assert.deepEqual(
      db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get(),
      appliedBeforeSecondRun,
    );

    db.prepare(
      `INSERT INTO jobs
        (kind, dedupe_key, payload_json, status, max_attempts, run_at, created_at, updated_at)
       VALUES ('test.job', 'async-schema-dedupe', '{}', 'pending', 1,
               '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')`,
    ).run();
    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO jobs
              (kind, dedupe_key, payload_json, status, max_attempts, run_at, created_at, updated_at)
             VALUES ('test.job', 'async-schema-dedupe', '{}', 'pending', 1,
                     '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')`,
          )
          .run(),
      /UNIQUE constraint failed/,
    );
    const jobId = (
      db.prepare("SELECT id FROM jobs WHERE dedupe_key = 'async-schema-dedupe'").get() as {
        id: number;
      }
    ).id;
    db.prepare(
      `INSERT INTO job_attempts (job_id, attempt_number, started_at, outcome)
       VALUES (?, 1, '2026-08-01T00:00:00.000Z', 'succeeded')`,
    ).run(jobId);
    assert.throws(
      () => db.prepare('UPDATE job_attempts SET error = ? WHERE job_id = ?').run('no', jobId),
      /job_attempts are immutable/,
    );
    assert.throws(
      () => db.prepare('DELETE FROM job_attempts WHERE job_id = ?').run(jobId),
      /job_attempts are immutable/,
    );
    assert.doesNotThrow(() => db.prepare('DELETE FROM jobs WHERE id = ?').run(jobId));
    assert.equal(
      (
        db.prepare('SELECT COUNT(*) AS count FROM job_attempts WHERE job_id = ?').get(jobId) as {
          count: number;
        }
      ).count,
      0,
    );

    db.prepare(
      `INSERT INTO users (id, email, display_name, password_hash, password_salt, role)
       VALUES (3001, 'async-schema@example.test', 'Async schema', 'hash', 'salt', 'customer')`,
    ).run();
    db.prepare(
      `INSERT INTO saved_lists (id, user_id, name, is_default, created_at, updated_at)
       VALUES (3001, 3001, 'Async list', 0, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')`,
    ).run();
    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO standing_orders
              (user_id, name, source_kind, source_list_id, source_order_id, cadence, next_run_at, created_at, updated_at)
             VALUES (3001, 'Invalid source', 'saved_list', 3001, 1, 'weekly',
                     '2026-08-08T00:00:00.000Z', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')`,
          )
          .run(),
      /CHECK constraint failed/,
    );
    assert.equal((db.pragma('foreign_key_check') as unknown[]).length, 0);
  } finally {
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  }
});

void test('a fully migrated seeded database reruns migration 030 without losing rows', () => {
  const directory = mkdtempSync(join(tmpdir(), 'shop-async-seeded-schema-'));
  const db = new Database(join(directory, 'shop.db'));
  db.pragma('foreign_keys = ON');

  try {
    // `seedDatabase` now seeds async fixtures, which correctly require migration 030's tables.
    // Build the realistic production harness first, then prove its migration rerun preserves seed data.
    migrateDatabase(db);
    seedDatabase(db);
    const usersBefore = (
      db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }
    ).count;
    migrateDatabase(db);
    assert.equal(
      (db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }).count,
      usersBefore,
    );
    assert.equal((db.pragma('foreign_key_check') as unknown[]).length, 0);
  } finally {
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  }
});
