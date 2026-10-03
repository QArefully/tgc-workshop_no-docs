import { Type, type Static } from '@sinclair/typebox';
import { PositiveIntegerString, Uuid } from './common.js';

const UtcIsoInstant = Type.String({
  minLength: 24,
  maxLength: 24,
  pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$',
});

export const CreateAdminRefundBody = Type.Object(
  {
    paymentId: PositiveIntegerString,
    orderId: PositiveIntegerString,
    amountCents: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
    reason: Type.String({ minLength: 1, maxLength: 500, pattern: '^(?!\\s*$)[^<>]*$' }),
    idempotencyKey: Uuid,
  },
  { additionalProperties: false },
);
export type CreateAdminRefundBody = Static<typeof CreateAdminRefundBody>;

export const AdminRefund = Type.Object(
  {
    id: PositiveIntegerString,
    paymentId: PositiveIntegerString,
    orderId: PositiveIntegerString,
    actorUserId: PositiveIntegerString,
    amountCents: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
    reason: Type.String({ minLength: 1, maxLength: 500 }),
    idempotencyKey: Uuid,
    processor: Type.Literal('simulated'),
    simulatedReference: Type.String({ minLength: 1, maxLength: 500 }),
    createdAt: UtcIsoInstant,
  },
  { additionalProperties: false },
);
export type AdminRefund = Static<typeof AdminRefund>;
