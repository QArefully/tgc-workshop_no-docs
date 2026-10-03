import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import routes from '../src/routes/adminOrdersList.js';
import { OrderAdminError } from '../src/features/orders/orderAdminService.js';
import { authPlugin } from '../src/plugins/auth.js';
import { countryContextPlugin } from '../src/plugins/countryContext.js';
const admin = { id: 1, email: 'admin@example.test', displayName: 'Admin', role: 'admin' as const };
const customer = { ...admin, role: 'customer' as const };
void test('admin order listing invokes service and maps invalid queries', async () => {
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
      orderAdmin: {
        listAdmin: () => {
          invoked = true;
          throw new OrderAdminError('INVALID_QUERY');
        },
      },
    } as never,
  });
  const unauthorized = await app.inject({ method: 'GET', url: '/api/admin/orders?page=1' });
  const forbidden = await app.inject({
    method: 'GET',
    url: '/api/admin/orders?page=1',
    headers: { cookie: 'sid=customer' },
  });
  const mapped = await app.inject({
    method: 'GET',
    url: '/api/admin/orders?page=1',
    headers: { cookie: 'sid=admin', 'x-shop-country': 'DE' },
  });
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(forbidden.statusCode, 403);
  assert.equal(mapped.statusCode, 400);
  const body = mapped.json<{ error: string; code: string; meta?: unknown; details?: unknown }>();
  assert.deepEqual(body, {
    error: 'Die Anfrage konnte nicht verarbeitet werden. Bitte versuchen Sie es erneut.',
    code: 'INVALID_QUERY',
  });
  assert.equal('meta' in body, false);
  assert.equal('details' in body, false);
  assert.notEqual(body.error, 'INVALID_QUERY');
  assert.equal(invoked, true);
  await app.close();
});

void test('admin order detail invokes projected detail service and maps missing orders', async () => {
  let invoked = false;
  const app = Fastify();
  await app.register(fastifyCookie);
  const sessions = {
    getUser: (sid: string) => (sid === 'admin' ? admin : null),
    updateLastSeen: () => undefined,
  };
  authPlugin(sessions as never)(app, {}, () => undefined);
  countryContextPlugin(sessions as never)(app, {}, () => undefined);
  await app.register(routes, {
    services: {
      sessions,
      orderAdmin: {
        getAdminDetail: () => {
          invoked = true;
          throw new OrderAdminError('ORDER_NOT_FOUND');
        },
      },
    } as never,
  });
  const response = await app.inject({
    method: 'GET',
    url: '/api/admin/orders/1',
    headers: { cookie: 'sid=admin', 'x-shop-country': 'DE' },
  });
  assert.equal(response.statusCode, 404);
  const body = response.json<{ error: string; code: string; meta?: unknown; details?: unknown }>();
  assert.deepEqual(body, {
    error: 'Die Anfrage konnte nicht verarbeitet werden. Bitte versuchen Sie es erneut.',
    code: 'ORDER_NOT_FOUND',
  });
  assert.equal('meta' in body, false);
  assert.equal('details' in body, false);
  assert.notEqual(body.error, 'ORDER_NOT_FOUND');
  assert.equal(invoked, true);
  await app.close();
});

void test('admin order detail serializes captured-payment refund capacity', async () => {
  const app = Fastify();
  await app.register(fastifyCookie);
  const sessions = {
    getUser: (sid: string) => (sid === 'admin' ? admin : null),
    updateLastSeen: () => undefined,
  };
  authPlugin(sessions as never)(app, {}, () => undefined);
  countryContextPlugin(sessions as never)(app, {}, () => undefined);
  await app.register(routes, {
    services: {
      sessions,
      orderAdmin: {
        getAdminDetail: () => ({
          id: '1',
          status: 'processing',
          version: 0,
          items: [],
          subtotalCents: 1000,
          discountCents: 0,
          totalCents: 1000,
          promoApplied: null,
          createdAt: '2026-07-29T10:00:00.000Z',
          shipments: [],
          events: [],
          canCancel: true,
          refundPayment: { paymentId: '3', remainingRefundableCents: 500 },
        }),
      },
    } as never,
  });
  const response = await app.inject({
    method: 'GET',
    url: '/api/admin/orders/1',
    headers: { cookie: 'sid=admin', 'x-shop-country': 'DE' },
  });
  assert.equal(response.statusCode, 200);
  const body = response.json<{
    refundPayment: { paymentId: string; remainingRefundableCents: number };
  }>();
  assert.deepEqual(body.refundPayment, {
    paymentId: '3',
    remainingRefundableCents: 500,
  });
  await app.close();
});
