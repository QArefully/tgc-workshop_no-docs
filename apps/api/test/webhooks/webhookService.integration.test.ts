import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { migrateDatabase } from '../../src/db/migrate.js';
import { createUnitOfWork } from '../../src/db/unitOfWork.js';
import { createAuditRepository } from '../../src/features/audit/auditRepository.js';
import { createAuditWriter } from '../../src/features/audit/auditService.js';
import { noFaults } from '../../src/features/jobs/faultSwitch.js';
import { JobHandlerRegistry } from '../../src/features/jobs/jobHandlerRegistry.js';
import { createJobRepository } from '../../src/features/jobs/jobRepository.js';
import { JobService } from '../../src/features/jobs/jobService.js';
import { createNotificationRepository } from '../../src/features/notifications/notificationRepository.js';
import { createNotificationService } from '../../src/features/notifications/notificationService.js';
import { createPaymentRepository } from '../../src/features/payments/paymentRepository.js';
import { createWebhookProcessingHandler } from '../../src/features/webhooks/webhookProcessingHandler.js';
import { createWebhookRepository } from '../../src/features/webhooks/webhookRepository.js';
import { createWebhookService } from '../../src/features/webhooks/webhookService.js';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'shop-webhooks-'));
  const db = new Database(join(dir, 'shop.db'));
  migrateDatabase(db);
  const clock = { now: () => new Date('2026-08-01T00:00:00.000Z') };
  const uow = createUnitOfWork(db);
  const audit = createAuditWriter({ repository: createAuditRepository(db), clock });
  const registry = new JobHandlerRegistry();
  const jobs = new JobService({
    repository: createJobRepository(db),
    registry,
    unitOfWork: uow,
    clock,
  });
  const notifications = createNotificationService({
    repository: createNotificationRepository(db),
    jobs,
    unitOfWork: uow,
    audit,
    clock,
  });
  const payments = createPaymentRepository(db),
    repository = createWebhookRepository(db),
    secret = 'webhook-secret';
  const service = createWebhookService({ repository, jobs, unitOfWork: uow, audit, clock, secret });
  registry.register(
    'webhook.process',
    createWebhookProcessingHandler({
      repository,
      payments,
      notifications,
      audit,
      clock,
      faults: noFaults,
      countryForUser: () => 'DE',
    }),
  );
  const owner = Number(
    (
      db
        .prepare(
          "INSERT INTO users (email,display_name,password_hash,password_salt,role,country) VALUES ('buyer@example.test','Buyer','hash','salt','customer','DE') RETURNING id",
        )
        .get() as { id: number }
    ).id,
  );
  const order = Number(
    (
      db
        .prepare(
          "INSERT INTO orders (customer_name,customer_email,shipping_address,subtotal_cents,discount_cents,total_cents,user_id,created_at) VALUES ('Buyer','buyer@example.test','1 Test Street',100,0,100,?,?) RETURNING id",
        )
        .get(owner, clock.now().toISOString()) as { id: number }
    ).id,
  );
  const sign = (raw: string) => createHmac('sha256', secret).update(raw).digest('hex');
  const reserve = (
    key: string,
    status: 'prepared' | 'authorized_pending_finalize' | 'succeeded' = 'prepared',
  ) => {
    payments.reservePreGateway({
      idempotencyKey: key,
      fingerprint: key,
      card: { brand: 'visa', last4: '1111' },
      createdAt: clock.now().toISOString(),
    });
    db.prepare('UPDATE payments SET status=?,order_id=? WHERE idempotency_key=?').run(
      status,
      order,
      key,
    );
  };
  return {
    db,
    jobs,
    service,
    repository,
    reserve,
    sign,
    owner,
    order,
    close: () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
void test('captures once, queues once, and notifies the order owner only after success', async () => {
  const f = fixture();
  try {
    const succeeded = {
      eventId: 'evt-1',
      eventType: 'payment.succeeded' as const,
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
    };
    f.reserve(succeeded.idempotencyKey, 'authorized_pending_finalize');
    const raw = JSON.stringify(succeeded);
    const first = f.service.capture({
      rawPayload: raw,
      signature: f.sign(raw),
      payload: succeeded,
    });
    const replay = f.service.capture({
      rawPayload: raw,
      signature: f.sign(raw),
      payload: succeeded,
    });
    assert.equal(first.replayed, false);
    assert.equal(replay.replayed, true);
    assert.equal(f.repository.count(), 1);
    assert.equal(
      (
        f.db.prepare("SELECT COUNT(*) AS count FROM jobs WHERE kind='webhook.process'").get() as {
          count: number;
        }
      ).count,
      1,
    );
    await f.jobs.runDue();
    assert.equal(f.repository.get(first.webhook.id)?.status, 'processed');
    assert.equal(
      (
        f.db
          .prepare(
            "SELECT COUNT(*) AS count FROM notifications WHERE user_id=? AND kind='payment.webhook_settled'",
          )
          .get(f.owner) as { count: number }
      ).count,
      1,
    );
    assert.deepEqual(
      f.db
        .prepare(
          "SELECT title, body FROM notifications WHERE user_id=? AND kind='payment.webhook_settled'",
        )
        .get(f.owner),
      {
        title: 'Zahlungsaktualisierung erhalten',
        body: `Zahlungsaktualisierung f\u00fcr Bestellung Nr. ${f.order} erhalten.`,
      },
    );
    for (const payload of [
      {
        eventId: 'evt-declined',
        eventType: 'payment.declined' as const,
        idempotencyKey: '11111111-1111-4111-8111-111111111112',
      },
      {
        eventId: 'evt-timed-out',
        eventType: 'payment.timed_out' as const,
        idempotencyKey: '11111111-1111-4111-8111-111111111113',
      },
    ]) {
      f.reserve(payload.idempotencyKey);
      const eventRaw = JSON.stringify(payload);
      f.service.capture({ rawPayload: eventRaw, signature: f.sign(eventRaw), payload });
      await f.jobs.runDue();
    }
    assert.equal(
      (
        f.db
          .prepare(
            "SELECT COUNT(*) AS count FROM notifications WHERE user_id=? AND kind='payment.webhook_settled'",
          )
          .get(f.owner) as { count: number }
      ).count,
      1,
    );
  } finally {
    f.close();
  }
});
void test('rejects a captured webhook with an unsupported event type without retrying', async () => {
  const f = fixture();
  try {
    const key = '55555555-5555-4555-8555-555555555555';
    f.reserve(key);
    const raw = JSON.stringify({
      eventId: 'evt-unsupported',
      eventType: 'payment.unsupported',
      idempotencyKey: key,
    });
    const webhookId = Number(
      (
        f.db
          .prepare(
            "INSERT INTO captured_webhooks (source,event_id,event_type,payload_json,request_fingerprint,received_at,status) VALUES ('simulated_payments',?,?,?,?,?,'captured') RETURNING id",
          )
          .get(
            'evt-unsupported',
            'payment.unsupported',
            raw,
            'unsupported-fingerprint',
            '2026-08-01T00:00:00.000Z',
          ) as {
          id: number;
        }
      ).id,
    );
    f.jobs.enqueue({
      kind: 'webhook.process',
      dedupeKey: `webhook.process:${webhookId}`,
      payload: { webhookId },
    });
    const result = await f.jobs.runDue();
    assert.equal(result.failedCount, 0);
    assert.equal(f.repository.get(webhookId)?.status, 'rejected');
    assert.equal(f.repository.get(webhookId)?.failureReason, 'Unsupported webhook event type');
    assert.equal(
      (
        f.db
          .prepare(
            "SELECT COUNT(*) AS count FROM audit_events WHERE action='webhook.rejected' AND entity_id=?",
          )
          .get(String(webhookId)) as { count: number }
      ).count,
      1,
    );
  } finally {
    f.close();
  }
});
void test('rejects bad signatures without capture, handles unknown payment, and ignores stale CAS', async () => {
  const f = fixture();
  try {
    const bad = {
      eventId: 'evt-bad',
      eventType: 'payment.declined' as const,
      idempotencyKey: '22222222-2222-4222-8222-222222222222',
    };
    assert.throws(
      () => f.service.capture({ rawPayload: JSON.stringify(bad), signature: '00', payload: bad }),
      { message: 'INVALID_SIGNATURE' },
    );
    assert.equal(f.repository.count(), 0);
    const unknown = {
      eventId: 'evt-unknown',
      eventType: 'payment.declined' as const,
      idempotencyKey: '33333333-3333-4333-8333-333333333333',
    };
    let raw = JSON.stringify(unknown);
    const captured = f.service.capture({
      rawPayload: raw,
      signature: f.sign(raw),
      payload: unknown,
    });
    await f.jobs.runDue();
    assert.equal(f.repository.get(captured.webhook.id)?.status, 'rejected');
    const stale = {
      eventId: 'evt-stale',
      eventType: 'payment.succeeded' as const,
      idempotencyKey: '44444444-4444-4444-8444-444444444444',
    };
    f.reserve(stale.idempotencyKey, 'succeeded');
    raw = JSON.stringify(stale);
    const staleCaptured = f.service.capture({
      rawPayload: raw,
      signature: f.sign(raw),
      payload: stale,
    });
    await f.jobs.runDue();
    assert.equal(f.repository.get(staleCaptured.webhook.id)?.status, 'ignored_stale');
  } finally {
    f.close();
  }
});
