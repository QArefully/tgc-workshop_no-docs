/* eslint-disable @typescript-eslint/no-redundant-type-constituents */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { PaymentWebhookBody, PaymentWebhookEventType } from '@shop/contracts/webhooks';
import type { IntentPaymentStatus } from '../payments/paymentRepository.js';

/** Compares hex HMACs without exposing a length mismatch to timingSafeEqual. */
export function verifiesWebhookSignature(
  rawPayload: string,
  signature: string,
  secret: string,
): boolean {
  const expected = createHmac('sha256', secret).update(rawPayload).digest('hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  const receivedBuffer = Buffer.from(signature, 'hex');
  return (
    receivedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(receivedBuffer, expectedBuffer)
  );
}

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, sorted(nested)]),
    );
  return value;
}

/** Hashes semantically identical JSON objects identically, independent of key insertion order. */
export function webhookFingerprint(payload: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(sorted(payload)))
    .digest('hex');
}

export function paymentTransitionForWebhook(
  eventType: PaymentWebhookEventType | string,
): Pick<
  { expectedStatus: IntentPaymentStatus; nextStatus: IntentPaymentStatus },
  'expectedStatus' | 'nextStatus'
> | null {
  switch (eventType) {
    case 'payment.succeeded':
      return { expectedStatus: 'authorized_pending_finalize', nextStatus: 'succeeded' };
    case 'payment.declined':
      return { expectedStatus: 'prepared', nextStatus: 'declined' };
    case 'payment.timed_out':
      return { expectedStatus: 'prepared', nextStatus: 'timed_out' };
    default:
      return null;
  }
}

export function webhookPayloadText(payload: PaymentWebhookBody): string {
  return JSON.stringify(payload);
}
