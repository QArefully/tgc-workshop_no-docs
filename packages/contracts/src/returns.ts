import { Type, type Static } from '@sinclair/typebox';
import { MoneyCents, PositiveIntegerString, Uuid } from './common.js';

const UtcIsoInstant = Type.String({
  minLength: 24,
  maxLength: 24,
  pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$',
});
const NonNegativeVersion = Type.Integer({ minimum: 0 });
/** Plain text transport fields exclude markup delimiters. */
const TrackingText = Type.String({ minLength: 1, maxLength: 500, pattern: '^[^<>]*$' });

export const ReturnRequestStatus = Type.Union([
  Type.Literal('requested'),
  Type.Literal('approved'),
  Type.Literal('rejected'),
  Type.Literal('received'),
  Type.Literal('refunded'),
]);
export type ReturnRequestStatus = Static<typeof ReturnRequestStatus>;

export const ReturnReasonCode = Type.Union([
  Type.Literal('damaged'),
  Type.Literal('wrong_item'),
  Type.Literal('not_as_expected'),
  Type.Literal('other'),
]);
export type ReturnReasonCode = Static<typeof ReturnReasonCode>;

export const ReturnErrorCode = Type.Union([
  Type.Literal('RETURN_NOT_FOUND'),
  Type.Literal('RETURN_NOT_ELIGIBLE'),
  Type.Literal('RETURN_WINDOW_EXPIRED'),
  Type.Literal('QUANTITY_UNAVAILABLE'),
  Type.Literal('INVALID_TRANSITION'),
  Type.Literal('STALE_VERSION'),
  Type.Literal('IDEMPOTENCY_CONFLICT'),
  Type.Literal('PAYMENT_NOT_REFUNDABLE'),
  Type.Literal('RETURN_DATA_CORRUPT'),
]);
export type ReturnErrorCode = Static<typeof ReturnErrorCode>;

export const ReturnEligibilityLine = Type.Object(
  {
    shipmentId: PositiveIntegerString,
    shipmentNumber: Type.Integer({ minimum: 1 }),
    orderLineItemId: PositiveIntegerString,
    productName: Type.String({ minLength: 1 }),
    variantId: Type.Optional(Type.Integer({ minimum: 1 })),
    variantLabel: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    deliveredQuantity: Type.Integer({ minimum: 1 }),
    reservedQuantity: Type.Integer({ minimum: 0 }),
    availableQuantity: Type.Integer({ minimum: 0 }),
    deliveredAt: UtcIsoInstant,
    windowClosesAt: UtcIsoInstant,
  },
  { additionalProperties: false },
);
export type ReturnEligibilityLine = Static<typeof ReturnEligibilityLine>;

export const ReturnRequestItem = Type.Object(
  {
    shipmentId: PositiveIntegerString,
    orderLineItemId: PositiveIntegerString,
    productName: Type.String({ minLength: 1 }),
    variantId: Type.Optional(Type.Integer({ minimum: 1 })),
    variantLabel: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    quantity: Type.Integer({ minimum: 1 }),
    deliveredAt: UtcIsoInstant,
    windowClosesAt: UtcIsoInstant,
  },
  { additionalProperties: false },
);
export type ReturnRequestItem = Static<typeof ReturnRequestItem>;

export const RefundSummary = Type.Object(
  {
    grossSubtotalCents: MoneyCents,
    discountShareCents: MoneyCents,
    amountCents: MoneyCents,
    simulatedReference: Type.String({ minLength: 1 }),
    refundedAt: UtcIsoInstant,
  },
  { additionalProperties: false },
);
export type RefundSummary = Static<typeof RefundSummary>;

export const ReturnRequest = Type.Object(
  {
    id: PositiveIntegerString,
    orderId: PositiveIntegerString,
    status: ReturnRequestStatus,
    version: NonNegativeVersion,
    reason: ReturnReasonCode,
    note: Type.Union([TrackingText, Type.Null()]),
    items: Type.Array(ReturnRequestItem),
    refund: Type.Union([RefundSummary, Type.Null()]),
    requestedAt: UtcIsoInstant,
    approvedAt: Type.Union([UtcIsoInstant, Type.Null()]),
    rejectedAt: Type.Union([UtcIsoInstant, Type.Null()]),
    receivedAt: Type.Union([UtcIsoInstant, Type.Null()]),
  },
  { additionalProperties: false },
);
export type ReturnRequest = Static<typeof ReturnRequest>;

export const ReturnOverviewResponse = Type.Object(
  {
    windowDays: Type.Literal(30),
    eligibleLines: Type.Array(ReturnEligibilityLine),
    requests: Type.Array(ReturnRequest),
  },
  { additionalProperties: false },
);
export type ReturnOverviewResponse = Static<typeof ReturnOverviewResponse>;

const ReturnSelection = Type.Object(
  {
    shipmentId: PositiveIntegerString,
    orderLineItemId: PositiveIntegerString,
    quantity: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

export const CreateReturnRequestBody = Type.Object(
  {
    idempotencyKey: Uuid,
    reason: ReturnReasonCode,
    note: Type.Optional(TrackingText),
    selections: Type.Array(ReturnSelection, { minItems: 1, maxItems: 50 }),
  },
  { additionalProperties: false },
);
export type CreateReturnRequestBody = Static<typeof CreateReturnRequestBody>;

export const ReturnIdParam = Type.Object(
  { returnId: PositiveIntegerString },
  { additionalProperties: false },
);
export type ReturnIdParam = Static<typeof ReturnIdParam>;

export const AdminReturnListQuery = Type.Object(
  {
    status: Type.Optional(ReturnRequestStatus),
    page: Type.Optional(Type.Integer({ minimum: 1, maximum: 10_000 })),
    pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
  },
  { additionalProperties: false },
);
export type AdminReturnListQuery = Static<typeof AdminReturnListQuery>;

export const AdminReturnListResponse = Type.Object(
  {
    items: Type.Array(ReturnRequest),
    page: Type.Integer({ minimum: 1, maximum: 10_000 }),
    pageSize: Type.Integer({ minimum: 1, maximum: 50 }),
  },
  { additionalProperties: false },
);
export type AdminReturnListResponse = Static<typeof AdminReturnListResponse>;

export const AdminDecisionBody = Type.Object(
  {
    version: NonNegativeVersion,
    idempotencyKey: Uuid,
    decision: Type.Union([Type.Literal('approve'), Type.Literal('reject')]),
  },
  { additionalProperties: false },
);
export type AdminDecisionBody = Static<typeof AdminDecisionBody>;

export const AdminReceiveBody = Type.Object(
  {
    version: NonNegativeVersion,
    idempotencyKey: Uuid,
  },
  { additionalProperties: false },
);
export type AdminReceiveBody = Static<typeof AdminReceiveBody>;

export const AdminRefundBody = Type.Object(
  {
    version: NonNegativeVersion,
    idempotencyKey: Uuid,
  },
  { additionalProperties: false },
);
export type AdminRefundBody = Static<typeof AdminRefundBody>;

export const ReturnErrorResponse = Type.Object(
  {
    error: Type.String({ minLength: 1, maxLength: 500 }),
    code: Type.Optional(ReturnErrorCode),
  },
  { additionalProperties: false },
);
export type ReturnErrorResponse = Static<typeof ReturnErrorResponse>;
