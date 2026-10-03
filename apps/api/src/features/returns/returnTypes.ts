/** Return request status values matching the state graph. */
export const ReturnRequestStatus = {
  REQUESTED: 'requested',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  RECEIVED: 'received',
  REFUNDED: 'refunded',
} as const;
export type ReturnRequestStatus = (typeof ReturnRequestStatus)[keyof typeof ReturnRequestStatus];

/** Customer-facing return reason codes. */
export const ReturnReasonCode = {
  DAMAGED: 'damaged',
  WRONG_ITEM: 'wrong_item',
  NOT_AS_EXPECTED: 'not_as_expected',
  OTHER: 'other',
} as const;
export type ReturnReasonCode = (typeof ReturnReasonCode)[keyof typeof ReturnReasonCode];

/** Domain error codes for return workflows. */
export const ReturnErrorCode = {
  RETURN_NOT_FOUND: 'RETURN_NOT_FOUND',
  RETURN_NOT_ELIGIBLE: 'RETURN_NOT_ELIGIBLE',
  RETURN_WINDOW_EXPIRED: 'RETURN_WINDOW_EXPIRED',
  QUANTITY_UNAVAILABLE: 'QUANTITY_UNAVAILABLE',
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  STALE_VERSION: 'STALE_VERSION',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  PAYMENT_NOT_REFUNDABLE: 'PAYMENT_NOT_REFUNDABLE',
  RETURN_DATA_CORRUPT: 'RETURN_DATA_CORRUPT',
} as const;
export type ReturnErrorCode = (typeof ReturnErrorCode)[keyof typeof ReturnErrorCode];

/** Domain event types recorded in the return event ledger. */
export const ReturnEventType = {
  REQUESTED: 'return.requested',
  APPROVED: 'return.approved',
  REJECTED: 'return.rejected',
  RECEIVED: 'return.received',
  REFUNDED: 'payment.refunded',
} as const;
export type ReturnEventType = (typeof ReturnEventType)[keyof typeof ReturnEventType];
