import type Database from 'better-sqlite3';
import type { RefundSummary, ReturnEligibilityLine, ReturnRequest } from '@shop/contracts/returns';
import { ReturnDomainError } from './returnErrors.js';
import { ReturnErrorCode } from './returnTypes.js';
import { returnWindowClosesAt } from './returnRules.js';

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

interface ReturnRequestRow {
  id: number;
  order_id: number;
  user_id: number;
  status: string;
  reason: string;
  note: string | null;
  version: number;
  requested_at: string;
  approved_at: string | null;
  rejected_at: string | null;
  received_at: string | null;
  refunded_at: string | null;
}

interface ReturnItemRow {
  id: number;
  return_request_id: number;
  shipment_id: number;
  order_line_item_id: number;
  quantity: number;
  product_name: string;
  delivered_at: string;
  window_closes_at: string;
}

interface RefundRow {
  id: number;
  return_request_id: number;
  payment_id: number;
  idempotency_key: string;
  gross_subtotal_cents: number;
  discount_share_cents: number;
  net_refund_cents: number;
  processor: string;
  simulated_reference: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function mapRefundSummary(refund: RefundRow): RefundSummary {
  return {
    grossSubtotalCents: refund.gross_subtotal_cents,
    discountShareCents: refund.discount_share_cents,
    amountCents: refund.net_refund_cents,
    simulatedReference: refund.simulated_reference,
    refundedAt: refund.created_at,
  };
}

function mapReturnRequest(
  request: ReturnRequestRow,
  items: ReturnItemRow[],
  refund: RefundRow | null,
): ReturnRequest {
  return {
    id: String(request.id),
    orderId: String(request.order_id),
    status: request.status as ReturnRequest['status'],
    version: request.version,
    reason: request.reason as ReturnRequest['reason'],
    note: request.note,
    items: items
      .sort((a, b) => a.shipment_id - b.shipment_id || a.order_line_item_id - b.order_line_item_id)
      .map((item) => ({
        shipmentId: String(item.shipment_id),
        orderLineItemId: String(item.order_line_item_id),
        productName: item.product_name,
        quantity: item.quantity,
        deliveredAt: item.delivered_at,
        windowClosesAt: item.window_closes_at,
      })),
    refund: refund ? mapRefundSummary(refund) : null,
    requestedAt: request.requested_at,
    approvedAt: request.approved_at,
    rejectedAt: request.rejected_at,
    receivedAt: request.received_at,
  };
}

// ---------------------------------------------------------------------------
// Repository interface
// ---------------------------------------------------------------------------

export interface ReturnRepository {
  /** Ownership-gated eligibility + existing requests for a given order. */
  getOwnedOverview(
    orderId: number,
    userId: number,
    now: string,
  ):
    | { eligibleLines: ReturnEligibilityLine[]; windowDays: 30; requests: ReturnRequest[] }
    | undefined;

  /** Insert request + items + event in one call. Caller owns the transaction. */
  insertRequest(params: {
    orderId: number;
    userId: number;
    reason: string;
    note: string | null;
    selections: Array<{
      shipmentId: number;
      orderLineItemId: number;
      quantity: number;
      productName: string;
      deliveredAt: string;
      windowClosesAt: string;
    }>;
    idempotencyKey: string;
    requestFingerprint: string;
    occurredAt: string;
  }): number;

  /** Find a return by ID, optionally scoped to an owner. */
  findById(returnId: number): ReturnRequest | undefined;
  findOwnedById(returnId: number, userId: number): ReturnRequest | undefined;

  /** State mutation with expected version + status predicate. Returns true on success. */
  updateState(params: {
    returnId: number;
    expectedVersion: number;
    expectedStatus: string;
    nextStatus: string;
    statusTimestampField: string;
    occurredAt: string;
  }): boolean;

  /** Admin paginated list, newest first. */
  listReturns(params: { status?: string; page: number; pageSize: number }): {
    items: ReturnRequest[];
    total: number;
  };

  /** Idempotency: look up a return event by key. */
  findReturnEventByKey(idempotencyKey: string):
    | {
        returnRequestId: number;
        requestFingerprint: string;
      }
    | undefined;

