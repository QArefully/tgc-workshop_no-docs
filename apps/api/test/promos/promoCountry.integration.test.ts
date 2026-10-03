import assert from 'node:assert/strict';
import test from 'node:test';
import { createSeededFixture } from '../support/seededDatabase.js';

function sessionCookie(response: {
  headers: Record<string, string | string[] | undefined>;
}): string {
  const header = response.headers['set-cookie'];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) throw new Error('Expected session cookie');
  return value.split(';', 1)[0]!;
}

const promoFields = {
  discountPercent: 10,
  minItemCount: 0,
  kind: 'percent' as const,
  amountCents: 1,
  minSubtotalCents: 0,
  categoryScope: null,
  startAt: null,
  endAt: null,
  maxRedemptions: 100,
  perUserLimit: null,
};

void test('omitting countries on admin update preserves targeting and opaque rejection', async (t) => {
  const { db, app } = await createSeededFixture(t);

  const login = await app.inject({
    method: 'POST',
    url: '/login',
    payload: { email: 'admin@example.com', password: 'Password123!', country: 'UK' },
  });
  assert.equal(login.statusCode, 200, login.body);
  const adminCookie = sessionCookie(login);
  const create = await app.inject({
    method: 'POST',
    url: '/api/admin/promos',
    headers: { cookie: adminCookie },
    payload: { code: 'COUNTRY10', ...promoFields, countries: ['UK'] },
  });
  assert.equal(create.statusCode, 201, create.body);

  const deCart = await app.inject({
    method: 'POST',
    url: '/api/cart',
    payload: { country: 'DE' },
  });
  assert.equal(deCart.statusCode, 201, deCart.body);
  const cartId = deCart.json<{ cartId: string }>().cartId;

  const threshold = await app.inject({
    method: 'POST',
    url: '/api/admin/promos',
    headers: { cookie: adminCookie },
    payload: {
      code: 'THRESHOLD10',
      ...promoFields,
      minSubtotalCents: 12_345,
    },
  });
  assert.equal(threshold.statusCode, 201, threshold.body);
  const thresholdResult = await app.inject({
    method: 'POST',
    url: '/api/promo/validate',
    payload: { cartId, promoCode: 'THRESHOLD10' },
  });
  assert.equal(thresholdResult.statusCode, 200, thresholdResult.body);
  assert.deepEqual(thresholdResult.json(), {
    valid: false,
    errorCode: 'MIN_SUBTOTAL',
    minSubtotalCents: 12_345,
  });
  assert.equal('error' in thresholdResult.json(), false);
  assert.doesNotMatch(thresholdResult.body, /[$£€]/);

  const update = await app.inject({
    method: 'PUT',
    url: '/api/admin/promos/COUNTRY10',
    headers: { cookie: adminCookie },
    payload: { ...promoFields, endAt: '2026-12-31T00:00:00.000Z' },
  });
  assert.equal(update.statusCode, 200, update.body);

  const outside = await app.inject({
    method: 'POST',
    url: '/api/promo/validate',
    payload: { cartId, promoCode: 'COUNTRY10' },
  });
  const unknown = await app.inject({
    method: 'POST',
    url: '/api/promo/validate',
    payload: { cartId, promoCode: 'NO-SUCH-CODE' },
  });
  assert.equal(outside.statusCode, 200);
  assert.equal(unknown.statusCode, 200);
  assert.equal(outside.body, unknown.body);
  assert.deepEqual(outside.json(), {
    valid: false,
    errorCode: 'INVALID',
  });
  assert.deepEqual(update.json<{ countries: string[] }>().countries, ['UK']);
  assert.deepEqual(
    db
      .prepare(
        `SELECT pcc.country
         FROM promo_code_countries pcc
         JOIN promo_codes pc ON pc.id = pcc.promo_code_id
         WHERE pc.code = ? ORDER BY pcc.rowid`,
      )
      .all('COUNTRY10'),
    [{ country: 'UK' }],
  );

  const missingCart = await app.inject({
    method: 'POST',
    url: '/api/promo/validate',
    payload: {
      cartId: '00000000-0000-4000-8000-000000000000',
      promoCode: 'THRESHOLD10',
    },
  });
  assert.equal(missingCart.statusCode, 404);
  assert.equal(missingCart.json<{ code: string }>().code, 'CART_NOT_FOUND');
});

