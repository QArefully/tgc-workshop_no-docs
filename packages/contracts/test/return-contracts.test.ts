import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import {
  ReturnRequestStatus,
  ReturnReasonCode,
  ReturnRequest,
  ReturnOverviewResponse,
  CreateReturnRequestBody,
  AdminDecisionBody,
  AdminReceiveBody,
  AdminRefundBody,
  AdminReturnListQuery,
  AdminReturnListResponse,
  ReturnIdParam,
  ReturnEligibilityLine,
  ReturnRequestItem,
  RefundSummary,
  ReturnErrorResponse,
  ReturnErrorCode,
} from '../src/returns.js';

// ---------------------------------------------------------------------------
// Status and reason enums
// ---------------------------------------------------------------------------

void test('ReturnRequestStatus accepts valid literals and rejects invalid', () => {
  const valid = ['requested', 'approved', 'rejected', 'received', 'refunded'];
  for (const value of valid) {
    assert.equal(Value.Check(ReturnRequestStatus, value), true, `expected ${value} valid`);
  }
  assert.equal(Value.Check(ReturnRequestStatus, 'unknown'), false);
  assert.equal(Value.Check(ReturnRequestStatus, 'returned'), false);
  assert.equal(Value.Check(ReturnRequestStatus, ''), false);
});

void test('ReturnReasonCode accepts valid literals and rejects invalid', () => {
  const valid = ['damaged', 'wrong_item', 'not_as_expected', 'other'];
  for (const value of valid) {
    assert.equal(Value.Check(ReturnReasonCode, value), true, `expected ${value} valid`);
  }
  assert.equal(Value.Check(ReturnReasonCode, 'lost'), false);
  assert.equal(Value.Check(ReturnReasonCode, ''), false);
});

void test('ReturnErrorCode accepts valid literals', () => {
  const valid = [
    'RETURN_NOT_FOUND',
    'RETURN_NOT_ELIGIBLE',
    'RETURN_WINDOW_EXPIRED',
    'QUANTITY_UNAVAILABLE',
    'INVALID_TRANSITION',
    'STALE_VERSION',
    'IDEMPOTENCY_CONFLICT',
    'PAYMENT_NOT_REFUNDABLE',
    'RETURN_DATA_CORRUPT',
  ];
  for (const value of valid) {
    assert.equal(Value.Check(ReturnErrorCode, value), true, `expected ${value} valid`);
  }
  assert.equal(Value.Check(ReturnErrorCode, 'UNKNOWN'), false);
});

// ---------------------------------------------------------------------------
// ReturnEligibilityLine
// ---------------------------------------------------------------------------

void test('ReturnEligibilityLine rejects missing fields', () => {
  const valid = {
    shipmentId: '1',
    shipmentNumber: 1,
    orderLineItemId: '10',
    productName: 'Widget',
    deliveredQuantity: 5,
    reservedQuantity: 0,
    availableQuantity: 5,
    deliveredAt: '2026-07-01T12:00:00.000Z',
    windowClosesAt: '2026-07-31T12:00:00.000Z',
  };
  assert.equal(Value.Check(ReturnEligibilityLine, valid), true);

  const missingField = { ...valid };
  delete (missingField as Record<string, unknown>).productName;
  assert.equal(Value.Check(ReturnEligibilityLine, missingField), false);
});

void test('ReturnEligibilityLine rejects unknown fields', () => {
  const withUnknown = {
    shipmentId: '1',
    shipmentNumber: 1,
    orderLineItemId: '10',
    productName: 'Widget',
    deliveredQuantity: 5,
    reservedQuantity: 0,
    availableQuantity: 5,
    deliveredAt: '2026-07-01T12:00:00.000Z',
    windowClosesAt: '2026-07-31T12:00:00.000Z',
    extraField: 'should reject',
  };
  assert.equal(Value.Check(ReturnEligibilityLine, withUnknown), false);
});

void test('ReturnEligibilityLine rejects negative quantities', () => {
  const invalid = {
    shipmentId: '1',
    shipmentNumber: 1,
    orderLineItemId: '10',
    productName: 'Widget',
    deliveredQuantity: -1,
    reservedQuantity: 0,
    availableQuantity: 5,
    deliveredAt: '2026-07-01T12:00:00.000Z',
    windowClosesAt: '2026-07-31T12:00:00.000Z',
  };
  assert.equal(Value.Check(ReturnEligibilityLine, invalid), false);
});

