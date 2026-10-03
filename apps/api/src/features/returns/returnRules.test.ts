import assert from 'node:assert/strict';
import test from 'node:test';
import { ReturnRequestStatus, ReturnErrorCode } from './returnTypes.js';
import { ReturnDomainError } from './returnErrors.js';
import {
  assertReturnTransition,
  returnWindowClosesAt,
  isWithinReturnWindow,
  assertEligibleSelections,
  returnFingerprint,
  allocateOrderDiscountByLine,
  calculateCumulativeRefundDelta,
} from './returnRules.js';
import type {
  EligibilitySelection,
  DeliveredAllocation,
  ActiveReservation,
  DiscountLine,
} from './returnRules.js';

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------

void test('assertReturnTransition allows valid transitions', () => {
  // requested -> approved
  assert.doesNotThrow(() =>
    assertReturnTransition(ReturnRequestStatus.REQUESTED, ReturnRequestStatus.APPROVED),
  );
  // requested -> rejected
  assert.doesNotThrow(() =>
    assertReturnTransition(ReturnRequestStatus.REQUESTED, ReturnRequestStatus.REJECTED),
  );
  // approved -> received
  assert.doesNotThrow(() =>
    assertReturnTransition(ReturnRequestStatus.APPROVED, ReturnRequestStatus.RECEIVED),
  );
  // received -> refunded
  assert.doesNotThrow(() =>
    assertReturnTransition(ReturnRequestStatus.RECEIVED, ReturnRequestStatus.REFUNDED),
  );
});

void test('assertReturnTransition rejects invalid transitions', () => {
  // terminal states cannot transition
  const terminal: ReturnRequestStatus[] = [
    ReturnRequestStatus.REJECTED,
    ReturnRequestStatus.REFUNDED,
  ];
  for (const from of terminal) {
    assert.throws(
      () => assertReturnTransition(from, ReturnRequestStatus.REQUESTED),
      ReturnDomainError,
    );
  }
  // rejected cannot go to refunded
  assert.throws(
    () => assertReturnTransition(ReturnRequestStatus.REJECTED, ReturnRequestStatus.REFUNDED),
    ReturnDomainError,
  );
  // refunded cannot go anywhere
  assert.throws(
    () => assertReturnTransition(ReturnRequestStatus.REFUNDED, ReturnRequestStatus.REQUESTED),
    ReturnDomainError,
  );
  // received cannot go directly to rejected
  assert.throws(
    () => assertReturnTransition(ReturnRequestStatus.RECEIVED, ReturnRequestStatus.REJECTED),
    ReturnDomainError,
  );
  // approved cannot go to rejected
  assert.throws(
    () => assertReturnTransition(ReturnRequestStatus.APPROVED, ReturnRequestStatus.REJECTED),
    ReturnDomainError,
  );
  // approved cannot go to refunded (must go through received)
  assert.throws(
    () => assertReturnTransition(ReturnRequestStatus.APPROVED, ReturnRequestStatus.REFUNDED),
    ReturnDomainError,
  );
  // requested cannot go to received (must go through approved)
  assert.throws(
    () => assertReturnTransition(ReturnRequestStatus.REQUESTED, ReturnRequestStatus.RECEIVED),
    ReturnDomainError,
  );
  // requested cannot go to refunded (must go through approved + received)
  assert.throws(
    () => assertReturnTransition(ReturnRequestStatus.REQUESTED, ReturnRequestStatus.REFUNDED),
    ReturnDomainError,
  );
});

void test('assertReturnTransition error has correct code', () => {
  try {
    assertReturnTransition(ReturnRequestStatus.REJECTED, ReturnRequestStatus.APPROVED);
    assert.fail('Expected error');
  } catch (err) {
    assert.ok(err instanceof ReturnDomainError);
    assert.equal(err.code, ReturnErrorCode.INVALID_TRANSITION);
  }
});

// ---------------------------------------------------------------------------
// Return window
// ---------------------------------------------------------------------------

void test('returnWindowClosesAt is exactly 30 days after delivery', () => {
  const deliveredAt = new Date('2026-07-01T12:00:00.000Z');
  const closes = returnWindowClosesAt(deliveredAt);
  assert.equal(closes.toISOString(), '2026-07-31T12:00:00.000Z');
});

void test('isWithinReturnWindow: before close -> true', () => {
  const deliveredAt = new Date('2026-07-01T12:00:00.000Z');
  const now = new Date('2026-07-31T11:59:59.999Z');
  assert.equal(isWithinReturnWindow(deliveredAt, now), true);
});

