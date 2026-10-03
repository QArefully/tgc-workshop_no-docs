export interface InventoryDemand {
  variantId: number;
  quantity: number;
}

export interface InventoryProduct {
  variantId: number;
  stockCount: number;
  availableToSell: number;
  backorderable: boolean;
  backorderLeadDays: number | null;
}

export interface InventoryReservationAllocation extends InventoryDemand {
  reservedQuantity: number;
  backorderedQuantity: number;
}

export interface InventoryOrderLine {
  orderLineItemId: number;
  variantId: number;
  quantity: number;
}

export interface InventoryReceiptAllocation {
  orderId: number;
  orderLineItemId: number;
  quantity: number;
}

export interface InventoryReceiptResult {
  receiptId: number;
  variantId: number;
  receivedQuantity: number;
  allocatedQuantity: number;
  remainingStock: number;
  allocations: readonly InventoryReceiptAllocation[];
}

export interface ReturnRestoreLine {
  variantId: number;
  orderLineItemId: number;
  quantity: number;
}

export type InventoryErrorCode =
  'INSUFFICIENT_STOCK' | 'RESERVATION_EXPIRED' | 'IDEMPOTENCY_KEY_REUSED' | 'INVENTORY_CORRUPTION';

export class InventoryError extends Error {
  constructor(
    public readonly code: InventoryErrorCode,
    message: string,
    public readonly variantIds: readonly number[] = [],
  ) {
    super(message);
    this.name = 'InventoryError';
  }
}
