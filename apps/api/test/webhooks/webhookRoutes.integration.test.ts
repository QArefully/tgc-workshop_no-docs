import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import {
  AdminCapturedWebhook,
  AdminCapturedWebhookPage,
  PaymentWebhookAck,
} from '@shop/contracts/webhooks';
import { buildApp } from '../../src/app.js';
import { createSeededFixture } from '../support/seededDatabase.js';

function cookie(response: { headers: Record<string, string | string[] | undefined> }): string {
  const header = response.headers['set-cookie'];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) throw new Error('Expected session cookie');
  return value.split(';', 1)[0]!;
}

async function login(app: Awaited<ReturnType<typeof buildApp>>, email: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/login',
    payload: { email, password: 'Password123!', country: 'UK' },
  });
  assert.equal(response.statusCode, 200, response.body);
  return cookie(response);
}

void test('payment webhook preserves signed payload, captures once, and rejects tampering', async (t) => {
  const secret = 'route-webhook-secret';
  const { db, app } = await createSeededFixture({
    testContext: t,
    app: { webhookSecret: secret },
  });

  const body = {
    eventId: 'route-event-1',
    eventType: 'payment.declined',
    idempotencyKey: '11111111-1111-4111-8111-111111111111',
  };
  const raw = JSON.stringify(body);
  const signature = createHmac('sha256', secret).update(raw).digest('hex');
  const capture = () =>
    app.inject({
      method: 'POST',
      url: '/api/webhooks/payments',
      headers: { 'content-type': 'application/json', 'x-webhook-signature': signature },
      payload: raw,
    });
  const first = await capture();
  assert.equal(first.statusCode, 202, first.body);
  assert.equal(Value.Parse(PaymentWebhookAck, first.json()).replayed, false);
  const replay = await capture();
  assert.equal(replay.statusCode, 202, replay.body);
  assert.equal(Value.Parse(PaymentWebhookAck, replay.json()).replayed, true);
  assert.equal(
    Number(
      db
        .prepare('SELECT COUNT(*) FROM captured_webhooks WHERE event_id=?')
        .pluck()
        .get(body.eventId),
    ),
    1,
  );
  const queuedJobId = db
    .prepare('SELECT job_id FROM captured_webhooks WHERE event_id=?')
    .pluck()
    .get(body.eventId) as number | null;
  assert.notEqual(queuedJobId, null);
  assert.equal(
    Number(db.prepare('SELECT COUNT(*) FROM jobs WHERE id=?').pluck().get(queuedJobId)),
    1,
  );

  const tampered = await app.inject({
    method: 'POST',
    url: '/api/webhooks/payments',
    headers: { 'content-type': 'application/json', 'x-webhook-signature': signature },
    payload: JSON.stringify({ ...body, eventId: 'route-event-tampered' }),
  });
  assert.equal(tampered.statusCode, 401, tampered.body);
  assert.equal(
    Number(
      db
        .prepare('SELECT COUNT(*) FROM captured_webhooks WHERE event_id=?')
        .pluck()
        .get(body.eventId),
    ),
    1,
  );
  assert.equal(
    Number(
      db
        .prepare('SELECT COUNT(*) FROM captured_webhooks WHERE event_id=?')
        .pluck()
        .get('route-event-tampered'),
    ),
    0,
  );
  const malformedRaw = '{';
  const malformed = await app.inject({
    method: 'POST',
    url: '/api/webhooks/payments',
    headers: {
      'content-type': 'application/json',
      'x-webhook-signature': createHmac('sha256', secret).update(malformedRaw).digest('hex'),
    },
    payload: malformedRaw,
  });
  assert.equal(malformed.statusCode, 400, malformed.body);
});

void test('admin webhook surfaces require admin and expose stored payload', async (t) => {
  const { app } = await createSeededFixture(t);
  const customer = await login(app, 'alice@example.com');
  const admin = await login(app, 'admin@example.com');
  const webhook = app.context.services.webhooks.capture({
    rawPayload:
      '{"eventId":"admin-route-event","eventType":"payment.timed_out","idempotencyKey":"22222222-2222-4222-8222-222222222222"}',
    signature: createHmac('sha256', 'local-development-webhook-secret')
      .update(
        '{"eventId":"admin-route-event","eventType":"payment.timed_out","idempotencyKey":"22222222-2222-4222-8222-222222222222"}',
      )
      .digest('hex'),
  }).webhook;
  for (const request of [
    { method: 'GET' as const, url: '/api/admin/webhooks' },
    { method: 'GET' as const, url: `/api/admin/webhooks/${webhook.id}` },
  ]) {
    assert.equal((await app.inject(request)).statusCode, 401);
    assert.equal((await app.inject({ ...request, headers: { cookie: customer } })).statusCode, 403);
  }
  const listed = await app.inject({
    method: 'GET',
    url: '/api/admin/webhooks?status=captured&page=1&pageSize=1',
    headers: { cookie: admin },
  });
  assert.equal(listed.statusCode, 200, listed.body);
  assert.equal(
    Value.Parse(AdminCapturedWebhookPage, listed.json()).items[0]!.eventId,
    'admin-route-event',
  );
  const detail = await app.inject({
    method: 'GET',
    url: `/api/admin/webhooks/${webhook.id}`,
    headers: { cookie: admin },
  });
  assert.equal(detail.statusCode, 200, detail.body);
  assert.equal(
    Value.Parse(AdminCapturedWebhook, detail.json()).payload.eventType,
    'payment.timed_out',
  );
});
