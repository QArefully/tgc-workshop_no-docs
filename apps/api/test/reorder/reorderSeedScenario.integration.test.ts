import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import { CreateCartResponse } from '@shop/contracts/cart';
import { ReorderResponse } from '@shop/contracts/reorder';
import { buildApp } from '../../src/app.js';
import { createSeededFixture } from '../support/seededDatabase.js';

/**
 * The seeded `alice-reorder-mix` order is the demo fixture for Buy again. This suite asserts the
 * fixture still produces the mixed outcome it exists to produce, against the real seed rather than
 * against lots the test pinned itself.
 */

/** Inside the seeded clearance window on `GDN-1043-001` (2026-07-21 .. 2026-08-04). */
const NOW = new Date('2026-07-31T12:00:00.000Z');
const ALICE = 'alice@example.com';
const SCENARIO_KEY = 'alice-reorder-mix';

type App = Awaited<ReturnType<typeof buildApp>>;

function cookieValue(response: { headers: Record<string, string | string[] | undefined> }): string {
  const header = response.headers['set-cookie'];
  const cookie = Array.isArray(header) ? header[0] : header;
  if (!cookie) throw new Error('Expected set-cookie header');
  return cookie.split(';', 1)[0]!;
}

async function login(app: App, email: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/login',
    payload: { email, password: 'Password123!', country: 'UK' },
  });
  assert.equal(response.statusCode, 200);
  return cookieValue(response);
}

void test('the seeded buy-again order reorders into a mixed added/skipped result', async (t) => {
  const { db, app } = await createSeededFixture({
    testContext: t,
    app: { clock: { now: () => NOW } },
  });

  const orderId = Number(
    db.prepare('SELECT id FROM orders WHERE demo_seed_key = ?').pluck().get(SCENARIO_KEY),
  );
  assert.ok(Number.isSafeInteger(orderId) && orderId > 0, 'seed must install the buy-again order');

  const cookie = await login(app, ALICE);
  const created = await app.inject({ method: 'POST', url: '/api/cart' });
  const cartId = Value.Parse(CreateCartResponse, created.json()).cartId;

  const response = await app.inject({
    method: 'POST',
    url: `/api/orders/${orderId}/reorder`,
    headers: { cookie },
    payload: { cartId },
  });
  assert.equal(response.statusCode, 200, response.body);
  const body: unknown = response.json();
  if (!Value.Check(ReorderResponse, body)) {
    const first = [...Value.Errors(ReorderResponse, body)][0];
    assert.fail(`ReorderResponse violation at ${first?.path ?? '/'}: ${first?.message ?? '?'}`);
  }

  // Mixed by construction: neither bucket may be empty, or the fixture has stopped teaching
  // anything about partial reorder success.
  assert.ok(body.addedLineCount > 0, 'expected at least one added line');
  assert.ok(body.skippedLineCount > 0, 'expected at least one skipped line');
  assert.equal(body.addedLineCount + body.skippedLineCount, body.outcomes.length);

  const added = body.outcomes.filter((outcome) => outcome.status === 'added');
  const shortOfStock = body.outcomes.filter((outcome) => outcome.reason === 'INSUFFICIENT_STOCK');
  const drifted = body.outcomes.filter((outcome) => outcome.priceChanged);
  assert.ok(added.length >= 1, 'expected at least one added outcome');
  assert.equal(shortOfStock.length, 1, 'expected exactly one out-of-stock skip');
  assert.equal(shortOfStock[0]?.status, 'skipped');
  assert.equal(drifted.length, 1, 'expected exactly one drifted line');

  // Drift is server-resolved, not echoed: the current price must genuinely differ from the price
  // frozen on the order line.
  const drift = drifted[0]!;
  assert.equal(drift.sku, 'GDN-1043-001');
  assert.equal(drift.status, 'added');
  assert.ok(
    typeof drift.currentUnitPriceCents === 'number',
    'a drifted line must carry a current price',
  );
  assert.notEqual(drift.currentUnitPriceCents, drift.orderedUnitPriceCents);
  assert.ok(
    drift.currentUnitPriceCents < drift.orderedUnitPriceCents,
    'the seeded clearance window prices below the frozen list price',
  );

  // Every added line really landed in the cart, at exactly the quantity that was ordered.
  assert.deepEqual(
    (
      db
        .prepare(
          'SELECT variant_id, quantity FROM cart_line_items WHERE cart_id = ? ORDER BY variant_id',
        )
        .all(cartId) as Array<{ variant_id: number; quantity: number }>
    ).map((row) => [row.variant_id, row.quantity]),
    added
      .map((outcome) => [outcome.variantId, outcome.quantity])
      .sort((left, right) => Number(left[0]) - Number(right[0])),
  );
  assert.equal(
    body.cart.totalItems,
    added.reduce((total, outcome) => total + outcome.quantity, 0),
  );
});
