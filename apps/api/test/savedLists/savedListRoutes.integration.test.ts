import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import {
  CreateCartResponse as CreateCartResponseSchema,
  type CreateCartResponse,
} from '@shop/contracts/cart';
import { SavedListDetail, SavedListsResponse } from '@shop/contracts/saved-lists';
import { buildApp } from '../../src/app.js';
import { createSeededFixture } from '../support/seededDatabase.js';

function cookie(response: { headers: Record<string, string | string[] | undefined> }): string {
  const value = response.headers['set-cookie'];
  const header = Array.isArray(value) ? value[0] : value;
  if (!header) throw new Error('Expected session cookie');
  return header.split(';', 1)[0]!;
}

async function signup(app: Awaited<ReturnType<typeof buildApp>>, email: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/signup',
    payload: { email, password: 'password-one', displayName: 'Buyer', country: 'UK' },
  });
  assert.equal(response.statusCode, 201, response.body);
  return cookie(response);
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

void test('saved-list routes require auth and preserve CRUD ownership boundaries', async (t) => {
  const { db, app } = await createSeededFixture(t);

  const anonymous = [
    { method: 'GET' as const, url: '/api/saved-lists' },
    { method: 'POST' as const, url: '/api/saved-lists', payload: { name: 'A' } },
    { method: 'GET' as const, url: '/api/saved-lists/1' },
    { method: 'PATCH' as const, url: '/api/saved-lists/1', payload: { name: 'A' } },
    { method: 'DELETE' as const, url: '/api/saved-lists/1' },
    {
      method: 'POST' as const,
      url: '/api/saved-lists/1/items',
      payload: { variantId: 1, quantity: 1 },
    },
    { method: 'PATCH' as const, url: '/api/saved-lists/1/items/1', payload: { quantity: 1 } },
    { method: 'DELETE' as const, url: '/api/saved-lists/1/items/1' },
    {
      method: 'POST' as const,
      url: '/api/saved-lists/1/add-to-cart',
      payload: { cartId: '00000000-0000-4000-8000-000000000000' },
    },
    {
      method: 'POST' as const,
      url: '/api/saved-lists/from-cart',
      payload: { name: 'A', cartId: '00000000-0000-4000-8000-000000000000' },
    },
    { method: 'POST' as const, url: '/api/saved-lists/from-order/1', payload: { name: 'A' } },
  ];
  for (const request of anonymous) assert.equal((await app.inject(request)).statusCode, 401);

  const owner = await signup(app, 'saved-routes-owner@example.test');
  const other = await signup(app, 'saved-routes-other@example.test');
  const createdResponse = await app.inject({
    method: 'POST',
    url: '/api/saved-lists',
    headers: { cookie: owner },
    payload: { name: 'Monthly restock' },
  });
  assert.equal(createdResponse.statusCode, 201, createdResponse.body);
  const created = Value.Parse(SavedListDetail, createdResponse.json());
  const listId = created.listId;
  const listed = await app.inject({
    method: 'GET',
    url: '/api/saved-lists',
    headers: { cookie: owner },
  });
  assert.equal(listed.statusCode, 200, listed.body);
  Value.Parse(SavedListsResponse, listed.json());

  for (const request of [
    { method: 'GET' as const, url: `/api/saved-lists/${listId}` },
    { method: 'PATCH' as const, url: `/api/saved-lists/${listId}`, payload: { name: 'Nope' } },
    { method: 'DELETE' as const, url: `/api/saved-lists/${listId}` },
    {
      method: 'POST' as const,
      url: `/api/saved-lists/${listId}/items`,
      payload: { variantId: 1, quantity: 1 },
    },
    {
      method: 'PATCH' as const,
      url: `/api/saved-lists/${listId}/items/1`,
      payload: { quantity: 2 },
    },
    { method: 'DELETE' as const, url: `/api/saved-lists/${listId}/items/1` },
  ])
    assert.equal((await app.inject({ ...request, headers: { cookie: other } })).statusCode, 404);

  const variantId = (
    db.prepare('SELECT id FROM product_variants WHERE active = 1 ORDER BY id LIMIT 1').get() as {
      id: number;
    }
  ).id;
  const added = await app.inject({
    method: 'POST',
    url: `/api/saved-lists/${listId}/items`,
    headers: { cookie: owner },
    payload: { variantId, quantity: 4 },
  });
  assert.equal(added.statusCode, 200, added.body);
  const withItem = Value.Parse(SavedListDetail, added.json());
  const itemId = withItem.items[0]!.itemId;
  const renamed = await app.inject({
    method: 'PATCH',
    url: `/api/saved-lists/${listId}`,
    headers: { cookie: owner },
    payload: { name: 'Renamed list' },
  });
  assert.equal(Value.Parse(SavedListDetail, renamed.json()).name, 'Renamed list');
  const updated = await app.inject({
    method: 'PATCH',
    url: `/api/saved-lists/${listId}/items/${itemId}`,
    headers: { cookie: owner },
    payload: { quantity: 8 },
  });
  assert.equal(Value.Parse(SavedListDetail, updated.json()).items[0]!.quantity, 8);
  assert.equal(
    (
      await app.inject({
        method: 'DELETE',
        url: `/api/saved-lists/${listId}/items/${itemId}`,
        headers: { cookie: owner },
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await app.inject({
        method: 'DELETE',
        url: `/api/saved-lists/${listId}`,
        headers: { cookie: owner },
      })
    ).statusCode,
    200,
  );
});

void test('saved-list routes expose caps, default protection, and cart/order source statuses', async (t) => {
  const { db, app } = await createSeededFixture(t);

  const alice = await login(app, 'alice@example.com');
  const aliceLists = Value.Parse(
    SavedListsResponse,
    (
      await app.inject({ method: 'GET', url: '/api/saved-lists', headers: { cookie: alice } })
    ).json(),
  );
  const defaultList = aliceLists.find((list) => list.isDefault);
  assert.ok(defaultList);
  assert.equal(
    (
      await app.inject({
        method: 'DELETE',
        url: `/api/saved-lists/${defaultList.listId}`,
        headers: { cookie: alice },
      })
    ).statusCode,
    409,
  );

  const emptyCart = await createCart(app);
  const empty = await app.inject({
    method: 'POST',
    url: '/api/saved-lists/from-cart',
    headers: { cookie: alice },
    payload: { name: 'Empty cart', cartId: emptyCart },
  });
  assert.equal(empty.json<{ code: string }>().code, 'CART_EMPTY');
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/saved-lists/from-cart',
        headers: { cookie: alice },
        payload: { name: 'Missing', cartId: '00000000-0000-4000-8000-000000000000' },
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/saved-lists/from-order/999999',
        headers: { cookie: alice },
        payload: { name: 'Missing order' },
      })
    ).statusCode,
    404,
  );
  const ownOrderId = db
    .prepare('SELECT id FROM orders WHERE user_id = 1 ORDER BY id LIMIT 1')
    .pluck()
    .get() as number;
  const fromOrder = await app.inject({
    method: 'POST',
    url: `/api/saved-lists/from-order/${ownOrderId}`,
    headers: { cookie: alice },
    payload: { name: 'Order copy' },
  });
  assert.equal(fromOrder.statusCode, 201, fromOrder.body);
  Value.Parse(SavedListDetail, fromOrder.json());

  const capped = await signup(app, 'saved-routes-capped@example.test');
  for (let index = 0; index < 25; index += 1) {
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/saved-lists',
          headers: { cookie: capped },
          payload: { name: `List ${index}` },
        })
      ).statusCode,
      201,
    );
  }
  const listLimit = await app.inject({
    method: 'POST',
    url: '/api/saved-lists',
    headers: { cookie: capped },
    payload: { name: 'One too many' },
  });
  assert.equal(listLimit.json<{ code: string }>().code, 'LIST_LIMIT_REACHED');
});
