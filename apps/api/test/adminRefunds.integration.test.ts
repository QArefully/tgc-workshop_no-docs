import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import routes from '../src/routes/adminRefunds.js';
import { AdminRefundError } from '../src/features/payments/adminRefundService.js';
const admin = { id: 1, email: 'admin@example.test', displayName: 'Admin', role: 'admin' as const };
const customer = { ...admin, role: 'customer' as const };
const payload = {
  paymentId: '1',
  orderId: '1',
  amountCents: 100,
  reason: 'Customer request',
  idempotencyKey: '00000000-0000-4000-8000-000000000001',
};
void test('admin refund command invokes service and maps unrefundable payments', async () => {
  let invoked = false;
  const app = Fastify();
  await app.register(fastifyCookie);
  await app.register(routes, {
    services: {
      sessions: {
        getUser: (sid: string) => (sid === 'admin' ? admin : sid === 'customer' ? customer : null),
      },
      adminRefunds: {
        refund: () => {
          invoked = true;
          throw new AdminRefundError('PAYMENT_NOT_REFUNDABLE');
        },
      },
    } as never,
  });
  const unauthorized = await app.inject({ method: 'POST', url: '/api/admin/refunds', payload });
  const forbidden = await app.inject({
    method: 'POST',
    url: '/api/admin/refunds',
    headers: { cookie: 'sid=customer' },
    payload,
  });
  const mapped = await app.inject({
    method: 'POST',
    url: '/api/admin/refunds',
    headers: { cookie: 'sid=admin' },
    payload,
  });
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(forbidden.statusCode, 403);
  assert.equal(mapped.statusCode, 409);
  assert.equal(invoked, true);
  await app.close();
});
