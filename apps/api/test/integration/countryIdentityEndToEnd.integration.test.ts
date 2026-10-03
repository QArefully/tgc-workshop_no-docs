import assert from 'node:assert/strict';
import test from 'node:test';
import { createSeededAppFixture } from '../support/seededDatabase.js';

function sessionCookie(response: {
  headers: Record<string, string | string[] | undefined>;
}): string {
  const header = response.headers['set-cookie'];
  const cookie = Array.isArray(header) ? header[0] : header;
  if (!cookie) throw new Error('Expected a session cookie');
  return cookie.split(';', 1)[0];
}

function responseBody<T>(response: { body: string }): T {
  return JSON.parse(response.body) as T;
}

void test('country identity composes signup, /me, cart isolation, and cross-country auth', async (t) => {
  const now = new Date('2026-08-03T12:00:00.000Z');
  const fixture = await createSeededAppFixture({
    testContext: t,
    app: {
      resetBaseUrl: 'http://web.example.test/',
      clock: { now: () => now },
    },
  });
  const { db, app } = fixture;

  await t.test('sign up UK user and confirm country identity', async () => {
    const signup = await app.inject({
      method: 'POST',
      url: '/signup',
      payload: {
        email: 'ctry-uk@test.d',
        password: 'PasswordUK!1',
        displayName: 'Country UK Tester',
        country: 'UK',
      },
    });
    assert.equal(signup.statusCode, 201);
    const ukCookie = sessionCookie(signup);
    const ukUser = responseBody<{ id: string; email: string; country: string }>(signup);
    assert.equal(ukUser.country, 'UK');

    const me = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { cookie: ukCookie },
    });
    assert.equal(me.statusCode, 200);
    assert.equal(responseBody<{ country: string }>(me).country, 'UK');

    const cart = await app.inject({
      method: 'POST',
      url: '/api/cart',
      headers: { cookie: ukCookie },
      payload: { country: 'UK' },
    });
    assert.equal(cart.statusCode, 201);
    const ukCartId = responseBody<{ cartId: string }>(cart).cartId;
    assert.ok(ukCartId.length > 0);

    const cartCountry = db
      .prepare('SELECT country FROM carts WHERE id = ?')
      .pluck()
      .get(ukCartId) as string;
    assert.equal(cartCountry, 'UK');
  });

  await t.test('sign up DE user and confirm country identity', async () => {
    const signup = await app.inject({
      method: 'POST',
      url: '/signup',
      payload: {
        email: 'ctry-de@test.d',
        password: 'PasswordDE!1',
        displayName: 'Country DE Tester',
        country: 'DE',
      },
    });
    assert.equal(signup.statusCode, 201);
    const deCookie = sessionCookie(signup);
    const deUser = responseBody<{ id: string; email: string; country: string }>(signup);
    assert.equal(deUser.country, 'DE');

    const me = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { cookie: deCookie },
    });
    assert.equal(me.statusCode, 200);
    assert.equal(responseBody<{ country: string }>(me).country, 'DE');

    const cart = await app.inject({
      method: 'POST',
      url: '/api/cart',
      headers: { cookie: deCookie },
      payload: { country: 'DE' },
    });
    assert.equal(cart.statusCode, 201);
    const deCartId = responseBody<{ cartId: string }>(cart).cartId;
    assert.ok(deCartId.length > 0);

    const cartCountry = db
      .prepare('SELECT country FROM carts WHERE id = ?')
      .pluck()
      .get(deCartId) as string;
    assert.equal(cartCountry, 'DE');
  });

  await t.test('UK and DE carts are independent', async () => {
    const ukLogin = await app.inject({
      method: 'POST',
      url: '/login',
      payload: { email: 'ctry-uk@test.d', password: 'PasswordUK!1', country: 'UK' },
    });
    const ukCookie = sessionCookie(ukLogin);

    const deLogin = await app.inject({
      method: 'POST',
      url: '/login',
      payload: { email: 'ctry-de@test.d', password: 'PasswordDE!1', country: 'DE' },
    });
    const deCookie = sessionCookie(deLogin);

    const ukCart = await app.inject({
      method: 'POST',
      url: '/api/cart',
      headers: { cookie: ukCookie },
      payload: { country: 'UK' },
    });
    const ukCartId = responseBody<{ cartId: string }>(ukCart).cartId;

    const deCart = await app.inject({
      method: 'POST',
      url: '/api/cart',
      headers: { cookie: deCookie },
      payload: { country: 'DE' },
    });
    const deCartId = responseBody<{ cartId: string }>(deCart).cartId;

    assert.notEqual(ukCartId, deCartId);
  });

  await t.test('UK password fails on DE account', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/login',
      payload: { email: 'ctry-de@test.d', password: 'PasswordUK!1', country: 'DE' },
    });
    assert.equal(login.statusCode, 401);
  });

  await t.test('DE password fails on UK account', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/login',
      payload: { email: 'ctry-uk@test.d', password: 'PasswordDE!1', country: 'UK' },
    });
    assert.equal(login.statusCode, 401);
  });

  /** Captured so the distinct-row assertion below cannot pass on a single shared user row. */
  let ukAliceId = '';
  let deAliceId = '';

  await t.test('seeded UK Alice logs in with correct country and Password123!', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/login',
      payload: { email: 'alice@example.com', password: 'Password123!', country: 'UK' },
    });
    assert.equal(login.statusCode, 200);
    const cookie = sessionCookie(login);

    const me = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { cookie },
    });
    assert.equal(me.statusCode, 200);
    const body = responseBody<{ id: string; country: string }>(me);
    assert.equal(body.country, 'UK');
    assert.ok(body.id.length > 0);
    ukAliceId = body.id;
  });

  await t.test('seeded DE Alice logs in with correct country and PasswordDE!1', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/login',
      payload: { email: 'alice@example.com', password: 'PasswordDE!1', country: 'DE' },
    });
    assert.equal(login.statusCode, 200);
    const cookie = sessionCookie(login);

    const me = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { cookie },
    });
    assert.equal(me.statusCode, 200);
    const body = responseBody<{ id: string; country: string }>(me);
    assert.equal(body.country, 'DE');
    assert.ok(body.id.length > 0);
    deAliceId = body.id;
  });

  await t.test('seeded UK and DE Alice are distinct user rows', () => {
    assert.ok(ukAliceId.length > 0, 'expected the UK Alice login to record an id');
    assert.ok(deAliceId.length > 0, 'expected the DE Alice login to record an id');
    assert.notEqual(ukAliceId, deAliceId);
  });

  await t.test('seeded Alice fails with wrong country', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/login',
      payload: { email: 'alice@example.com', password: 'Password123!', country: 'US' },
    });
    assert.equal(login.statusCode, 401);
  });
});
