import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import { BackInStockSubscription, CreateBackInStockSubscriptionBody } from '../src/backInStock.js';
import { NotificationKind } from '../src/notifications.js';
import { JobKind } from '../src/jobs.js';
import type { BackInStockSubscription as BackInStockSubscriptionFromRoot } from '@shop/contracts';
import type { BackInStockSubscription as BackInStockSubscriptionFromSubpath } from '@shop/contracts/back-in-stock';

const subscription = {
  subscriptionId: '1',
  variantId: 42,
  productId: 'portland-cement',
  sku: 'TM-0001-001',
  productName: 'Portland cement',
  variantLabel: '25 kg sack',
  status: 'pending',
  requestedAt: '2026-08-02T09:15:30.000Z',
  notifiedAt: null,
  minimumOrderQuantity: 4,
} satisfies BackInStockSubscriptionFromRoot;

// @ts-expect-error Subscription status is a closed union.
const invalidStatus: BackInStockSubscriptionFromRoot = { ...subscription, status: 'waiting' };
void invalidStatus;

void test('back-in-stock subscription parses round-trip', () => {
  const parsed = Value.Parse(BackInStockSubscription, subscription);
  assert.deepEqual(parsed, subscription);
});

void test('back-in-stock subscription rejects unknown status and extra properties', () => {
  assert.equal(Value.Check(BackInStockSubscription, { ...subscription, status: 'waiting' }), false);
  assert.equal(Value.Check(BackInStockSubscription, { ...subscription, unexpected: true }), false);
  assert.equal(Value.Check(CreateBackInStockSubscriptionBody, { variantId: 0 }), false);
  assert.equal(
    Value.Check(CreateBackInStockSubscriptionBody, { variantId: 1, unexpected: true }),
    false,
  );
});

void test('back-in-stock extends the notification and job kind unions', () => {
  assert.equal(Value.Check(NotificationKind, 'back_in_stock.available'), true);
  assert.equal(Value.Check(JobKind, 'back_in_stock.notify'), true);
});

void test('back-in-stock types import through root and back-in-stock subpath', () => {
  const rootConsumer: BackInStockSubscriptionFromRoot = subscription;
  const subpathConsumer: BackInStockSubscriptionFromSubpath = rootConsumer;
  assert.equal(subpathConsumer.status, 'pending');
});
