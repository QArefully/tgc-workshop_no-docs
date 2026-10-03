import assert from 'node:assert/strict';
import test from 'node:test';
import { createCart } from '../../src/features/cart/cartService.js';
import { createCartRepository } from '../../src/features/cart/cartRepository.js';
import { createSeededFixture } from '../support/seededDatabase.js';
import { adhocBilling, adhocDestination, bookableSlot } from '../checkout/checkoutDepthFixtures.js';

const NOW = new Date('2026-09-03T09:00:00.000Z');

function sessionCookie(response: {
  headers: Record<string, string | string[] | undefined>;
}): string {
  const header = response.headers['set-cookie'];
  const cookie = Array.isArray(header) ? header[0] : header;
  if (!cookie) throw new Error('Expected session cookie');
  return cookie.split(';', 1)[0]!;
}

async function login(
  app: Awaited<ReturnType<typeof createSeededFixture>>['app'],
  email: string,
): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/login',
    payload: { email, password: 'Password123!', country: 'UK' },
  });
  assert.equal(response.statusCode, 200, response.body);
  return sessionCookie(response);
}

function createCheckoutCart(db: Parameters<typeof createCartRepository>[0]): {
  cartId: string;
  variantId: number;
  quantity: number;
} {
  const carts = createCartRepository(db);
  const variant = db
    .prepare(
      `SELECT id, moq_sacks FROM product_variants
       WHERE active = 1 ORDER BY id LIMIT 1`,
    )
    .get() as { id: number; moq_sacks: number } | undefined;
  if (!variant) throw new Error('Expected a seeded active variant');
  const quantity = Math.max(1, variant.moq_sacks);
  const cartId = createCart(carts, 'UK').cartId;
  carts.addLineQuantity(cartId, String(variant.id), quantity);
  return { cartId, variantId: variant.id, quantity };
}

