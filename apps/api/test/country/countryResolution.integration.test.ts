import assert from 'node:assert/strict';
import test from 'node:test';
import { assertProfilesMatchCatalog } from '../../src/features/countryProfile/countryProfileService.js';
import { createSeededAppFixture } from '../support/seededDatabase.js';

function sessionCookie(response: {
  headers: Record<string, string | string[] | undefined>;
}): string {
  const header = response.headers['set-cookie'];
  const cookie = Array.isArray(header) ? header[0] : header;
  if (!cookie) throw new Error('Expected a session cookie');
  return cookie.split(';', 1)[0];
}

void test('request country resolution precedence', async (t) => {
  const fixture = await createSeededAppFixture(t);
  const { db, app } = fixture;
  app.get('/__test/resolved-country', (request) => ({ country: request.resolvedCountry }));

  async function resolvedCountry(headers?: Record<string, string>): Promise<string> {
    const response = await app.inject({
      method: 'GET',
      url: '/__test/resolved-country',
      ...(headers ? { headers } : {}),
    });
    assert.equal(response.statusCode, 200);
    return (JSON.parse(response.body) as { country: string }).country;
  }

  async function login(email: string): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/login',
      payload: { email, password: 'Password123!', country: 'UK' },
    });
    assert.equal(response.statusCode, 200);
    return sessionCookie(response);
  }

  await t.test('guest defaults to the configured guest country', async () => {
    assert.equal(await resolvedCountry(), 'US');
  });

  await t.test('guest supported header is honoured', async () => {
    assert.equal(await resolvedCountry({ 'x-shop-country': 'CN' }), 'CN');
  });

  await t.test('guest invalid or unknown header falls back without throwing', async () => {
    assert.equal(await resolvedCountry({ 'x-shop-country': 'not-a-country' }), 'US');
  });

  await t.test('signed-in customer header is ignored', async () => {
    const cookie = await login('alice@example.com');
    assert.equal(await resolvedCountry({ cookie, 'x-shop-country': 'FR' }), 'UK');
  });

  await t.test('admin supported header overrides the account country', async () => {
    const cookie = await login('admin@example.com');
    assert.equal(await resolvedCountry({ cookie, 'x-shop-country': 'FR' }), 'FR');
  });

  await t.test('header name and value are case-insensitive', async () => {
    assert.equal(await resolvedCountry({ 'X-ShOp-CoUnTrY': 'eS' }), 'ES');
  });

  await t.test('profile validation names a missing catalogue reference', () => {
    assert.doesNotThrow(() => assertProfilesMatchCatalog(db));
    db.prepare("UPDATE products SET category = 'Test Removed Category' WHERE category = ?").run(
      'Sports Nutrition',
    );
    assert.throws(() => assertProfilesMatchCatalog(db), /Sports Nutrition/);
  });
});
