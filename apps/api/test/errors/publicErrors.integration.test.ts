import assert from 'node:assert/strict';
import test from 'node:test';
import { createSeededAppFixture } from '../support/seededDatabase.js';

type PublicErrorBody = { error: string; code: string; meta?: unknown; details?: unknown };

void test('generic API errors are coded, localized, and detail-free', async (t) => {
  const fixture = await createSeededAppFixture(t);
  const { app } = fixture;
  app.get('/__test/public-error-throw', () => {
    throw new Error('database password and stack should never cross the boundary');
  });

  await t.test('validation removes AJV detail and uses the request country', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/cart/not-a-cart/items',
      headers: { 'x-shop-country': 'DE' },
      payload: { productId: '<script>alert(1)</script>' },
    });
    assert.equal(response.statusCode, 400);
    const body = response.json<PublicErrorBody>();
    assert.equal(body.code, 'REQUEST_INVALID');
    assert.equal(body.error, 'Die Anfrage ist ungültig.');
    assert.equal('details' in body, false);
    assert.equal(JSON.stringify(body).includes('script'), false);
  });

  await t.test('malformed JSON is localized from the strict request country', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/cart/not-a-cart/items',
      headers: { 'content-type': 'application/json', 'x-shop-country': 'DE' },
      payload: '{"productId":',
    });
    assert.equal(response.statusCode, 400);
    const body = response.json<PublicErrorBody>();
    assert.equal(body.code, 'REQUEST_INVALID');
    assert.equal(body.error, 'Die Anfrage ist ungültig.');
    assert.equal('details' in body, false);
    assert.equal(JSON.stringify(body).includes('productId'), false);
    assert.equal(JSON.stringify(body).includes('JSON'), false);
  });

  await t.test('unknown exceptions are generic and do not expose exception text', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/__test/public-error-throw',
      headers: { 'x-shop-country': 'FR' },
    });
    assert.equal(response.statusCode, 500);
    const body = response.json<PublicErrorBody>();
    assert.equal(body.code, 'INTERNAL_ERROR');
    assert.equal(body.error, 'Une erreur est survenue. Veuillez réessayer.');
    assert.equal(JSON.stringify(body).includes('database password'), false);
  });

  await t.test('not-found hides method and URL', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/__missing/public-route',
      headers: { 'x-shop-country': 'ES' },
    });
    assert.equal(response.statusCode, 404);
    const body = response.json<PublicErrorBody>();
    assert.equal(body.code, 'NOT_FOUND');
    assert.equal(body.error, 'No se encontró el recurso solicitado.');
    assert.equal(JSON.stringify(body).includes('__missing'), false);
  });

  await t.test('auth guard uses a stable identity without account enumeration', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/saved-lists' });
    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.json<PublicErrorBody>(), {
      error: 'You need to sign in to continue.',
      code: 'UNAUTHORIZED',
    });
  });
});
