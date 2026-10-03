import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import type { Country } from '@shop/contracts/country';
import type { Invoice } from '@shop/contracts/trade-credit';
import { InvoiceDomainError } from '../../src/features/invoices/invoiceErrors.js';
import type { InvoiceService } from '../../src/features/invoices/invoiceService.js';
import type { CreditAccountService } from '../../src/features/tradeCredit/creditAccountService.js';
import type { SessionService } from '../../src/features/auth/sessionService.js';
import tradeCreditRoutes from '../../src/routes/tradeCredit.js';

const invoice = {
  version: 1,
  id: '101',
  invoiceNumber: 'QME-2026-000101',
  orderId: '55',
  companyId: '7',
  userId: '3',
  country: 'UK',
  paymentMethod: 'trade_credit',
  currency: 'GBP',
  terms: 'net_30',
  billingEntity: {
    legalName: 'Example Trading Ltd',
    registrationNumber: null,
    vatNumber: null,
    address: {
      line1: '1 Example Street',
      city: 'London',
      postcode: 'EC1A 1BB',
      countryCode: 'GB',
    },
  },
  purchaseOrderReference: 'PO-101',
  lines: [
    {
      lineId: '1',
      description: 'Material sacks',
      quantity: 2,
      unitPriceCents: 5_000,
      netCents: 10_000,
    },
  ],
  netCents: 10_000,
  vatRateBasisPoints: 2_000,
  vatCents: 2_000,
  grossCents: 12_000,
  issuedAt: '2026-09-01T00:00:00.000Z',
  dueAt: '2026-10-01T00:00:00.000Z',
  status: 'open',
  settledAt: null,
  lifecycleVersion: 0,
  lifecycle: {
    invoiceId: '101',
    status: 'open',
    version: 0,
    settledAt: null,
    updatedAt: '2026-09-01T00:00:00.000Z',
  },
  settlement: null,
  events: [{ id: '301', invoiceId: '101', type: 'issued', occurredAt: '2026-09-01T00:00:00.000Z' }],
} satisfies Invoice;

function createApp(
  getOwned: (invoiceId: number, userId: number) => Invoice,
  getMember: (userId: number) => null,
) {
  const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
  app.decorateRequest('authenticatedUser', null);
  app.decorateRequest('sessionToken', null);
  app.decorateRequest('resolvedCountry', null as unknown as Country);
  app.addHook('preValidation', (request, _reply, done) => {
    const role = request.headers['x-test-role'];
    request.authenticatedUser =
      role === 'customer'
        ? {
            id: 3,
            email: 'buyer@example.test',
            displayName: 'Buyer',
            role: 'customer',
            country: 'UK',
          }
        : role === 'admin'
          ? {
              id: 9,
              email: 'admin@example.test',
              displayName: 'Admin',
              role: 'admin',
              country: 'UK',
            }
          : null;
    request.resolvedCountry = request.headers['x-shop-country'] === 'DE' ? 'DE' : 'UK';
    done();
  });
  const sessions = {} as SessionService;
  const creditAccounts = { getMember } as Pick<CreditAccountService, 'getMember'>;
  const invoices = { getOwned } as Pick<InvoiceService, 'getOwned'>;
  app.register(tradeCreditRoutes, { services: { sessions, creditAccounts, invoices } });
  return app;
}

void test('buyer credit and invoice routes enforce role, ownership, country, and closed queries', async (t) => {
  const app = createApp(
    (invoiceId, userId) => {
      if (invoiceId === 101 && userId === 3) return invoice;
      throw new InvoiceDomainError('INVOICE_NOT_FOUND');
    },
    () => null,
  );
  t.after(() => app.close());
  await app.ready();

  assert.equal((await app.inject('/api/company/credit')).statusCode, 401);
  assert.equal(
    (await app.inject({ url: '/api/company/credit', headers: { 'x-test-role': 'admin' } }))
      .statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        url: '/api/company/credit?companyId=7',
        headers: { 'x-test-role': 'customer' },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (await app.inject({ url: '/api/company/credit', headers: { 'x-test-role': 'customer' } }))
      .statusCode,
    200,
  );

  assert.equal((await app.inject('/api/account/invoices/101')).statusCode, 401);
  assert.equal(
    (await app.inject({ url: '/api/account/invoices/101', headers: { 'x-test-role': 'admin' } }))
      .statusCode,
    403,
  );
  const owned = await app.inject({
    url: '/api/account/invoices/101',
    headers: { 'x-test-role': 'customer' },
  });
  assert.equal(owned.statusCode, 200);
  assert.equal(owned.json<{ id: string }>().id, '101');

  const foreign = await app.inject({
    url: '/api/account/invoices/102',
    headers: { 'x-test-role': 'customer' },
  });
  assert.equal(foreign.statusCode, 404);
  const wrongCountry = await app.inject({
    url: '/api/account/invoices/101',
    headers: { 'x-test-role': 'customer', 'x-shop-country': 'DE' },
  });
  assert.equal(wrongCountry.statusCode, 404);
  assert.equal(JSON.stringify(wrongCountry.json()).includes('InvoiceDomainError'), false);
});
