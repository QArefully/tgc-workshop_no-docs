import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildApp } from '../../src/app.js';
import { closeDatabase, openDatabase } from '../../src/db/index.js';

type App = Awaited<ReturnType<typeof buildApp>>;

function cookieHeader(response: {
  headers: Record<string, string | string[] | undefined>;
}): string {
  const value = response.headers['set-cookie'];
  const cookie = Array.isArray(value) ? value[0] : value;
  if (!cookie) throw new Error('Expected session cookie');
  return cookie.split(';', 1)[0]!;
}

async function signUpGermanBuyer(app: App): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/signup',
    payload: {
      email: 'address-country@example.test',
      password: 'password-one',
      displayName: 'German Trade Buyer',
      country: 'DE',
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  return cookieHeader(response);
}

const germanSite = {
  label: 'Berlin Yard',
  contactName: 'Site Foreman',
  contactPhone: '+49 30 123456',
  address: {
    line1: '1 Materialstrasse',
    city: 'Berlin',
    postcode: '10115',
    countryCode: 'DE',
  },
};

void test('delivery-site country rules and unrestricted billing addresses', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'shop-address-country-'));
  const db = openDatabase({ path: join(directory, 'shop.db') });
  const app = await buildApp({ db, resetBaseUrl: 'http://web.test' });
  t.after(async () => {
    await app.close();
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  });

  const cookie = await signUpGermanBuyer(app);

  await t.test('create and update reject a postcode outside the account profile', async () => {
    const badCreate = await app.inject({
      method: 'POST',
      url: '/api/account/delivery-sites',
      headers: { cookie },
      payload: {
        ...germanSite,
        address: { ...germanSite.address, postcode: 'SW1A 1AA' },
      },
    });
    assert.equal(badCreate.statusCode, 400, badCreate.body);
    assert.deepEqual(badCreate.json(), {
      error: 'Die Anfrage konnte nicht verarbeitet werden. Bitte versuchen Sie es erneut.',
      code: 'INVALID_POSTCODE',
    });

    const created = await app.inject({
      method: 'POST',
      url: '/api/account/delivery-sites',
      headers: { cookie },
      payload: germanSite,
    });
    assert.equal(created.statusCode, 201, created.body);
    const siteId = created.json<{ id: string }>().id;

    const badUpdate = await app.inject({
      method: 'PATCH',
      url: `/api/account/delivery-sites/${siteId}`,
      headers: { cookie },
      payload: {
        address: { ...germanSite.address, postcode: '00-001' },
      },
    });
    assert.equal(badUpdate.statusCode, 400, badUpdate.body);
    assert.deepEqual(badUpdate.json(), {
      error: 'Die Anfrage konnte nicht verarbeitet werden. Bitte versuchen Sie es erneut.',
      code: 'INVALID_POSTCODE',
    });
  });

  await t.test(
    'create and update reject a postal country outside the profile allowlist',
    async () => {
      const badCreate = await app.inject({
        method: 'POST',
        url: '/api/account/delivery-sites',
        headers: { cookie },
        payload: {
          ...germanSite,
          label: 'French Yard',
          address: { ...germanSite.address, countryCode: 'FR' },
        },
      });
      assert.equal(badCreate.statusCode, 400, badCreate.body);
      assert.deepEqual(badCreate.json(), {
        error: 'Die Anfrage konnte nicht verarbeitet werden. Bitte versuchen Sie es erneut.',
        code: 'DELIVERY_COUNTRY_NOT_ALLOWED',
      });

      const [site] = (
        await app.inject({
          method: 'GET',
          url: '/api/account/delivery-sites',
          headers: { cookie },
        })
      ).json<Array<{ id: string }>>();
      assert.ok(site);
      const badUpdate = await app.inject({
        method: 'PATCH',
        url: `/api/account/delivery-sites/${site.id}`,
        headers: { cookie },
        payload: {
          address: { ...germanSite.address, countryCode: 'PL' },
        },
      });
      assert.equal(badUpdate.statusCode, 400, badUpdate.body);
      assert.deepEqual(badUpdate.json(), {
        error: 'Die Anfrage konnte nicht verarbeitet werden. Bitte versuchen Sie es erneut.',
        code: 'DELIVERY_COUNTRY_NOT_ALLOWED',
      });
    },
  );

  await t.test('billing entity create and update remain unrestricted', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/account/billing-entities',
      headers: { cookie },
      payload: {
        legalName: 'Cross-border Holdings GmbH',
        address: {
          line1: '1 Ledger Street',
          city: 'London',
          postcode: 'SW1A 1AA',
          countryCode: 'GB',
        },
      },
    });
    assert.equal(created.statusCode, 201, created.body);
    const entityId = created.json<{ id: string }>().id;

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/account/billing-entities/${entityId}`,
      headers: { cookie },
      payload: {
        address: {
          line1: '2 Ledger Street',
          city: 'Paris',
          postcode: '75001',
          countryCode: 'FR',
        },
      },
    });
    assert.equal(updated.statusCode, 200, updated.body);
    assert.deepEqual(updated.json<{ address: unknown }>().address, {
      line1: '2 Ledger Street',
      city: 'Paris',
      postcode: '75001',
      countryCode: 'FR',
    });
  });
});
