import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import routes from '../src/routes/adminProducts.js';
import { ProductAdminError } from '../src/features/catalog/productAdminService.js';
import { authPlugin } from '../src/plugins/auth.js';
import { countryContextPlugin } from '../src/plugins/countryContext.js';
const admin = { id: 1, email: 'admin@example.test', displayName: 'Admin', role: 'admin' as const };
const customer = { ...admin, role: 'customer' as const };
void test('admin product write invokes service and maps duplicate slugs', async () => {
  let invoked = false;
  const app = Fastify();
  await app.register(fastifyCookie);
  const sessions = {
    getUser: (sid: string) => (sid === 'admin' ? admin : sid === 'customer' ? customer : null),
    updateLastSeen: () => undefined,
  };
  authPlugin(sessions as never)(app, {}, () => undefined);
  countryContextPlugin(sessions as never)(app, {}, () => undefined);
  await app.register(routes, {
    services: {
      sessions,
      productAdmin: {
        create: () => {
          invoked = true;
          throw new ProductAdminError('DUPLICATE_SLUG');
        },
      },
    } as never,
  });
  const payload = {
    name: 'Product',
    description: 'Description',
    priceCents: 100,
    category: 'Drinks',
    stockCount: 0,
    slug: 'product',
    consumptionClassification: 'food',
    mixingGroup: 'food-grade',
  };
  const unauthorized = await app.inject({ method: 'POST', url: '/api/admin/products', payload });
  const forbidden = await app.inject({
    method: 'POST',
    url: '/api/admin/products',
    headers: { cookie: 'sid=customer' },
    payload,
  });
  const mapped = await app.inject({
    method: 'POST',
    url: '/api/admin/products',
    headers: { cookie: 'sid=admin', 'x-shop-country': 'DE' },
    payload,
  });
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(forbidden.statusCode, 403);
  assert.equal(mapped.statusCode, 409);
  const body = mapped.json<{ error: string; code: string; meta?: unknown; details?: unknown }>();
  assert.deepEqual(body, {
    error: 'Die Anfrage konnte nicht verarbeitet werden. Bitte versuchen Sie es erneut.',
    code: 'DUPLICATE_SLUG',
  });
  assert.equal('meta' in body, false);
  assert.equal('details' in body, false);
  assert.notEqual(body.error, 'DUPLICATE_SLUG');
  assert.equal(body.error.includes('slug'), false);
  assert.equal(invoked, true);
  await app.close();
});
