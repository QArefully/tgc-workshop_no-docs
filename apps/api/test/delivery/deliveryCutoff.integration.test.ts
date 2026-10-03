import assert from 'node:assert/strict';
import test from 'node:test';
import type { Country } from '@shop/contracts/country';
import type { DeliverySlotOptionsResponse } from '@shop/contracts/delivery';
import { createSeededAppFixture } from '../support/seededDatabase.js';

const NOW = new Date('2026-07-20T15:30:00.000Z');

void test('delivery cut-off uses each cart persisted country at one instant', async (t) => {
  const fixture = await createSeededAppFixture({
    testContext: t,
    app: {
      resetBaseUrl: 'http://web.example.test/',
      clock: { now: () => NOW },
    },
  });
  const { db, app } = fixture;

  const slotsFor = async (country: Country): Promise<DeliverySlotOptionsResponse> => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/cart',
      payload: { country },
    });
    assert.equal(created.statusCode, 201);
    const { cartId } = created.json<{ cartId: string }>();
    assert.equal(db.prepare('SELECT country FROM carts WHERE id = ?').pluck().get(cartId), country);

    const response = await app.inject({
      method: 'GET',
      url: `/api/delivery/slots?cartId=${cartId}`,
      headers: { 'x-shop-country': 'CN' },
    });
    assert.equal(response.statusCode, 200);
    return response.json<DeliverySlotOptionsResponse>();
  };

  const uk = await slotsFor('UK');
  const us = await slotsFor('US');

  assert.equal(uk.leadTime.earliestDate, '2026-07-22');
  assert.equal(us.leadTime.earliestDate, '2026-07-21');
  assert.equal(uk.slots[0]?.date, uk.leadTime.earliestDate);
  assert.equal(us.slots[0]?.date, us.leadTime.earliestDate);
  assert.notEqual(uk.leadTime.earliestDate, us.leadTime.earliestDate);
});
