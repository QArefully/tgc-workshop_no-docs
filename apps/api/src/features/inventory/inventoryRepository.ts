import type Database from 'better-sqlite3';
import type { InventoryProduct } from './inventoryTypes.js';

interface ReservationRow {
  payment_idempotency_key: string;
  variant_id: number;
  reserved_quantity: number;
  backordered_quantity: number;
  expires_at: string | null;
}

interface AllocationRow {
  order_line_item_id: number;
  order_id: number;
  variant_id: number;
  allocated_quantity: number;
  backordered_quantity: number;
  cancelled_quantity: number;
  stock_debited_quantity: number;
  created_at: string;
}

export interface InventoryRepository {
  availableToSell(variantIds: readonly number[], now: string): readonly InventoryProduct[];
  insertReservations(input: {
    paymentIdempotencyKey: string;
    reservations: readonly {
      variantId: number;
      reservedQuantity: number;
      backorderedQuantity: number;
    }[];
    expiresAt: string;
    createdAt: string;
  }): void;
  listReservations(paymentIdempotencyKey: string): readonly ReservationRow[];
  releaseReservation(paymentIdempotencyKey: string): void;
  authorizeReservation(paymentIdempotencyKey: string, now: string): boolean;
  listExpiredPaymentKeys(now: string): readonly string[];
  releaseExpired(now: string): readonly string[];
  decrementStock(variantId: number, quantity: number): boolean;
  incrementStock(variantId: number, quantity: number): boolean;
  stockCount(variantId: number): number | undefined;
  insertAllocation(input: {
    orderLineItemId: number;
    variantId: number;
    allocatedQuantity: number;
    backorderedQuantity: number;
    stockDebitedQuantity: number;
    createdAt: string;
  }): void;
  insertMovement(input: {
    variantId: number;
    movementType:
      | 'checkout_consumed'
      | 'receipt_received'
      | 'backorder_allocated'
      | 'cancellation_restored'
      | 'return_received';
    quantityDelta: number;
    paymentIdempotencyKey?: string;
    orderId?: number;
    orderLineItemId?: number;
    receiptId?: number;
    returnRequestId?: number;
    occurredAt: string;
  }): void;
  findReceipt(
    key: string,
  ): { id: number; requestFingerprint: string; responseJson: string } | undefined;
  insertReceipt(input: {
    idempotencyKey: string;
    requestFingerprint: string;
    variantId: number;
    receivedQuantity: number;
    receivedByUserId: number;
    createdAt: string;
  }): number;
  setReceiptResponse(receiptId: number, responseJson: string): void;
  listOpenBackorders(variantId: number, excludedOrderId?: number): readonly AllocationRow[];
  fulfillBackorder(input: { orderLineItemId: number; quantity: number; updatedAt: string }): void;
  listOrderAllocations(orderId: number): readonly AllocationRow[];
  cancelAllocation(input: {
    orderLineItemId: number;
    cancelledQuantity: number;
    updatedAt: string;
  }): void;
}

