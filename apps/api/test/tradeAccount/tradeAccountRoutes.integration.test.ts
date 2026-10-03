import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import {
  BillingEntity,
  DeliverySite,
  type CreateBillingEntityBody,
  type CreateDeliverySiteBody,
} from '@shop/contracts/trade-account';
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

/** Signs a fresh buyer up and returns their session cookie. Emails are unique per caller. */
async function signUp(app: App, email: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/signup',
    payload: { email, password: 'password-one', displayName: 'Trade Buyer', country: 'UK' },
  });
  assert.equal(response.statusCode, 201, `signup failed for ${email}`);
  return cookieHeader(response);
}

function siteBody(overrides: Partial<CreateDeliverySiteBody> = {}): CreateDeliverySiteBody {
  return {
    label: 'Yard A',
    contactName: 'Site Foreman',
    contactPhone: '01234 567890',
    address: {
      line1: '1 Wharf Road',
      city: 'Leeds',
      postcode: 'LS1 4AP',
      countryCode: 'GB',
    },
    ...overrides,
  };
}

function entityBody(overrides: Partial<CreateBillingEntityBody> = {}): CreateBillingEntityBody {
  return {
    legalName: 'Northern Builders Ltd',
    registrationNumber: '09876543',
    vatNumber: 'GB123456789',
    address: {
      line1: '4 Ledger Street',
      city: 'Leeds',
      postcode: 'LS2 7PQ',
      countryCode: 'GB',
    },
    ...overrides,
  };
}

