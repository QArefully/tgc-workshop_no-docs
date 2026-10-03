import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aggregateInventoryDemand,
  isPreparedReservationExpired,
  splitInventoryReservation,
} from './inventoryRules.js';

void test('backorderable demand reserves available stock and backorders the remainder', () => {
  const split = splitInventoryReservation(
    [
      { variantId: 2, quantity: 3 },
      { variantId: 2, quantity: 2 },
    ],
    [
      {
        variantId: 2,
        stockCount: 4,
        availableToSell: 4,
        backorderable: true,
        backorderLeadDays: 14,
      },
    ],
  );
  assert.deepEqual(split, [
    {
      variantId: 2,
      quantity: 5,
      reservedQuantity: 4,
      backorderedQuantity: 1,
    },
  ]);
});

void test('non-backorderable demand beyond availability is rejected outright', () => {
  assert.throws(
    () =>
      splitInventoryReservation(
        [{ variantId: 7, quantity: 3 }],
        [
          {
            variantId: 7,
            stockCount: 2,
            availableToSell: 2,
            backorderable: false,
            backorderLeadDays: null,
          },
        ],
      ),
    /insufficient stock/i,
  );
});

void test('demand ordering and expiry boundary are deterministic', () => {
  assert.deepEqual(
    aggregateInventoryDemand([
      { variantId: 3, quantity: 1 },
      { variantId: 2, quantity: 1 },
      { variantId: 3, quantity: 2 },
    ]),
    [
      { variantId: 2, quantity: 1 },
      { variantId: 3, quantity: 3 },
    ],
  );
  assert.equal(
    isPreparedReservationExpired('2026-07-19T12:00:00.000Z', '2026-07-19T12:00:00.000Z'),
    true,
  );
});
