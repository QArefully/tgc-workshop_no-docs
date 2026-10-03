import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import {
  QuickOrderLineOutcome,
  QuickOrderRequestBody,
  QuickOrderResponse,
  QuickOrderSkipReason,
} from '../src/quickOrder.js';
import type { QuickOrderResponse as QuickOrderResponseFromRoot } from '@shop/contracts';
import type { QuickOrderResponse as QuickOrderResponseFromSubpath } from '@shop/contracts/quick-order';

const uuid = '123e4567-e89b-42d3-a456-426614174000';

const addedOutcome = {
  lineNumber: 1,
  rawLine: 'BKP-0001-001, 4',
  sku: 'BKP-0001-001',
  requestedQuantity: 4,
  submittedQuantity: 4,
  moqAdjusted: false,
  duplicateSku: false,
  variantId: 1,
  productId: '1',
  productName: 'Portland cement',
  resolvedUnitPriceCents: 2500,
  status: 'added',
  reason: null,
} as const;

const skippedOutcome = {
  lineNumber: 2,
  rawLine: 'UNKNOWN-001, 2',
  sku: 'UNKNOWN-001',
  requestedQuantity: 2,
  submittedQuantity: null,
  moqAdjusted: false,
  duplicateSku: false,
  variantId: null,
  productId: null,
  productName: null,
  resolvedUnitPriceCents: null,
  status: 'skipped',
  reason: 'SKU_NOT_FOUND',
} as const;

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
} satisfies QuickOrderResponseFromRoot;

void test('quick order request body requires bounded text and rejects unknown properties', () => {
  assert.equal(Value.Check(QuickOrderRequestBody, { text: 'BKP-0001-001, 4' }), true);
  assert.equal(Value.Check(QuickOrderRequestBody, { text: '' }), false);
  assert.equal(Value.Check(QuickOrderRequestBody, { text: 'x'.repeat(20_001) }), false);
  assert.equal(Value.Check(QuickOrderRequestBody, { text: 'BKP-0001-001, 4', extra: true }), false);
});

void test('quick order skip reasons are a closed union', () => {
  for (const reason of [
    'MALFORMED_LINE',
    'SKU_NOT_FOUND',
    'INVALID_QUANTITY',
    'VARIANT_RETIRED',
    'INSUFFICIENT_STOCK',
    'BELOW_MOQ',
    'BLEND_UNAVAILABLE',
  ]) {
    assert.equal(Value.Check(QuickOrderSkipReason, reason), true);
  }
  assert.equal(Value.Check(QuickOrderSkipReason, 'UNKNOWN_REASON'), false);
});

void test('quick order outcome accepts a mixed result including nullable fields', () => {
  assert.equal(Value.Check(QuickOrderLineOutcome, addedOutcome), true);
  assert.equal(Value.Check(QuickOrderLineOutcome, skippedOutcome), true);
  assert.equal(Value.Check(QuickOrderResponse, response), true);
});

void test('quick order outcome enforces status and reason pairings', () => {
  assert.equal(
    Value.Check(QuickOrderLineOutcome, { ...addedOutcome, reason: 'INSUFFICIENT_STOCK' }),
    false,
  );
  assert.equal(Value.Check(QuickOrderLineOutcome, { ...skippedOutcome, reason: null }), false);
});

void test('quick order outcome rejects unknown reasons and additional properties', () => {
  assert.equal(
    Value.Check(QuickOrderLineOutcome, { ...skippedOutcome, reason: 'UNKNOWN_REASON' }),
    false,
  );
  assert.equal(Value.Check(QuickOrderLineOutcome, { ...addedOutcome, extra: true }), false);
  assert.equal(Value.Check(QuickOrderResponse, { ...response, extra: true }), false);
  assert.equal(
    Value.Check(QuickOrderResponse, {
      ...response,
      cart: { ...response.cart, unexpected: true },
    }),
    false,
  );
});

void test('quick order types import through root and quick-order subpath', () => {
  const rootConsumer: QuickOrderResponseFromRoot = response;
  const subpathConsumer: QuickOrderResponseFromSubpath = rootConsumer;
  assert.equal(subpathConsumer.outcomes.length, 2);
});
