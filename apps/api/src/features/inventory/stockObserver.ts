/**
 * Outbound port for "stock for this variant may have moved".
 *
 * Inventory owns the fact; interested domains own the reaction. The observer is deliberately
 * fact-only and synchronous-void: it must never make inventory wait on, or care about, a
 * downstream decision, and it carries no availability figure so observers cannot branch on a
 * number inventory has not yet committed.
 */
export interface StockChangeObserver {
  stockChanged(variantId: number, occurredAt: string): void;
}

/** No-op observer for compositions that do not wire a reactive consumer. */
export const noStockObserver: StockChangeObserver = { stockChanged() {} };
