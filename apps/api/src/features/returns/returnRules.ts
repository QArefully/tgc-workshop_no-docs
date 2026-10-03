import { createHash } from 'node:crypto';
import { ReturnRequestStatus, ReturnErrorCode } from './returnTypes.js';
import { ReturnDomainError } from './returnErrors.js';

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------

/** Exact state graph: requested->approved->received->refunded; requested->rejected. */
export function assertReturnTransition(from: ReturnRequestStatus, to: ReturnRequestStatus): void {
  const allowed: Record<ReturnRequestStatus, readonly ReturnRequestStatus[]> = {
    [ReturnRequestStatus.REQUESTED]: [ReturnRequestStatus.APPROVED, ReturnRequestStatus.REJECTED],
    [ReturnRequestStatus.APPROVED]: [ReturnRequestStatus.RECEIVED],
    [ReturnRequestStatus.RECEIVED]: [ReturnRequestStatus.REFUNDED],
    [ReturnRequestStatus.REJECTED]: [],
    [ReturnRequestStatus.REFUNDED]: [],
  };
  if (!allowed[from]?.includes(to)) {
    throw new ReturnDomainError(ReturnErrorCode.INVALID_TRANSITION);
  }
}

// ---------------------------------------------------------------------------
// Return window
// ---------------------------------------------------------------------------

const RETURN_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Exclusive close boundary: window closes exactly 30 days after the delivery event.
 * @param deliveredAt UTC ISO instant from the authoritative shipment_delivered event.
 * @param now Current UTC instant.
 */
export function returnWindowClosesAt(deliveredAt: Date): Date {
  return new Date(deliveredAt.getTime() + RETURN_WINDOW_MS);
}

/**
 * Returns true when `now` is strictly before the exclusive close boundary.
 * @param deliveredAt UTC ISO instant from the authoritative shipment_delivered event.
 * @param now Current UTC instant (injected clock).
 */
export function isWithinReturnWindow(deliveredAt: Date, now: Date): boolean {
  return now.getTime() < returnWindowClosesAt(deliveredAt).getTime();
}

// ---------------------------------------------------------------------------
// Eligibility input validation
// ---------------------------------------------------------------------------

export interface EligibilitySelection {
  shipmentId: string;
  orderLineItemId: string;
  quantity: number;
}

export interface DeliveredAllocation {
  shipmentId: string;
  shipmentStatus: string;
  orderLineItemId: string;
  deliveredQuantity: number;
}

export interface ActiveReservation {
  shipmentId: string;
  orderLineItemId: string;
  reservedQuantity: number;
}

/**
 * Validates return selections against delivered allocations and active reservations.
 * Throws on duplicate selection keys, zero/negative quantity, non-delivered shipment,
 * or exceeding available quantity per allocation.
 */
export function assertEligibleSelections(
  selections: readonly EligibilitySelection[],
  deliveredAllocations: readonly DeliveredAllocation[],
  activeReservations: readonly ActiveReservation[],
): void {
  // Deduplicate selections
  const seen = new Set<string>();
  for (const sel of selections) {
    const key = `${sel.shipmentId}:${sel.orderLineItemId}`;
    if (seen.has(key)) {
      throw new ReturnDomainError(ReturnErrorCode.RETURN_NOT_ELIGIBLE);
    }
    if (!Number.isSafeInteger(sel.quantity) || sel.quantity <= 0) {
      throw new ReturnDomainError(ReturnErrorCode.RETURN_NOT_ELIGIBLE);
    }
    seen.add(key);
  }

  // Build delivery index: only delivered lines
  const delivered = new Map<string, number>();
  for (const alloc of deliveredAllocations) {
    const key = `${alloc.shipmentId}:${alloc.orderLineItemId}`;
    if (alloc.shipmentStatus === 'delivered') {
      delivered.set(key, alloc.deliveredQuantity);
    }
  }

  // Build reservation index
  const reserved = new Map<string, number>();
  for (const res of activeReservations) {
    const key = `${res.shipmentId}:${res.orderLineItemId}`;
    reserved.set(key, (reserved.get(key) ?? 0) + res.reservedQuantity);
  }

  // Validate each selection
  for (const sel of selections) {
    const key = `${sel.shipmentId}:${sel.orderLineItemId}`;
    const dlvQty = delivered.get(key);
    if (dlvQty === undefined) {
      throw new ReturnDomainError(ReturnErrorCode.RETURN_NOT_ELIGIBLE);
    }
    const resQty = reserved.get(key) ?? 0;
    const available = dlvQty - resQty;
    if (available <= 0 || sel.quantity > available) {
      throw new ReturnDomainError(ReturnErrorCode.RETURN_NOT_ELIGIBLE);
    }
  }
}

