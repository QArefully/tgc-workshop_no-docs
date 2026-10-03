import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import {
  Cart,
  CreateCartResponse as CreateCartResponseSchema,
  type CreateCartResponse,
} from '@shop/contracts/cart';
import { SavedListAddToCartResponse, SavedListsResponse } from '@shop/contracts/saved-lists';
import { buildApp } from '../../src/app.js';
import { createSeededFixture } from '../support/seededDatabase.js';

function cookie(response: { headers: Record<string, string | string[] | undefined> }): string {
  const value = response.headers['set-cookie'];
  const header = Array.isArray(value) ? value[0] : value;
  if (!header) throw new Error('Expected session cookie');
  return header.split(';', 1)[0]!;
}

async function login(app: Awaited<ReturnType<typeof buildApp>>, email: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/login',
    payload: { email, password: 'Password123!', country: 'UK' },
  });
  assert.equal(response.statusCode, 200, response.body);
  return cookie(response);
}

async function createCart(app: Awaited<ReturnType<typeof buildApp>>): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/cart' });
  assert.equal(response.statusCode, 201, response.body);
  const cart: CreateCartResponse = Value.Parse(CreateCartResponseSchema, response.json());
  return cart.cartId;
}

void test('seeded Monthly restock exposes exact outcomes and repeated cart accumulation', async (t) => {
  const { app } = await createSeededFixture(t);

  const alice = await login(app, 'alice@example.com');
  const lists = Value.Parse(
    SavedListsResponse,
    (
      await app.inject({ method: 'GET', url: '/api/saved-lists', headers: { cookie: alice } })
    ).json(),
  );
  const monthly = lists.find((list) => list.name === 'Monthly restock');
  assert.ok(monthly);
  const cartId = await createCart(app);
  const first = await app.inject({
    method: 'POST',
    url: `/api/saved-lists/${monthly.listId}/add-to-cart`,
    headers: { cookie: alice },
    payload: { cartId },
  });
  assert.equal(first.statusCode, 200, first.body);
  const firstBody = Value.Parse(SavedListAddToCartResponse, first.json());
  assert.equal(firstBody.addedLineCount, 2);
  assert.equal(firstBody.skippedLineCount, 2);
  assert.deepEqual(
    firstBody.outcomes.map((outcome) => ({
      sku: outcome.sku,
      status: outcome.status,
      reason: outcome.reason,
      savedQuantity: outcome.savedQuantity,
      submittedQuantity: outcome.submittedQuantity,
      moqAdjusted: outcome.moqAdjusted,
    })),
    [
      {
        sku: 'SPN-1007-001',
        status: 'skipped',
        reason: 'INSUFFICIENT_STOCK',
        savedQuantity: 20,
        submittedQuantity: 20,
        moqAdjusted: false,
      },
      {
        sku: 'SPN-0009-002',
        status: 'skipped',
        reason: 'VARIANT_RETIRED',
        savedQuantity: 4,
        submittedQuantity: null,
        moqAdjusted: false,
      },
      {
        sku: 'SPN-0008-001',
        status: 'added',
        reason: null,
        savedQuantity: 1,
        submittedQuantity: 4,
        moqAdjusted: true,
      },
      {
        sku: 'GDN-1043-001',
        status: 'added',
        reason: null,
        savedQuantity: 4,
        submittedQuantity: 4,
        moqAdjusted: false,
      },
    ],
  );
  for (const outcome of firstBody.outcomes.filter((outcome) => outcome.status === 'added'))
    assert.notEqual(outcome.resolvedUnitPriceCents, null);
  assert.equal(firstBody.cart.items.length, 2);

  const second = Value.Parse(
    SavedListAddToCartResponse,
    (
      await app.inject({
        method: 'POST',
        url: `/api/saved-lists/${monthly.listId}/add-to-cart`,
        headers: { cookie: alice },
        payload: { cartId },
      })
    ).json(),
  );
  assert.equal(second.cart.items.length, 2);
  for (const outcome of second.outcomes.filter((outcome) => outcome.status === 'added')) {
    const original = firstBody.outcomes.find((entry) => entry.itemId === outcome.itemId)!;
    assert.equal(
      outcome.resolvedUnitPriceCents,
      second.cart.items.find((item) => item.variantSnap?.variantId === outcome.variantId)!
        .resolvedUnitPriceCents,
    );
    assert.equal(outcome.submittedQuantity, original.submittedQuantity);
  }
  const persisted = Value.Parse(
    Cart,
    (await app.inject({ method: 'GET', url: `/api/cart/${cartId}` })).json(),
  );
  assert.deepEqual(
    persisted.items.map((item) => item.quantity).sort((a, b) => a - b),
    [8, 8],
  );
});

void test('saved-list add-to-cart preserves missing and reserved carts and is customer-only', async (t) => {
  const { db, app } = await createSeededFixture(t);

  const alice = await login(app, 'alice@example.com');
  const admin = await login(app, 'admin@example.com');
  const monthly = Value.Parse(
    SavedListsResponse,
    (
      await app.inject({ method: 'GET', url: '/api/saved-lists', headers: { cookie: alice } })
    ).json(),
  ).find((list) => list.name === 'Monthly restock');
  assert.ok(monthly);
  const missing = await app.inject({
    method: 'POST',
    url: `/api/saved-lists/${monthly.listId}/add-to-cart`,
    headers: { cookie: alice },
    payload: { cartId: '00000000-0000-4000-8000-000000000000' },
  });
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json<{ code: string }>().code, 'CART_NOT_FOUND');

  const cartId = await createCart(app);
  db.prepare(
    `INSERT INTO payments (idempotency_key, request_fingerprint, status, amount_cents, card_last4, card_brand, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'saved-list-route-reservation',
    'saved-list-route-test',
    'prepared',
    1,
    '1111',
    'Visa',
    '2026-08-01T12:00:00.000Z',
  );
  db.prepare(
    'INSERT INTO cart_reservations (cart_id, payment_idempotency_key, created_at) VALUES (?, ?, ?)',
  ).run(cartId, 'saved-list-route-reservation', '2026-08-01T12:00:00.000Z');
  const before = Value.Parse(
    Cart,
    (await app.inject({ method: 'GET', url: `/api/cart/${cartId}` })).json(),
  );
  const reserved = await app.inject({
    method: 'POST',
    url: `/api/saved-lists/${monthly.listId}/add-to-cart`,
    headers: { cookie: alice },
    payload: { cartId },
  });
  assert.equal(reserved.statusCode, 409);
  assert.equal(reserved.json<{ code: string }>().code, 'CART_RESERVED');
  assert.deepEqual(
    Value.Parse(Cart, (await app.inject({ method: 'GET', url: `/api/cart/${cartId}` })).json()),
    before,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: `/api/saved-lists/${monthly.listId}/add-to-cart`,
        headers: { cookie: admin },
        payload: { cartId },
      })
    ).statusCode,
    403,
  );
});
