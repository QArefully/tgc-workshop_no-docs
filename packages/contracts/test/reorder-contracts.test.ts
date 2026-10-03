import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import {
  ReorderLineOutcome,
  ReorderRequestBody,
  ReorderResponse,
  ReorderSkipReason,
} from '../src/reorder.js';

const uuid = '123e4567-e89b-42d3-a456-426614174000';

const addedOutcome = {
  orderLineItemId: '1',
  productId: '1',
  productName: 'Portland cement',
  variantId: 1,
  sku: 'TM-0001-001',
  configKey: '',
  quantity: 4,
  status: 'added',
  reason: null,
  orderedUnitPriceCents: 2500,
  currentUnitPriceCents: 2600,
  priceChanged: true,
};

const skippedOutcome = {
  ...addedOutcome,
  orderLineItemId: '2',
  variantId: null,
  sku: null,
  status: 'skipped',
  reason: 'VARIANT_RETIRED',
  currentUnitPriceCents: null,
  priceChanged: false,
};

void test('reorder request body requires a non-empty cart id and rejects unknown properties', () => {
  assert.equal(Value.Check(ReorderRequestBody, { cartId: uuid }), true);
  assert.equal(Value.Check(ReorderRequestBody, { cartId: '' }), false);
  assert.equal(Value.Check(ReorderRequestBody, {}), false);
  assert.equal(Value.Check(ReorderRequestBody, { cartId: uuid, unexpected: true }), false);
});

void test('reorder skip reasons are a closed union', () => {
  for (const reason of [
    'VARIANT_RETIRED',
    'VARIANT_UNRESOLVED',
    'INSUFFICIENT_STOCK',
    'BELOW_MOQ',
    'INVALID_QUANTITY',
    'BLEND_UNAVAILABLE',
  ]) {
    assert.equal(Value.Check(ReorderSkipReason, reason), true);
  }
  assert.equal(Value.Check(ReorderSkipReason, 'SOMETHING_ELSE'), false);
  assert.equal(Value.Check(ReorderSkipReason, 'variant_retired'), false);
});

void test('reorder outcome accepts added and skipped lines', () => {
  assert.equal(Value.Check(ReorderLineOutcome, addedOutcome), true);
  assert.equal(Value.Check(ReorderLineOutcome, skippedOutcome), true);
  assert.equal(
    Value.Check(ReorderLineOutcome, { ...addedOutcome, configKey: 'a'.repeat(64) }),
    true,
  );
});

void test('reorder outcome enforces the status/reason pairing by schema', () => {
  assert.equal(
    Value.Check(ReorderLineOutcome, { ...addedOutcome, reason: 'INSUFFICIENT_STOCK' }),
    false,
  );
  assert.equal(Value.Check(ReorderLineOutcome, { ...skippedOutcome, reason: null }), false);
  assert.equal(
    Value.Check(ReorderLineOutcome, { ...skippedOutcome, reason: 'NOT_A_REASON' }),
    false,
  );
  assert.equal(Value.Check(ReorderLineOutcome, { ...addedOutcome, status: 'pending' }), false);
});

void test('reorder outcome rejects unknown properties and malformed identifiers', () => {
  assert.equal(Value.Check(ReorderLineOutcome, { ...addedOutcome, unexpected: true }), false);
  assert.equal(Value.Check(ReorderLineOutcome, { ...addedOutcome, orderLineItemId: '0' }), false);
  assert.equal(Value.Check(ReorderLineOutcome, { ...addedOutcome, quantity: 0 }), false);
  assert.equal(
    Value.Check(ReorderLineOutcome, {
      ...addedOutcome,
      orderedUnitPriceCents: Number.MAX_SAFE_INTEGER + 1,
    }),
    false,
  );
  assert.equal(
    Value.Check(ReorderLineOutcome, { ...addedOutcome, currentUnitPriceCents: 2600.5 }),
    false,
  );
  assert.equal(Value.Check(ReorderLineOutcome, { ...addedOutcome, configKey: 'nope' }), false);
});

void test('reorder response carries the resulting cart and outcome counts', () => {
  const response = {
    cart: {
      id: uuid,
      items: [],
      subtotalCents: 0,
      discountableSubtotalCents: 0,
      blendingFeeTotalCents: 0,
      totalItems: 0,
    },
    addedLineCount: 1,
    skippedLineCount: 1,
    outcomes: [addedOutcome, skippedOutcome],
  };
  assert.equal(Value.Check(ReorderResponse, response), true);
  assert.equal(Value.Check(ReorderResponse, { ...response, addedLineCount: -1 }), false);
  assert.equal(Value.Check(ReorderResponse, { ...response, unexpected: true }), false);
  assert.equal(
    Value.Check(ReorderResponse, {
      ...response,
      outcomes: [{ ...addedOutcome, reason: 'BELOW_MOQ' }],
    }),
    false,
  );
});
