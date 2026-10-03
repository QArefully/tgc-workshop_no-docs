import { LEGACY_DATA_COUNTRY } from '@shop/contracts';
import { standingOrderDueCopy } from '@shop/localisation/messages/asyncContent';
import type Database from 'better-sqlite3';

export const ASYNC_SEED_INSTANT = '2026-08-02T09:00:00.000Z';
const SAVED_LIST_SEED_INSTANT = '2026-08-01T09:00:00.000Z';

const FEATURE_FLAGS = [
  ['async.job_handler_failure', 'Force local async job handler failure.'],
  ['async.notification_delivery_failure', 'Force local notification delivery failure.'],
  ['async.webhook_processing_failure', 'Force local webhook processing failure.'],
  ['async.standing_order_run_failure', 'Force local standing-order run failure.'],
  ['async.back_in_stock_failure', 'Force local back-in-stock notification failure.'],
] as const;

function requiredId(
  db: Database.Database,
  sql: string,
  label: string,
  ...values: unknown[]
): number {
  const row = db.prepare(sql).get(...values) as { id: number } | undefined;
  if (!row) throw new Error(`Seed assertion failed: missing ${label}`);
  return row.id;
}

/** Installs fixed local async scenarios; no wall clock or generated identifiers enter seed state. */
export function seedAsyncScenarios(db: Database.Database): void {
  const aliceId = requiredId(
    db,
    'SELECT id FROM users WHERE email = ? AND country = ?',
    'Alice user',
    'alice@example.com',
    LEGACY_DATA_COUNTRY,
  );
  const upsertFlag = db.prepare(`
    INSERT INTO feature_flags (key, description, enabled, updated_at, updated_by_user_id)
    VALUES (?, ?, 0, ?, NULL)
    ON CONFLICT(key) DO UPDATE SET description=excluded.description,enabled=0,updated_at=excluded.updated_at,updated_by_user_id=NULL
  `);
  for (const [key, description] of FEATURE_FLAGS)
    upsertFlag.run(key, description, ASYNC_SEED_INSTANT);

  const monthlyRestock = db
    .prepare(
      "SELECT id FROM saved_lists WHERE user_id = ? AND name = 'Monthly restock' AND created_at = ?",
    )
    .get(aliceId, SAVED_LIST_SEED_INSTANT) as { id: number } | undefined;
  // Preserve saved-list seed's explicit buyer-replacement scenario: async fixtures never recreate it.
  if (!monthlyRestock) return;
  const monthlyRestockId = monthlyRestock.id;

  // Due at the frozen instant: scheduler diagnostics can claim this fixture without date arithmetic.
  db.prepare(
    `
    INSERT INTO standing_orders
      (user_id,name,source_kind,source_list_id,source_order_id,cadence,next_run_at,active,created_at,updated_at)
    SELECT ?, 'Weekly Monthly restock', 'saved_list', ?, NULL, 'weekly', ?, 1, ?, ?
    WHERE NOT EXISTS (
      SELECT 1 FROM standing_orders WHERE user_id=? AND name='Weekly Monthly restock' AND created_at=?
    )
  `,
  ).run(
    aliceId,
    monthlyRestockId,
    ASYNC_SEED_INSTANT,
    ASYNC_SEED_INSTANT,
    ASYNC_SEED_INSTANT,
    aliceId,
    ASYNC_SEED_INSTANT,
  );
  const standingOrderId = requiredId(
    db,
    "SELECT id FROM standing_orders WHERE user_id = ? AND name = 'Weekly Monthly restock' AND created_at = ?",
    'weekly standing order',
    aliceId,
    ASYNC_SEED_INSTANT,
  );
  const dueCopy = standingOrderDueCopy(LEGACY_DATA_COUNTRY, 'Weekly Monthly restock');

  db.prepare(
    `
    INSERT INTO notifications (user_id,kind,title,body,entity_type,entity_id,dedupe_key,created_at,read_at)
    VALUES (?, 'standing_order.run_completed', ?, ?, 'standing_order', ?, 'seed:async:alice:standing-order-due', ?, NULL)
    ON CONFLICT(dedupe_key) DO NOTHING
  `,
  ).run(aliceId, dueCopy.title, dueCopy.body, String(standingOrderId), ASYNC_SEED_INSTANT);
  const notificationId = requiredId(
    db,
    "SELECT id FROM notifications WHERE dedupe_key = 'seed:async:alice:standing-order-due'",
    'standing-order notification',
  );

  const insertPayment = db.prepare(`
    INSERT INTO payments
      (idempotency_key,request_fingerprint,status,amount_cents,card_last4,card_brand,created_at,updated_at)
    VALUES (?, ?, 'succeeded', 0, '4242', 'Visa', ?, ?)
    ON CONFLICT(idempotency_key) DO NOTHING
  `);
  // Both payments are already terminal: one webhook completed the transition, one arrived stale.
  insertPayment.run(
    '11111111-1111-4111-8111-111111111111',
    'seed-payment-fingerprint-processed',
    ASYNC_SEED_INSTANT,
    ASYNC_SEED_INSTANT,
  );
  insertPayment.run(
    '22222222-2222-4222-8222-222222222222',
    'seed-payment-fingerprint-ignored-stale',
    ASYNC_SEED_INSTANT,
    ASYNC_SEED_INSTANT,
  );

  const insertWebhook = db.prepare(`
    INSERT INTO captured_webhooks
      (source,event_id,event_type,payload_json,request_fingerprint,received_at,status,processed_at,failure_reason,job_id)
    VALUES ('simulated_payments', ?, 'payment.succeeded', ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(event_id) DO NOTHING
  `);
  // Completed processor outcome.
  insertWebhook.run(
    'seed-payment-processed',
    JSON.stringify({
      eventId: 'seed-payment-processed',
      eventType: 'payment.succeeded',
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
    }),
    'seed-fingerprint-processed',
    ASYNC_SEED_INSTANT,
    'processed',
    ASYNC_SEED_INSTANT,
    null,
  );
  // Stale processor outcome: captured safely but intentionally ignored.
  insertWebhook.run(
    'seed-payment-ignored-stale',
    JSON.stringify({
      eventId: 'seed-payment-ignored-stale',
      eventType: 'payment.succeeded',
      idempotencyKey: '22222222-2222-4222-8222-222222222222',
    }),
    'seed-fingerprint-ignored-stale',
    ASYNC_SEED_INSTANT,
    'ignored_stale',
    ASYNC_SEED_INSTANT,
    'Payment state no longer accepts event',
  );
  const webhookId = (eventId: string) =>
    requiredId(
      db,
      'SELECT id FROM captured_webhooks WHERE event_id = ?',
      `webhook ${eventId}`,
      eventId,
    );
  const processedWebhookId = webhookId('seed-payment-processed');
  const staleWebhookId = webhookId('seed-payment-ignored-stale');

  const insertJob = db.prepare(`
    INSERT INTO jobs (kind,dedupe_key,payload_json,status,attempts,max_attempts,run_at,lease_expires_at,last_error,created_at,updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
    ON CONFLICT(dedupe_key) DO NOTHING
  `);
  insertJob.run(
    'standing_order.run',
    'seed:async:standing-order:weekly-monthly-restock',
    JSON.stringify({ standingOrderId }),
    'pending',
    0,
    5,
    ASYNC_SEED_INSTANT,
    null,
    ASYNC_SEED_INSTANT,
    ASYNC_SEED_INSTANT,
  );
  insertJob.run(
    'webhook.process',
    'seed:async:webhook:processed',
    JSON.stringify({ webhookId: processedWebhookId }),
    'succeeded',
    1,
    5,
    ASYNC_SEED_INSTANT,
    null,
    ASYNC_SEED_INSTANT,
    ASYNC_SEED_INSTANT,
  );
  insertJob.run(
    'webhook.process',
    'seed:async:webhook:ignored-stale',
    JSON.stringify({ webhookId: staleWebhookId }),
    'succeeded',
    1,
    5,
    ASYNC_SEED_INSTANT,
    null,
    ASYNC_SEED_INSTANT,
    ASYNC_SEED_INSTANT,
  );
  // Dead before max attempts: admin retry exercise remains available after reset.
  insertJob.run(
    'notification.deliver',
    'seed:async:job:retryable-dead',
    JSON.stringify({ notificationId }),
    'dead',
    1,
    5,
    ASYNC_SEED_INSTANT,
    'Simulated recipient rejected delivery',
    ASYNC_SEED_INSTANT,
    ASYNC_SEED_INSTANT,
  );

  const jobId = (key: string) =>
    requiredId(db, 'SELECT id FROM jobs WHERE dedupe_key = ?', `job ${key}`, key);
  const processedJobId = jobId('seed:async:webhook:processed');
  const staleJobId = jobId('seed:async:webhook:ignored-stale');
  const deadJobId = jobId('seed:async:job:retryable-dead');
  db.prepare('UPDATE captured_webhooks SET job_id = ? WHERE id = ?').run(
    processedJobId,
    processedWebhookId,
  );
  db.prepare('UPDATE captured_webhooks SET job_id = ? WHERE id = ?').run(
    staleJobId,
    staleWebhookId,
  );

  const insertAttempt = db.prepare(`
    INSERT OR IGNORE INTO job_attempts (job_id,attempt_number,started_at,finished_at,outcome,error)
    VALUES (?, 1, ?, ?, ?, ?)
  `);
  insertAttempt.run(processedJobId, ASYNC_SEED_INSTANT, ASYNC_SEED_INSTANT, 'succeeded', null);
  insertAttempt.run(staleJobId, ASYNC_SEED_INSTANT, ASYNC_SEED_INSTANT, 'succeeded', null);
  insertAttempt.run(
    deadJobId,
    ASYNC_SEED_INSTANT,
    ASYNC_SEED_INSTANT,
    'failed',
    'Simulated recipient rejected delivery',
  );
}
