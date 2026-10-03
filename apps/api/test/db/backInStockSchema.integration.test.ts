import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { closeDatabase, migrateDatabase, resetDatabase, seedDatabase } from '../../src/db/index.js';
import { migrations } from '../../src/db/migrations/index.js';

const TIMESTAMP = '2026-08-02T00:00:00.000Z';

function openMigratedSeededDatabase(prefix: string): { directory: string; db: Database.Database } {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  const db = new Database(join(directory, 'shop.db'));
  db.pragma('foreign_keys = ON');
  migrateDatabase(db);
  seedDatabase(db);
  return { directory, db };
}

function createBuyer(db: Database.Database, id: number, email: string): number {
  db.prepare(
    `INSERT INTO users (id, email, display_name, password_hash, password_salt, role)
     VALUES (?, ?, 'Back in stock buyer', 'hash', 'salt', 'customer')`,
  ).run(id, email);
  return id;
}

function firstVariantId(db: Database.Database): number {
  return (db.prepare('SELECT id FROM product_variants ORDER BY id LIMIT 1').get() as { id: number })
    .id;
}

function insertSubscription(
  db: Database.Database,
  userId: number,
  variantId: number,
  status: string,
): void {
  db.prepare(
    `INSERT INTO back_in_stock_subscriptions
      (user_id, variant_id, status, requested_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(userId, variantId, status, TIMESTAMP, TIMESTAMP, TIMESTAMP);
}

void test('migration 031 creates constrained back-in-stock subscription schema', () => {
  const { directory, db } = openMigratedSeededDatabase('shop-back-in-stock-schema-');

  try {
    assert.equal(migrations.at(-1)?.version, '038');

    const columns = (
      db.pragma('table_info(back_in_stock_subscriptions)') as { name: string; notnull: number }[]
    ).map((column) => column.name);
    assert.deepEqual(columns, [
      'id',
      'user_id',
      'variant_id',
      'status',
      'requested_at',
      'notified_at',
      'cancelled_at',
      'notification_id',
      'created_at',
      'updated_at',
    ]);

    const indexes = (
      db.pragma('index_list(back_in_stock_subscriptions)') as { name: string }[]
    ).map((index) => index.name);
    for (const expected of [
      'back_in_stock_pending_idx',
      'back_in_stock_variant_status_idx',
      'back_in_stock_user_requested_idx',
    ]) {
      assert.ok(indexes.includes(expected), `${expected} must exist`);
    }

    const userId = createBuyer(db, 3101, 'back-in-stock-schema@example.test');
    const variantId = firstVariantId(db);

    insertSubscription(db, userId, variantId, 'pending');

    assert.throws(
      () => insertSubscription(db, userId, variantId, 'waiting'),
      /CHECK constraint failed/,
      'status vocabulary is closed to pending/notified/cancelled',
    );

    assert.throws(
      () => insertSubscription(db, userId, variantId, 'pending'),
      /UNIQUE constraint failed/,
      'at most one pending subscription per (user, variant)',
    );

    db.prepare(
      `UPDATE back_in_stock_subscriptions
       SET status = 'notified', notified_at = ?, updated_at = ?
       WHERE user_id = ? AND variant_id = ?`,
    ).run(TIMESTAMP, TIMESTAMP, userId, variantId);

    assert.doesNotThrow(
      () => insertSubscription(db, userId, variantId, 'pending'),
      'a fresh pending row is allowed once the previous one is notified',
    );

    assert.equal((db.pragma('foreign_key_check') as unknown[]).length, 0);

    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    assert.equal(
      (
        db
          .prepare('SELECT COUNT(*) AS count FROM back_in_stock_subscriptions WHERE user_id = ?')
          .get(userId) as { count: number }
      ).count,
      0,
      'subscriptions cascade with the owning user',
    );
    assert.equal((db.pragma('foreign_key_check') as unknown[]).length, 0);
  } finally {
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  }
});

void test('resetDatabase empties back_in_stock_subscriptions', () => {
  const { directory, db } = openMigratedSeededDatabase('shop-back-in-stock-reset-');

  try {
    const userId = createBuyer(db, 3102, 'back-in-stock-reset@example.test');
    insertSubscription(db, userId, firstVariantId(db), 'pending');
    assert.equal(
      (
        db
          .prepare('SELECT COUNT(*) AS count FROM back_in_stock_subscriptions WHERE user_id = ?')
          .get(userId) as {
          count: number;
        }
      ).count,
      1,
      'the fixture subscription exists before reset',
    );

    resetDatabase(db);

    assert.equal(
      (
        db.prepare('SELECT COUNT(*) AS count FROM back_in_stock_subscriptions').get() as {
          count: number;
        }
      ).count,
      0,
      'reset empties the whole table, including any seeded subscriptions',
    );
    assert.equal((db.pragma('foreign_key_check') as unknown[]).length, 0);
  } finally {
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  }
});