  /** Resolve the succeeded payment for an order. */
  resolveSucceededPayment(orderId: number):
    | {
        id: number;
        amountCents: number;
      }
    | undefined;

  /**
   * Check the persisted order and all of its linked payments before entering the card return flow.
   * `undefined` means the order does not exist; `false` means its payment facts are not safe.
   */
  hasAuthoritativeCardSettlement(orderId: number): boolean | undefined;

  /** All prior refund amounts against one captured payment, across both refund workflows. */
  getPaymentRefundedCents(paymentId: number): number;

  /** Cumulative prior refund quantity and cents per return item line for a given order. */
  getPriorRefundedTotals(orderId: number): Array<{
    return_request_item_id: number;
    order_line_item_id: number;
    prior_refunded_quantity: number;
  }>;

  /** Insert a return event for admin state transitions. */
  insertReturnEvent(params: {
    returnRequestId: number;
    orderId: number;
    eventType: string;
    actorUserId: number;
    idempotencyKey: string;
    requestFingerprint: string;
    occurredAt: string;
  }): void;

  /** Get raw return item rows (with DB ids) for refund ID mapping. */
  getReturnItemRows(returnId: number): Array<{
    id: number;
    shipment_id: number;
    order_line_item_id: number;
    quantity: number;
  }>;

