import {
  aggregateInventoryDemand,
  receiptFingerprint,
  splitInventoryReservation,
} from './inventoryRules.js';
import type { InventoryRepository } from './inventoryRepository.js';
import { noStockObserver, type StockChangeObserver } from './stockObserver.js';
import {
  InventoryError,
  type InventoryDemand,
  type InventoryOrderLine,
  type InventoryReceiptAllocation,
  type InventoryReceiptResult,
  type InventoryReservationAllocation,
  type ReturnRestoreLine,
} from './inventoryTypes.js';

export interface InventoryService {
  availableToSell(
    variantIds: readonly number[],
    now: string,
  ): ReturnType<InventoryRepository['availableToSell']>;
  reserveCheckout(input: {
    paymentIdempotencyKey: string;
    demands: readonly InventoryDemand[];
    now: string;
    expiresAt: string;
  }): readonly InventoryReservationAllocation[];
  releaseReservation(paymentIdempotencyKey: string): void;
  expirePrepared(now: string): readonly string[];
  authorizeReservation(paymentIdempotencyKey: string, now: string): void;
  commitReservation(input: {
    paymentIdempotencyKey: string;
    orderId: number;
    ordinaryLines: readonly InventoryOrderLine[];
    occurredAt: string;
  }): void;
  receiveStock(input: {
    idempotencyKey: string;
    variantId: number;
    quantity: number;
    receivedByUserId: number;
    occurredAt: string;
  }): InventoryReceiptResult & { replayed: boolean };
  cancelOrderInventory(input: {
    orderId: number;
    occurredAt: string;
  }): readonly InventoryReceiptAllocation[];
  restoreReturnInventory(input: {
    returnRequestId: number;
    lines: readonly ReturnRestoreLine[];
    occurredAt: string;
  }): readonly InventoryReceiptAllocation[];
}

function requirePositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new InventoryError('INVENTORY_CORRUPTION', `${label} must be a positive integer.`);
  }
}

function allocateFromRows(
  rows: readonly InventoryOrderLine[],
  quantity: number,
): Array<{ line: InventoryOrderLine; quantity: number }> {
  let remaining = quantity;
  const result: Array<{ line: InventoryOrderLine; quantity: number }> = [];
  for (const line of [...rows].sort(
    (left, right) => left.orderLineItemId - right.orderLineItemId,
  )) {
    if (remaining === 0) break;
    const applied = Math.min(line.quantity, remaining);
    result.push({ line, quantity: applied });
    remaining -= applied;
  }
  if (remaining !== 0)
    throw new InventoryError('INVENTORY_CORRUPTION', 'Reservation does not match order lines.');
  return result;
}

/**
 * Domain coordinator. Does not create, commit, or roll back SQLite transactions.
 *
 * `stockObserver` is optional so compositions that wire no reactive consumer keep their exact
 * previous behaviour. Every notification is raised inside the caller transaction and only after
 * backorder fulfilment has consumed what it is entitled to, so a restock is never announced for
 * units an open backorder immediately takes back.
 */