// ---------------------------------------------------------------------------
// ReturnRequest
// ---------------------------------------------------------------------------

void test('ReturnRequest accepts valid request object', () => {
  const valid = {
    id: '42',
    orderId: '10',
    status: 'requested',
    version: 0,
    reason: 'damaged',
    note: null,
    items: [
      {
        shipmentId: '1',
        orderLineItemId: '5',
        productName: 'Widget',
        quantity: 2,
        deliveredAt: '2026-07-01T12:00:00.000Z',
        windowClosesAt: '2026-07-31T12:00:00.000Z',
      },
    ],
    refund: null,
    requestedAt: '2026-07-01T12:00:00.000Z',
    approvedAt: null,
    rejectedAt: null,
    receivedAt: null,
  };
  assert.equal(Value.Check(ReturnRequest, valid), true);
});

void test('ReturnRequest rejects unknown fields', () => {
  const withUnknown = {
    id: '42',
    orderId: '10',
    status: 'requested',
    version: 0,
    reason: 'damaged',
    note: null,
    items: [],
    refund: null,
    requestedAt: '2026-07-01T12:00:00.000Z',
    approvedAt: null,
    rejectedAt: null,
    receivedAt: null,
    badField: true,
  };
  assert.equal(Value.Check(ReturnRequest, withUnknown), false);
});

void test('ReturnRequest rejects invalid status', () => {
  const invalidStatus = {
    id: '42',
    orderId: '10',
    status: 'unknown',
    version: 0,
    reason: 'damaged',
    note: null,
    items: [],
    refund: null,
    requestedAt: '2026-07-01T12:00:00.000Z',
    approvedAt: null,
    rejectedAt: null,
    receivedAt: null,
  };
  assert.equal(Value.Check(ReturnRequest, invalidStatus), false);
});

// ---------------------------------------------------------------------------
// ReturnOverviewResponse
// ---------------------------------------------------------------------------

void test('ReturnOverviewResponse validates windowDays=30', () => {
  const valid = {
    windowDays: 30,
    eligibleLines: [],
    requests: [],
  };
  assert.equal(Value.Check(ReturnOverviewResponse, valid), true);

  assert.equal(Value.Check(ReturnOverviewResponse, { ...valid, windowDays: 14 }), false);
});

// ---------------------------------------------------------------------------
// CreateReturnRequestBody
// ---------------------------------------------------------------------------

void test('CreateReturnRequestBody accepts valid payload', () => {
  const valid = {
    idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
    reason: 'damaged',
    note: 'Box was crushed',
    selections: [{ shipmentId: '1', orderLineItemId: '5', quantity: 2 }],
  };
  assert.equal(Value.Check(CreateReturnRequestBody, valid), true);
});

void test('CreateReturnRequestBody rejects empty selections', () => {
  const invalid = {
    idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
    reason: 'damaged',
    selections: [],
  };
  assert.equal(Value.Check(CreateReturnRequestBody, invalid), false);
});

void test('CreateReturnRequestBody rejects zero quantity', () => {
  const invalid = {
    idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
    reason: 'damaged',
    selections: [{ shipmentId: '1', orderLineItemId: '5', quantity: 0 }],
  };
  assert.equal(Value.Check(CreateReturnRequestBody, invalid), false);
});

void test('CreateReturnRequestBody rejects markup in note', () => {
  const invalid = {
    idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
    reason: 'other',
    note: '<script>alert(1)</script>',
    selections: [{ shipmentId: '1', orderLineItemId: '5', quantity: 1 }],
  };
  assert.equal(Value.Check(CreateReturnRequestBody, invalid), false);
});

void test('CreateReturnRequestBody note is optional', () => {
  const valid = {
    idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
    reason: 'other',
    selections: [{ shipmentId: '1', orderLineItemId: '5', quantity: 1 }],
  };
  assert.equal(Value.Check(CreateReturnRequestBody, valid), true);
});

// ---------------------------------------------------------------------------
// Admin command bodies
// ---------------------------------------------------------------------------