void test('explicit empty countries on admin update clears targeting globally', async (t) => {
  const { db, app } = await createSeededFixture(t);

  const login = await app.inject({
    method: 'POST',
    url: '/login',
    payload: { email: 'admin@example.com', password: 'Password123!', country: 'UK' },
  });
  assert.equal(login.statusCode, 200, login.body);
  const adminCookie = sessionCookie(login);
  const create = await app.inject({
    method: 'POST',
    url: '/api/admin/promos',
    headers: { cookie: adminCookie },
    payload: { code: 'COUNTRY10', ...promoFields, countries: ['UK'] },
  });
  assert.equal(create.statusCode, 201, create.body);

  const deCart = await app.inject({
    method: 'POST',
    url: '/api/cart',
    payload: { country: 'DE' },
  });
  assert.equal(deCart.statusCode, 201, deCart.body);
  const cartId = deCart.json<{ cartId: string }>().cartId;
  const update = await app.inject({
    method: 'PUT',
    url: '/api/admin/promos/COUNTRY10',
    headers: { cookie: adminCookie },
    payload: { ...promoFields, countries: [] },
  });
  assert.equal(update.statusCode, 200, update.body);
  assert.equal('countries' in update.json(), false);
  assert.deepEqual(
    db
      .prepare(
        `SELECT pcc.country
         FROM promo_code_countries pcc
         JOIN promo_codes pc ON pc.id = pcc.promo_code_id
         WHERE pc.code = ?`,
      )
      .all('COUNTRY10'),
    [],
  );
  const applies = await app.inject({
    method: 'POST',
    url: '/api/promo/validate',
    payload: { cartId, promoCode: 'COUNTRY10' },
  });
  assert.equal(applies.statusCode, 200);
  assert.equal(applies.json<{ valid: boolean }>().valid, true);
});

void test('country-targeted promos apply, reject opaquely, and replace targeting on admin update', async (t) => {
  const { db, app } = await createSeededFixture(t);

  const login = await app.inject({
    method: 'POST',
    url: '/login',
    payload: { email: 'admin@example.com', password: 'Password123!', country: 'UK' },
  });
  assert.equal(login.statusCode, 200, login.body);
  const adminCookie = sessionCookie(login);

  const createTargeted = await app.inject({
    method: 'POST',
    url: '/api/admin/promos',
    headers: { cookie: adminCookie },
    payload: { code: 'COUNTRY10', ...promoFields, countries: ['UK', 'US'] },
  });
  assert.equal(createTargeted.statusCode, 201, createTargeted.body);
  assert.deepEqual(createTargeted.json<{ countries: string[] }>().countries, ['UK', 'US']);

  const cart = async (country: 'UK' | 'US' | 'DE'): Promise<string> => {
    const response = await app.inject({ method: 'POST', url: '/api/cart', payload: { country } });
    assert.equal(response.statusCode, 201, response.body);
    return response.json<{ cartId: string }>().cartId;
  };
  const ukCart = await cart('UK');
  const usCart = await cart('US');
  const deCart = await cart('DE');

  const applyInTarget = await app.inject({
    method: 'POST',
    url: '/api/promo/validate',
    payload: { cartId: ukCart, promoCode: 'COUNTRY10' },
  });
  assert.equal(applyInTarget.statusCode, 200);
  assert.equal(applyInTarget.json<{ valid: boolean }>().valid, true);

  const applyInSecondTarget = await app.inject({
    method: 'POST',
    url: '/api/promo/validate',
    payload: { cartId: usCart, promoCode: 'COUNTRY10' },
  });
  assert.equal(applyInSecondTarget.statusCode, 200);
  assert.equal(applyInSecondTarget.json<{ valid: boolean }>().valid, true);

  const updateTargeted = await app.inject({
    method: 'PUT',
    url: '/api/admin/promos/COUNTRY10',
    headers: { cookie: adminCookie },
    payload: { ...promoFields, countries: ['DE'] },
  });
  assert.equal(updateTargeted.statusCode, 200, updateTargeted.body);
  assert.deepEqual(updateTargeted.json<{ countries: string[] }>().countries, ['DE']);
  assert.deepEqual(
    db
      .prepare(
        `SELECT pcc.country
         FROM promo_code_countries pcc
         JOIN promo_codes pc ON pc.id = pcc.promo_code_id
         WHERE pc.code = ? ORDER BY pcc.rowid`,
      )
      .all('COUNTRY10'),
    [{ country: 'DE' }],
  );

  const outside = await app.inject({
    method: 'POST',
    url: '/api/promo/validate',
    payload: { cartId: ukCart, promoCode: 'COUNTRY10' },
  });
  const unknown = await app.inject({
    method: 'POST',
    url: '/api/promo/validate',
    payload: { cartId: ukCart, promoCode: 'NO-SUCH-CODE' },
  });
  assert.equal(outside.statusCode, 200);
  assert.equal(unknown.statusCode, 200);
  assert.equal(outside.body, unknown.body);
  assert.deepEqual(outside.json(), {
    valid: false,
    errorCode: 'INVALID',
  });

  const appliesAfterReplacement = await app.inject({
    method: 'POST',
    url: '/api/promo/validate',
    payload: { cartId: deCart, promoCode: 'COUNTRY10' },
  });
  assert.equal(appliesAfterReplacement.statusCode, 200);
  assert.equal(appliesAfterReplacement.json<{ valid: boolean }>().valid, true);

  const createUntargeted = await app.inject({
    method: 'POST',
    url: '/api/admin/promos',
    headers: { cookie: adminCookie },
    payload: { code: 'GLOBAL10', ...promoFields },
  });
  assert.equal(createUntargeted.statusCode, 201, createUntargeted.body);
  assert.equal('countries' in createUntargeted.json(), false);
  for (const cartId of [ukCart, usCart]) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/promo/validate',
      payload: { cartId, promoCode: 'GLOBAL10' },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json<{ valid: boolean }>().valid, true);
  }
});