// ---------------------------------------------------------------------------
// Idempotency fingerprint
// ---------------------------------------------------------------------------

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

/** Stable SHA-256 operation fingerprint. Operation + recursively key-sorted payload. */
export function returnFingerprint(operation: string, payload: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize({ operation, payload })))
    .digest('hex');
}

// ---------------------------------------------------------------------------
// Discount allocation (largest-remainder)
// ---------------------------------------------------------------------------

export interface DiscountLine {
  lineId: string;
  grossTotalCents: number;
}

export interface DiscountAllocation {
  lineId: string;
  grossTotalCents: number;
  allocatedDiscountCents: number;
}

/**
 * Allocates a whole-order discount across every purchased line using largest-remainder.
 * Base allocation: floor(discount * lineGross / subtotal).
 * Remaining cents distributed to lines with largest fractional remainders.
 * Tiebreak: numeric line ID.
 */
export function allocateOrderDiscountByLine(
  subtotalCents: number,
  discountCents: number,
  lines: readonly DiscountLine[],
): DiscountAllocation[] {
  if (lines.length === 0 || subtotalCents <= 0) return [];

  const allocations: DiscountAllocation[] = lines.map((line) => {
    const share = (discountCents * line.grossTotalCents) / subtotalCents;
    const floor = Math.floor(share);
    return {
      lineId: line.lineId,
      grossTotalCents: line.grossTotalCents,
      allocatedDiscountCents: floor,
      remainder: share - floor,
    };
  });

  // Total discount allocated so far
  const allocated = allocations.reduce((sum, a) => sum + a.allocatedDiscountCents, 0);
  let remaining = discountCents - allocated;

  // Sort by remainder descending, then by tiebreak rules
  type AllocationWithRemainder = DiscountAllocation & { remainder: number };
  const sorted = [...(allocations as AllocationWithRemainder[])].sort((a, b) => {
    if (a.remainder !== b.remainder) return b.remainder - a.remainder;
    // numeric line ID
    return parseInt(a.lineId, 10) - parseInt(b.lineId, 10);
  });

  for (const alloc of sorted) {
    if (remaining <= 0) break;
    alloc.allocatedDiscountCents += 1;
    remaining -= 1;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return sorted.map(({ remainder: _, ...rest }) => rest);
}

// ---------------------------------------------------------------------------
// Cumulative refund delta
// ---------------------------------------------------------------------------

/**
 * Computes the refund delta for a single order line given cumulative refunded quantity.
 *
 * lineNet = lineGross - allocatedLineDiscount
 * cumulativeTarget = floor(lineNet * cumulativeRefundedQuantity / purchasedQuantity)
 * currentRefundCents = newCumulativeTarget - priorCumulativeTarget
 */
export function calculateCumulativeRefundDelta(params: {
  lineGrossTotalCents: number;
  allocatedLineDiscountCents: number;
  purchasedQuantity: number;
  priorCumulativeRefundedQuantity: number;
  newCumulativeRefundedQuantity: number;
}): { newCumulativeRefundCents: number; deltaRefundCents: number } {
  const {
    lineGrossTotalCents,
    allocatedLineDiscountCents,
    purchasedQuantity,
    priorCumulativeRefundedQuantity,
    newCumulativeRefundedQuantity,
  } = params;

  const lineNetCents = lineGrossTotalCents - allocatedLineDiscountCents;

  const priorCumulativeRefundCents = Math.floor(
    (lineNetCents * priorCumulativeRefundedQuantity) / purchasedQuantity,
  );
  const newCumulativeRefundCents = Math.floor(
    (lineNetCents * newCumulativeRefundedQuantity) / purchasedQuantity,
  );

  return {
    newCumulativeRefundCents,
    deltaRefundCents: newCumulativeRefundCents - priorCumulativeRefundCents,
  };
}
