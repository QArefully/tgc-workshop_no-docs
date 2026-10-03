import type { ReturnOverviewResponse, ReturnRequest } from '@shop/contracts/returns';
import type { UnitOfWork } from '../../db/unitOfWork.js';
import type { AuditContext } from '../audit/auditEvent.js';
import type { AuditWriter, Clock } from '../audit/auditService.js';
import { ReturnDomainError } from './returnErrors.js';
import { ReturnErrorCode, ReturnEventType, ReturnRequestStatus } from './returnTypes.js';
import {
  assertReturnTransition,
  assertEligibleSelections,
  returnFingerprint,
  isWithinReturnWindow,
  allocateOrderDiscountByLine,
  calculateCumulativeRefundDelta,
} from './returnRules.js';
import type { ReturnRepository } from './returnRepository.js';
import type { RefundGateway } from './refundGateway.js';
import type { InventoryService } from '../inventory/inventoryService.js';
import type { OrderRepository } from '../orders/orderRepository.js';

// ── Public service interface ───────────────────────────────────────────

export interface ReturnService {
  getOverview(orderId: number, userId: number): ReturnOverviewResponse;
  requestReturn(params: {
    orderId: number;
    userId: number;
    idempotencyKey: string;
    reason: string;
    note: string | null;
    selections: Array<{
      shipmentId: string;
      orderLineItemId: string;
      quantity: number;
    }>;
    context: AuditContext;
  }): ReturnRequest;
  listReturns(params: { status?: string; page: number; pageSize: number }): {
    items: ReturnRequest[];
    total: number;
    page: number;
    pageSize: number;
  };
  decideReturn(params: {
    returnId: number;
    version: number;
    decision: 'approve' | 'reject';
    idempotencyKey: string;
    context: AuditContext;
  }): ReturnRequest;
  receiveReturn(params: {
    returnId: number;
    version: number;
    idempotencyKey: string;
    context: AuditContext;
  }): ReturnRequest;
  refundReturn(params: {
    returnId: number;
    version: number;
    idempotencyKey: string;
    context: AuditContext;
  }): ReturnRequest;
}

// ── Dependencies ────────────────────────────────────────────────────────

interface ReturnServiceDeps {
  returnRepository: ReturnRepository;
  orderRepository: Pick<OrderRepository, 'findOwnedDetail' | 'findDetailById'>;
  unitOfWork: UnitOfWork;
  clock: Clock;
  audit: AuditWriter;
  inventory: Pick<InventoryService, 'restoreReturnInventory'>;
  refundGateway: RefundGateway;
  resolveVariantId: (orderLineItemId: number) => number | undefined;
}

// ── Factory ────────────────────────────────────────────────────────────

