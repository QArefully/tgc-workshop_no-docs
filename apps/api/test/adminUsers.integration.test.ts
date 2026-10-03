import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import routes from '../src/routes/adminUsers.js';
import { UserAdminServiceError } from '../src/features/auth/userAdminService.js';
import { authPlugin } from '../src/plugins/auth.js';
import { countryContextPlugin } from '../src/plugins/countryContext.js';
const admin = { id: 1, email: 'admin@example.test', displayName: 'Admin', role: 'admin' as const };
const customer = { ...admin, role: 'customer' as const };
void test('admin user command invokes service and maps missing users', async () => {
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
      userAdmin: {
        suspend: () => {
          invoked = true;
          throw new UserAdminServiceError('NOT_FOUND', 'missing');
        },
      },
    } as never,
  });
  const payload = { reason: 'policy breach' };
  const unauthorized = await app.inject({
    method: 'POST',
    url: '/api/admin/users/1/suspend',
    payload,
  });
  const forbidden = await app.inject({
    method: 'POST',
    url: '/api/admin/users/1/suspend',
    headers: { cookie: 'sid=customer' },
    payload,
  });
  const mapped = await app.inject({
    method: 'POST',
    url: '/api/admin/users/1/suspend',
    headers: { cookie: 'sid=admin', 'x-shop-country': 'DE' },
    payload,
  });
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(forbidden.statusCode, 403);
  assert.equal(mapped.statusCode, 404);
  const body = mapped.json<{ error: string; code: string; meta?: unknown; details?: unknown }>();
  assert.deepEqual(body, {
    error: 'Die angeforderte Ressource wurde nicht gefunden.',
    code: 'NOT_FOUND',
  });
  assert.equal('meta' in body, false);
  assert.equal('details' in body, false);
  assert.equal(JSON.stringify(body).includes('missing'), false);
  assert.equal(invoked, true);
  await app.close();
});
