import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import routes from '../src/routes/adminFeatureFlags.js';
import { FeatureFlagServiceError } from '../src/features/featureFlags/featureFlagService.js';
import { authPlugin } from '../src/plugins/auth.js';
import { countryContextPlugin } from '../src/plugins/countryContext.js';
const admin = { id: 1, email: 'admin@example.test', displayName: 'Admin', role: 'admin' as const };
const customer = { ...admin, role: 'customer' as const };
const payload = { key: 'demo.flag', description: 'Demo feature', enabled: true };
void test('admin flag command invokes service and maps duplicates', async () => {
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
      featureFlags: {
        create: () => {
          invoked = true;
          throw new FeatureFlagServiceError('DUPLICATE', 'duplicate');
        },
      },
    } as never,
  });
  const unauthorized = await app.inject({
    method: 'POST',
    url: '/api/admin/feature-flags',
    payload,
  });
  const forbidden = await app.inject({
    method: 'POST',
    url: '/api/admin/feature-flags',
    headers: { cookie: 'sid=customer' },
    payload,
  });
  const mapped = await app.inject({
    method: 'POST',
    url: '/api/admin/feature-flags',
    headers: { cookie: 'sid=admin', 'x-shop-country': 'DE' },
    payload,
  });
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(forbidden.statusCode, 403);
  assert.equal(mapped.statusCode, 409);
  const body = mapped.json<{ error: string; code: string; meta?: unknown; details?: unknown }>();
  assert.deepEqual(body, {
    error: 'Die Anfrage konnte nicht verarbeitet werden. Bitte versuchen Sie es erneut.',
    code: 'DUPLICATE',
  });
  assert.equal('meta' in body, false);
  assert.equal('details' in body, false);
  assert.equal(JSON.stringify(body).includes('duplicate'), false);
  assert.equal(invoked, true);
  await app.close();
});
