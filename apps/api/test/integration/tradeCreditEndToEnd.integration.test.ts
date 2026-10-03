import assert from 'node:assert/strict';
import test from 'node:test';
import type Database from 'better-sqlite3';
import { createSeededAppFixture } from '../support/seededDatabase.js';
import { adhocBilling, adhocDestination, bookableSlot } from '../checkout/checkoutDepthFixtures.js';
import type { PaymentGateway } from '../../src/features/payments/paymentGateway.js';

const NOW = new Date('2026-09-03T09:00:00.000Z');

type VariantFacts = {
  id: number;
  product_id: number;
  sku: string;
  price_cents: number;
  stock_count: number;
  weight_grams: number;
  moq_sacks: number;
};

type CompanyFacts = {
  id: number;
  credit_limit_cents: number;
  approval_threshold_cents: number | null;
  credit_state: 'active' | 'on_hold' | 'suspended';
  credit_version: number;
};

type PaymentFacts = {
  id: number;
  status: string;
  amount_cents: number;
  payment_method: string;
  order_id: number | null;
  quote_json: string | null;
};

type InvoiceFacts = {
  id: number;
  order_id: number;
  gross_cents: number;
  status: string;
  version: number;
};

function responseBody<T>(response: { body: string }): T {
  return JSON.parse(response.body) as T;
}

function sessionCookie(response: {
  headers: Record<string, string | string[] | undefined>;
}): string {
  const header = response.headers['set-cookie'];
  const cookie = Array.isArray(header) ? header[0] : header;
  if (!cookie) throw new Error('Expected session cookie');
  return cookie.split(';', 1)[0]!;
}

function countRows(db: Database.Database, sql: string, ...parameters: unknown[]): number {
  return (db.prepare(sql).get(...parameters) as { count: number }).count;
}

function errorCode(response: { statusCode: number; body: string }, statusCode: number): string {
  assert.equal(response.statusCode, statusCode, response.body);
  return responseBody<{ code: string }>(response).code;
}

function seededCompany(db: Database.Database): CompanyFacts {
  const company = db
    .prepare(
      `SELECT id, credit_limit_cents, approval_threshold_cents, credit_state, credit_version
       FROM company_accounts WHERE name = ?`,
    )
    .get('Acme Materials Ltd') as CompanyFacts | undefined;
  if (!company) throw new Error('Expected canonical Acme company seed');
  return company;
}

function selectVariant(
  db: Database.Database,
  predicate: string,
  parameters: unknown[] = [],
): VariantFacts {
  const variant = db
    .prepare(
      `SELECT id, product_id, sku, price_cents, stock_count, weight_grams, moq_sacks
       FROM product_variants
       WHERE active = 1 AND stock_count >= moq_sacks AND ${predicate}
       ORDER BY price_cents DESC, id
       LIMIT 1`,
    )
    .get(...parameters) as VariantFacts | undefined;
  if (!variant) throw new Error(`Expected seeded active variant matching ${predicate}`);
  return variant;
}

