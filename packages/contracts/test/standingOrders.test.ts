import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import type { StandingOrderRunListResponse as RootRunList } from '@shop/contracts';
import type { StandingOrderRunListResponse as SubpathRunList } from '@shop/contracts/standing-orders';

const runs = [
  {
    id: '1',
    standingOrderId: '1',
    jobId: '2',
    cartId: '123e4567-e89b-42d3-a456-426614174000',
    runAt: '2026-08-01T12:00:00.000Z',
    status: 'completed',
    addedLineCount: 1,
    skippedLineCount: 0,
    outcomes: [
      {
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
        currentUnitPriceCents: 2500,
        priceChanged: false,
      },
    ],
    failureReason: null,
  },
] satisfies RootRunList;

void test('standing-order contracts reuse outcomes, close request bodies, and preserve root/subpath identity', async () => {
  const root = await import('@shop/contracts');
  const subpath = await import('@shop/contracts/standing-orders');

  assert.strictEqual(root.StandingOrderRunListResponse, subpath.StandingOrderRunListResponse);
  const subpathRuns: SubpathRunList = runs;
  assert.equal(subpathRuns[0]?.outcomes?.length, 1);
  assert.equal(Value.Check(root.StandingOrderRunListResponse, runs), true);
  assert.equal(
    Value.Check(root.CreateStandingOrderBody, {
      name: 'Monthly cement',
      source: { kind: 'saved_list', listId: '1' },
      cadence: 'monthly',
      unexpected: true,
    }),
    false,
  );
});
