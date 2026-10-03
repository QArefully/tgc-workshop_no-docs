import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import type { Country } from '@shop/contracts/country';
import { InvoiceDomainError } from '../../src/features/invoices/invoiceErrors.js';
import type { SessionService } from '../../src/features/auth/sessionService.js';
import type { OrdersRouteServices } from '../../src/routes/orders.js';
import ordersRoutes from '../../src/routes/orders.js';

const idempotencyKey = '123e4567-e89b-42d3-a456-426614174000';

function createApp(invoiceError: InvoiceDomainError) {
  const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
  app.decorateRequest('authenticatedUser', null);
  app.decorateRequest('sessionToken', null);
  app.decorateRequest('resolvedCountry', null as unknown as Country);
  app.addHook('preValidation', (request, _reply, done) => {
    request.authenticatedUser = {
      id: 3,
      email: 'buyer@example.test',
      displayName: 'Buyer',
      role: 'customer',
      country: 'UK',
    };
    request.resolvedCountry = 'UK';
    done();
  });
  const services = {
    sessions: {} as SessionService,
    orders: {
      getOwned: () => ({}) as never,
      cancel: () => {
        throw invoiceError;
      },
    },
    orderAccess: { validate: () => false },
  } as unknown as OrdersRouteServices;
  app.register(ordersRoutes, { services });
  return app;
}

void test('credit-order cancellation maps a paid invoice race to a public 409', async (t) => {
  const app = createApp(new InvoiceDomainError('INVOICE_ALREADY_PAID'));
  t.after(() => app.close());
  await app.ready();
  const response = await app.inject({
    method: 'POST',
    url: '/api/orders/55/cancel',
    payload: { version: 0, idempotencyKey },
  });
  assert.equal(response.statusCode, 409);
  const body = response.json<{ error: string; code: string }>();
  assert.equal(body.code, 'INVOICE_ALREADY_PAID');
  assert.equal(body.error.includes('InvoiceDomainError'), false);
});

void test('credit-order cancellation hides invoice settlement races behind generic conflict', async (t) => {
  const app = createApp(new InvoiceDomainError('INVOICE_SETTLEMENT_CONFLICT'));
  t.after(() => app.close());
  await app.ready();
  const response = await app.inject({
    method: 'POST',
    url: '/api/orders/55/cancel',
    payload: { version: 0, idempotencyKey },
  });
  assert.equal(response.statusCode, 409);
  assert.deepEqual(response.json(), {
    error: 'The request conflicts with current data.',
    code: 'CONFLICT',
  });
});
