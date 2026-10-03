import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import {
  paymentTransitionForWebhook,
  verifiesWebhookSignature,
  webhookFingerprint,
} from './webhookRules.js';
void test('verifies HMAC with a length-safe mismatch guard', () => {
  const raw = '{"eventId":"a"}',
    secret = 'local-secret';
  const signature = createHmac('sha256', secret).update(raw).digest('hex');
  assert.equal(verifiesWebhookSignature(raw, signature, secret), true);
  assert.equal(verifiesWebhookSignature(raw, '00', secret), false);
});
void test('fingerprints equivalent payload objects independent of key order', () =>
  assert.equal(
    webhookFingerprint({ b: 2, a: { z: 1, y: 0 } }),
    webhookFingerprint({ a: { y: 0, z: 1 }, b: 2 }),
  ));
void test('maps payment lifecycle events to non-compounding CAS transitions', () => {
  assert.deepEqual(paymentTransitionForWebhook('payment.succeeded'), {
    expectedStatus: 'authorized_pending_finalize',
    nextStatus: 'succeeded',
  });
  assert.deepEqual(paymentTransitionForWebhook('payment.declined'), {
    expectedStatus: 'prepared',
    nextStatus: 'declined',
  });
  assert.deepEqual(paymentTransitionForWebhook('payment.timed_out'), {
    expectedStatus: 'prepared',
    nextStatus: 'timed_out',
  });
  assert.equal(paymentTransitionForWebhook('payment.unknown'), null);
});
