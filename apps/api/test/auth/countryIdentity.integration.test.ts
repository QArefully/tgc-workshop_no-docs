import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildApp } from '../../src/app.js';
import { closeDatabase, openDatabase } from '../../src/db/index.js';

function readError(response: { body: string }): { error: string; code: string } {
  const body: unknown = JSON.parse(response.body);
  assert.ok(typeof body === 'object' && body !== null && 'error' in body && 'code' in body);
  assert.equal(typeof body.error, 'string');
  assert.equal(typeof body.code, 'string');
  return { error: body.error, code: body.code };
}

function sessionCookie(response: {
  headers: Record<string, string | string[] | undefined>;
}): string {
  const cookie = response.headers['set-cookie'];
  const value = Array.isArray(cookie) ? cookie[0] : cookie;
  if (!value) throw new Error('Expected a session cookie');
  return value.split(';', 1)[0];
}

void test('country-scoped identity: same email in two countries yields independent accounts', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'shop-country-identity-'));
  const db = openDatabase({ path: join(directory, 'shop.db') });
  const app = await buildApp({
    db,
    resetBaseUrl: 'https://web.example.test/store',
  });
  t.after(async () => {
    await app.close();
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  });

  const ukSignup = await app.inject({
    method: 'POST',
    url: '/signup',
    payload: {
      email: 'seccheck@example.test',
      password: 'pass1-UK!!',
      displayName: 'SecCheck UK',
      country: 'UK',
    },
  });
  assert.equal(ukSignup.statusCode, 201);

  await t.test('register same email in DE creates independent account', async () => {
    const deSignup = await app.inject({
      method: 'POST',
      url: '/signup',
      payload: {
        email: 'seccheck@example.test',
        password: 'pass2-DE!',
        displayName: 'SecCheck DE',
        country: 'DE',
      },
    });
    assert.equal(deSignup.statusCode, 201);
  });

  await t.test('login UK with pass1 succeeds and /me shows country UK', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/login',
      payload: { email: 'seccheck@example.test', password: 'pass1-UK!!', country: 'UK' },
    });
    assert.equal(login.statusCode, 200);
    const cookie = sessionCookie(login);
    const me = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { cookie },
    });
    assert.equal(me.statusCode, 200);
    const body: unknown = JSON.parse(me.body);
    assert.ok(typeof body === 'object' && body !== null && 'country' in body);
    assert.equal(body.country, 'UK');
  });

  await t.test('login DE with pass2 succeeds and /me shows country DE', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/login',
      payload: { email: 'seccheck@example.test', password: 'pass2-DE!', country: 'DE' },
    });
    assert.equal(login.statusCode, 200);
    const cookie = sessionCookie(login);
    const me = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { cookie },
    });
    assert.equal(me.statusCode, 200);
    const body: unknown = JSON.parse(me.body);
    assert.ok(typeof body === 'object' && body !== null && 'country' in body);
    assert.equal(body.country, 'DE');
  });

  await t.test('login UK with pass2 returns 401 with expected message', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/login',
      payload: { email: 'seccheck@example.test', password: 'pass2-DE!', country: 'UK' },
    });
    assert.equal(login.statusCode, 401);
    assert.equal(readError(login).code, 'UNAUTHORIZED');
  });

  await t.test('login DE with pass1 returns 401 with expected message', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/login',
      payload: { email: 'seccheck@example.test', password: 'pass1-UK!!', country: 'DE' },
    });
    assert.equal(login.statusCode, 401);
    assert.equal(readError(login).code, 'UNAUTHORIZED');
  });

  await t.test(
    'wrong-password and wrong-country stay indistinguishable by public identity',
    async () => {
      const wrongPass = await app.inject({
        method: 'POST',
        url: '/login',
        payload: { email: 'seccheck@example.test', password: 'wrong-pass', country: 'UK' },
      });
      const wrongCountry = await app.inject({
        method: 'POST',
        url: '/login',
        payload: { email: 'seccheck@example.test', password: 'pass1-UK!!', country: 'DE' },
      });
      assert.equal(wrongPass.statusCode, 401);
      assert.equal(wrongCountry.statusCode, 401);
      assert.equal(readError(wrongPass).code, 'UNAUTHORIZED');
      assert.equal(readError(wrongCountry).code, 'UNAUTHORIZED');
      assert.equal(
        wrongPass.json<{ code: string }>().code,
        wrongCountry.json<{ code: string }>().code,
      );
    },
  );

  await t.test('both sessions valid concurrently', async () => {
    const ukLogin = await app.inject({
      method: 'POST',
      url: '/login',
      payload: { email: 'seccheck@example.test', password: 'pass1-UK!!', country: 'UK' },
    });
    assert.equal(ukLogin.statusCode, 200);
    const deLogin = await app.inject({
      method: 'POST',
      url: '/login',
      payload: { email: 'seccheck@example.test', password: 'pass2-DE!', country: 'DE' },
    });
    assert.equal(deLogin.statusCode, 200);

    const ukCookie = sessionCookie(ukLogin);
    const deCookie = sessionCookie(deLogin);

    const ukMe = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { cookie: ukCookie },
    });
    assert.equal(ukMe.statusCode, 200);
    const ukBody: unknown = JSON.parse(ukMe.body);
    assert.ok(typeof ukBody === 'object' && ukBody !== null && 'country' in ukBody);
    assert.equal(ukBody.country, 'UK');

    const deMe = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { cookie: deCookie },
    });
    assert.equal(deMe.statusCode, 200);
    const deBody: unknown = JSON.parse(deMe.body);
    assert.ok(typeof deBody === 'object' && deBody !== null && 'country' in deBody);
    assert.equal(deBody.country, 'DE');
  });

  await t.test('duplicate (email, country) signup returns 409', async () => {
    const dup = await app.inject({
      method: 'POST',
      url: '/signup',
      payload: {
        email: 'seccheck@example.test',
        password: 'pass3-DUP!',
        displayName: 'SecCheck Dup',
        country: 'UK',
      },
    });
    assert.equal(dup.statusCode, 409);
    assert.equal(readError(dup).code, 'EMAIL_EXISTS');
  });
});
