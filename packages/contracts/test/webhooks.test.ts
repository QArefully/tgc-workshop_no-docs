import assert from 'node:assert/strict';
import test from 'node:test';
import { PaymentWebhookBody, AdminCapturedWebhookListQuery } from '../src/webhooks.js';
import { Value } from '@sinclair/typebox/value';
import type { PaymentWebhookBody as RootPaymentWebhookBody } from '@shop/contracts';
import type { PaymentWebhookBody as SubpathPaymentWebhookBody } from '@shop/contracts/webhooks';

const body = {
  eventId: 'evt_001',
  eventType: 'payment.succeeded',
  idempotencyKey: '123e4567-e89b-42d3-a456-426614174000',
} satisfies RootPaymentWebhookBody;

void test('webhook contracts validate bodies, close queries, and preserve root/subpath identity', async () => {
  const root = await import('@shop/contracts');
  const subpath = await import('@shop/contracts/webhooks');

  assert.strictEqual(root.PaymentWebhookBody, subpath.PaymentWebhookBody);
  const subpathBody: SubpathPaymentWebhookBody = body;
  assert.equal(subpathBody.eventType, 'payment.succeeded');
  assert.equal(Value.Check(PaymentWebhookBody, body), true);
  assert.equal(
    Value.Check(AdminCapturedWebhookListQuery, { page: 1, pageSize: 25, unexpected: true }),
    false,
  );
});
