import assert from 'node:assert/strict';
import test from 'node:test';
import { openSeededDatabase } from '../support/seededDatabase.js';
import { createUnitOfWork } from '../../src/db/unitOfWork.js';
import { createAuditRepository } from '../../src/features/audit/auditRepository.js';
import { createAuditWriter } from '../../src/features/audit/auditService.js';
import { createInvoiceRepository } from '../../src/features/invoices/invoiceRepository.js';
import { createInvoiceService } from '../../src/features/invoices/invoiceService.js';
import { createOrderRepository } from '../../src/features/orders/orderRepository.js';

const issuedAt = '2026-09-01T09:00:00.000Z';
const paymentKey = '123e4567-e89b-42d3-a456-426614174001';
const billingEntity = {
  legalName: 'Credit Invoice Materials Ltd',
  registrationNumber: null,
  vatNumber: null,
  address: { line1: '1 Invoice Lane', city: 'London', postcode: 'EC1A 1BB', countryCode: 'GB' },
} as const;

void test('credit order repository exposes frozen accounting facts and invoice issues from that order snapshot', (t) => {
  const { db } = openSeededDatabase(t);
  db.exec(`
    INSERT INTO users (id, email, display_name, password_hash, password_salt, role, country)
    VALUES (9201, 'credit-invoice-buyer@example.test', 'Credit Invoice Buyer', 'hash', 'salt', 'customer', 'UK');
    INSERT INTO company_accounts
      (id, name, created_by_user_id, active, approval_threshold_cents, credit_limit_cents,
       credit_terms_days, credit_state, credit_version, created_at, updated_at, country)
    VALUES (9201, 'Credit Invoice Materials Ltd', 9201, 1, 0, 100000, 30, 'active', 0,
            '${issuedAt}', '${issuedAt}', 'UK');
    INSERT INTO orders
      (id, customer_name, customer_email, shipping_address, subtotal_cents, discount_cents,
       total_cents, created_at, user_id, lifecycle_status, version, country, payment_method,
       company_id, net_cents, vat_rate_basis_points, vat_cents, gross_cents,
       billing_entity_json, purchase_order_reference)
    VALUES (9201, 'Credit Invoice Buyer', 'credit-invoice-buyer@example.test', '1 Invoice Lane',
            10000, 0, 12000, '${issuedAt}', 9201, 'processing', 0, 'UK', 'trade_credit', 9201,
            10000, 2000, 2000, 12000, '${JSON.stringify(billingEntity)}', 'PO-9201');
    INSERT INTO order_line_items
      (id, order_id, product_id, product_name, product_price_cents, quantity, line_total_cents,
       discountable_total_cents, blending_fee_cents)
    VALUES (9201, 9201, 1, 'Material sacks', 10000, 1, 10000, 10000, 0);
    INSERT INTO payments
      (id, order_id, idempotency_key, request_fingerprint, status, amount_cents,
       card_last4, card_brand, created_at, payment_method, company_id, user_id)
    VALUES (9201, 9201, '${paymentKey}', 'credit-invoice-fingerprint', 'authorized_pending_finalize',
            12000, NULL, NULL, '${issuedAt}', 'trade_credit', 9201, 9201);
    INSERT INTO credit_exposure_holds
      (id, company_id, payment_idempotency_key, amount_cents, status,
       authorized_at, created_at, updated_at)
    VALUES (9201, 9201, '${paymentKey}', 12000, 'authorized', '${issuedAt}', '${issuedAt}', '${issuedAt}');
  `);

  const orders = createOrderRepository(db);
  const order = orders.findById(9201);
  assert.equal(order?.paymentMethod, 'trade_credit');
  assert.equal(order?.companyId, '9201');
  assert.equal(order?.netCents, 10000);
  assert.equal(order?.vatRateBasisPoints, 2000);
  assert.equal(order?.vatCents, 2000);
  assert.equal(order?.grossCents, 12000);

  let current = new Date('2026-09-02T09:00:00.000Z');
  const invoiceService = createInvoiceService({
    repository: createInvoiceRepository(db),
    unitOfWork: createUnitOfWork(db),
    clock: { now: () => current },
    audit: createAuditWriter({
      repository: createAuditRepository(db),
      clock: { now: () => current },
    }),
  });
  const invoice = invoiceService.issue({
    orderId: 9201,
    paymentIdempotencyKey: paymentKey,
    companyId: 9201,
    userId: 9201,
    country: 'UK',
    billingEntity,
    purchaseOrderReference: 'PO-9201',
    netCents: 10000,
    vatRateBasisPoints: 2000,
    vatCents: 2000,
    grossCents: 12000,
    issuedAt: '2026-09-02T09:00:00.000Z',
  });
  assert.equal(invoice.orderId, '9201');
  assert.equal(invoice.grossCents, 12000);
  assert.deepEqual(invoice.billingEntity, billingEntity);

  current = new Date('2026-09-20T09:00:00.000Z');
  const replay = invoiceService.issue({
    orderId: 9201,
    paymentIdempotencyKey: paymentKey,
    companyId: 9201,
    userId: 9201,
    country: 'UK',
    billingEntity,
    purchaseOrderReference: 'PO-9201',
    netCents: 10000,
    vatRateBasisPoints: 2000,
    vatCents: 2000,
    grossCents: 12000,
    issuedAt: '2026-09-02T09:00:00.000Z',
  });
  assert.equal(replay.id, invoice.id);
  assert.equal(
    (
      db
        .prepare('SELECT COUNT(*) AS count FROM invoices WHERE payment_idempotency_key = ?')
        .get(paymentKey) as { count: number }
    ).count,
    1,
  );
  assert.equal(
    (
      db
        .prepare('SELECT COUNT(*) AS count FROM invoice_events WHERE invoice_id = ?')
        .get(Number(invoice.id)) as { count: number }
    ).count,
    1,
  );
});
