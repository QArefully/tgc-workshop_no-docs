import { Type, type Static } from '@sinclair/typebox';
import { PositiveIntegerString, Uuid } from './common.js';

const UtcIsoInstant = Type.String({
  minLength: 24,
  maxLength: 24,
  pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$',
});
const SafeNonNegativeInteger = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });

/** Simulated payment processor lifecycle events accepted by the local webhook endpoint. */
export const PaymentWebhookEventType = Type.Union([
  Type.Literal('payment.succeeded'),
  Type.Literal('payment.declined'),
  Type.Literal('payment.timed_out'),
]);
export type PaymentWebhookEventType = Static<typeof PaymentWebhookEventType>;

export const PaymentWebhookBody = Type.Object(
  {
    eventId: Type.String({ minLength: 1, maxLength: 255 }),
    eventType: PaymentWebhookEventType,
    idempotencyKey: Uuid,
  },
  { additionalProperties: false },
);
export type PaymentWebhookBody = Static<typeof PaymentWebhookBody>;

export const PaymentWebhookAck = Type.Object(
  {
    webhookId: PositiveIntegerString,
    replayed: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type PaymentWebhookAck = Static<typeof PaymentWebhookAck>;

export const CapturedWebhookStatus = Type.Union([
  Type.Literal('captured'),
  Type.Literal('processed'),
  Type.Literal('ignored_stale'),
  Type.Literal('rejected'),
]);
export type CapturedWebhookStatus = Static<typeof CapturedWebhookStatus>;

export const AdminCapturedWebhook = Type.Object(
  {
    id: PositiveIntegerString,
    source: Type.Literal('simulated_payments'),
    eventId: Type.String({ minLength: 1, maxLength: 255 }),
    eventType: PaymentWebhookEventType,
    payload: PaymentWebhookBody,
    receivedAt: UtcIsoInstant,
    status: CapturedWebhookStatus,
    processedAt: Type.Union([UtcIsoInstant, Type.Null()]),
    failureReason: Type.Union([Type.String({ minLength: 1, maxLength: 2_000 }), Type.Null()]),
    jobId: Type.Union([PositiveIntegerString, Type.Null()]),
  },
  { additionalProperties: false },
);
export type AdminCapturedWebhook = Static<typeof AdminCapturedWebhook>;

export const AdminCapturedWebhookListQuery = Type.Object(
  {
    status: Type.Optional(CapturedWebhookStatus),
    page: Type.Optional(Type.Integer({ minimum: 1, maximum: 10_000 })),
    pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  },
  { additionalProperties: false },
);
export type AdminCapturedWebhookListQuery = Static<typeof AdminCapturedWebhookListQuery>;

export const AdminCapturedWebhookPage = Type.Object(
  {
    items: Type.Array(AdminCapturedWebhook),
    total: SafeNonNegativeInteger,
    page: Type.Integer({ minimum: 1, maximum: 10_000 }),
    pageSize: Type.Integer({ minimum: 1, maximum: 100 }),
  },
  { additionalProperties: false },
);
export type AdminCapturedWebhookPage = Static<typeof AdminCapturedWebhookPage>;
