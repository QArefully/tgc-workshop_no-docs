import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../../src/app.js';
import { createSeededAppFixture } from '../support/seededDatabase.js';

function sessionCookie(response: {
  headers: Record<string, string | string[] | undefined>;
}): string {
  const header = response.headers['set-cookie'];
  const cookie = Array.isArray(header) ? header[0] : header;
  if (!cookie) throw new Error('Expected session cookie');
  return cookie.split(';', 1)[0];
}

async function login(app: Awaited<ReturnType<typeof buildApp>>, email: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/login',
    payload: { email, password: 'Password123!', country: 'UK' },
  });
  assert.equal(response.statusCode, 200);
  return sessionCookie(response);
}

void test('admin reads follow standing country while global catalog is annotated', async (t) => {
  const database = await createSeededAppFixture(t);
  const db = database.db;
  const movedOrder = (
    db.prepare('SELECT id FROM orders ORDER BY id ASC LIMIT 1').get() as { id: number }
  ).id;
  db.prepare('UPDATE orders SET country = ? WHERE id = ?').run('DE', movedOrder);
  const promoId = (
    db.prepare('SELECT id FROM promo_codes WHERE code = ?').get('SAVE10') as { id: number }
  ).id;
  db.prepare(
    'INSERT OR IGNORE INTO promo_code_countries (promo_code_id, country) VALUES (?, ?)',
  ).run(promoId, 'UK');

  const app = database.app;

  const adminCookie = await login(app, 'admin@example.com');
  const customerCookie = await login(app, 'alice@example.com');
  const country = (value: string) => ({ cookie: adminCookie, 'x-shop-country': value });

  const ukUsers = await app.inject({
    method: 'GET',
    url: '/api/admin/users',
    headers: country('UK'),
  });
  const deUsers = await app.inject({
    method: 'GET',
    url: '/api/admin/users',
    headers: country('DE'),
  });
  assert.equal(ukUsers.statusCode, 200);
  assert.equal(deUsers.statusCode, 200);
  assert.ok(
    ukUsers.json<{ items: Array<{ country: string }> }>().items.every((u) => u.country === 'UK'),
  );
  assert.ok(
    deUsers.json<{ items: Array<{ country: string }> }>().items.every((u) => u.country === 'DE'),
  );

  const ukOrders = await app.inject({
    method: 'GET',
    url: '/api/admin/orders',
    headers: country('UK'),
  });
  const deOrders = await app.inject({
    method: 'GET',
    url: '/api/admin/orders',
    headers: country('DE'),
  });
  assert.equal(ukOrders.statusCode, 200);
  assert.equal(deOrders.statusCode, 200);
  assert.ok(
    !ukOrders
      .json<{ items: Array<{ id: string }> }>()
      .items.some((o) => o.id === String(movedOrder)),
  );
  assert.ok(
    deOrders
      .json<{ items: Array<{ id: string }> }>()
      .items.some((o) => o.id === String(movedOrder)),
  );
  const hiddenDetail = await app.inject({
    method: 'GET',
    url: `/api/admin/orders/${movedOrder}`,
    headers: country('UK'),
  });
  assert.equal(hiddenDetail.statusCode, 404);
  const visibleDetail = await app.inject({
    method: 'GET',
    url: `/api/admin/orders/${movedOrder}`,
    headers: country('DE'),
  });
  assert.equal(visibleDetail.statusCode, 200);

  const cnProducts = await app.inject({
    method: 'GET',
    url: '/api/admin/products',
    headers: country('CN'),
  });
  const ukProducts = await app.inject({
    method: 'GET',
    url: '/api/admin/products',
    headers: country('UK'),
  });
  assert.equal(cnProducts.statusCode, 200);
  assert.equal(ukProducts.statusCode, 200);
  const sportsId = (
    db.prepare("SELECT id FROM products WHERE category = 'Sports Nutrition' LIMIT 1").get() as {
      id: number;
    }
  ).id;
  const cnSports = cnProducts
    .json<{ items: Array<{ id: string; blockedInCountry?: boolean }> }>()
    .items.find((p) => p.id === String(sportsId));
  const ukSports = ukProducts
    .json<{ items: Array<{ id: string; blockedInCountry?: boolean }> }>()
    .items.find((p) => p.id === String(sportsId));
  assert.equal(cnSports?.blockedInCountry, true);
  assert.equal(ukSports?.blockedInCountry, false);

  const ukPromos = await app.inject({
    method: 'GET',
    url: '/api/admin/promos',
    headers: country('UK'),
  });
  const dePromos = await app.inject({
    method: 'GET',
    url: '/api/admin/promos',
    headers: country('DE'),
  });
  assert.ok(
    ukPromos.json<{ items: Array<{ code: string }> }>().items.some((p) => p.code === 'SAVE10'),
  );
  assert.ok(
    !dePromos.json<{ items: Array<{ code: string }> }>().items.some((p) => p.code === 'SAVE10'),
  );

  const ukFlags = await app.inject({
    method: 'GET',
    url: '/api/admin/feature-flags',
    headers: country('UK'),
  });
  const deFlags = await app.inject({
    method: 'GET',
    url: '/api/admin/feature-flags',
    headers: country('DE'),
  });
  assert.deepEqual(ukFlags.json(), deFlags.json());

  const forbidden = await app.inject({
    method: 'GET',
    url: '/api/admin/users',
    headers: { cookie: customerCookie, 'x-shop-country': 'DE' },
  });
  assert.equal(forbidden.statusCode, 403);
});
