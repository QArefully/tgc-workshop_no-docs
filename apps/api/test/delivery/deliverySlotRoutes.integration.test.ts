import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import { DeliverySlotOptionsResponse } from '@shop/contracts/delivery';
import { openDatabase } from '../../src/db/index.js';
import { createSeededAppFixture } from '../support/seededDatabase.js';

/** Fixed instant so lead time and the offered slot window are deterministic. */
const CLOCK = { now: () => new Date('2026-07-27T09:00:00.000Z') };

function firstActiveVariantId(db: ReturnType<typeof openDatabase>, productId: number): number {
  const row = db
    .prepare(
      'SELECT id FROM product_variants WHERE product_id = ? AND active = 1 ORDER BY sort_order LIMIT 1',
    )
    .get(productId) as { id: number } | undefined;
  if (!row) throw new Error(`Expected an active variant for product ${productId}`);
  return row.id;
}

void test('delivery slot routes', async (t) => {
  const fixture = await createSeededAppFixture({
    testContext: t,
    app: { clock: CLOCK },
  });
  const { db, app } = fixture;

  /** Creates a cart holding one seeded freight line. */
  const createStockedCart = async (): Promise<string> => {
    const created = await app.inject({ method: 'POST', url: '/api/cart' });
    assert.equal(created.statusCode, 201);
    const { cartId }: { cartId: string } = created.json();
    const added = await app.inject({
      method: 'POST',
      url: `/api/cart/${cartId}/items`,
      payload: { productId: '1', variantId: firstActiveVariantId(db, 1) },
    });
    assert.equal(added.statusCode, 200);
    return cartId;
  };

  await t.test('returns lead time and bookable slots for an existing cart', async () => {
    const cartId = await createStockedCart();

    const response = await app.inject({
      method: 'GET',
      url: `/api/delivery/slots?cartId=${cartId}`,
    });
    assert.equal(response.statusCode, 200);

    const body: unknown = response.json();
    assert.ok(
      Value.Check(DeliverySlotOptionsResponse, body),
      'response must satisfy DeliverySlotOptionsResponse',
    );
    assert.ok(body.slots.length > 0, 'a stocked cart has bookable slots');
    assert.ok(body.leadTime.businessDays >= 1);
    assert.ok(body.leadTime.reason.length > 0);
    assert.equal(body.delivery.mode, 'freight', 'seeded sacks are freight class');

    // Every offered slot falls inside the advertised window, in ascending order.
    const dates = body.slots.map((slot) => slot.date);
    assert.deepEqual([...dates].sort(), dates, 'slots are ordered by date');
    for (const slot of body.slots) {
      assert.ok(
        slot.date >= body.leadTime.earliestDate,
        `${slot.date} is not before the lead time`,
      );
      assert.ok(slot.date <= body.leadTime.latestDate, `${slot.date} is inside the horizon`);
    }

    // Route is deliberately unauthenticated: the cart id is the only capability needed.
    const repeated = await app.inject({
      method: 'GET',
      url: `/api/delivery/slots?cartId=${cartId}`,
    });
    assert.equal(repeated.statusCode, 200);
    assert.deepEqual(repeated.json(), body, 'a fixed clock yields a stable answer');
  });

  await t.test('quotes an empty cart without failing', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/cart' });
    const { cartId }: { cartId: string } = created.json();

    const response = await app.inject({
      method: 'GET',
      url: `/api/delivery/slots?cartId=${cartId}`,
    });
    assert.equal(response.statusCode, 200);
    const body: unknown = response.json();
    assert.ok(Value.Check(DeliverySlotOptionsResponse, body));
    assert.equal(body.delivery.weightGrams, 0);
  });

  await t.test('unknown cart is 404 and malformed cart id is 400', async () => {
    const unknown = await app.inject({
      method: 'GET',
      url: `/api/delivery/slots?cartId=${randomUUID()}`,
    });
    assert.equal(unknown.statusCode, 404);
    const body: { error: string; code: string } = unknown.json();
    assert.deepEqual(body, { error: 'The cart was not found.', code: 'CART_NOT_FOUND' });
    assert.ok(!/\.ts:\d+/.test(body.error), 'no source location leaks into the 404');

    assert.equal(
      (await app.inject({ method: 'GET', url: '/api/delivery/slots?cartId=not-a-uuid' }))
        .statusCode,
      400,
    );
    assert.equal(
      (await app.inject({ method: 'GET', url: '/api/delivery/slots' })).statusCode,
      400,
      'cartId is required',
    );
  });
});
