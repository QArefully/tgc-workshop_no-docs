import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BACK_IN_STOCK_SUBSCRIPTION_LIMIT,
  backInStockJobDedupeKey,
  backInStockNotificationCopy,
  isNotifiable,
} from './backInStockRules.js';

void test('treats a lot as notifiable only at or above the minimum order quantity', () => {
  assert.equal(isNotifiable(3, 4), false);
  assert.equal(isNotifiable(4, 4), true);
  assert.equal(isNotifiable(5, 4), true);
  assert.equal(isNotifiable(0, 1), false);
  assert.equal(isNotifiable(1, 1), true);
});

void test('rejects unusable availability or MOQ figures rather than guessing', () => {
  assert.equal(isNotifiable(-1, 1), false);
  assert.equal(isNotifiable(1.5, 1), false);
  assert.equal(isNotifiable(10, 0), false);
  assert.equal(isNotifiable(10, -4), false);
  assert.equal(isNotifiable(Number.NaN, 1), false);
});

void test('builds a deterministic dedupe key per variant and instant', () => {
  assert.equal(
    backInStockJobDedupeKey(7, '2026-08-02T09:30:00.000Z'),
    'back-in-stock:7:2026-08-02T09:30:00.000Z',
  );
  assert.equal(
    backInStockJobDedupeKey(7, '2026-08-02T09:30:00.000Z'),
    backInStockJobDedupeKey(7, '2026-08-02T09:30:00.000Z'),
  );
  assert.notEqual(
    backInStockJobDedupeKey(7, '2026-08-02T09:30:00.000Z'),
    backInStockJobDedupeKey(8, '2026-08-02T09:30:00.000Z'),
  );
  assert.notEqual(
    backInStockJobDedupeKey(7, '2026-08-02T09:30:00.000Z'),
    backInStockJobDedupeKey(7, '2026-08-02T09:30:01.000Z'),
  );
});

void test('builds buyer-facing restock copy from catalog facts', () => {
  assert.deepEqual(backInStockNotificationCopy('Portland Cement', '25 kg sack'), {
    title: 'Back in stock: Portland Cement',
    body: 'Portland Cement (25 kg sack) is available to order again.',
  });
});

void test('publishes a bounded pending-subscription ceiling', () => {
  assert.equal(Number.isSafeInteger(BACK_IN_STOCK_SUBSCRIPTION_LIMIT), true);
  assert.equal(BACK_IN_STOCK_SUBSCRIPTION_LIMIT > 0, true);
});