async function login(
  app: Awaited<ReturnType<typeof createSeededAppFixture>>['app'],
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

async function createCart(
  app: Awaited<ReturnType<typeof createSeededAppFixture>>['app'],
  cookie: string | undefined,
  variant: VariantFacts,
  quantity: number,
): Promise<string> {
  const headers = cookie ? { cookie } : undefined;
  const created = await app.inject({
    method: 'POST',
    url: '/api/cart',
    ...(headers ? { headers } : {}),
    payload: { country: 'UK' },
  });
  assert.equal(created.statusCode, 201, created.body);
  const cartId = responseBody<{ cartId: string }>(created).cartId;
  const added = await app.inject({
    method: 'POST',
    url: `/api/cart/${cartId}/items`,
    ...(headers ? { headers } : {}),
    payload: {
      productId: String(variant.product_id),
      variantId: variant.id,
      quantity,
    },
  });
  assert.equal(added.statusCode, 200, added.body);
  return cartId;
}

function creditPaymentPayload(
  cartId: string,
  idempotencyKey: string,
  customerEmail: string,
  purchaseOrderReference: string,
) {
  return {
    cartId,
    customerName: 'Acme Buyer',
    customerEmail,
    deliveryDestination: adhocDestination,
    billingSelection: adhocBilling,
    deliverySlot: bookableSlot(NOW),
    paymentMethod: 'trade_credit' as const,
    purchaseOrderReference,
    idempotencyKey,
  };
}

function cardPaymentPayload(cartId: string, idempotencyKey: string) {
  return {
    cartId,
    customerName: 'Card Buyer',
    customerEmail: `card-${idempotencyKey}@example.test`,
    deliveryDestination: adhocDestination,
    billingSelection: adhocBilling,
    deliverySlot: bookableSlot(NOW),
    cardNumber: '4242 4242 4242 4242',
    cardExpiry: '12/99',
    cardCvc: '123',
    idempotencyKey,
  };
}

function paymentByKey(db: Database.Database, idempotencyKey: string): PaymentFacts {
  const payment = db
    .prepare(
      `SELECT id, status, amount_cents, payment_method, order_id, quote_json
       FROM payments WHERE idempotency_key = ?`,
    )
    .get(idempotencyKey) as PaymentFacts | undefined;
  if (!payment) throw new Error(`Expected payment ${idempotencyKey}`);
  return payment;
}

function invoiceByKey(db: Database.Database, idempotencyKey: string): InvoiceFacts {
  const invoice = db
    .prepare(
      `SELECT invoice.id, invoice.order_id, invoice.gross_cents,
              state.status, state.version
       FROM invoices invoice
       JOIN invoice_states state ON state.invoice_id = invoice.id
       WHERE invoice.payment_idempotency_key = ?`,
    )
    .get(idempotencyKey) as InvoiceFacts | undefined;
  if (!invoice) throw new Error(`Expected invoice for ${idempotencyKey}`);
  return invoice;
}

function accountView(body: string): {
  companyId: string;
  state: string;
  creditLimitCents: number;
  outstandingCents: number;
  heldCents: number;
  exposureCents: number;
  availableCreditCents: number;
  termsDays?: number;
} {
  return JSON.parse(body) as {
    companyId: string;
    state: string;
    creditLimitCents: number;
    outstandingCents: number;
    heldCents: number;
    exposureCents: number;
    availableCreditCents: number;
    termsDays?: number;
  };
}

void test('composed trade-credit approval, V10 finalization, settlement, and replay journey', async (t) => {
  let gatewayCalls = 0;
  const gateway: PaymentGateway = {
    process: () => {
      gatewayCalls += 1;
      return Promise.resolve({
        status: 'success' as const,
        reference: `unexpected-credit-gateway-${gatewayCalls}`,
      });
    },
  };
  const { app, db } = await createSeededAppFixture({
    testContext: t,
    app: { clock: { now: () => NOW }, paymentGateway: gateway },
  });
  const buyerCookie = await login(app, 'buyer@example.com');
  const approverCookie = await login(app, 'approver@example.com');
  const adminCookie = await login(app, 'admin@example.com');
  const company = seededCompany(db);

  const accountResponse = await app.inject({
    method: 'GET',
    url: '/api/company/credit',
    headers: { cookie: buyerCookie },
  });
  assert.equal(accountResponse.statusCode, 200, accountResponse.body);
  const account = accountView(accountResponse.body);
  assert.equal(account.companyId, String(company.id));
  assert.equal(account.state, 'active');
  assert.equal(account.creditLimitCents, company.credit_limit_cents);
  assert.equal(account.termsDays, 30);

  const highVariant = selectVariant(
    db,
    "sku = 'SPN-1008-001' AND price_cents BETWEEN 10000 AND 100000 AND weight_grams >= 25000",
  );
  const threshold = company.approval_threshold_cents ?? 0;
  const quantity = Math.max(
    highVariant.moq_sacks,
    Math.ceil((threshold + 1) / highVariant.price_cents),
  );
  assert.ok(quantity <= highVariant.stock_count, 'approval journey needs enough seeded stock');
  const cartId = await createCart(app, buyerCookie, highVariant, quantity);
  const idempotencyKey = 'a1111111-1111-4111-8111-111111111111';
  const paymentPayload = creditPaymentPayload(
    cartId,
    idempotencyKey,
    'buyer@example.com',
    'PO-P15B-APPROVED',
  );

  const pending = await app.inject({
    method: 'POST',
    url: '/api/payments/pay',
    headers: { cookie: buyerCookie },
    payload: paymentPayload,
  });
  assert.equal(pending.statusCode, 409, pending.body);
  const pendingBody = responseBody<{ code: string; meta?: { approvalRequestId?: string } }>(
    pending,
  );
  assert.equal(pendingBody.code, 'PENDING_APPROVAL');
  const approvalRequestId = pendingBody.meta?.approvalRequestId;
  assert.ok(approvalRequestId);
  const approval = db
    .prepare(
      `SELECT status, quote_total_cents FROM order_approvals
       WHERE id = ? AND idempotency_key = ?`,
    )
    .get(Number(approvalRequestId), idempotencyKey) as
    { status: string; quote_total_cents: number } | undefined;
  assert.ok(approval);
  assert.equal(approval.status, 'pending');
  assert.ok(approval.quote_total_cents >= threshold);
  const pendingPayment = paymentByKey(db, idempotencyKey);
  assert.equal(pendingPayment.status, 'failed_pre_gateway');
  assert.equal(pendingPayment.amount_cents, 0);
  assert.equal(
    countRows(
      db,
      'SELECT COUNT(*) AS count FROM credit_exposure_holds WHERE payment_idempotency_key = ?',
      idempotencyKey,
    ),
    0,
  );
  assert.equal(gatewayCalls, 0, 'approval gate must not invoke the card gateway');

  const approved = await app.inject({
    method: 'POST',
    url: `/api/approvals/${approvalRequestId}/decision`,
    headers: { cookie: approverCookie },
    payload: { action: 'approve' },
  });
  assert.equal(approved.statusCode, 200, approved.body);

  const finalized = await app.inject({
    method: 'POST',
    url: '/api/payments/pay',
    headers: { cookie: buyerCookie },
    payload: paymentPayload,
  });
  assert.equal(finalized.statusCode, 201, finalized.body);
  const orderId = responseBody<{ id: string }>(finalized).id;
  const payment = paymentByKey(db, idempotencyKey);
  const invoice = invoiceByKey(db, idempotencyKey);
  assert.equal(invoice.status, 'open');
  assert.equal(payment.status, 'succeeded');
  assert.equal(payment.payment_method, 'trade_credit');
  assert.equal(payment.amount_cents, invoice.gross_cents);
  assert.equal(payment.order_id, Number(orderId));
  const quoteJson = payment.quote_json;
  assert.ok(quoteJson);
  const persistedQuote = JSON.parse(quoteJson) as { version?: unknown };
  assert.equal(persistedQuote.version, 10);
  assert.deepEqual(
    db
      .prepare(
        `SELECT status, invoice_id, amount_cents FROM credit_exposure_holds
         WHERE payment_idempotency_key = ?`,
      )
      .get(idempotencyKey),
    { status: 'committed', invoice_id: invoice.id, amount_cents: invoice.gross_cents },
  );
  assert.equal(
    countRows(
      db,
      'SELECT COUNT(*) AS count FROM invoices WHERE payment_idempotency_key = ?',
      idempotencyKey,
    ),
    1,
  );
  assert.equal(
    countRows(db, 'SELECT COUNT(*) AS count FROM orders WHERE id = ?', Number(orderId)),
    1,
  );
  assert.equal(
    countRows(
      db,
      `SELECT COUNT(*) AS count FROM orders
       WHERE payment_method = 'trade_credit' AND purchase_order_reference = ?`,
      'PO-P15B-APPROVED',
    ),
    1,
  );
  assert.equal(
    countRows(db, 'SELECT COUNT(*) AS count FROM dev_mailbox WHERE invoice_id = ?', invoice.id),
    1,
  );
  assert.equal(
    countRows(
      db,
      `SELECT COUNT(*) AS count FROM audit_events
       WHERE action = 'invoice.issued' AND entity_type = 'invoice' AND entity_id = ?`,
      String(invoice.id),
    ),
    1,
  );
  assert.equal(
    countRows(
      db,
      `SELECT COUNT(*) AS count FROM audit_events
       WHERE action = 'order.created' AND entity_type = 'order' AND entity_id = ?`,
      String(orderId),
    ),
    1,
  );

  const replay = await app.inject({
    method: 'POST',
    url: '/api/payments/pay',
    headers: { cookie: buyerCookie },
    payload: paymentPayload,
  });
  assert.equal(replay.statusCode, 201, replay.body);
  assert.equal(responseBody<{ id: string }>(replay).id, orderId);
  assert.equal(
    countRows(
      db,
      'SELECT COUNT(*) AS count FROM invoices WHERE payment_idempotency_key = ?',
      idempotencyKey,
    ),
    1,
  );
  assert.equal(
    countRows(db, 'SELECT COUNT(*) AS count FROM dev_mailbox WHERE invoice_id = ?', invoice.id),
    1,
  );
  assert.equal(
    countRows(
      db,
      `SELECT COUNT(*) AS count FROM orders
       WHERE payment_method = 'trade_credit' AND purchase_order_reference = ?`,
      'PO-P15B-APPROVED',
    ),
    1,
  );
  assert.equal(gatewayCalls, 0, 'credit retry and replay must never invoke the card gateway');

  const beforeSettlement = accountView(
    (
      await app.inject({
        method: 'GET',
        url: '/api/company/credit',
        headers: { cookie: buyerCookie },
      })
    ).body,
  );
  const settleKey = 'a2222222-2222-4222-8222-222222222222';
  const settled = await app.inject({
    method: 'POST',
    url: `/api/admin/invoices/${invoice.id}/settle`,
    headers: { cookie: adminCookie },
    payload: { expectedVersion: invoice.version, idempotencyKey: settleKey },
  });
  assert.equal(settled.statusCode, 200, settled.body);
  assert.equal(responseBody<{ status: string }>(settled).status, 'paid');
  const afterSettlement = accountView(
    (
      await app.inject({
        method: 'GET',
        url: '/api/company/credit',
        headers: { cookie: buyerCookie },
      })
    ).body,
  );
  assert.equal(beforeSettlement.exposureCents - afterSettlement.exposureCents, invoice.gross_cents);
  assert.equal(
    beforeSettlement.outstandingCents - afterSettlement.outstandingCents,
    invoice.gross_cents,
  );
  assert.deepEqual(
    db.prepare('SELECT status FROM invoice_states WHERE invoice_id = ?').get(invoice.id),
    { status: 'paid' },
  );
  assert.equal(
    countRows(
      db,
      `SELECT COUNT(*) AS count FROM invoice_events
       WHERE invoice_id = ? AND event_type = 'settled'`,
      invoice.id,
    ),
    1,
  );
  assert.equal(
    countRows(
      db,
      `SELECT COUNT(*) AS count FROM audit_events
       WHERE action = 'invoice.settled' AND entity_type = 'invoice' AND entity_id = ?`,
      String(invoice.id),
    ),
    1,
  );
  const settlementReplay = await app.inject({
    method: 'POST',
    url: `/api/admin/invoices/${invoice.id}/settle`,
    headers: { cookie: adminCookie },
    payload: { expectedVersion: invoice.version, idempotencyKey: settleKey },
  });
  assert.equal(settlementReplay.statusCode, 200, settlementReplay.body);
  assert.equal(
    countRows(
      db,
      `SELECT COUNT(*) AS count FROM invoice_events
       WHERE invoice_id = ? AND event_type = 'settled'`,
      invoice.id,
    ),
    1,
  );
  assert.equal(
    countRows(
      db,
      `SELECT COUNT(*) AS count FROM audit_events
       WHERE action = 'invoice.settled' AND entity_type = 'invoice' AND entity_id = ?`,
      String(invoice.id),
    ),
    1,
  );

  const paidCancel = await app.inject({
    method: 'POST',
    url: `/api/orders/${orderId}/cancel`,
    headers: { cookie: buyerCookie },
    payload: { version: 0, idempotencyKey: 'a3333333-3333-4333-8333-333333333333' },
  });
  assert.equal(errorCode(paidCancel, 409), 'INVOICE_ALREADY_PAID');
  assert.notEqual(
    (
      db
        .prepare('SELECT lifecycle_status AS status FROM orders WHERE id = ?')
        .get(Number(orderId)) as {
        status: string;
      }
    ).status,
    'cancelled',
  );

  const returnGuard = await app.inject({
    method: 'GET',
    url: `/api/orders/${orderId}/returns`,
    headers: { cookie: buyerCookie },
  });
  assert.equal(errorCode(returnGuard, 409), 'PAYMENT_NOT_REFUNDABLE');
  const refundGuard = await app.inject({
    method: 'POST',
    url: '/api/admin/refunds',
    headers: { cookie: adminCookie },
    payload: {
      paymentId: payment.id,
      orderId: Number(orderId),
      amountCents: payment.amount_cents,
      reason: 'Credit return guard',
      idempotencyKey: 'a4444444-4444-4444-8444-444444444444',
    },
  });
  assert.equal(errorCode(refundGuard, 409), 'PAYMENT_NOT_REFUNDABLE');
  assert.equal(
    countRows(db, 'SELECT COUNT(*) AS count FROM admin_refunds WHERE payment_id = ?', payment.id),
    0,
  );
});

void test('trade-credit denial states leave card fallback and credit exposure unchanged', async (t) => {
  let gatewayCalls = 0;
  const gateway: PaymentGateway = {
    process: () => {
      gatewayCalls += 1;
      return Promise.resolve({
        status: 'success' as const,
        reference: `card-${gatewayCalls}`,
      });
    },
  };
  const { app, db } = await createSeededAppFixture({
    testContext: t,
    app: { clock: { now: () => NOW }, paymentGateway: gateway },
  });
  const buyerCookie = await login(app, 'buyer@example.com');
  const adminCookie = await login(app, 'admin@example.com');
  const company = seededCompany(db);
  const lowVariant = selectVariant(db, "sku = 'BKP-0005-001' AND price_cents <= 2500");

  const cardKey = 'b1111111-1111-4111-8111-111111111111';
  const cardCart = await createCart(app, undefined, lowVariant, lowVariant.moq_sacks);
  const card = await app.inject({
    method: 'POST',
    url: '/api/payments/pay',
    payload: cardPaymentPayload(cardCart, cardKey),
  });
  assert.equal(card.statusCode, 201, card.body);
  assert.equal(gatewayCalls, 1, 'legacy card checkout still uses the gateway');
  assert.deepEqual(
    db
      .prepare('SELECT status, payment_method, company_id FROM payments WHERE idempotency_key = ?')
      .get(cardKey),
    { status: 'succeeded', payment_method: 'card', company_id: null },
  );

  const limited = await app.inject({
    method: 'PATCH',
    url: `/api/admin/credit-accounts/${company.id}/limit`,
    headers: { cookie: adminCookie },
    payload: {
      creditLimitCents: 1,
      expectedVersion: company.credit_version,
      idempotencyKey: 'b2222222-2222-4222-8222-222222222222',
    },
  });
  assert.equal(limited.statusCode, 200, limited.body);
  const limitedVersion = responseBody<{ version: number }>(limited).version;
  const overKey = 'b3333333-3333-4333-8333-333333333333';
  const overCart = await createCart(app, buyerCookie, lowVariant, lowVariant.moq_sacks);
  const overLimit = await app.inject({
    method: 'POST',
    url: '/api/payments/pay',
    headers: { cookie: buyerCookie },
    payload: creditPaymentPayload(overCart, overKey, 'buyer@example.com', 'PO-P15B-LIMIT'),
  });
  assert.equal(errorCode(overLimit, 409), 'CREDIT_LIMIT_EXCEEDED');
  assert.equal(gatewayCalls, 1);
  assert.equal(
    countRows(
      db,
      'SELECT COUNT(*) AS count FROM credit_exposure_holds WHERE payment_idempotency_key = ?',
      overKey,
    ),
    0,
  );

  const onHold = await app.inject({
    method: 'PATCH',
    url: `/api/admin/credit-accounts/${company.id}/state`,
    headers: { cookie: adminCookie },
    payload: {
      state: 'on_hold',
      expectedVersion: limitedVersion,
      idempotencyKey: 'b4444444-4444-4444-8444-444444444444',
    },
  });
  assert.equal(onHold.statusCode, 200, onHold.body);
  const onHoldVersion = responseBody<{ version: number }>(onHold).version;
  const onHoldKey = 'b5555555-5555-4555-8555-555555555555';
  const onHoldCart = await createCart(app, buyerCookie, lowVariant, lowVariant.moq_sacks);
  const onHoldCheckout = await app.inject({
    method: 'POST',
    url: '/api/payments/pay',
    headers: { cookie: buyerCookie },
    payload: creditPaymentPayload(onHoldCart, onHoldKey, 'buyer@example.com', 'PO-P15B-HOLD'),
  });
  assert.equal(errorCode(onHoldCheckout, 409), 'CREDIT_ACCOUNT_ON_HOLD');
  assert.equal(
    countRows(
      db,
      'SELECT COUNT(*) AS count FROM credit_exposure_holds WHERE payment_idempotency_key = ?',
      onHoldKey,
    ),
    0,
  );

  const suspended = await app.inject({
    method: 'PATCH',
    url: `/api/admin/credit-accounts/${company.id}/state`,
    headers: { cookie: adminCookie },
    payload: {
      state: 'suspended',
      expectedVersion: onHoldVersion,
      idempotencyKey: 'b6666666-6666-4666-8666-666666666666',
    },
  });
  assert.equal(suspended.statusCode, 200, suspended.body);
  const suspendedKey = 'b7777777-7777-4777-8777-777777777777';
  const suspendedCart = await createCart(app, buyerCookie, lowVariant, lowVariant.moq_sacks);
  const suspendedCheckout = await app.inject({
    method: 'POST',
    url: '/api/payments/pay',
    headers: { cookie: buyerCookie },
    payload: creditPaymentPayload(
      suspendedCart,
      suspendedKey,
      'buyer@example.com',
      'PO-P15B-SUSPENDED',
    ),
  });
  assert.equal(errorCode(suspendedCheckout, 409), 'CREDIT_ACCOUNT_SUSPENDED');
  assert.equal(
    countRows(
      db,
      'SELECT COUNT(*) AS count FROM credit_exposure_holds WHERE payment_idempotency_key = ?',
      suspendedKey,
    ),
    0,
  );
  assert.equal(gatewayCalls, 1, 'credit denials must not affect card gateway calls');
});

void test('unpaid trade-credit cancellation voids its invoice, releases exposure, and replays once', async (t) => {
  const gateway: PaymentGateway = {
    process: () => Promise.resolve({ status: 'success' as const, reference: 'must-not-run' }),
  };
  const { app, db } = await createSeededAppFixture({
    testContext: t,
    app: { clock: { now: () => NOW }, paymentGateway: gateway },
  });
  const buyerCookie = await login(app, 'buyer@example.com');
  const lowVariant = selectVariant(db, "sku = 'BKP-0005-001' AND price_cents <= 2500");
  const key = 'c1111111-1111-4111-8111-111111111111';
  const cartId = await createCart(app, buyerCookie, lowVariant, lowVariant.moq_sacks);
  const checkout = await app.inject({
    method: 'POST',
    url: '/api/payments/pay',
    headers: { cookie: buyerCookie },
    payload: creditPaymentPayload(cartId, key, 'buyer@example.com', 'PO-P15B-CANCEL'),
  });
  assert.equal(checkout.statusCode, 201, checkout.body);
  const orderId = Number(responseBody<{ id: string }>(checkout).id);
  const invoice = invoiceByKey(db, key);
  assert.equal(invoice.status, 'open');
  const before = accountView(
    (
      await app.inject({
        method: 'GET',
        url: '/api/company/credit',
        headers: { cookie: buyerCookie },
      })
    ).body,
  );
  const cancelKey = 'c2222222-2222-4222-8222-222222222222';
  const cancelled = await app.inject({
    method: 'POST',
    url: `/api/orders/${orderId}/cancel`,
    headers: { cookie: buyerCookie },
    payload: { version: 0, idempotencyKey: cancelKey },
  });
  assert.equal(cancelled.statusCode, 200, cancelled.body);
  assert.deepEqual(
    db.prepare('SELECT status FROM invoice_states WHERE invoice_id = ?').get(invoice.id),
    { status: 'voided' },
  );
  assert.deepEqual(
    db
      .prepare(
        `SELECT status, invoice_id FROM credit_exposure_holds
         WHERE payment_idempotency_key = ?`,
      )
      .get(key),
    { status: 'released', invoice_id: invoice.id },
  );
  const after = accountView(
    (
      await app.inject({
        method: 'GET',
        url: '/api/company/credit',
        headers: { cookie: buyerCookie },
      })
    ).body,
  );
  assert.equal(before.exposureCents - after.exposureCents, invoice.gross_cents);
  assert.equal(before.outstandingCents - after.outstandingCents, invoice.gross_cents);
  assert.equal(
    (
      db.prepare('SELECT lifecycle_status AS status FROM orders WHERE id = ?').get(orderId) as {
        status: string;
      }
    ).status,
    'cancelled',
  );
  assert.equal(
    countRows(
      db,
      `SELECT COUNT(*) AS count FROM invoice_events
       WHERE invoice_id = ? AND event_type = 'voided'`,
      invoice.id,
    ),
    1,
  );
  assert.equal(
    countRows(
      db,
      `SELECT COUNT(*) AS count FROM audit_events
       WHERE action = 'invoice.voided' AND entity_type = 'invoice' AND entity_id = ?`,
      String(invoice.id),
    ),
    1,
  );
  assert.equal(
    countRows(
      db,
      `SELECT COUNT(*) AS count FROM audit_events
       WHERE action = 'order.cancelled' AND entity_type = 'order' AND entity_id = ?`,
      String(orderId),
    ),
    1,
  );

  const replay = await app.inject({
    method: 'POST',
    url: `/api/orders/${orderId}/cancel`,
    headers: { cookie: buyerCookie },
    payload: { version: 0, idempotencyKey: cancelKey },
  });
  assert.equal(replay.statusCode, 200, replay.body);
  assert.equal(
    countRows(
      db,
      `SELECT COUNT(*) AS count FROM invoice_events
       WHERE invoice_id = ? AND event_type = 'voided'`,
      invoice.id,
    ),
    1,
  );
  assert.equal(
    countRows(
      db,
      `SELECT COUNT(*) AS count FROM audit_events
       WHERE action = 'order.cancelled' AND entity_type = 'order' AND entity_id = ?`,
      String(orderId),
    ),
    1,
  );
});
