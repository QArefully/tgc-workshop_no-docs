import assert from 'node:assert/strict';
import test from 'node:test';
import type { OrderLineItem } from '@shop/contracts/orders';
import type { BulkAddOutcome } from '../cart/cartBulkAddRules.js';
import { resolveUnitPriceCents } from '../pricing/pricingRules.js';
import {
  assembleReorderOutcomes,
  countReorderOutcomes,
  toBulkAddRequests,
} from './reorderRules.js';

const SACK_GRAMS = 25_000;

function orderLine(overrides: Partial<OrderLineItem> & { lineId: string }): OrderLineItem {
  const quantity = overrides.quantity ?? 4;
  const unitPriceCents = overrides.unitPriceCents ?? 1_000;
  return {
    productId: '9',
    productName: 'Portland Cement',
    unitPriceCents,
    quantity,
    discountableTotalCents: unitPriceCents * quantity,
    blendingFeeCents: 0,
    lineTotalCents: unitPriceCents * quantity,
    inventoryStatus: 'allocated',
    allocatedQuantity: quantity,
    backorderedQuantity: 0,
    variantSnapshot: {
      variantId: 41,
      sku: 'CEM-25',
      label: '25 kg sack',
      unitPriceCents,
      weightGrams: SACK_GRAMS,
      consumptionClassification: 'non-food',
      deliveryClass: 'freight',
    },
    ...overrides,
  };
}

function addedOutcome(key: string, resultingQuantity: number, price: number): BulkAddOutcome {
  return { key, status: 'added', resultingQuantity, resolvedUnitPriceCents: price };
}

void test('a line whose variant no longer resolves never reaches the cart', () => {
  const lines = [
    orderLine({ lineId: '1' }),
    orderLine({ lineId: '2', variantSnapshot: undefined }),
  ];

  const { requests, preSkips } = toBulkAddRequests(lines);

  assert.deepEqual(
    requests.map((request) => request.key),
    ['1'],
  );
  assert.deepEqual([...preSkips], [['2', 'VARIANT_UNRESOLVED']]);

  const outcomes = assembleReorderOutcomes(
    lines,
    [addedOutcome('1', 4, 1_000)],
    new Map([
      ['1', 1_000],
      ['2', null],
    ]),
  );
  assert.equal(outcomes[1]!.status, 'skipped');
  assert.equal(outcomes[1]!.reason, 'VARIANT_UNRESOLVED');
  assert.equal(outcomes[1]!.variantId, null);
  assert.equal(outcomes[1]!.currentUnitPriceCents, null);
  assert.equal(outcomes[1]!.priceChanged, false);
});

void test('an unusable ordered quantity is guarded before demand aggregation', () => {
  const lines = [orderLine({ lineId: '1', quantity: 0 }), orderLine({ lineId: '2', quantity: 4 })];

  const { requests, preSkips } = toBulkAddRequests(lines);

  assert.deepEqual(
    requests.map((request) => request.quantity),
    [4],
  );
  assert.equal(preSkips.get('1'), 'INVALID_QUANTITY');
});

void test('duplicate source lines each receive the fanned-out group outcome', () => {
  const lines = [orderLine({ lineId: '1', quantity: 4 }), orderLine({ lineId: '2', quantity: 6 })];

  const { requests } = toBulkAddRequests(lines);
  assert.deepEqual(
    requests.map((request) => [request.key, request.variantId, request.quantity]),
    [
      ['1', 41, 4],
      ['2', 41, 6],
    ],
  );

  // The cart judges the combined demand once and fans the same verdict back to both keys.
  const outcomes = assembleReorderOutcomes(
    lines,
    [addedOutcome('1', 10, 950), addedOutcome('2', 10, 950)],
    new Map([
      ['1', 950],
      ['2', 950],
    ]),
  );

  assert.deepEqual(
    outcomes.map((outcome) => [outcome.orderLineItemId, outcome.status, outcome.reason]),
    [
      ['1', 'added', null],
      ['2', 'added', null],
    ],
  );
  assert.deepEqual(countReorderOutcomes(outcomes), { addedLineCount: 2, skippedLineCount: 0 });
});