void test('isWithinReturnWindow: at exact close -> false (exclusive)', () => {
  const deliveredAt = new Date('2026-07-01T12:00:00.000Z');
  const now = new Date('2026-07-31T12:00:00.000Z');
  assert.equal(isWithinReturnWindow(deliveredAt, now), false);
});

void test('isWithinReturnWindow: after close -> false', () => {
  const deliveredAt = new Date('2026-07-01T12:00:00.000Z');
  const now = new Date('2026-08-01T00:00:00.000Z');
  assert.equal(isWithinReturnWindow(deliveredAt, now), false);
});

void test('isWithinReturnWindow: exactly at delivery time -> true', () => {
  const deliveredAt = new Date('2026-07-01T12:00:00.000Z');
  assert.equal(isWithinReturnWindow(deliveredAt, deliveredAt), true);
});

void test('isWithinReturnWindow: one day after delivery -> still within window', () => {
  const deliveredAt = new Date('2026-07-01T12:00:00.000Z');
  const now = new Date('2026-07-02T12:00:00.000Z');
  assert.equal(isWithinReturnWindow(deliveredAt, now), true);
});

// ---------------------------------------------------------------------------
// Eligibility selections
// ---------------------------------------------------------------------------

const makeAllocation = (
  shipmentId: string,
  orderLineItemId: string,
  deliveredQuantity: number,
  status = 'delivered',
): DeliveredAllocation => ({
  shipmentId,
  shipmentStatus: status,
  orderLineItemId,
  deliveredQuantity,
});

void test('assertEligibleSelections accepts valid single selection', () => {
  const selections: EligibilitySelection[] = [
    { shipmentId: '1', orderLineItemId: '10', quantity: 2 },
  ];
  const allocations: DeliveredAllocation[] = [makeAllocation('1', '10', 5)];

  assert.doesNotThrow(() => assertEligibleSelections(selections, allocations, []));
});

void test('assertEligibleSelections accepts partial quantity', () => {
  const selections: EligibilitySelection[] = [
    { shipmentId: '1', orderLineItemId: '10', quantity: 3 },
  ];
  const allocations: DeliveredAllocation[] = [makeAllocation('1', '10', 5)];

  assert.doesNotThrow(() => assertEligibleSelections(selections, allocations, []));
});

void test('assertEligibleSelections accepts full quantity', () => {
  const selections: EligibilitySelection[] = [
    { shipmentId: '1', orderLineItemId: '10', quantity: 5 },
  ];
  const allocations: DeliveredAllocation[] = [makeAllocation('1', '10', 5)];

  assert.doesNotThrow(() => assertEligibleSelections(selections, allocations, []));
});

void test('assertEligibleSelections rejects duplicate selection keys', () => {
  const selections: EligibilitySelection[] = [
    { shipmentId: '1', orderLineItemId: '10', quantity: 1 },
    { shipmentId: '1', orderLineItemId: '10', quantity: 2 },
  ];
  const allocations: DeliveredAllocation[] = [makeAllocation('1', '10', 5)];

  assert.throws(() => assertEligibleSelections(selections, allocations, []), ReturnDomainError);
});

void test('assertEligibleSelections rejects zero quantity', () => {
  const selections: EligibilitySelection[] = [
    { shipmentId: '1', orderLineItemId: '10', quantity: 0 },
  ];
  const allocations: DeliveredAllocation[] = [makeAllocation('1', '10', 5)];

  assert.throws(() => assertEligibleSelections(selections, allocations, []), ReturnDomainError);
});

void test('assertEligibleSelections rejects non-safe integer', () => {
  const selections: EligibilitySelection[] = [
    { shipmentId: '1', orderLineItemId: '10', quantity: 1.5 },
  ];
  const allocations: DeliveredAllocation[] = [makeAllocation('1', '10', 5)];

  assert.throws(() => assertEligibleSelections(selections, allocations, []), ReturnDomainError);
});

void test('assertEligibleSelections rejects non-delivered shipment', () => {
  const selections: EligibilitySelection[] = [
    { shipmentId: '1', orderLineItemId: '10', quantity: 1 },
  ];
  const allocations: DeliveredAllocation[] = [makeAllocation('1', '10', 5, 'shipped')];

  assert.throws(() => assertEligibleSelections(selections, allocations, []), ReturnDomainError);
});

void test('assertEligibleSelections rejects quantity exceeding delivery', () => {
  const selections: EligibilitySelection[] = [
    { shipmentId: '1', orderLineItemId: '10', quantity: 6 },
  ];
  const allocations: DeliveredAllocation[] = [makeAllocation('1', '10', 5)];

  assert.throws(() => assertEligibleSelections(selections, allocations, []), ReturnDomainError);
});

