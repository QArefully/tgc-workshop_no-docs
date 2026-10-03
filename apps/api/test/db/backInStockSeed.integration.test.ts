import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { closeDatabase, openDatabase, resetDatabase, seedDatabase } from '../../src/db/index.js';

const SOLD_OUT_SKU = 'TCM-0034-002';
const SUBSCRIBER_EMAIL = 'alice@example.com';
const SEED_INSTANT = '2026-08-02T09:00:00.000Z';

interface LotRow {
  sku: string;
  stock_count: number;
  active: number;
  backorderable: number;
  is_default: number;
}

const soldOutLot = (db: ReturnType<typeof openDatabase>): LotRow =>
  db
    .prepare(
      `SELECT v.sku, v.stock_count, v.active, v.backorderable,
              CASE WHEN p.default_variant_id = v.id THEN 1 ELSE 0 END AS is_default
       FROM product_variants v JOIN products p ON p.id = v.product_id
       WHERE v.sku = ?`,
    )
    .get(SOLD_OUT_SKU) as LotRow;

/**
 * Subscriptions keyed by buyer email and SKU rather than by surrogate id: `resetDatabase` does not
 * rewind SQLite's AUTOINCREMENT counters, so variant ids legitimately shift across a reset while
 * row content stays identical.
 */
const subscriptions = (db: ReturnType<typeof openDatabase>) =>
  db
    .prepare(
      `SELECT u.email, v.sku, s.status, s.requested_at, s.notified_at, s.cancelled_at,
              s.notification_id, s.created_at, s.updated_at
       FROM back_in_stock_subscriptions s
       JOIN users u ON u.id = s.user_id
       JOIN product_variants v ON v.id = s.variant_id
       ORDER BY u.email, v.sku`,
    )
    .all();

const faultFlag = (db: ReturnType<typeof openDatabase>) =>
  db
    .prepare('SELECT key, enabled FROM feature_flags WHERE key = ?')
    .get('async.back_in_stock_failure');

const withSeededDatabase = (t: test.TestContext, prefix: string) => {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  const db = openDatabase({ path: join(directory, 'shop.db') });
  t.after(() => {
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  });
  return db;
};

void test('back-in-stock seed installs one sold-out lot with one pending subscription', (t) => {
  const db = withSeededDatabase(t, 'shop-back-in-stock-seed-');
  seedDatabase(db);

  assert.deepEqual(soldOutLot(db), {
    sku: SOLD_OUT_SKU,
    stock_count: 0,
    active: 1,
    backorderable: 0,
    // The product keeps a purchasable default variant, so only this lot reads as sold out.
    is_default: 0,
  });

  assert.deepEqual(subscriptions(db), [
    {
      email: SUBSCRIBER_EMAIL,
      sku: SOLD_OUT_SKU,
      status: 'pending',
      requested_at: SEED_INSTANT,
      notified_at: null,
      cancelled_at: null,
      notification_id: null,
      created_at: SEED_INSTANT,
      updated_at: SEED_INSTANT,
    },
  ]);

  assert.deepEqual(faultFlag(db), { key: 'async.back_in_stock_failure', enabled: 0 });
});

void test('re-seeding changes nothing about the back-in-stock fixture', (t) => {
  const db = withSeededDatabase(t, 'shop-back-in-stock-idempotent-');
  seedDatabase(db);
  const first = { lot: soldOutLot(db), rows: subscriptions(db), flag: faultFlag(db) };

  seedDatabase(db);
  assert.deepEqual({ lot: soldOutLot(db), rows: subscriptions(db), flag: faultFlag(db) }, first);
  assert.equal(first.rows.length, 1);
});

void test('reset then seed reproduces identical back-in-stock rows', (t) => {
  const db = withSeededDatabase(t, 'shop-back-in-stock-reset-');
  seedDatabase(db);
  const first = { lot: soldOutLot(db), rows: subscriptions(db), flag: faultFlag(db) };

  resetDatabase(db);
  seedDatabase(db);
  assert.deepEqual({ lot: soldOutLot(db), rows: subscriptions(db), flag: faultFlag(db) }, first);
});

void test('a subscription moved off pending is never resurrected by a re-seed', (t) => {
  const db = withSeededDatabase(t, 'shop-back-in-stock-cancelled-');
  seedDatabase(db);
  db.prepare(
    `UPDATE back_in_stock_subscriptions
     SET status = 'cancelled', cancelled_at = ?, updated_at = ?`,
  ).run(SEED_INSTANT, SEED_INSTANT);

  seedDatabase(db);
  const rows = subscriptions(db) as Array<{ status: string }>;
  assert.equal(rows.length, 1, 're-seed must not add a second row for the same buyer and lot');
  assert.equal(rows[0]?.status, 'cancelled');
});

void test('a buyer-created subscription survives a re-seed untouched', (t) => {
  const db = withSeededDatabase(t, 'shop-back-in-stock-buyer-');
  seedDatabase(db);
  const bobId = (
    db.prepare('SELECT id FROM users WHERE email = ?').get('bob@example.com') as {
      id: number;
    }
  ).id;
  const variantId = (
    db.prepare('SELECT id FROM product_variants WHERE sku = ?').get(SOLD_OUT_SKU) as { id: number }
  ).id;
  db.prepare(
    `INSERT INTO back_in_stock_subscriptions
       (user_id, variant_id, status, requested_at, created_at, updated_at)
     VALUES (?, ?, 'pending', ?, ?, ?)`,
  ).run(bobId, variantId, SEED_INSTANT, SEED_INSTANT, SEED_INSTANT);
  const before = subscriptions(db);

  seedDatabase(db);
  assert.deepEqual(subscriptions(db), before);
});