void test('AdminDecisionBody accepts approve and reject', () => {
  const approve = {
    version: 0,
    idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
    decision: 'approve',
  };
  assert.equal(Value.Check(AdminDecisionBody, approve), true);

  const reject = { ...approve, decision: 'reject' };
  assert.equal(Value.Check(AdminDecisionBody, reject), true);

  assert.equal(Value.Check(AdminDecisionBody, { ...approve, decision: 'unknown' }), false);
  assert.equal(Value.Check(AdminDecisionBody, { ...approve, version: -1 }), false);
});

void test('AdminReceiveBody validates fields', () => {
  const valid = {
    version: 3,
    idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
  };
  assert.equal(Value.Check(AdminReceiveBody, valid), true);

  assert.equal(Value.Check(AdminReceiveBody, { ...valid, version: -1 }), false);
});

void test('AdminRefundBody validates fields', () => {
  const valid = {
    version: 5,
    idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
  };
  assert.equal(Value.Check(AdminRefundBody, valid), true);
});

// ---------------------------------------------------------------------------
// ReturnIdParam
// ---------------------------------------------------------------------------

void test('ReturnIdParam validates positive integer string', () => {
  assert.equal(Value.Check(ReturnIdParam, { returnId: '1' }), true);
  assert.equal(Value.Check(ReturnIdParam, { returnId: '0' }), false);
  assert.equal(Value.Check(ReturnIdParam, { returnId: '-1' }), false);
  assert.equal(Value.Check(ReturnIdParam, { returnId: 'abc' }), false);
});

// ---------------------------------------------------------------------------
// AdminReturnListQuery/Response
// ---------------------------------------------------------------------------

void test('AdminReturnListQuery accepts optional status and pagination', () => {
  assert.equal(Value.Check(AdminReturnListQuery, {}), true);
  assert.equal(Value.Check(AdminReturnListQuery, { status: 'requested' }), true);
  assert.equal(Value.Check(AdminReturnListQuery, { page: 1, pageSize: 20 }), true);
  assert.equal(Value.Check(AdminReturnListQuery, { page: 0 }), false);
  assert.equal(Value.Check(AdminReturnListQuery, { pageSize: 0 }), false);
});

void test('AdminReturnListResponse validates items array', () => {
  const valid = {
    items: [],
    page: 1,
    pageSize: 20,
  };
  assert.equal(Value.Check(AdminReturnListResponse, valid), true);

  // Missing items should fail
  assert.equal(Value.Check(AdminReturnListResponse, { page: 1, pageSize: 20 }), false);
});

// ---------------------------------------------------------------------------
// RefundSummary
// ---------------------------------------------------------------------------

void test('RefundSummary validates refund data', () => {
  const valid = {
    grossSubtotalCents: 5000,
    discountShareCents: 250,
    amountCents: 4750,
    simulatedReference: 'sim_refund_key123',
    refundedAt: '2026-07-15T12:00:00.000Z',
  };
  assert.equal(Value.Check(RefundSummary, valid), true);

  assert.equal(Value.Check(RefundSummary, { ...valid, amountCents: -1 }), false);
});

// ---------------------------------------------------------------------------
// ReturnRequestItem
// ---------------------------------------------------------------------------

void test('ReturnRequestItem validates item data', () => {
  const valid = {
    shipmentId: '1',
    orderLineItemId: '5',
    productName: 'Widget',
    quantity: 2,
    deliveredAt: '2026-07-01T12:00:00.000Z',
    windowClosesAt: '2026-07-31T12:00:00.000Z',
  };
  assert.equal(Value.Check(ReturnRequestItem, valid), true);

  assert.equal(Value.Check(ReturnRequestItem, { ...valid, quantity: 0 }), false);
});

// ---------------------------------------------------------------------------
// ReturnErrorResponse
// ---------------------------------------------------------------------------

void test('ReturnErrorResponse validates optional code', () => {
  assert.equal(
    Value.Check(ReturnErrorResponse, { error: 'Not eligible', code: 'RETURN_NOT_ELIGIBLE' }),
    true,
  );
  assert.equal(Value.Check(ReturnErrorResponse, { error: 'Something went wrong' }), true);
});