void test('price drift is reported only when the current price differs', () => {
  const lines = [
    orderLine({ lineId: '1', unitPriceCents: 1_000 }),
    orderLine({ lineId: '2', unitPriceCents: 1_000 }),
  ];

  const outcomes = assembleReorderOutcomes(
    lines,
    [addedOutcome('1', 4, 1_000), addedOutcome('2', 4, 1_150)],
    new Map([
      ['1', 1_000],
      ['2', 1_150],
    ]),
  );

  assert.equal(outcomes[0]!.priceChanged, false, 'exact equality is not drift');
  assert.equal(outcomes[1]!.priceChanged, true);
  assert.equal(outcomes[1]!.currentUnitPriceCents, 1_150);
  assert.equal(outcomes[1]!.orderedUnitPriceCents, 1_000);
});

void test('drift surfaces when the resulting quantity crosses a tier boundary', () => {
  // 40 sacks = 1 t. The order bought 120 sacks (3 t, no discount); the cart already holds 100
  // sacks of the same variant, so the post-add line sits at 220 sacks (5.5 t) and earns 5%.
  const orderedQuantity = 120;
  const resultingQuantity = 220;
  const basePriceCents = 1_000;
  const orderedUnitPriceCents = resolveUnitPriceCents(basePriceCents, orderedQuantity, SACK_GRAMS);
  const currentUnitPriceCents = resolveUnitPriceCents(
    basePriceCents,
    resultingQuantity,
    SACK_GRAMS,
  );
  assert.equal(orderedUnitPriceCents, 1_000);
  assert.equal(currentUnitPriceCents, 950);

  const lines = [
    orderLine({ lineId: '1', quantity: orderedQuantity, unitPriceCents: orderedUnitPriceCents }),
  ];
  const outcomes = assembleReorderOutcomes(
    lines,
    [addedOutcome('1', resultingQuantity, currentUnitPriceCents)],
    new Map([['1', currentUnitPriceCents]]),
  );

  assert.equal(outcomes[0]!.status, 'added');
  assert.equal(outcomes[0]!.priceChanged, true);
  assert.equal(outcomes[0]!.currentUnitPriceCents, 950);
});

void test('an all-skipped reorder counts every line as skipped', () => {
  const lines = [
    orderLine({ lineId: '1' }),
    orderLine({ lineId: '2' }),
    orderLine({ lineId: '3', variantSnapshot: undefined }),
  ];

  const outcomes = assembleReorderOutcomes(
    lines,
    [
      { key: '1', status: 'skipped', reason: 'VARIANT_RETIRED' },
      { key: '2', status: 'skipped', reason: 'BELOW_MOQ' },
    ],
    new Map([
      ['1', null],
      ['2', 1_000],
    ]),
  );

  assert.deepEqual(
    outcomes.map((outcome) => outcome.reason),
    ['VARIANT_RETIRED', 'BELOW_MOQ', 'VARIANT_UNRESOLVED'],
  );
  assert.deepEqual(countReorderOutcomes(outcomes), { addedLineCount: 0, skippedLineCount: 3 });
  // A sub-MOQ line is skipped, never rounded up to the MOQ floor, so its quantity is untouched.
  assert.equal(outcomes[1]!.quantity, 4);
});

void test('reorder preserves the cart country-blocking precedence verdict', () => {
  const outcomes = assembleReorderOutcomes(
    [orderLine({ lineId: '1' })],
    [{ key: '1', status: 'skipped', reason: 'BLOCKED_IN_COUNTRY' }],
    new Map([['1', null]]),
  );

  assert.equal(outcomes[0]?.reason, 'BLOCKED_IN_COUNTRY');
});

void test('a submitted line without a cart outcome is an invariant breach', () => {
  assert.throws(
    () => assembleReorderOutcomes([orderLine({ lineId: '1' })], [], new Map()),
    /no cart outcome/,
  );
});