export function createReturnService(deps: ReturnServiceDeps): ReturnService {
  const {
    returnRepository,
    orderRepository,
    unitOfWork,
    clock,
    audit,
    inventory,
    refundGateway,
    resolveVariantId,
  } = deps;

  const run = <T>(work: () => T): T => unitOfWork.run(work);

  const append = (input: Parameters<AuditWriter['append']>[0]) => audit.append(input);

  // ── replay or conflict ───────────────────────────────────────────

  const replayOrConflict = (
    idempotencyKey: string,
    fingerprint: string,
  ): ReturnRequest | undefined => {
    const previous = returnRepository.findReturnEventByKey(idempotencyKey);
    if (!previous) return undefined;
    if (previous.requestFingerprint !== fingerprint) {
      throw new ReturnDomainError(ReturnErrorCode.IDEMPOTENCY_CONFLICT);
    }
    const replay = returnRepository.findById(previous.returnRequestId);
    if (!replay) throw new ReturnDomainError(ReturnErrorCode.RETURN_DATA_CORRUPT);
    return replay;
  };

  /** Ownership-gated eligibility. Throws RETURN_NOT_FOUND if order not owned by user. */
  const requireOwnedOverview = (orderId: number, userId: number) => {
    const now = clock.now().toISOString();
    const overview = returnRepository.getOwnedOverview(orderId, userId, now);
    if (!overview) throw new ReturnDomainError(ReturnErrorCode.RETURN_NOT_FOUND);
    return overview;
  };

  // ── helper: assert current return state ───────────────────────────

  const requireReturnWithState = (returnId: number, version: number, expectedStatus: string) => {
    const current = returnRepository.findById(returnId);
    if (!current) throw new ReturnDomainError(ReturnErrorCode.RETURN_NOT_FOUND);
    if (current.version !== version) {
      throw new ReturnDomainError(ReturnErrorCode.STALE_VERSION);
    }
    if (current.status !== expectedStatus) {
      throw new ReturnDomainError(ReturnErrorCode.INVALID_TRANSITION);
    }
    return current;
  };

  /** Returns are a card settlement workflow; reject credit orders before any state or stock write. */
  const requireCardOrder = (orderId: number) => {
    const cardSettlement = returnRepository.hasAuthoritativeCardSettlement(orderId);
    if (cardSettlement === undefined) {
      throw new ReturnDomainError(ReturnErrorCode.RETURN_DATA_CORRUPT);
    }
    if (!cardSettlement) {
      throw new ReturnDomainError(ReturnErrorCode.PAYMENT_NOT_REFUNDABLE);
    }

    const order = orderRepository.findDetailById(orderId);
    if (!order) throw new ReturnDomainError(ReturnErrorCode.RETURN_DATA_CORRUPT);
    return order;
  };

  // ── public API ────────────────────────────────────────────────────

  return {
    getOverview(orderId, userId) {
      const { eligibleLines, requests } = requireOwnedOverview(orderId, userId);
      return { eligibleLines, requests, windowDays: 30 as const };
    },

    requestReturn({ orderId, userId, idempotencyKey, reason, note, selections, context }) {
      const fingerprint = returnFingerprint('request', { orderId, selections, reason, note });
      return run(() => {
        // Re-establish ownership and card settlement eligibility before consulting the global key.
        const overview = requireOwnedOverview(orderId, userId);
        const replay = replayOrConflict(idempotencyKey, fingerprint);
        if (replay) return replay;

        // Ownership + eligibility were rechecked inside the transaction before replay lookup.
        const now = clock.now();

        // Verify window (exclusive close boundary) for every eligible line
        for (const line of overview.eligibleLines) {
          if (!isWithinReturnWindow(new Date(line.deliveredAt), now)) {
            throw new ReturnDomainError(ReturnErrorCode.RETURN_WINDOW_EXPIRED);
          }
        }

        // Validate selections via pure rule
        const deliveredAllocations = overview.eligibleLines.map((line) => ({
          shipmentId: line.shipmentId,
          shipmentStatus: 'delivered',
          orderLineItemId: line.orderLineItemId,
          deliveredQuantity: line.deliveredQuantity,
        }));
        const activeReservations = overview.eligibleLines
          .filter((line) => line.reservedQuantity > 0)
          .map((line) => ({
            shipmentId: line.shipmentId,
            orderLineItemId: line.orderLineItemId,
            reservedQuantity: line.reservedQuantity,
          }));

        assertEligibleSelections(selections, deliveredAllocations, activeReservations);

        // Enrich selections with product name + timestamps from eligibility lines
        const lineMap = new Map<string, (typeof overview.eligibleLines)[number]>();
        for (const line of overview.eligibleLines) {
          lineMap.set(`${line.shipmentId}:${line.orderLineItemId}`, line);
        }

        const enriched = selections.map((sel) => {
          const line = lineMap.get(`${sel.shipmentId}:${sel.orderLineItemId}`);
          if (!line) throw new ReturnDomainError(ReturnErrorCode.RETURN_DATA_CORRUPT);
          return {
            shipmentId: Number(sel.shipmentId),
            orderLineItemId: Number(sel.orderLineItemId),
            quantity: sel.quantity,
            productName: line.productName,
            deliveredAt: line.deliveredAt,
            windowClosesAt: line.windowClosesAt,
          };
        });

        const occurredAt = now.toISOString();
        const returnId = returnRepository.insertRequest({
          orderId,
          userId,
          reason,
          note,
          selections: enriched,
          idempotencyKey,
          requestFingerprint: fingerprint,
          occurredAt,
        });

        append({
          action: 'return.requested',
          context,
          returnId,
          orderId,
        });

        const result = returnRepository.findById(returnId);
        if (!result) throw new ReturnDomainError(ReturnErrorCode.RETURN_DATA_CORRUPT);
        return result;
      });
    },

    listReturns({ status, page, pageSize }) {
      const result = returnRepository.listReturns({ status, page, pageSize });
      return { ...result, page, pageSize };
    },

    decideReturn({ returnId, version, decision, idempotencyKey, context }) {
      const operation = decision === 'approve' ? 'approve' : 'reject';
      const fingerprint = returnFingerprint(operation, { returnId, version });
      return run(() => {
        const existing = returnRepository.findById(returnId);
        if (!existing) throw new ReturnDomainError(ReturnErrorCode.RETURN_NOT_FOUND);
        requireCardOrder(Number(existing.orderId));

        const replay = replayOrConflict(idempotencyKey, fingerprint);
        if (replay) return replay;

        const current = requireReturnWithState(returnId, version, ReturnRequestStatus.REQUESTED);
        requireCardOrder(Number(current.orderId));

        const nextStatus =
          decision === 'approve' ? ReturnRequestStatus.APPROVED : ReturnRequestStatus.REJECTED;
        assertReturnTransition(current.status, nextStatus);

        const occurredAt = clock.now().toISOString();
        const timestampField = nextStatus === 'approved' ? 'approved_at' : 'rejected_at';
        const eventType =
          nextStatus === 'approved' ? ReturnEventType.APPROVED : ReturnEventType.REJECTED;

        if (
          !returnRepository.updateState({
            returnId,
            expectedVersion: version,
            expectedStatus: current.status,
            nextStatus,
            statusTimestampField: timestampField,
            occurredAt,
          })
        ) {
          throw new ReturnDomainError(ReturnErrorCode.STALE_VERSION);
        }

        const actorUserId = context.actor.type === 'user' ? context.actor.userId : 0;
        returnRepository.insertReturnEvent({
          returnRequestId: returnId,
          orderId: Number(current.orderId),
          eventType,
          actorUserId,
          idempotencyKey,
          requestFingerprint: fingerprint,
          occurredAt,
        });

        if (decision === 'approve') {
          append({
            action: 'return.approved',
            context,
            returnId,
            orderId: Number(current.orderId),
          });
        } else {
          append({
            action: 'return.rejected',
            context,
            returnId,
            orderId: Number(current.orderId),
          });
        }

        const result = returnRepository.findById(returnId);
        if (!result) throw new ReturnDomainError(ReturnErrorCode.RETURN_DATA_CORRUPT);
        return result;
      });
    },

    receiveReturn({ returnId, version, idempotencyKey, context }) {
      const fingerprint = returnFingerprint('receive', { returnId, version });
      return run(() => {
        const existing = returnRepository.findById(returnId);
        if (!existing) throw new ReturnDomainError(ReturnErrorCode.RETURN_NOT_FOUND);
        requireCardOrder(Number(existing.orderId));

        const replay = replayOrConflict(idempotencyKey, fingerprint);
        if (replay) return replay;

        const current = requireReturnWithState(returnId, version, ReturnRequestStatus.APPROVED);
        assertReturnTransition(current.status, ReturnRequestStatus.RECEIVED);

        const orderId = Number(current.orderId);
        const orderDetail = requireCardOrder(orderId);
        const occurredAt = clock.now().toISOString();

        if (
          !returnRepository.updateState({
            returnId,
            expectedVersion: version,
            expectedStatus: current.status,
            nextStatus: ReturnRequestStatus.RECEIVED,
            statusTimestampField: 'received_at',
            occurredAt,
          })
        ) {
          throw new ReturnDomainError(ReturnErrorCode.STALE_VERSION);
        }

        // Restore inventory + FIFO backorder allocation
        const restoreLines = current.items.map((item) => {
          const orderItem = orderDetail.items.find(
            (oi) => String(oi.lineId) === item.orderLineItemId,
          );
          if (!orderItem) throw new ReturnDomainError(ReturnErrorCode.RETURN_DATA_CORRUPT);
          const variantId = resolveVariantId(Number(item.orderLineItemId));
          if (variantId == null) throw new ReturnDomainError(ReturnErrorCode.RETURN_DATA_CORRUPT);
          return {
            variantId,
            orderLineItemId: Number(item.orderLineItemId),
            quantity: item.quantity,
          };
        });

        inventory.restoreReturnInventory({
          returnRequestId: returnId,
          lines: restoreLines,
          occurredAt,
        });

        const actorUserId = context.actor.type === 'user' ? context.actor.userId : 0;
        returnRepository.insertReturnEvent({
          returnRequestId: returnId,
          orderId,
          eventType: ReturnEventType.RECEIVED,
          actorUserId,
          idempotencyKey,
          requestFingerprint: fingerprint,
          occurredAt,
        });

        append({
          action: 'return.received',
          context,
          returnId,
          orderId,
        });

        const result = returnRepository.findById(returnId);
        if (!result) throw new ReturnDomainError(ReturnErrorCode.RETURN_DATA_CORRUPT);
        return result;
      });
    },

    refundReturn({ returnId, version, idempotencyKey, context }) {
      const fingerprint = returnFingerprint('refund', { returnId, version });
      return run(() => {
        const existing = returnRepository.findById(returnId);
        if (!existing) throw new ReturnDomainError(ReturnErrorCode.RETURN_NOT_FOUND);
        requireCardOrder(Number(existing.orderId));

        const replay = replayOrConflict(idempotencyKey, fingerprint);
        if (replay) return replay;

        const current = requireReturnWithState(returnId, version, ReturnRequestStatus.RECEIVED);
        assertReturnTransition(current.status, ReturnRequestStatus.REFUNDED);

        const orderId = Number(current.orderId);
        const orderDetail = requireCardOrder(orderId);

        // Resolve payment
        const payment = returnRepository.resolveSucceededPayment(orderId);
        if (!payment) {
          throw new ReturnDomainError(ReturnErrorCode.PAYMENT_NOT_REFUNDABLE);
        }

        // Build discount lines from every purchased order line. The base is the discountable
        // total, not the line total: a blending fee is a service charge that never earned the
        // promotion, so it must not weight a line's share of the whole-order discount.
        const discountLines = orderDetail.items.map((item) => ({
          lineId: item.lineId,
          grossTotalCents: item.discountableTotalCents,
        }));

        // Denominator mirrors the checkout-time promotion base (sum of discountable line totals),
        // which equals the order subtotal whenever no line carries a fee.
        const discountableSubtotalCents = discountLines.reduce(
          (total, line) => total + line.grossTotalCents,
          0,
        );

        // Allocate whole-order discount
        const discountAllocations = allocateOrderDiscountByLine(
          discountableSubtotalCents,
          orderDetail.discountCents,
          discountLines,
        );
        const discountMap = new Map(
          discountAllocations.map((alloc) => [alloc.lineId, alloc.allocatedDiscountCents]),
        );

        // Get prior refunded totals for cumulative computation
        const priorTotals = returnRepository.getPriorRefundedTotals(orderId);
        const priorByLineId = new Map<string, number>();
        for (const pt of priorTotals) {
          priorByLineId.set(
            String(pt.order_line_item_id),
            (priorByLineId.get(String(pt.order_line_item_id)) ?? 0) + pt.prior_refunded_quantity,
          );
        }

        // Resolve DB item IDs
        const dbItems = returnRepository.getReturnItemRows(returnId);
        const dbItemMap = new Map<string, number>();
        for (const dbi of dbItems) {
          dbItemMap.set(`${dbi.shipment_id}:${dbi.order_line_item_id}`, dbi.id);
        }

        // Compute refund items
        let grossSubtotalCents = 0;
        let discountShareCents = 0;
        let netRefundCents = 0;
        const refundItems: Array<{
          returnRequestItemId: number;
          quantity: number;
          grossSubtotalCents: number;
          discountShareCents: number;
          netRefundCents: number;
        }> = [];

        const occurredAt = clock.now().toISOString();

        for (const reqItem of current.items) {
          const orderItem = orderDetail.items.find(
            (oi) => String(oi.lineId) === reqItem.orderLineItemId,
          );
          if (!orderItem) throw new ReturnDomainError(ReturnErrorCode.RETURN_DATA_CORRUPT);

          const lineId = reqItem.orderLineItemId;
          const allocatedDiscount = discountMap.get(lineId) ?? 0;
          const priorQty = priorByLineId.get(lineId) ?? 0;
          const newQty = priorQty + reqItem.quantity;

          // Refundable value excludes any blending fee: the service was performed and is kept.
          const lineGross = orderItem.discountableTotalCents;
          const purchasedQty = orderItem.quantity;

          const { deltaRefundCents } = calculateCumulativeRefundDelta({
            lineGrossTotalCents: lineGross,
            allocatedLineDiscountCents: allocatedDiscount,
            purchasedQuantity: purchasedQty,
            priorCumulativeRefundedQuantity: priorQty,
            newCumulativeRefundedQuantity: newQty,
          });

          if (deltaRefundCents === 0) continue;

          // Proportional gross + discount for this delta relative to line net
          const lineNet = lineGross - allocatedDiscount;
          const share = lineNet > 0 ? deltaRefundCents / lineNet : 0;
          const itemGross = Math.round(lineGross * share);
          const itemDiscount = Math.round(allocatedDiscount * share);
          const itemNet = itemGross - itemDiscount;

          if (itemNet <= 0) continue;

          grossSubtotalCents += itemGross;
          discountShareCents += itemDiscount;
          netRefundCents += itemNet;

          const dbItemId = dbItemMap.get(`${reqItem.shipmentId}:${reqItem.orderLineItemId}`);
          if (!dbItemId) throw new ReturnDomainError(ReturnErrorCode.RETURN_DATA_CORRUPT);

          refundItems.push({
            returnRequestItemId: dbItemId,
            quantity: reqItem.quantity,
            grossSubtotalCents: itemGross,
            discountShareCents: itemDiscount,
            netRefundCents: itemNet,
          });
        }

        // Cap: never exceed merchandise total (exclude delivery charge from refund cap)
        const merchandiseTotal = orderDetail.subtotalCents - orderDetail.discountCents;
        if (netRefundCents > merchandiseTotal) {
          throw new ReturnDomainError(ReturnErrorCode.PAYMENT_NOT_REFUNDABLE);
        }

        // Payment-level cap spans return and standalone admin refunds in this transaction.
        if (
          returnRepository.getPaymentRefundedCents(payment.id) + netRefundCents >
          payment.amountCents
        ) {
          throw new ReturnDomainError(ReturnErrorCode.PAYMENT_NOT_REFUNDABLE);
        }

        // Normalize: adjust gross/discount so gross - discount == net exactly
        if (grossSubtotalCents - discountShareCents !== netRefundCents) {
          const diff = grossSubtotalCents - discountShareCents - netRefundCents;
          discountShareCents += diff;
        }

        // Simulated gateway
        const { simulatedReference, processor } = refundGateway.refund(idempotencyKey);

        returnRepository.insertRefund({
          returnRequestId: returnId,
          paymentId: payment.id,
          idempotencyKey,
          grossSubtotalCents,
          discountShareCents,
          netRefundCents,
          simulatedReference,
          processor,
          items: refundItems,
          occurredAt,
        });

        // Update state to refunded
        if (
          !returnRepository.updateState({
            returnId,
            expectedVersion: version,
            expectedStatus: current.status,
            nextStatus: ReturnRequestStatus.REFUNDED,
            statusTimestampField: 'refunded_at',
            occurredAt,
          })
        ) {
          throw new ReturnDomainError(ReturnErrorCode.STALE_VERSION);
        }

        const actorUserId = context.actor.type === 'user' ? context.actor.userId : 0;
        returnRepository.insertReturnEvent({
          returnRequestId: returnId,
          orderId,
          eventType: ReturnEventType.REFUNDED,
          actorUserId,
          idempotencyKey,
          requestFingerprint: fingerprint,
          occurredAt,
        });

        append({
          action: 'payment.refunded',
          context,
          returnId,
          orderId,
          amountCents: netRefundCents,
        });

        const result = returnRepository.findById(returnId);
        if (!result) throw new ReturnDomainError(ReturnErrorCode.RETURN_DATA_CORRUPT);
        return result;
      });
    },
  };
}