void test('assertEligibleSelections respects active reservations', () => {
  const selections: EligibilitySelection[] = [
    { shipmentId: '1', orderLineItemId: '10', quantity: 3 },
  ];
  const allocations: DeliveredAllocation[] = [makeAllocation('1', '10', 5)];
  const reservations: ActiveReservation[] = [
    { shipmentId: '1', orderLineItemId: '10', reservedQuantity: 2 },
  ];

  // available = 5 - 2 = 3, so 3 is OK
  assert.doesNotThrow(() => assertEligibleSelections(selections, allocations, reservations));

  // 4 exceeds available
  const tooMany: EligibilitySelection[] = [{ shipmentId: '1', orderLineItemId: '10', quantity: 4 }];
  assert.throws(
    () => assertEligibleSelections(tooMany, allocations, reservations),
    ReturnDomainError,
  );
});

void test('assertEligibleSelections aggregates multiple reservations for same line', () => {
  const selections: EligibilitySelection[] = [
    { shipmentId: '1', orderLineItemId: '10', quantity: 1 },
  ];
  const allocations: DeliveredAllocation[] = [makeAllocation('1', '10', 5)];
  const reservations: ActiveReservation[] = [
    { shipmentId: '1', orderLineItemId: '10', reservedQuantity: 2 },
    { shipmentId: '1', orderLineItemId: '10', reservedQuantity: 2 },
  ];

  // available = 5 - 4 = 1, so 1 is OK
  assert.doesNotThrow(() => assertEligibleSelections(selections, allocations, reservations));

  // 2 exceeds available
  const tooMany: EligibilitySelection[] = [{ shipmentId: '1', orderLineItemId: '10', quantity: 2 }];
  assert.throws(
    () => assertEligibleSelections(tooMany, allocations, reservations),
    ReturnDomainError,
  );
});

void test('assertEligibleSelections accepts mixed shipments', () => {
  const selections: EligibilitySelection[] = [
    { shipmentId: '1', orderLineItemId: '10', quantity: 2 },
    { shipmentId: '2', orderLineItemId: '20', quantity: 1 },
  ];
  const allocations: DeliveredAllocation[] = [
    makeAllocation('1', '10', 5),
    makeAllocation('2', '20', 3),
  ];

  assert.doesNotThrow(() => assertEligibleSelections(selections, allocations, []));
});

void test('assertEligibleSelections rejects unknown allocation', () => {
  const selections: EligibilitySelection[] = [
    { shipmentId: '99', orderLineItemId: '10', quantity: 1 },
  ];
  const allocations: DeliveredAllocation[] = [makeAllocation('1', '10', 5)];

  assert.throws(() => assertEligibleSelections(selections, allocations, []), ReturnDomainError);
});

// ---------------------------------------------------------------------------
// Fingerprint
// ---------------------------------------------------------------------------

void test('returnFingerprint is deterministic', () => {
  const payload = { a: 1, b: 2 };
  const f1 = returnFingerprint('create', payload);
  const f2 = returnFingerprint('create', payload);
  assert.equal(f1, f2);
});

void test('returnFingerprint differs by operation', () => {
  const payload = { a: 1 };
  const f1 = returnFingerprint('create', payload);
  const f2 = returnFingerprint('decide', payload);
  assert.notEqual(f1, f2);
});

void test('returnFingerprint is key-order stable', () => {
  // Same logical object, different JSON key order -> same fingerprint
  const f1 = returnFingerprint('create', { b: 2, a: 1 });
  const f2 = returnFingerprint('create', { a: 1, b: 2 });
  assert.equal(f1, f2);
});

void test('returnFingerprint differs by payload value', () => {
  const f1 = returnFingerprint('decide', { decision: 'approve' });
  const f2 = returnFingerprint('decide', { decision: 'reject' });
  assert.notEqual(f1, f2);
});

// ---------------------------------------------------------------------------
// Discount allocation
// ---------------------------------------------------------------------------

void test('allocateOrderDiscountByLine: even split', () => {
  // $100 subtotal, $10 discount, two $50 lines
  const lines: DiscountLine[] = [
    { lineId: '1', grossTotalCents: 5000 },
    { lineId: '2', grossTotalCents: 5000 },
  ];
  const result = allocateOrderDiscountByLine(10000, 1000, lines);
  assert.equal(result.length, 2);
  // Both should get $5 discount each
  const sorted = result.sort((a, b) => parseInt(a.lineId, 10) - parseInt(b.lineId, 10));
  assert.equal(sorted[0]!.allocatedDiscountCents, 500);
  assert.equal(sorted[1]!.allocatedDiscountCents, 500);
  // Sum matches discount
  const sum = result.reduce((s, r) => s + r.allocatedDiscountCents, 0);
  assert.equal(sum, 1000);
});

