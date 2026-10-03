export const ORDER_ERROR_CODES = [
  'ORDER_NOT_FOUND',
  'ORDER_FORBIDDEN',
  'INVALID_ALLOCATION',
  'INVALID_TRANSITION',
  'CANCELLATION_NOT_ALLOWED',
  'STALE_VERSION',
  'IDEMPOTENCY_CONFLICT',
  'TRACKING_NOT_ALLOWED',
  'OUTSTANDING_BACKORDER',
] as const;

export type OrderErrorCode = (typeof ORDER_ERROR_CODES)[number];

const messages: Record<OrderErrorCode, string> = {
  ORDER_NOT_FOUND: 'Order not found',
  ORDER_FORBIDDEN: 'Order not found',
  INVALID_ALLOCATION: 'Shipment allocation must exactly match purchased quantities',
  INVALID_TRANSITION: 'Shipment transition is not allowed',
  CANCELLATION_NOT_ALLOWED: 'Order can no longer be cancelled',
  STALE_VERSION: 'Order has changed',
  IDEMPOTENCY_CONFLICT: 'Idempotency key conflicts with a different request',
  TRACKING_NOT_ALLOWED: 'Tracking events require a shipped shipment',
  OUTSTANDING_BACKORDER: 'Order has outstanding backordered items',
};

export class OrderDomainError extends Error {
  constructor(public readonly code: OrderErrorCode) {
    super(messages[code]);
    this.name = 'OrderDomainError';
  }
}
