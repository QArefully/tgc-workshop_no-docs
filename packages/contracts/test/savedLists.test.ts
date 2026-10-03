import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import {
  CreateSavedListBody,
  SavedListAddToCartResponse,
  SavedListLineOutcome,
  UpdateSavedListItemBody,
} from '../src/savedLists.js';
import type { SavedListLineOutcome as SavedListLineOutcomeType } from '../src/savedLists.js';
import type { SavedListAddToCartResponse as SavedListAddToCartResponseFromRoot } from '@shop/contracts';
import type { SavedListAddToCartResponse as SavedListAddToCartResponseFromSubpath } from '@shop/contracts/saved-lists';

const uuid = '123e4567-e89b-42d3-a456-426614174000';

const addedOutcome = {
  itemId: '1',
  variantId: 1,
  sku: 'TM-0001-001',
  productId: '1',
  productName: 'Portland cement',
  savedQuantity: 4,
  submittedQuantity: 4,
  moqAdjusted: false,
  resolvedUnitPriceCents: 2500,
  status: 'added',
  reason: null,
} as const;

const skippedOutcome = {
  ...addedOutcome,
  itemId: '2',
  status: 'skipped',
  reason: 'VARIANT_RETIRED',
  submittedQuantity: null,
  resolvedUnitPriceCents: null,
} as const;

// @ts-expect-error Added outcomes cannot carry a skip reason.
const invalidAddedOutcome: SavedListLineOutcomeType = {
  ...addedOutcome,
  reason: 'INSUFFICIENT_STOCK',
};

// @ts-expect-error Skipped outcomes must carry a skip reason.
const invalidSkippedOutcome: SavedListLineOutcomeType = { ...skippedOutcome, reason: null };

void invalidAddedOutcome;
void invalidSkippedOutcome;

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
} satisfies SavedListAddToCartResponseFromRoot;

void test('saved list outcomes enforce status and reason pairings', () => {
  assert.equal(Value.Check(SavedListLineOutcome, addedOutcome), true);
  assert.equal(Value.Check(SavedListLineOutcome, skippedOutcome), true);
  assert.equal(
    Value.Check(SavedListLineOutcome, { ...addedOutcome, reason: 'INSUFFICIENT_STOCK' }),
    false,
  );
  assert.equal(Value.Check(SavedListLineOutcome, { ...skippedOutcome, reason: null }), false);
});

void test('saved list add-to-cart response closes cart properties', () => {
  assert.equal(Value.Check(SavedListAddToCartResponse, response), true);
  assert.equal(
    Value.Check(SavedListAddToCartResponse, {
      ...response,
      cart: { ...response.cart, unexpected: true },
    }),
    false,
  );
});

void test('saved list quantity and name bounds reject invalid input', () => {
  assert.equal(Value.Check(UpdateSavedListItemBody, { quantity: 0 }), false);
  assert.equal(Value.Check(CreateSavedListBody, { name: 'x'.repeat(81) }), false);
});

void test('saved list response types import through root and saved-lists subpath', () => {
  const rootConsumer: SavedListAddToCartResponseFromRoot = response;
  const subpathConsumer: SavedListAddToCartResponseFromSubpath = rootConsumer;
  assert.equal(subpathConsumer.outcomes.length, 2);
});
