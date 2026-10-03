import { Type, type Static } from '@sinclair/typebox';
import { PositiveIntegerString, Uuid } from './common.js';

export const InventoryReceiptBody = Type.Object(
  {
    variantId: Type.Integer({ minimum: 1 }),
    quantity: Type.Integer({ minimum: 1, maximum: 1_000_000 }),
    idempotencyKey: Uuid,
  },
  { additionalProperties: false },
);
export type InventoryReceiptBody = Static<typeof InventoryReceiptBody>;

/** @deprecated Use variantId. Accepted for backward compat; replaced by variantId at the API boundary. */
export const InventoryReceiptBodyLegacy = Type.Object(
  {
    productId: PositiveIntegerString,
    quantity: Type.Integer({ minimum: 1, maximum: 1_000_000 }),
    idempotencyKey: Uuid,
  },
  { additionalProperties: false },
);
export type InventoryReceiptBodyLegacy = Static<typeof InventoryReceiptBodyLegacy>;

export const InventoryReceiptAllocation = Type.Object(
  {
    orderId: PositiveIntegerString,
    orderLineItemId: PositiveIntegerString,
    quantity: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);
export type InventoryReceiptAllocation = Static<typeof InventoryReceiptAllocation>;

export const InventoryReceiptResponse = Type.Object(
  {
    receiptId: PositiveIntegerString,
    variantId: Type.Integer({ minimum: 1 }),
    receivedQuantity: Type.Integer({ minimum: 1 }),
    allocatedQuantity: Type.Integer({ minimum: 0 }),
    remainingStock: Type.Integer({ minimum: 0 }),
    allocations: Type.Array(InventoryReceiptAllocation),
  },
  { additionalProperties: false },
);
export type InventoryReceiptResponse = Static<typeof InventoryReceiptResponse>;

/** @deprecated Use InventoryReceiptResponse. Accepted for backward compat. */
export const InventoryReceiptResponseLegacy = Type.Object(
  {
    receiptId: PositiveIntegerString,
    productId: PositiveIntegerString,
    receivedQuantity: Type.Integer({ minimum: 1 }),
    allocatedQuantity: Type.Integer({ minimum: 0 }),
    remainingStock: Type.Integer({ minimum: 0 }),
    allocations: Type.Array(InventoryReceiptAllocation),
  },
  { additionalProperties: false },
);
export type InventoryReceiptResponseLegacy = Static<typeof InventoryReceiptResponseLegacy>;

export const InventoryConflictCode = Type.Union([
  Type.Literal('INSUFFICIENT_STOCK'),
  Type.Literal('RESERVATION_EXPIRED'),
  Type.Literal('IDEMPOTENCY_KEY_REUSED'),
]);
export type InventoryConflictCode = Static<typeof InventoryConflictCode>;
