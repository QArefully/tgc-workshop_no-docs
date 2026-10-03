import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import {
  InventoryReceiptBody,
  InventoryReceiptBodyLegacy,
  InventoryReceiptResponse,
  InventoryReceiptResponseLegacy,
  type InventoryReceiptResponse as InventoryReceiptResponseType,
} from '../src/inventory.js';

const key = '123e4567-e89b-42d3-a456-426614174000';

void test('inventory receipt transport requires bounded positive receipt and allocation facts', () => {
  assert.equal(
    Value.Check(InventoryReceiptBody, { variantId: 1, quantity: 2, idempotencyKey: key }),
    true,
  );
  assert.equal(
    Value.Check(InventoryReceiptBody, { variantId: 1, quantity: 0, idempotencyKey: key }),
    false,
  );
  const response: InventoryReceiptResponseType = {
    receiptId: '1',
    variantId: 1,
    receivedQuantity: 2,
    allocatedQuantity: 1,
    remainingStock: 1,
    allocations: [{ orderId: '4', orderLineItemId: '8', quantity: 1 }],
  };
  assert.equal(Value.Check(InventoryReceiptResponse, response), true);
  assert.equal(Value.Check(InventoryReceiptResponse, { ...response, remainingStock: -1 }), false);
});

void test('legacy inventory receipt schemas accept productId for backward compat', () => {
  assert.equal(
    Value.Check(InventoryReceiptBodyLegacy, {
      productId: '49',
      quantity: 2,
      idempotencyKey: key,
    }),
    true,
  );
  assert.equal(
    Value.Check(InventoryReceiptBodyLegacy, {
      productId: '49',
      quantity: 0,
      idempotencyKey: key,
    }),
    false,
  );
  const legacyResponse = {
    receiptId: '1',
    productId: '49',
    receivedQuantity: 2,
    allocatedQuantity: 1,
    remainingStock: 1,
    allocations: [{ orderId: '4', orderLineItemId: '8', quantity: 1 }],
  };
  assert.equal(Value.Check(InventoryReceiptResponseLegacy, legacyResponse), true);
  assert.equal(
    Value.Check(InventoryReceiptResponseLegacy, { ...legacyResponse, remainingStock: -1 }),
    false,
  );
});

void test('inventory receipt body rejects productId when using new variantId schema', () => {
  assert.equal(
    Value.Check(InventoryReceiptBody, {
      productId: '49',
      quantity: 2,
      idempotencyKey: key,
    }),
    false,
  );
});