  /** Insert immutable refund + refund items. Caller owns transaction. */
  insertRefund(params: {
    returnRequestId: number;
    paymentId: number;
    idempotencyKey: string;
    grossSubtotalCents: number;
    discountShareCents: number;
    netRefundCents: number;
    simulatedReference: string;
    processor: string;
    items: Array<{
      returnRequestItemId: number;
      quantity: number;
      grossSubtotalCents: number;
      discountShareCents: number;
      netRefundCents: number;
    }>;
    occurredAt: string;
  }): void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createReturnRepository(db: Database.Database): ReturnRepository {
  // ── eligibility rows ──────────────────────────────────────────────

  /**
   * Delivered lines a customer may return. Made-to-order Custom Blend lines are excluded at the
   * SQL boundary, so a blend can never be selected, reserved, received, or refunded.
   */
  const loadEligibleLines = (
    orderId: number,
  ): { lines: ReturnEligibilityLine[]; corruption: string[] } => {
    const rows = db
      .prepare(
        `SELECT
           s.id                AS shipment_id,
           s.shipment_number,
           li.id              AS order_line_item_id,
           li.product_name,
           osi.quantity       AS delivered_quantity,
           de.occurred_at     AS delivered_at,
           de.event_count     AS delivery_event_count
         FROM order_shipments s
         JOIN order_shipment_items osi
           ON osi.shipment_id = s.id AND osi.order_line_item_id IS NOT NULL
         JOIN order_line_items li
           ON li.id = osi.order_line_item_id
         JOIN (
           SELECT shipment_id,
                  occurred_at,
                  COUNT(*) AS event_count
           FROM order_lifecycle_events
           WHERE event_type = 'shipment_delivered'
           GROUP BY shipment_id
         ) de ON de.shipment_id = s.id
         WHERE s.order_id = ? AND s.status = 'delivered'
           AND li.custom_blend_json IS NULL
         ORDER BY s.id ASC, li.id ASC`,
      )
      .all(orderId) as Array<{
      shipment_id: number;
      shipment_number: number;
      order_line_item_id: number;
      product_name: string;
      delivered_quantity: number;
      delivered_at: string;
      delivery_event_count: number;
    }>;

    // Corruption check: exactly one delivery event per shipment
    const corruption: string[] = [];
    const seen = new Set<number>();
    for (const row of rows) {
      if (seen.has(row.shipment_id)) continue;
      seen.add(row.shipment_id);
      if (row.delivery_event_count !== 1) {
        corruption.push(`shipment ${row.shipment_id}: ${row.delivery_event_count} delivery events`);
      }
    }

    const lines: ReturnEligibilityLine[] = rows.map((row) => ({
      shipmentId: String(row.shipment_id),
      shipmentNumber: row.shipment_number,
      orderLineItemId: String(row.order_line_item_id),
      productName: row.product_name,
      deliveredQuantity: row.delivered_quantity,
      reservedQuantity: 0, // filled in below
      availableQuantity: 0, // filled in below
      deliveredAt: row.delivered_at,
      windowClosesAt: returnWindowClosesAt(new Date(row.delivered_at)).toISOString(),
    }));

    return { lines, corruption };
  };

  // ── active reservations (non-rejected) ────────────────────────────

  const loadActiveReservations = (
    orderId: number,
  ): Array<{
    shipment_id: number;
    order_line_item_id: number;
    reserved_quantity: number;
  }> => {
    return db
      .prepare(
        `SELECT
           rri.shipment_id,
           rri.order_line_item_id,
           SUM(rri.quantity) AS reserved_quantity
         FROM return_request_items rri
         JOIN return_requests rr ON rr.id = rri.return_request_id
         WHERE rr.order_id = ? AND rr.status != 'rejected'
         GROUP BY rri.shipment_id, rri.order_line_item_id`,
      )
      .all(orderId) as Array<{
      shipment_id: number;
      order_line_item_id: number;
      reserved_quantity: number;
    }>;
  };

  // ── existing requests ─────────────────────────────────────────────

  const loadRequests = (orderId: number): ReturnRequest[] => {
    const requests = db
      .prepare(
        `SELECT id, order_id, user_id, status, reason, note, version,
                requested_at, approved_at, rejected_at, received_at, refunded_at
         FROM return_requests
         WHERE order_id = ?
         ORDER BY requested_at DESC, id DESC`,
      )
      .all(orderId) as ReturnRequestRow[];

    if (requests.length === 0) return [];

    const ids = requests.map((r) => r.id);
    const placeholders = ids.map(() => '?').join(',');
    const items = db
      .prepare(
        `SELECT id, return_request_id, shipment_id, order_line_item_id,
                quantity, product_name, delivered_at, window_closes_at
         FROM return_request_items
         WHERE return_request_id IN (${placeholders})
         ORDER BY return_request_id, shipment_id ASC, order_line_item_id ASC`,
      )
      .all(...ids) as ReturnItemRow[];

    const refunds = db
      .prepare(
        `SELECT id, return_request_id, payment_id, idempotency_key,
                gross_subtotal_cents, discount_share_cents, net_refund_cents,
                processor, simulated_reference, created_at
         FROM refunds
         WHERE return_request_id IN (${placeholders})`,
      )
      .all(...ids) as RefundRow[];

    const itemsByRequest = new Map<number, ReturnItemRow[]>();
    for (const item of items) {
      const group = itemsByRequest.get(item.return_request_id);
      if (group) group.push(item);
      else itemsByRequest.set(item.return_request_id, [item]);
    }

    const refundByRequest = new Map<number, RefundRow>();
    for (const refund of refunds) {
      refundByRequest.set(refund.return_request_id, refund);
    }

    return requests.map((r) =>
      mapReturnRequest(r, itemsByRequest.get(r.id) ?? [], refundByRequest.get(r.id) ?? null),
    );
  };

  // ── find by id ────────────────────────────────────────────────────

  const loadRequestById = (returnId: number): ReturnRequestRow | undefined => {
    return db
      .prepare(
        `SELECT id, order_id, user_id, status, reason, note, version,
                requested_at, approved_at, rejected_at, received_at, refunded_at
         FROM return_requests WHERE id = ?`,
      )
      .get(returnId) as ReturnRequestRow | undefined;
  };

  const loadItems = (returnId: number): ReturnItemRow[] => {
    return db
      .prepare(
        `SELECT id, return_request_id, shipment_id, order_line_item_id,
                quantity, product_name, delivered_at, window_closes_at
         FROM return_request_items
         WHERE return_request_id = ?
         ORDER BY shipment_id ASC, order_line_item_id ASC`,
      )
      .all(returnId) as ReturnItemRow[];
  };

  const loadRefund = (returnId: number): RefundRow | null => {
    return (
      (db
        .prepare(
          `SELECT id, return_request_id, payment_id, idempotency_key,
                  gross_subtotal_cents, discount_share_cents, net_refund_cents,
                  processor, simulated_reference, created_at
           FROM refunds WHERE return_request_id = ?`,
        )
        .get(returnId) as RefundRow | undefined) ?? null
    );
  };

  const findById = (returnId: number): ReturnRequest | undefined => {
    const request = loadRequestById(returnId);
    if (!request) return undefined;
    return mapReturnRequest(request, loadItems(returnId), loadRefund(returnId));
  };

  /**
   * Card returns require an existing card order and a complete card-only payment set. Checking all
   * linked rows matters because selecting only one succeeded card payment would otherwise let a
   * mismatched or malformed payment row hide beside it.
   */
  const loadAuthoritativeCardSettlement = (
    orderId: number,
  ): { orderPaymentMethod: unknown; paymentMethods: unknown[] } | undefined => {
    const order = db.prepare('SELECT payment_method FROM orders WHERE id = ?').get(orderId) as
      { payment_method: unknown } | undefined;
    if (!order) return undefined;

    const payments = db
      .prepare('SELECT payment_method FROM payments WHERE order_id = ? ORDER BY id ASC')
      .all(orderId) as Array<{ payment_method: unknown }>;

    return {
      orderPaymentMethod: order.payment_method,
      paymentMethods: payments.map((payment) => payment.payment_method),
    };
  };

  const hasAuthoritativeCardSettlement = (orderId: number): boolean | undefined => {
    const settlement = loadAuthoritativeCardSettlement(orderId);
    if (!settlement) return undefined;
    return (
      settlement.orderPaymentMethod === 'card' &&
      settlement.paymentMethods.length > 0 &&
      settlement.paymentMethods.every((method) => method === 'card')
    );
  };

  const requireAuthoritativeCardSettlement = (orderId: number): void => {
    const eligible = hasAuthoritativeCardSettlement(orderId);
    if (eligible === undefined) {
      throw new ReturnDomainError(ReturnErrorCode.RETURN_DATA_CORRUPT);
    }
    if (!eligible) {
      throw new ReturnDomainError(ReturnErrorCode.PAYMENT_NOT_REFUNDABLE);
    }
  };

  // ── public API ────────────────────────────────────────────────────

  return {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    getOwnedOverview(orderId, userId, _now) {
      const order = db
        .prepare(
          `SELECT payment_method
           FROM orders
           WHERE id = ? AND user_id = ?`,
        )
        .get(orderId, userId) as { payment_method: unknown } | undefined;
      if (!order) return undefined;
      if (hasAuthoritativeCardSettlement(orderId) !== true) {
        throw new ReturnDomainError(ReturnErrorCode.PAYMENT_NOT_REFUNDABLE);
      }

      const { lines, corruption } = loadEligibleLines(orderId);

      // Fail closed on duplicate delivery events
      if (corruption.length > 0) {
        throw new ReturnDomainError(
          ReturnErrorCode.RETURN_DATA_CORRUPT,
          `Corrupt delivery data: ${corruption.join('; ')}`,
        );
      }

      // Apply active reservations
      const reservations = loadActiveReservations(orderId);
      const reservationMap = new Map<string, number>();
      for (const res of reservations) {
        const key = `${res.shipment_id}:${res.order_line_item_id}`;
        reservationMap.set(key, (reservationMap.get(key) ?? 0) + res.reserved_quantity);
      }

      for (const line of lines) {
        const key = `${line.shipmentId}:${line.orderLineItemId}`;
        line.reservedQuantity = reservationMap.get(key) ?? 0;
        line.availableQuantity = line.deliveredQuantity - line.reservedQuantity;
      }

      return {
        eligibleLines: lines,
        windowDays: 30 as const,
        requests: loadRequests(orderId),
      };
    },

    insertRequest({
      orderId,
      userId,
      reason,
      note,
      selections,
      idempotencyKey,
      requestFingerprint,
      occurredAt,
    }) {
      requireAuthoritativeCardSettlement(orderId);
      const result = db
        .prepare(
          `INSERT INTO return_requests
           (order_id, user_id, status, reason, note, version, requested_at)
           VALUES (?, ?, 'requested', ?, ?, 0, ?)`,
        )
        .run(orderId, userId, reason, note, occurredAt);
      const returnRequestId = Number(result.lastInsertRowid);

      const insertItem = db.prepare(
        `INSERT INTO return_request_items
         (return_request_id, shipment_id, order_line_item_id, quantity,
          product_name, delivered_at, window_closes_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const sel of selections) {
        insertItem.run(
          returnRequestId,
          sel.shipmentId,
          sel.orderLineItemId,
          sel.quantity,
          sel.productName,
          sel.deliveredAt,
          sel.windowClosesAt,
        );
      }

      db.prepare(
        `INSERT INTO return_events
         (return_request_id, order_id, event_type, actor_user_id,
          idempotency_key, request_fingerprint, occurred_at)
         VALUES (?, ?, 'return.requested', ?, ?, ?, ?)`,
      ).run(returnRequestId, orderId, userId, idempotencyKey, requestFingerprint, occurredAt);

      return returnRequestId;
    },

    findById: (returnId) => findById(returnId),

    findOwnedById(returnId, userId) {
      const request = db
        .prepare('SELECT 1 FROM return_requests WHERE id = ? AND user_id = ?')
        .get(returnId, userId);
      if (!request) return undefined;
      return findById(returnId);
    },

    updateState({
      returnId,
      expectedVersion,
      expectedStatus,
      nextStatus,
      statusTimestampField,
      occurredAt,
    }) {
      const request = db
        .prepare('SELECT order_id FROM return_requests WHERE id = ?')
        .get(returnId) as { order_id: number } | undefined;
      if (request) requireAuthoritativeCardSettlement(request.order_id);
      return (
        db
          .prepare(
            `UPDATE return_requests
             SET status = ?, version = version + 1, ${statusTimestampField} = ?
             WHERE id = ? AND version = ? AND status = ?`,
          )
          .run(nextStatus, occurredAt, returnId, expectedVersion, expectedStatus).changes === 1
      );
    },

    listReturns({ status, page, pageSize }) {
      const offset = (page - 1) * pageSize;
      const where = status ? 'WHERE status = ?' : '';
      const params: unknown[] = status ? [status] : [];

      const count = db
        .prepare(`SELECT COUNT(*) AS count FROM return_requests ${where}`)
        .get(...params) as { count: number };

      const rows = db
        .prepare(
          `SELECT id, order_id, user_id, status, reason, note, version,
                  requested_at, approved_at, rejected_at, received_at, refunded_at
           FROM return_requests ${where}
           ORDER BY requested_at DESC, id DESC
           LIMIT ? OFFSET ?`,
        )
        .all(...params, pageSize, offset) as ReturnRequestRow[];

      const items = rows.map((r) => mapReturnRequest(r, loadItems(r.id), loadRefund(r.id)));

      return { items, total: count.count };
    },

    findReturnEventByKey(idempotencyKey) {
      const row = db
        .prepare(
          `SELECT return_request_id, request_fingerprint
           FROM return_events WHERE idempotency_key = ?`,
        )
        .get(idempotencyKey) as
        { return_request_id: number; request_fingerprint: string } | undefined;
      return row
        ? { returnRequestId: row.return_request_id, requestFingerprint: row.request_fingerprint }
        : undefined;
    },

    hasAuthoritativeCardSettlement,

    resolveSucceededPayment(orderId) {
      if (hasAuthoritativeCardSettlement(orderId) !== true) return undefined;
      const row = db
        .prepare(
          `SELECT id, amount_cents
           FROM payments
           WHERE order_id = ? AND status = 'succeeded' AND payment_method = 'card'
           ORDER BY id ASC LIMIT 1`,
        )
        .get(orderId) as { id: number; amount_cents: number } | undefined;
      return row ? { id: row.id, amountCents: row.amount_cents } : undefined;
    },

    getPaymentRefundedCents(paymentId) {
      const payment = db
        .prepare('SELECT order_id, payment_method FROM payments WHERE id = ?')
        .get(paymentId) as { order_id: number | null; payment_method: unknown } | undefined;
      if (
        !payment ||
        payment.order_id === null ||
        payment.payment_method !== 'card' ||
        hasAuthoritativeCardSettlement(payment.order_id) !== true
      ) {
        return 0;
      }
      const row = db
        .prepare(
          `SELECT
             COALESCE((SELECT SUM(net_refund_cents) FROM refunds WHERE payment_id = p.id), 0) +
             COALESCE((SELECT SUM(amount_cents) FROM admin_refunds WHERE payment_id = p.id), 0)
             AS amount
           FROM payments p
           WHERE p.id = ? AND p.payment_method = 'card'`,
        )
        .get(paymentId) as { amount: number } | undefined;
      return row?.amount ?? 0;
    },

    getPriorRefundedTotals(orderId) {
      return db
        .prepare(
          `SELECT
             rri.id AS return_request_item_id,
             rri.order_line_item_id,
             COALESCE(SUM(ri.quantity), 0) AS prior_refunded_quantity
           FROM return_request_items rri
           JOIN return_requests rr ON rr.id = rri.return_request_id
           LEFT JOIN refund_items ri ON ri.return_request_item_id = rri.id
           WHERE rr.order_id = ? AND rr.status = 'refunded'
           GROUP BY rri.id, rri.order_line_item_id`,
        )
        .all(orderId) as Array<{
        return_request_item_id: number;
        order_line_item_id: number;
        prior_refunded_quantity: number;
      }>;
    },

    insertReturnEvent({
      returnRequestId,
      orderId,
      eventType,
      actorUserId,
      idempotencyKey,
      requestFingerprint,
      occurredAt,
    }) {
      requireAuthoritativeCardSettlement(orderId);
      db.prepare(
        `INSERT INTO return_events
         (return_request_id, order_id, event_type, actor_user_id,
          idempotency_key, request_fingerprint, occurred_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        returnRequestId,
        orderId,
        eventType,
        actorUserId,
        idempotencyKey,
        requestFingerprint,
        occurredAt,
      );
    },

    getReturnItemRows(returnId) {
      return db
        .prepare(
          `SELECT id, shipment_id, order_line_item_id, quantity
           FROM return_request_items WHERE return_request_id = ?
           ORDER BY shipment_id ASC, order_line_item_id ASC`,
        )
        .all(returnId) as Array<{
        id: number;
        shipment_id: number;
        order_line_item_id: number;
        quantity: number;
      }>;
    },

    insertRefund({
      returnRequestId,
      paymentId,
      idempotencyKey,
      grossSubtotalCents,
      discountShareCents,
      netRefundCents,
      simulatedReference,
      processor,
      items,
      occurredAt,
    }) {
      const payment = db
        .prepare('SELECT order_id, payment_method FROM payments WHERE id = ?')
        .get(paymentId) as { order_id: number | null; payment_method: unknown } | undefined;
      if (
        !payment ||
        payment.order_id === null ||
        payment.payment_method !== 'card' ||
        hasAuthoritativeCardSettlement(payment.order_id) !== true
      ) {
        throw new ReturnDomainError(ReturnErrorCode.PAYMENT_NOT_REFUNDABLE);
      }
      const result = db
        .prepare(
          `INSERT INTO refunds
           (return_request_id, payment_id, idempotency_key,
            gross_subtotal_cents, discount_share_cents, net_refund_cents,
            processor, simulated_reference, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          returnRequestId,
          paymentId,
          idempotencyKey,
          grossSubtotalCents,
          discountShareCents,
          netRefundCents,
          processor,
          simulatedReference,
          occurredAt,
        );
      const refundId = Number(result.lastInsertRowid);

      const insertItem = db.prepare(
        `INSERT INTO refund_items
         (refund_id, return_request_item_id, quantity,
          gross_subtotal_cents, discount_share_cents, net_refund_cents)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const item of items) {
        insertItem.run(
          refundId,
          item.returnRequestItemId,
          item.quantity,
          item.grossSubtotalCents,
          item.discountShareCents,
          item.netRefundCents,
        );
      }
    },
  };
}