void test('allocateOrderDiscountByLine: largest remainder allocation', () => {
  // $100 subtotal, $10 discount, three $33 lines (total $99... but we use actual numbers)
  // Use $100 subtotal, $1 discount = hard to split with remainders
  // Instead: $99 subtotal, $10 discount, three $33 lines -> floor gives 3,3,3 = 9, remainder 1
  const lines: DiscountLine[] = [
    { lineId: '1', grossTotalCents: 3300 },
    { lineId: '2', grossTotalCents: 3300 },
    { lineId: '3', grossTotalCents: 3300 },
  ];
  const result = allocateOrderDiscountByLine(9900, 1000, lines);
  const sum = result.reduce((s, r) => s + r.allocatedDiscountCents, 0);
  assert.equal(sum, 1000);
  // Each gets at least floor(1000*3300/9900)=333, plus one extra (334) for line with largest remainder
  // Tie: all remainders equal (1000*3300/9900 = 333.333...), numeric ID
  const sorted = result.sort((a, b) => parseInt(a.lineId, 10) - parseInt(b.lineId, 10));
  // line 1 gets the extra cent (smallest numeric ID)
  assert.equal(sorted[0]!.allocatedDiscountCents, 334);
  assert.equal(sorted[1]!.allocatedDiscountCents, 333);
  assert.equal(sorted[2]!.allocatedDiscountCents, 333);
});

void test('allocateOrderDiscountByLine: zero discount', () => {
  const lines: DiscountLine[] = [{ lineId: '1', grossTotalCents: 5000 }];
  const result = allocateOrderDiscountByLine(5000, 0, lines);
  assert.equal(result.length, 1);
  assert.equal(result[0]!.allocatedDiscountCents, 0);
});

void test('allocateOrderDiscountByLine: empty lines', () => {
  const result = allocateOrderDiscountByLine(1000, 100, []);
  assert.equal(result.length, 0);
});

void test('allocateOrderDiscountByLine: zero subtotal', () => {
  const lines: DiscountLine[] = [{ lineId: '1', grossTotalCents: 0 }];
  const result = allocateOrderDiscountByLine(0, 100, lines);
  assert.equal(result.length, 0);
});

void test('allocateOrderDiscountByLine: discount exceeds subtotal', () => {
  // discount cannot exceed subtotal in practice, but allocation should still work
  const lines: DiscountLine[] = [{ lineId: '1', grossTotalCents: 5000 }];
  const result = allocateOrderDiscountByLine(5000, 10000, lines);
  const sum = result.reduce((s, r) => s + r.allocatedDiscountCents, 0);
  assert.equal(sum, 10000);
  assert.equal(result[0]!.allocatedDiscountCents, 10000);
});

void test('allocateOrderDiscountByLine: full order exactness', () => {
  // 4 lines at different proportions
  const lines: DiscountLine[] = [
    { lineId: '1', grossTotalCents: 1000 },
    { lineId: '2', grossTotalCents: 2000 },
    { lineId: '3', grossTotalCents: 3000 },
    { lineId: '4', grossTotalCents: 4000 },
  ];
  // subtotal=10000, discount=1000 (10%)
  const result = allocateOrderDiscountByLine(10000, 1000, lines);
  const sum = result.reduce((s, r) => s + r.allocatedDiscountCents, 0);
  assert.equal(sum, 1000);
  // With exact 10%, remainders are all 0 -> each gets floor(10% of line)
  // 100, 200, 300, 400 = 1000 exactly
  const sorted = result.sort((a, b) => parseInt(a.lineId, 10) - parseInt(b.lineId, 10));
  assert.equal(sorted[0]!.allocatedDiscountCents, 100);
  assert.equal(sorted[1]!.allocatedDiscountCents, 200);
  assert.equal(sorted[2]!.allocatedDiscountCents, 300);
  assert.equal(sorted[3]!.allocatedDiscountCents, 400);
});

// ---------------------------------------------------------------------------
// Cumulative refund delta
// ---------------------------------------------------------------------------

void test('calculateCumulativeRefundDelta: full line return -> exact net', () => {
  // $50 line gross, $5 discount allocated, 5 purchased, return all 5
  const result = calculateCumulativeRefundDelta({
    lineGrossTotalCents: 5000,
    allocatedLineDiscountCents: 500,
    purchasedQuantity: 5,
    priorCumulativeRefundedQuantity: 0,
    newCumulativeRefundedQuantity: 5,
  });
  // lineNet = 5000 - 500 = 4500
  // cumulative = floor(4500 * 5 / 5) = 4500
  assert.equal(result.newCumulativeRefundCents, 4500);
  assert.equal(result.deltaRefundCents, 4500);
});

