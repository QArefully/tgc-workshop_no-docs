import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import routes from '../src/routes/adminVariants.js';
import { VariantAdminError } from '../src/features/catalog/variantAdminService.js';
import { authPlugin } from '../src/plugins/auth.js';
import { countryContextPlugin } from '../src/plugins/countryContext.js';
const admin = { id: 1, email: 'admin@example.test', displayName: 'Admin', role: 'admin' as const };
const customer = { ...admin, role: 'customer' as const };
void test('admin variant write invokes service and maps missing variants', async () => {
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
      variantAdmin: {
        update: () => {
          invoked = true;
          throw new VariantAdminError('VARIANT_NOT_FOUND', 'missing');
        },
      },
    } as never,
  });
  const payload = { label: 'Updated' };
  const unauthorized = await app.inject({ method: 'PATCH', url: '/api/admin/variants/1', payload });
  const forbidden = await app.inject({
    method: 'PATCH',
    url: '/api/admin/variants/1',
    headers: { cookie: 'sid=customer' },
    payload,
  });
  const mapped = await app.inject({
    method: 'PATCH',
    url: '/api/admin/variants/1',
    headers: { cookie: 'sid=admin', 'x-shop-country': 'DE' },
    payload,
  });
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(forbidden.statusCode, 403);
  assert.equal(mapped.statusCode, 404);
  const body = mapped.json<{ error: string; code: string; meta?: unknown; details?: unknown }>();
  assert.deepEqual(body, {
    error: 'Die Anfrage konnte nicht verarbeitet werden. Bitte versuchen Sie es erneut.',
    code: 'VARIANT_NOT_FOUND',
  });
  assert.equal('meta' in body, false);
  assert.equal('details' in body, false);
  assert.equal(JSON.stringify(body).includes('missing'), false);
  assert.equal(invoked, true);
  await app.close();
});
