import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import routes from '../src/routes/adminPromos.js';
import { PromoAdminServiceError } from '../src/features/promos/promoAdminService.js';
const admin = { id: 1, email: 'admin@example.test', displayName: 'Admin', role: 'admin' as const };
const customer = { ...admin, role: 'customer' as const };
const payload = {
  code: 'SAVE10',
  discountPercent: 10,
  minItemCount: 0,
  kind: 'percent',
  amountCents: null,
  minSubtotalCents: null,
  categoryScope: null,
  startAt: null,
  endAt: null,
  maxRedemptions: null,
  perUserLimit: null,
};
void test('admin promo write invokes service and maps duplicates', async () => {
  let invoked = false;
  const app = Fastify();
  await app.register(fastifyCookie);
  await app.register(routes, {
    services: {
      sessions: {
        getUser: (sid: string) => (sid === 'admin' ? admin : sid === 'customer' ? customer : null),
      },
      promoAdmin: {
        create: () => {
          invoked = true;
          throw new PromoAdminServiceError('DUPLICATE', 'duplicate');
        },
      },
    } as never,
  });
  const unauthorized = await app.inject({ method: 'POST', url: '/api/admin/promos', payload });
  const forbidden = await app.inject({
    method: 'POST',
    url: '/api/admin/promos',
    headers: { cookie: 'sid=customer' },
    payload,
  });
  const mapped = await app.inject({
    method: 'POST',
    url: '/api/admin/promos',
    headers: { cookie: 'sid=admin' },
    payload,
  });
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(forbidden.statusCode, 403);
  assert.equal(mapped.statusCode, 409);
  assert.equal(invoked, true);
  await app.close();
});