export function createInventoryService(dependencies: {
  repository: InventoryRepository;
  stockObserver?: StockChangeObserver;
}): InventoryService {
  const { repository } = dependencies;
  const stockObserver = dependencies.stockObserver ?? noStockObserver;
  const fulfillBackorders = (
    variantId: number,
    quantity: number,
    occurredAt: string,
    receiptId?: number,
    excludedOrderId?: number,
  ): InventoryReceiptAllocation[] => {
    let remaining = quantity;
    const fulfilled: InventoryReceiptAllocation[] = [];
    for (const allocation of repository.listOpenBackorders(variantId, excludedOrderId)) {
      if (remaining === 0) break;
      const applied = Math.min(remaining, allocation.backordered_quantity);
      if (!repository.decrementStock(variantId, applied)) {
        throw new InventoryError(
          'INVENTORY_CORRUPTION',
          'Stock disappeared while allocating backorders.',
        );
      }
      repository.fulfillBackorder({
        orderLineItemId: allocation.order_line_item_id,
        quantity: applied,
        updatedAt: occurredAt,
      });
      repository.insertMovement({
        variantId,
        movementType: 'backorder_allocated',
        quantityDelta: -applied,
        orderId: allocation.order_id,
        orderLineItemId: allocation.order_line_item_id,
        receiptId,
        occurredAt,
      });
      fulfilled.push({
        orderId: allocation.order_id,
        orderLineItemId: allocation.order_line_item_id,
        quantity: applied,
      });
      remaining -= applied;
    }
    return fulfilled;
  };

  return {
    availableToSell(variantIds, now) {
      return repository.availableToSell(variantIds, now);
    },
    reserveCheckout({ paymentIdempotencyKey, demands, now, expiresAt }) {
      if (expiresAt <= now)
        throw new InventoryError(
          'INVENTORY_CORRUPTION',
          'Reservation expiry must be in the future.',
        );
      const normalized = aggregateInventoryDemand(demands);
      const availability = repository.availableToSell(
        normalized.map((demand) => demand.variantId),
        now,
      );
      const split = splitInventoryReservation(normalized, availability);
      repository.insertReservations({
        paymentIdempotencyKey,
        reservations: split,
        expiresAt,
        createdAt: now,
      });
      return split;
    },
    releaseReservation(paymentIdempotencyKey) {
      repository.releaseReservation(paymentIdempotencyKey);
    },
    expirePrepared(now) {
      return repository.releaseExpired(now);
    },
    authorizeReservation(paymentIdempotencyKey, now) {
      if (!repository.authorizeReservation(paymentIdempotencyKey, now)) {
        throw new InventoryError(
          'RESERVATION_EXPIRED',
          'Checkout inventory reservation has expired.',
        );
      }
    },
    commitReservation({ paymentIdempotencyKey, orderId, ordinaryLines, occurredAt }) {
      const reservations = repository.listReservations(paymentIdempotencyKey);
      if (reservations.length === 0) {
        throw new InventoryError(
          'RESERVATION_EXPIRED',
          'Checkout inventory reservation is absent.',
        );
      }
      if (reservations.some((reservation) => reservation.expires_at !== null)) {
        throw new InventoryError(
          'RESERVATION_EXPIRED',
          'Checkout inventory reservation is not authorized.',
        );
      }
      const linesByVariant = new Map<number, InventoryOrderLine[]>();
      for (const line of ordinaryLines) {
        requirePositiveInteger(line.orderLineItemId, 'Order line ID');
        requirePositiveInteger(line.variantId, 'Variant ID');
        requirePositiveInteger(line.quantity, 'Order line quantity');
        const rows = linesByVariant.get(line.variantId) ?? [];
        rows.push(line);
        linesByVariant.set(line.variantId, rows);
      }
      for (const variantId of linesByVariant.keys()) {
        if (!reservations.some((row) => row.variant_id === variantId)) {
          throw new InventoryError(
            'INVENTORY_CORRUPTION',
            'Order variant has no inventory reservation.',
          );
        }
      }
      for (const reservation of reservations) {
        if (
          reservation.reserved_quantity > 0 &&
          !repository.decrementStock(reservation.variant_id, reservation.reserved_quantity)
        ) {
          throw new InventoryError(
            'INVENTORY_CORRUPTION',
            `Stock changed for variant ${reservation.variant_id}.`,
          );
        }
        if (reservation.reserved_quantity > 0)
          repository.insertMovement({
            variantId: reservation.variant_id,
            movementType: 'checkout_consumed',
            quantityDelta: -reservation.reserved_quantity,
            paymentIdempotencyKey,
            orderId,
            occurredAt,
          });
        const lines = linesByVariant.get(reservation.variant_id) ?? [];
        const total = lines.reduce((sum, line) => sum + line.quantity, 0);
        if (total !== reservation.reserved_quantity + reservation.backordered_quantity) {
          throw new InventoryError(
            'INVENTORY_CORRUPTION',
            'Order line quantities do not match reservation.',
          );
        }
        const reservedByLine = new Map(
          allocateFromRows(lines, reservation.reserved_quantity).map(({ line, quantity }) => [
            line.orderLineItemId,
            quantity,
          ]),
        );
        const backorderedByLine = new Map(
          allocateFromRows(
            lines.map((line) => ({
              ...line,
              quantity: line.quantity - (reservedByLine.get(line.orderLineItemId) ?? 0),
            })),
            reservation.backordered_quantity,
          ).map(({ line, quantity }) => [line.orderLineItemId, quantity]),
        );
        for (const line of [...lines].sort(
          (left, right) => left.orderLineItemId - right.orderLineItemId,
        )) {
          repository.insertAllocation({
            orderLineItemId: line.orderLineItemId,
            variantId: line.variantId,
            allocatedQuantity: reservedByLine.get(line.orderLineItemId) ?? 0,
            backorderedQuantity: backorderedByLine.get(line.orderLineItemId) ?? 0,
            stockDebitedQuantity: reservedByLine.get(line.orderLineItemId) ?? 0,
            createdAt: occurredAt,
          });
        }
      }
      repository.releaseReservation(paymentIdempotencyKey);
    },
    receiveStock({ idempotencyKey, variantId, quantity, receivedByUserId, occurredAt }) {
      requirePositiveInteger(variantId, 'Variant ID');
      requirePositiveInteger(quantity, 'Receipt quantity');
      requirePositiveInteger(receivedByUserId, 'Receiving user ID');
      const fingerprint = receiptFingerprint(variantId, quantity);
      const existing = repository.findReceipt(idempotencyKey);
      if (existing) {
        if (existing.requestFingerprint !== fingerprint) {
          throw new InventoryError(
            'IDEMPOTENCY_KEY_REUSED',
            'Receipt idempotency key has different payload.',
          );
        }
        return { ...(JSON.parse(existing.responseJson) as InventoryReceiptResult), replayed: true };
      }
      const receiptId = repository.insertReceipt({
        idempotencyKey,
        requestFingerprint: fingerprint,
        variantId,
        receivedQuantity: quantity,
        receivedByUserId,
        createdAt: occurredAt,
      });
      if (!repository.incrementStock(variantId, quantity)) {
        throw new InventoryError(
          'INVENTORY_CORRUPTION',
          `Receipt variant ${variantId} is missing.`,
        );
      }
      repository.insertMovement({
        variantId,
        movementType: 'receipt_received',
        quantityDelta: quantity,
        receiptId,
        occurredAt,
      });
      const allocations = fulfillBackorders(variantId, quantity, occurredAt, receiptId);
      const result: InventoryReceiptResult = {
        receiptId,
        variantId,
        receivedQuantity: quantity,
        allocatedQuantity: allocations.reduce(
          (total, allocation) => total + allocation.quantity,
          0,
        ),
        remainingStock:
          repository.stockCount(variantId) ??
          (() => {
            throw new InventoryError('INVENTORY_CORRUPTION', 'Receipt variant disappeared.');
          })(),
        allocations,
      };
      repository.setReceiptResponse(receiptId, JSON.stringify(result));
      stockObserver.stockChanged(variantId, occurredAt);
      return { ...result, replayed: false };
    },
    restoreReturnInventory({ returnRequestId, lines, occurredAt }) {
      const fulfilled: InventoryReceiptAllocation[] = [];
      for (const line of lines) {
        requirePositiveInteger(line.variantId, 'Variant ID');
        requirePositiveInteger(line.orderLineItemId, 'Order line item ID');
        requirePositiveInteger(line.quantity, 'Restore quantity');
        if (!repository.incrementStock(line.variantId, line.quantity)) {
          throw new InventoryError(
            'INVENTORY_CORRUPTION',
            `Variant ${line.variantId} not found for return restoration.`,
          );
        }
        repository.insertMovement({
          variantId: line.variantId,
          movementType: 'return_received',
          quantityDelta: line.quantity,
          orderLineItemId: line.orderLineItemId,
          returnRequestId,
          occurredAt,
        });
        const backorderAllocations = fulfillBackorders(
          line.variantId,
          line.quantity,
          occurredAt,
          undefined,
          undefined,
        );
        fulfilled.push(...backorderAllocations);
        stockObserver.stockChanged(line.variantId, occurredAt);
      }
      return fulfilled;
    },
    cancelOrderInventory({ orderId, occurredAt }) {
      const allocations = repository.listOrderAllocations(orderId);
      const restoredByVariant = new Map<number, number>();
      for (const allocation of allocations) {
        const cancelled = allocation.allocated_quantity + allocation.backordered_quantity;
        if (cancelled === 0) continue;
        repository.cancelAllocation({
          orderLineItemId: allocation.order_line_item_id,
          cancelledQuantity: cancelled,
          updatedAt: occurredAt,
        });
        if (allocation.stock_debited_quantity > 0) {
          const restored =
            (restoredByVariant.get(allocation.variant_id) ?? 0) + allocation.stock_debited_quantity;
          restoredByVariant.set(allocation.variant_id, restored);
          if (
            !repository.incrementStock(allocation.variant_id, allocation.stock_debited_quantity)
          ) {
            throw new InventoryError(
              'INVENTORY_CORRUPTION',
              'Cancelled allocation variant is missing.',
            );
          }
          repository.insertMovement({
            variantId: allocation.variant_id,
            movementType: 'cancellation_restored',
            quantityDelta: allocation.stock_debited_quantity,
            orderId,
            orderLineItemId: allocation.order_line_item_id,
            occurredAt,
          });
        }
      }
      return [...restoredByVariant.entries()]
        .sort(([left], [right]) => left - right)
        .flatMap(([variantId, quantity]) => {
          const reassigned = fulfillBackorders(variantId, quantity, occurredAt, undefined, orderId);
          stockObserver.stockChanged(variantId, occurredAt);
          return reassigned;
        });
    },
  };
}