void test('composition root wires card and trade-credit journeys exactly once', async (t) => {
  const { app, db } = await createSeededFixture({
    testContext: t,
    app: { clock: { now: () => NOW } },
  });
  await app.ready();
  assert.equal(app.server.listening, false);

  assert.equal(app.hasRoute({ method: 'POST', url: '/api/payments/pay' }), true);
  assert.equal(app.hasRoute({ method: 'GET', url: '/api/company/credit' }), true);
  assert.equal(app.hasRoute({ method: 'GET', url: '/api/admin/credit-accounts' }), true);
  assert.equal(app.hasRoute({ method: 'GET', url: '/api/orders/:orderId/invoice' }), true);

  const adminCookie = await login(app, 'admin@example.com');
  const buyerCookie = await login(app, 'buyer@example.com');
  const company = db
    .prepare(`SELECT id, credit_version AS version FROM company_accounts WHERE name = ?`)
    .get('Acme Materials Ltd') as { id: number; version: number } | undefined;
  if (!company) throw new Error('Expected seeded Acme company');

  const limit = await app.inject({
    method: 'PATCH',
    url: `/api/admin/credit-accounts/${company.id}/limit`,
    headers: { cookie: adminCookie },
    payload: {
      creditLimitCents: 10_000_000,
      expectedVersion: company.version,
      idempotencyKey: '22222222-2222-4222-8222-222222222222',
    },
  });
  assert.equal(limit.statusCode, 200, limit.body);

  const account = await app.inject({
    method: 'GET',
    url: '/api/company/credit',
    headers: { cookie: buyerCookie },
  });
  assert.equal(account.statusCode, 200, account.body);
  assert.equal(account.json<{ companyId: string }>().companyId, String(company.id));

  const cardCart = createCheckoutCart(db);
  const card = await app.inject({
    method: 'POST',
    url: '/api/payments/pay',
    payload: {
      cartId: cardCart.cartId,
      customerName: 'Card Checkout',
      customerEmail: 'card-composition@example.test',
      deliveryDestination: adhocDestination,
      billingSelection: adhocBilling,
      deliverySlot: bookableSlot(NOW),
      cardNumber: '4242 4242 4242 4242',
      cardExpiry: '12/99',
      cardCvc: '123',
      idempotencyKey: '33333333-3333-4333-8333-333333333333',
    },
  });
  assert.equal(card.statusCode, 201, card.body);

  const creditCart = createCheckoutCart(db);
  const credit = await app.inject({
    method: 'POST',
    url: '/api/payments/pay',
    headers: { cookie: buyerCookie },
    payload: {
      cartId: creditCart.cartId,
      customerName: 'Credit Checkout',
      customerEmail: 'buyer@example.com',
      deliveryDestination: adhocDestination,
      billingSelection: adhocBilling,
      deliverySlot: bookableSlot(NOW),
      paymentMethod: 'trade_credit',
      purchaseOrderReference: 'PO-COMPOSITION',
      idempotencyKey: '44444444-4444-4444-8444-444444444444',
    },
  });
  assert.equal(credit.statusCode, 201, credit.body);
  const orderId = credit.json<{ id: string }>().id;
  const invoiceRow = db
    .prepare('SELECT id FROM invoices WHERE order_id = ?')
    .get(Number(orderId)) as { id: number } | undefined;
  if (!invoiceRow) throw new Error('Expected invoice created by trade-credit checkout');

  const buyerInvoice = await app.inject({
    method: 'GET',
    url: `/api/account/invoices/${invoiceRow.id}`,
    headers: { cookie: buyerCookie },
  });
  assert.equal(buyerInvoice.statusCode, 200, buyerInvoice.body);
  const orderInvoice = await app.inject({
    method: 'GET',
    url: `/api/orders/${orderId}/invoice`,
    headers: { cookie: buyerCookie },
  });
  assert.equal(orderInvoice.statusCode, 200, orderInvoice.body);
  const adminInvoices = await app.inject({
    method: 'GET',
    url: `/api/admin/invoices?companyId=${company.id}`,
    headers: { cookie: adminCookie },
  });
  assert.equal(adminInvoices.statusCode, 200, adminInvoices.body);
  const adminInvoice = await app.inject({
    method: 'GET',
    url: `/api/admin/invoices/${invoiceRow.id}`,
    headers: { cookie: adminCookie },
  });
  assert.equal(adminInvoice.statusCode, 200, adminInvoice.body);

  const paymentRow = db
    .prepare('SELECT id, amount_cents FROM payments WHERE idempotency_key = ?')
    .get('44444444-4444-4444-8444-444444444444') as
    { id: number; amount_cents: number } | undefined;
  if (!paymentRow) throw new Error('Expected trade-credit payment');
  const cancelled = await app.inject({
    method: 'POST',
    url: `/api/orders/${orderId}/cancel`,
    headers: { cookie: buyerCookie },
    payload: {
      version: 0,
      idempotencyKey: '55555555-5555-4555-8555-555555555555',
    },
  });
  assert.equal(cancelled.statusCode, 200, cancelled.body);
  assert.equal(
    (
      db.prepare('SELECT status FROM invoice_states WHERE invoice_id = ?').get(invoiceRow.id) as {
        status: string;
      }
    ).status,
    'voided',
  );
  assert.equal(
    (
      db
        .prepare('SELECT status FROM credit_exposure_holds WHERE payment_idempotency_key = ?')
        .get('44444444-4444-4444-8444-444444444444') as { status: string }
    ).status,
    'released',
  );

  const exportResponse = await app.inject({
    method: 'GET',
    url: '/api/account/export',
    headers: { cookie: buyerCookie },
  });
  assert.equal(exportResponse.statusCode, 200, exportResponse.body);
  assert.ok(
    exportResponse
      .json<{ invoices: Array<{ id: string }> }>()
      .invoices.some((entry) => entry.id === String(invoiceRow.id)),
  );

  const returnGuard = await app.inject({
    method: 'GET',
    url: `/api/orders/${orderId}/returns`,
    headers: { cookie: buyerCookie },
  });
  assert.equal(returnGuard.statusCode, 409, returnGuard.body);
  assert.equal(returnGuard.json<{ code: string }>().code, 'PAYMENT_NOT_REFUNDABLE');
  const refundGuard = await app.inject({
    method: 'POST',
    url: '/api/admin/refunds',
    headers: { cookie: adminCookie },
    payload: {
      paymentId: paymentRow.id,
      orderId: Number(orderId),
      amountCents: paymentRow.amount_cents,
      reason: 'Trade-credit guard',
      idempotencyKey: '66666666-6666-4666-8666-666666666666',
    },
  });
  assert.equal(refundGuard.statusCode, 409, refundGuard.body);
  assert.equal(refundGuard.json<{ code: string }>().code, 'PAYMENT_NOT_REFUNDABLE');
});