void test('calculateCumulativeRefundDelta: partial return', () => {
  // $50 line gross, $5 discount allocated, 5 purchased, return 2
  const result = calculateCumulativeRefundDelta({
    lineGrossTotalCents: 5000,
    allocatedLineDiscountCents: 500,
    purchasedQuantity: 5,
    priorCumulativeRefundedQuantity: 0,
    newCumulativeRefundedQuantity: 2,
  });
  // lineNet = 4500
  // cumulative = floor(4500 * 2 / 5) = 1800
  assert.equal(result.newCumulativeRefundCents, 1800);
  assert.equal(result.deltaRefundCents, 1800);
});

void test('calculateCumulativeRefundDelta: incremental refunds', () => {
  // Return 2 then 3
  const first = calculateCumulativeRefundDelta({
    lineGrossTotalCents: 5000,
    allocatedLineDiscountCents: 500,
    purchasedQuantity: 5,
    priorCumulativeRefundedQuantity: 0,
    newCumulativeRefundedQuantity: 2,
  });
  assert.equal(first.newCumulativeRefundCents, 1800);
  assert.equal(first.deltaRefundCents, 1800);

  const second = calculateCumulativeRefundDelta({
    lineGrossTotalCents: 5000,
    allocatedLineDiscountCents: 500,
    purchasedQuantity: 5,
    priorCumulativeRefundedQuantity: 2,
    newCumulativeRefundedQuantity: 5,
  });
  // cumulative target = floor(4500 * 5 / 5) = 4500
  // delta = 4500 - 1800 = 2700
  assert.equal(second.newCumulativeRefundCents, 4500);
  assert.equal(second.deltaRefundCents, 2700);
  // total = 1800 + 2700 = 4500 = exact net
  assert.equal(first.deltaRefundCents + second.deltaRefundCents, 4500);
});

void test('calculateCumulativeRefundDelta: never exceeds line net', () => {
  const result = calculateCumulativeRefundDelta({
    lineGrossTotalCents: 5000,
    allocatedLineDiscountCents: 500,
    purchasedQuantity: 5,
    priorCumulativeRefundedQuantity: 0,
    newCumulativeRefundedQuantity: 5,
  });
  assert.ok(result.newCumulativeRefundCents <= 4500);
});

void test('calculateCumulativeRefundDelta: zero discount line', () => {
  const result = calculateCumulativeRefundDelta({
    lineGrossTotalCents: 10000,
    allocatedLineDiscountCents: 0,
    purchasedQuantity: 10,
    priorCumulativeRefundedQuantity: 0,
    newCumulativeRefundedQuantity: 5,
  });
  // lineNet = 10000, cumulative = floor(10000 * 5 / 10) = 5000
  assert.equal(result.newCumulativeRefundCents, 5000);
  assert.equal(result.deltaRefundCents, 5000);
});

void test('calculateCumulativeRefundDelta: rounding down preserves cap', () => {
  // $10 line, $3 discount, 3 purchased -> lineNet = 7
  // return 1: floor(7*1/3) = 2
  const result = calculateCumulativeRefundDelta({
    lineGrossTotalCents: 1000,
    allocatedLineDiscountCents: 300,
    purchasedQuantity: 3,
    priorCumulativeRefundedQuantity: 0,
    newCumulativeRefundedQuantity: 1,
  });
  assert.equal(result.newCumulativeRefundCents, 233); // floor(700/3) = 233
  assert.equal(result.deltaRefundCents, 233);

  // return all 3: floor(700*3/3) = 700
  const full = calculateCumulativeRefundDelta({
    lineGrossTotalCents: 1000,
    allocatedLineDiscountCents: 300,
    purchasedQuantity: 3,
    priorCumulativeRefundedQuantity: 0,
    newCumulativeRefundedQuantity: 3,
  });
  assert.equal(full.newCumulativeRefundCents, 700);
  assert.equal(full.deltaRefundCents, 700);
});

void test('calculateCumulativeRefundDelta: no-op when same quantity', () => {
  const result = calculateCumulativeRefundDelta({
    lineGrossTotalCents: 5000,
    allocatedLineDiscountCents: 500,
    purchasedQuantity: 5,
    priorCumulativeRefundedQuantity: 2,
    newCumulativeRefundedQuantity: 2,
  });
  assert.equal(result.deltaRefundCents, 0);
});
