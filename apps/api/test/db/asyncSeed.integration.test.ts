import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { closeDatabase, openDatabase, resetDatabase, seedDatabase } from '../../src/db/index.js';

void test('async seed is stable, due, and leaves an admin-retryable dead job', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'shop-async-seed-'));
  const db = openDatabase({ path: join(directory, 'shop.db') });
  t.after(() => {
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  });

  const scopedCounts = () => ({
    flags: (
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM feature_flags WHERE key LIKE 'async.%' AND enabled = 0",
        )
        .get() as { count: number }
    ).count,
    standingOrders: (
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM standing_orders s JOIN users u ON u.id=s.user_id
           WHERE u.email='alice@example.com' AND s.name='Weekly Monthly restock'`,
        )
        .get() as { count: number }
    ).count,
    notifications: (
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM notifications WHERE dedupe_key='seed:async:alice:standing-order-due'",
        )
        .get() as { count: number }
    ).count,
    webhooks: (
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM captured_webhooks WHERE event_id LIKE 'seed-payment-%'",
        )
        .get() as { count: number }
    ).count,
    jobs: (
      db
        .prepare("SELECT COUNT(*) AS count FROM jobs WHERE dedupe_key LIKE 'seed:async:%'")
        .get() as {
        count: number;
      }
    ).count,
  });

  seedDatabase(db);
  const first = scopedCounts();
  seedDatabase(db);
  assert.deepEqual(scopedCounts(), first);
  assert.deepEqual(first, { flags: 5, standingOrders: 1, notifications: 1, webhooks: 2, jobs: 4 });
  assert.equal(
    (
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM standing_orders
           WHERE name='Weekly Monthly restock' AND active=1 AND next_run_at<='2026-08-02T09:00:00.000Z'`,
        )
        .get() as { count: number }
    ).count,
    1,
  );
  assert.equal(
    (
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM jobs WHERE dedupe_key='seed:async:job:retryable-dead' AND status='dead' AND attempts < max_attempts",
        )
        .get() as { count: number }
    ).count,
    1,
  );
  assert.deepEqual(
    db
      .prepare(
        "SELECT status FROM captured_webhooks WHERE event_id LIKE 'seed-payment-%' ORDER BY event_id",
      )
      .all(),
    [{ status: 'ignored_stale' }, { status: 'processed' }],
  );
  const webhookJobs = db
    .prepare(
      `
      SELECT w.status, w.failure_reason, p.status AS payment_status,
             w.id AS webhook_id, json_extract(j.payload_json, '$.webhookId') AS payload_webhook_id,
             j.id AS job_id, a.outcome AS attempt_outcome
      FROM captured_webhooks w
      JOIN jobs j ON j.id=w.job_id
      JOIN payments p ON p.idempotency_key=json_extract(w.payload_json, '$.idempotencyKey')
      JOIN job_attempts a ON a.job_id=j.id AND a.attempt_number=1
      WHERE w.event_id LIKE 'seed-payment-%'
      ORDER BY w.event_id
    `,
    )
    .all();
  assert.deepEqual(
    webhookJobs.map((row) => ({
      status: (row as { status: string }).status,
      failure_reason: (row as { failure_reason: string | null }).failure_reason,
      payment_status: (row as { payment_status: string }).payment_status,
      attempt_outcome: (row as { attempt_outcome: string }).attempt_outcome,
    })),
    [
      {
        status: 'ignored_stale',
        failure_reason: 'Payment state no longer accepts event',
        payment_status: 'succeeded',
        attempt_outcome: 'succeeded',
      },
      {
        status: 'processed',
        failure_reason: null,
        payment_status: 'succeeded',
        attempt_outcome: 'succeeded',
      },
    ],
  );
  for (const row of webhookJobs as Array<{
    webhook_id: number;
    payload_webhook_id: number;
    job_id: number;
  }>) {
    assert.equal(row.payload_webhook_id, row.webhook_id);
    assert.ok(row.job_id > 0);
  }
  const deadDelivery = db
    .prepare(
      `
        SELECT n.id AS notification_id, json_extract(j.payload_json, '$.notificationId') AS payload_notification_id,
               j.status, j.attempts, j.max_attempts, a.outcome AS attempt_outcome
        FROM notifications n
        JOIN jobs j ON j.dedupe_key='seed:async:job:retryable-dead'
        JOIN job_attempts a ON a.job_id=j.id AND a.attempt_number=1
        WHERE n.dedupe_key='seed:async:alice:standing-order-due'
      `,
    )
    .get() as {
    notification_id: number;
    payload_notification_id: number;
    status: string;
    attempts: number;
    max_attempts: number;
    attempt_outcome: string;
  };
  assert.equal(deadDelivery.payload_notification_id, deadDelivery.notification_id);
  assert.deepEqual(
    { ...deadDelivery, notification_id: 0, payload_notification_id: 0 },
    {
      notification_id: 0,
      payload_notification_id: 0,
      status: 'dead',
      attempts: 1,
      max_attempts: 5,
      attempt_outcome: 'failed',
    },
  );
});

void test('reset clears async tables and restores job-attempt immutability triggers', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'shop-async-reset-'));
  const db = openDatabase({ path: join(directory, 'shop.db') });
  t.after(() => {
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  });
  seedDatabase(db);
  db.prepare(
    "INSERT INTO audit_events (actor_type, actor_user_id, action, entity_type, entity_id, request_id, occurred_at) VALUES ('system', NULL, 'test.async', 'test', '1', 'async-reset', '2026-08-02T09:00:00.000Z')",
  ).run();

  resetDatabase(db);
  for (const table of [
    'job_attempts',
    'standing_order_runs',
    'captured_webhooks',
    'notifications',
    'standing_orders',
    'jobs',
  ]) {
    assert.equal(
      (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count,
      0,
      `${table} should be empty after reset`,
    );
  }
  assert.equal(
    (
      db
        .prepare("SELECT COUNT(*) AS count FROM audit_events WHERE request_id='async-reset'")
        .get() as {
        count: number;
      }
    ).count,
    1,
  );
  assert.deepEqual(
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='trigger' AND name IN ('job_attempts_no_update','job_attempts_no_delete') ORDER BY name",
      )
      .all(),
    [{ name: 'job_attempts_no_delete' }, { name: 'job_attempts_no_update' }],
  );
});