/** SQLite persistence only. Every caller owns its enclosing transaction. */
export function createInventoryRepository(db: Database.Database): InventoryRepository {
  return {
    availableToSell(variantIds, now) {
      const ids = [...new Set(variantIds)].sort((left, right) => left - right);
      if (ids.length === 0) return [];
      const placeholders = ids.map(() => '?').join(', ');
      return db
        .prepare(
          `SELECT v.id AS variant_id, v.stock_count,
          MAX(0, v.stock_count - COALESCE(SUM(CASE WHEN r.expires_at IS NULL OR r.expires_at > ? THEN r.reserved_quantity ELSE 0 END), 0)) AS available_to_sell,
          v.backorderable, v.backorder_lead_days
         FROM product_variants v
         LEFT JOIN inventory_reservations r ON r.variant_id = v.id
         WHERE v.id IN (${placeholders})
         GROUP BY v.id
         ORDER BY v.id ASC`,
        )
        .all(now, ...ids)
        .map((row) => {
          const value = row as {
            variant_id: number;
            stock_count: number;
            available_to_sell: number;
            backorderable: number;
            backorder_lead_days: number | null;
          };
          return {
            variantId: value.variant_id,
            stockCount: value.stock_count,
            availableToSell: value.available_to_sell,
            backorderable: value.backorderable === 1,
            backorderLeadDays: value.backorder_lead_days,
          };
        });
    },
    insertReservations({ paymentIdempotencyKey, reservations, expiresAt, createdAt }) {
      const insert = db.prepare(
        `INSERT INTO inventory_reservations
          (payment_idempotency_key, variant_id, reserved_quantity, backordered_quantity, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const reservation of reservations) {
        if (reservation.reservedQuantity === 0 && reservation.backorderedQuantity === 0) continue;
        insert.run(
          paymentIdempotencyKey,
          reservation.variantId,
          reservation.reservedQuantity,
          reservation.backorderedQuantity,
          expiresAt,
          createdAt,
        );
      }
    },
    listReservations(paymentIdempotencyKey) {
      return db
        .prepare(
          `SELECT payment_idempotency_key, variant_id, reserved_quantity, backordered_quantity, expires_at
         FROM inventory_reservations WHERE payment_idempotency_key = ?
         ORDER BY variant_id ASC`,
        )
        .all(paymentIdempotencyKey) as ReservationRow[];
    },
    releaseReservation(paymentIdempotencyKey) {
      db.prepare('DELETE FROM inventory_reservations WHERE payment_idempotency_key = ?').run(
        paymentIdempotencyKey,
      );
    },
    authorizeReservation(paymentIdempotencyKey, now) {
      return (
        db
          .prepare(
            `UPDATE inventory_reservations SET expires_at = NULL
         WHERE payment_idempotency_key = ? AND expires_at IS NOT NULL AND expires_at > ?`,
          )
          .run(paymentIdempotencyKey, now).changes > 0
      );
    },
    listExpiredPaymentKeys(now) {
      return (
        db
          .prepare(
            `SELECT DISTINCT payment_idempotency_key FROM inventory_reservations
         WHERE expires_at IS NOT NULL AND expires_at <= ? ORDER BY payment_idempotency_key ASC`,
          )
          .all(now) as Array<{ payment_idempotency_key: string }>
      ).map((row) => row.payment_idempotency_key);
    },
    releaseExpired(now) {
      const keys = this.listExpiredPaymentKeys(now);
      if (keys.length > 0) {
        const placeholders = keys.map(() => '?').join(', ');
        db.prepare(
          `DELETE FROM inventory_reservations WHERE payment_idempotency_key IN (${placeholders})`,
        ).run(...keys);
      }
      return keys;
    },
    decrementStock(variantId, quantity) {
      return (
        db
          .prepare(
            'UPDATE product_variants SET stock_count = stock_count - ? WHERE id = ? AND stock_count >= ?',
          )
          .run(quantity, variantId, quantity).changes === 1
      );
    },
    incrementStock(variantId, quantity) {
      return (
        db
          .prepare('UPDATE product_variants SET stock_count = stock_count + ? WHERE id = ?')
          .run(quantity, variantId).changes === 1
      );
    },
    stockCount(variantId) {
      const row = db
        .prepare('SELECT stock_count FROM product_variants WHERE id = ?')
        .get(variantId) as { stock_count: number } | undefined;
      return row?.stock_count;
    },
    insertAllocation({
      orderLineItemId,
      variantId,
      allocatedQuantity,
      backorderedQuantity,
      stockDebitedQuantity,
      createdAt,
    }) {
      db.prepare(
        `INSERT INTO order_inventory_allocations
          (order_line_item_id, variant_id, allocated_quantity, backordered_quantity, cancelled_quantity,
           stock_debited_quantity, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?, ?)`,
      ).run(
        orderLineItemId,
        variantId,
        allocatedQuantity,
        backorderedQuantity,
        stockDebitedQuantity,
        createdAt,
        createdAt,
      );
    },
    insertMovement({
      variantId,
      movementType,
      quantityDelta,
      paymentIdempotencyKey,
      orderId,
      orderLineItemId,
      receiptId,
      returnRequestId,
      occurredAt,
    }) {
      db.prepare(
        `INSERT INTO inventory_stock_movements
          (variant_id, movement_type, quantity_delta, payment_idempotency_key, order_id, order_line_item_id, receipt_id, return_request_id, occurred_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        variantId,
        movementType,
        quantityDelta,
        paymentIdempotencyKey ?? null,
        orderId ?? null,
        orderLineItemId ?? null,
        receiptId ?? null,
        returnRequestId ?? null,
        occurredAt,
      );
    },
    findReceipt(key) {
      const row = db
        .prepare(
          'SELECT id, request_fingerprint, response_json FROM inventory_receipts WHERE idempotency_key = ?',
        )
        .get(key) as { id: number; request_fingerprint: string; response_json: string } | undefined;
      return (
        row && {
          id: row.id,
          requestFingerprint: row.request_fingerprint,
          responseJson: row.response_json,
        }
      );
    },
    insertReceipt({
      idempotencyKey,
      requestFingerprint,
      variantId,
      receivedQuantity,
      receivedByUserId,
      createdAt,
    }) {
      const productIdRow = db
        .prepare('SELECT product_id FROM product_variants WHERE id = ?')
        .get(variantId) as { product_id: number } | undefined;
      const productId = productIdRow?.product_id ?? variantId;
      return Number(
        db
          .prepare(
            `INSERT INTO inventory_receipts
          (idempotency_key, request_fingerprint, variant_id, product_id, received_quantity, response_json, received_by_user_id, created_at)
         VALUES (?, ?, ?, ?, ?, '{}', ?, ?)`,
          )
          .run(
            idempotencyKey,
            requestFingerprint,
            variantId,
            productId,
            receivedQuantity,
            receivedByUserId,
            createdAt,
          ).lastInsertRowid,
      );
    },
    setReceiptResponse(receiptId, responseJson) {
      db.prepare('UPDATE inventory_receipts SET response_json = ? WHERE id = ?').run(
        responseJson,
        receiptId,
      );
    },
    listOpenBackorders(variantId, excludedOrderId) {
      const rows = db
        .prepare(
          `SELECT a.order_line_item_id, line.order_id, a.variant_id, a.allocated_quantity, a.backordered_quantity,
                a.cancelled_quantity, a.stock_debited_quantity, a.created_at
         FROM order_inventory_allocations a
         JOIN order_line_items line ON line.id = a.order_line_item_id
         WHERE a.variant_id = ? AND a.backordered_quantity > 0
           AND (? IS NULL OR line.order_id <> ?)
         ORDER BY a.created_at ASC, a.order_line_item_id ASC`,
        )
        .all(variantId, excludedOrderId ?? null, excludedOrderId ?? null) as AllocationRow[];
      return rows;
    },
    fulfillBackorder({ orderLineItemId, quantity, updatedAt }) {
      const changed = db
        .prepare(
          `UPDATE order_inventory_allocations
         SET allocated_quantity = allocated_quantity + ?, backordered_quantity = backordered_quantity - ?,
             stock_debited_quantity = stock_debited_quantity + ?, updated_at = ?
         WHERE order_line_item_id = ? AND backordered_quantity >= ?`,
        )
        .run(quantity, quantity, quantity, updatedAt, orderLineItemId, quantity).changes;
      if (changed !== 1) throw new Error('Inventory backorder allocation changed concurrently.');
    },
    listOrderAllocations(orderId) {
      return db
        .prepare(
          `SELECT a.order_line_item_id, line.order_id, a.variant_id, a.allocated_quantity, a.backordered_quantity,
                a.cancelled_quantity, a.stock_debited_quantity, a.created_at
         FROM order_inventory_allocations a JOIN order_line_items line ON line.id = a.order_line_item_id
         WHERE line.order_id = ? ORDER BY a.variant_id ASC, a.order_line_item_id ASC`,
        )
        .all(orderId) as AllocationRow[];
    },
    cancelAllocation({ orderLineItemId, cancelledQuantity, updatedAt }) {
      const changed = db
        .prepare(
          `UPDATE order_inventory_allocations
         SET allocated_quantity = 0, backordered_quantity = 0, cancelled_quantity = cancelled_quantity + ?, updated_at = ?
         WHERE order_line_item_id = ?`,
        )
        .run(cancelledQuantity, updatedAt, orderLineItemId).changes;
      if (changed !== 1) throw new Error('Inventory allocation disappeared during cancellation.');
    },
  };
}