void test('trade account routes', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'shop-trade-routes-'));
  const db = openDatabase({ path: join(dir, 'shop.db') });
  const app = await buildApp({ db, resetBaseUrl: 'http://web.test' });

  t.after(async () => {
    await app.close();
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  });

  await t.test('every trade account endpoint rejects an anonymous caller', async () => {
    const anonymous = [
      { method: 'GET' as const, url: '/api/account/delivery-sites' },
      { method: 'POST' as const, url: '/api/account/delivery-sites', payload: siteBody() },
      { method: 'PATCH' as const, url: '/api/account/delivery-sites/1', payload: { label: 'X' } },
      { method: 'DELETE' as const, url: '/api/account/delivery-sites/1' },
      { method: 'GET' as const, url: '/api/account/billing-entities' },
      { method: 'POST' as const, url: '/api/account/billing-entities', payload: entityBody() },
      {
        method: 'PATCH' as const,
        url: '/api/account/billing-entities/1',
        payload: { legalName: 'X Ltd' },
      },
      { method: 'DELETE' as const, url: '/api/account/billing-entities/1' },
    ];

    for (const request of anonymous) {
      const response = await app.inject(request);
      assert.equal(response.statusCode, 401, `${request.method} ${request.url} must require auth`);
    }
  });

  await t.test('delivery sites: create, list, default swap, and retire over HTTP', async () => {
    const cookie = await signUp(app, 'sites-routes@example.test');

    const empty = await app.inject({
      method: 'GET',
      url: '/api/account/delivery-sites',
      headers: { cookie },
    });
    assert.equal(empty.statusCode, 200);
    assert.deepEqual(empty.json(), []);

    const created = await app.inject({
      method: 'POST',
      url: '/api/account/delivery-sites',
      headers: { cookie },
      payload: siteBody(),
    });
    assert.equal(created.statusCode, 201);
    const first: unknown = created.json();
    assert.ok(Value.Check(DeliverySite, first), 'create response must satisfy DeliverySite');
    assert.equal(first.isDefault, true, 'first live site is the default');
    assert.equal(first.active, true);

    const second = await app.inject({
      method: 'POST',
      url: '/api/account/delivery-sites',
      headers: { cookie },
      payload: siteBody({ label: 'Yard B' }),
    });
    assert.equal(second.statusCode, 201);
    const secondSite: unknown = second.json();
    assert.ok(Value.Check(DeliverySite, secondSite));
    assert.equal(secondSite.isDefault, false);

    // Default swap through PATCH: promoting one site demotes the other in the same request.
    const promoted = await app.inject({
      method: 'PATCH',
      url: `/api/account/delivery-sites/${secondSite.id}`,
      headers: { cookie },
      payload: { isDefault: true, contactName: 'Yard Manager' },
    });
    assert.equal(promoted.statusCode, 200);
    const promotedSite: unknown = promoted.json();
    assert.ok(Value.Check(DeliverySite, promotedSite));
    assert.equal(promotedSite.isDefault, true);
    assert.equal(promotedSite.contactName, 'Yard Manager');

    const afterSwap = await app.inject({
      method: 'GET',
      url: '/api/account/delivery-sites',
      headers: { cookie },
    });
    const swapped: unknown = afterSwap.json();
    assert.ok(Array.isArray(swapped) && swapped.length === 2);
    assert.deepEqual(
      swapped.map((site) => [(site as DeliverySite).id, (site as DeliverySite).isDefault]),
      [
        [secondSite.id, true],
        [first.id, false],
      ],
      'list is default-first and carries exactly one default',
    );

    // Retiring the default promotes the survivor, so the account never ends up with no default.
    const retired = await app.inject({
      method: 'DELETE',
      url: `/api/account/delivery-sites/${secondSite.id}`,
      headers: { cookie },
    });
    assert.equal(retired.statusCode, 200);
    assert.deepEqual(retired.json(), { success: true });

    const afterRetire = await app.inject({
      method: 'GET',
      url: '/api/account/delivery-sites',
      headers: { cookie },
    });
    const survivors: DeliverySite[] = afterRetire.json();
    assert.deepEqual(
      survivors.map((site) => [site.id, site.isDefault]),
      [[first.id, true]],
      'retired site leaves the list and the survivor becomes default',
    );

    // Retiring twice is not a silent success: the second call no longer finds a live site.
    const retiredAgain = await app.inject({
      method: 'DELETE',
      url: `/api/account/delivery-sites/${secondSite.id}`,
      headers: { cookie },
    });
    assert.equal(retiredAgain.statusCode, 404);
  });

  await t.test('billing entities: create, clear an identifier, and retire over HTTP', async () => {
    const cookie = await signUp(app, 'entities-routes@example.test');

    const created = await app.inject({
      method: 'POST',
      url: '/api/account/billing-entities',
      headers: { cookie },
      payload: entityBody(),
    });
    assert.equal(created.statusCode, 201);
    const entity: unknown = created.json();
    assert.ok(Value.Check(BillingEntity, entity), 'create response must satisfy BillingEntity');
    assert.equal(entity.isDefault, true);
    assert.equal(entity.vatNumber, 'GB123456789');

    // Explicit `null` clears; an absent key must leave the sibling identifier untouched.
    const cleared = await app.inject({
      method: 'PATCH',
      url: `/api/account/billing-entities/${entity.id}`,
      headers: { cookie },
      payload: { vatNumber: null },
    });
    assert.equal(cleared.statusCode, 200);
    const clearedEntity: unknown = cleared.json();
    assert.ok(Value.Check(BillingEntity, clearedEntity));
    assert.equal(clearedEntity.vatNumber, null);
    assert.equal(clearedEntity.registrationNumber, '09876543', 'absent field is untouched');

    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/account/billing-entities',
      headers: { cookie },
      payload: entityBody({ legalName: 'northern builders ltd' }),
    });
    assert.equal(duplicate.statusCode, 409, 'case-insensitive duplicate legal name conflicts');

    const retired = await app.inject({
      method: 'DELETE',
      url: `/api/account/billing-entities/${entity.id}`,
      headers: { cookie },
    });
    assert.equal(retired.statusCode, 200);

    const remaining = await app.inject({
      method: 'GET',
      url: '/api/account/billing-entities',
      headers: { cookie },
    });
    assert.deepEqual(remaining.json(), []);
  });

  await t.test('another buyer sees 404, never 403 and never the record', async () => {
    const ownerCookie = await signUp(app, 'owner-routes@example.test');
    const intruderCookie = await signUp(app, 'intruder-routes@example.test');

    const site: DeliverySite = (
      await app.inject({
        method: 'POST',
        url: '/api/account/delivery-sites',
        headers: { cookie: ownerCookie },
        payload: siteBody({ label: 'Private Yard' }),
      })
    ).json();
    const entity: BillingEntity = (
      await app.inject({
        method: 'POST',
        url: '/api/account/billing-entities',
        headers: { cookie: ownerCookie },
        payload: entityBody({ legalName: 'Private Holdings Ltd' }),
      })
    ).json();

    const crossUser = [
      {
        method: 'PATCH' as const,
        url: `/api/account/delivery-sites/${site.id}`,
        payload: { label: 'Hijacked' },
      },
      { method: 'DELETE' as const, url: `/api/account/delivery-sites/${site.id}` },
      {
        method: 'PATCH' as const,
        url: `/api/account/billing-entities/${entity.id}`,
        payload: { legalName: 'Hijacked Ltd' },
      },
      { method: 'DELETE' as const, url: `/api/account/billing-entities/${entity.id}` },
    ];

    for (const request of crossUser) {
      const response = await app.inject({ ...request, headers: { cookie: intruderCookie } });
      assert.equal(
        response.statusCode,
        404,
        `${request.method} ${request.url} must be indistinguishable from a missing record`,
      );
      const body: { error: string } = response.json();
      assert.ok(!('stack' in body), 'no stack in error body');
      assert.ok(!body.error.includes('Private'), 'error text must not echo another account record');
    }

    // The intruder's own lists stay empty: nothing leaked into their account surface.
    assert.deepEqual(
      (
        await app.inject({
          method: 'GET',
          url: '/api/account/delivery-sites',
          headers: { cookie: intruderCookie },
        })
      ).json(),
      [],
    );

    // The owner's records are untouched by the failed cross-user writes.
    const ownerSites: DeliverySite[] = (
      await app.inject({
        method: 'GET',
        url: '/api/account/delivery-sites',
        headers: { cookie: ownerCookie },
      })
    ).json();
    assert.deepEqual(
      ownerSites.map((row) => row.label),
      ['Private Yard'],
    );
  });

  await t.test('malformed input is rejected as 400 without leaking internals', async () => {
    const cookie = await signUp(app, 'validation-routes@example.test');

    const invalid = [
      { url: '/api/account/delivery-sites', payload: siteBody({ label: '' }) },
      { url: '/api/account/delivery-sites', payload: siteBody({ contactPhone: '     ' }) },
      {
        url: '/api/account/delivery-sites',
        payload: { ...siteBody(), unexpected: 'value' },
      },
      {
        url: '/api/account/delivery-sites',
        payload: siteBody({
          address: { line1: '1 Wharf Road', city: 'Leeds', postcode: 'LS1 4AP', countryCode: 'gb' },
        }),
      },
      { url: '/api/account/billing-entities', payload: entityBody({ legalName: '<script>' }) },
    ];

    for (const request of invalid) {
      const response = await app.inject({
        method: 'POST',
        url: request.url,
        headers: { cookie },
        payload: request.payload,
      });
      assert.equal(
        response.statusCode,
        400,
        `${request.url} must reject ${JSON.stringify(request.payload)}`,
      );
      const body: { error: string } = response.json();
      assert.ok(typeof body.error === 'string' && body.error.length > 0);
      assert.ok(!body.error.includes('at Object.'), 'no stack frames in validation errors');
      assert.ok(!/\.ts:\d+/.test(body.error), 'no source locations in validation errors');
    }

    // A non-numeric identifier fails the param schema, not the service.
    const badParam = await app.inject({
      method: 'DELETE',
      url: '/api/account/delivery-sites/not-a-number',
      headers: { cookie },
    });
    assert.equal(badParam.statusCode, 400);
  });
});
