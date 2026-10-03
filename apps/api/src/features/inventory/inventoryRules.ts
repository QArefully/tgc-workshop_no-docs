import {
  InventoryError,
  type InventoryDemand,
  type InventoryProduct,
  type InventoryReservationAllocation,
} from './inventoryTypes.js';

function positiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new InventoryError('INVENTORY_CORRUPTION', `${label} must be a positive integer.`);
  }
}

/** Aggregates duplicate input into stable variant order. */
export function aggregateInventoryDemand(
  demands: readonly InventoryDemand[],
): readonly InventoryDemand[] {
  const totals = new Map<number, InventoryDemand>();
  for (const demand of demands) {
    positiveInteger(demand.variantId, 'Variant ID');
    positiveInteger(demand.quantity, 'Inventory quantity');
    const existing = totals.get(demand.variantId);
    totals.set(
      demand.variantId,
      existing ? { ...existing, quantity: existing.quantity + demand.quantity } : { ...demand },
    );
  }
  return [...totals.values()].sort((left, right) => left.variantId - right.variantId);
}

/** `expires_at === now` is expired. ISO UTC strings preserve chronological ordering. */
export function isPreparedReservationExpired(expiresAt: string, now: string): boolean {
  return expiresAt <= now;
}

/**
 * Non-backorderable variant demand must be covered outright by available stock; backorderable
 * demand reserves what is available and backorders the remainder.
 */
export function splitInventoryReservation(
  demands: readonly InventoryDemand[],
  products: readonly InventoryProduct[],
): readonly InventoryReservationAllocation[] {
  const normalized = aggregateInventoryDemand(demands);
  const productByVariantId = new Map(products.map((product) => [product.variantId, product]));

  return normalized.map((demand) => {
    const product = productByVariantId.get(demand.variantId);
    if (!product) {
      throw new InventoryError(
        'INSUFFICIENT_STOCK',
        `Variant ${demand.variantId} is unavailable.`,
        [demand.variantId],
      );
    }
    if (!Number.isSafeInteger(product.availableToSell) || product.availableToSell < 0) {
      throw new InventoryError(
        'INVENTORY_CORRUPTION',
        `Variant ${demand.variantId} has invalid availability.`,
      );
    }
    if (!product.backorderable) {
      if (demand.quantity > product.availableToSell) {
        throw new InventoryError(
          'INSUFFICIENT_STOCK',
          `Variant ${demand.variantId} has insufficient stock.`,
          [demand.variantId],
        );
      }
      return { ...demand, reservedQuantity: demand.quantity, backorderedQuantity: 0 };
    }
    const reservedQuantity = Math.min(product.availableToSell, demand.quantity);
    return {
      ...demand,
      reservedQuantity,
      backorderedQuantity: demand.quantity - reservedQuantity,
    };
  });
}

export function receiptFingerprint(variantId: number, quantity: number): string {
  positiveInteger(variantId, 'Variant ID');
  positiveInteger(quantity, 'Receipt quantity');
  return JSON.stringify({ variantId, quantity });
}
