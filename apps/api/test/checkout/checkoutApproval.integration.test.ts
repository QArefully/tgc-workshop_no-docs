import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import type { AppContext } from '../../src/app.js';
import { openSeededDatabase } from '../support/seededDatabase.js';
import { createUnitOfWork } from '../../src/db/unitOfWork.js';
import { createAuditRepository } from '../../src/features/audit/auditRepository.js';
import { createAuditWriter } from '../../src/features/audit/auditService.js';
import { createCartRepository } from '../../src/features/cart/cartRepository.js';
import { addItem, createCart } from '../../src/features/cart/cartService.js';
import { createProductRepository } from '../../src/features/catalog/productRepository.js';
import { createCompanyMembershipRepository } from '../../src/features/companyAccounts/companyMembershipRepository.js';
import { createCompanyRepository } from '../../src/features/companyAccounts/companyRepository.js';
import { createCompanyInviteRepository } from '../../src/features/companyAccounts/companyInviteRepository.js';
import { createCompanyService } from '../../src/features/companyAccounts/companyService.js';
import {
  createCheckoutService,
  type CheckoutParams,
} from '../../src/features/checkout/checkoutService.js';
import { createInventoryRepository } from '../../src/features/inventory/inventoryRepository.js';
import { createInventoryService } from '../../src/features/inventory/inventoryService.js';
import { createMailboxRepository } from '../../src/features/mailbox/mailboxRepository.js';
import { createOrderRepository } from '../../src/features/orders/orderRepository.js';
import { createApprovalRepository } from '../../src/features/orderApprovals/approvalRepository.js';
import { createApprovalService } from '../../src/features/orderApprovals/approvalService.js';
import { createPaymentRepository } from '../../src/features/payments/paymentRepository.js';
import { simulatedPaymentGateway } from '../../src/features/payments/paymentGateway.js';
import { createPromoRepository } from '../../src/features/promos/promoRepository.js';
import paymentRoutes from '../../src/routes/payments.js';
import {
  checkoutDepthDependencies,
  adhocBilling,
  adhocDestination,
  bookableSlot,
} from './checkoutDepthFixtures.js';

void test('payment route serializes pending approval request IDs', async (t) => {
  const app = Fastify();
  paymentRoutes(app, {
    services: {
      checkout: {
        process: () =>
          Promise.resolve({
            success: false,
            error: 'PENDING_APPROVAL',
            approvalRequestId: '17',
          }),
      },
    },
  } as unknown as AppContext);
  t.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: '/api/payments/pay',
    payload: {
      cartId: '123e4567-e89b-42d3-a456-426614174000',
      customerName: 'Buyer',
      customerEmail: 'buyer@example.test',
      deliveryDestination: adhocDestination,
      billingSelection: adhocBilling,
      deliverySlot: bookableSlot(),
      cardNumber: '4242 4242 4242 4242',
      cardExpiry: '12/99',
      cardCvc: '123',
      idempotencyKey: '123e4567-e89b-42d3-a456-426614174000',
    },
  });

  assert.equal(response.statusCode, 409);
  assert.deepEqual(response.json(), {
    error: 'Approval is required (request 17).',
    code: 'PENDING_APPROVAL',
    meta: { approvalRequestId: '17' },
  });
});

void test('approval-gated checkout only re-arms an approved same-key retry for its requesting buyer', async (t) => {
  const { db } = openSeededDatabase(t);
  const now = new Date('2026-07-29T12:00:00.000Z');
  const clock = { now: () => now };
  const unitOfWork = createUnitOfWork(db);
  const mailbox = createMailboxRepository(db);
  const audit = createAuditWriter({ repository: createAuditRepository(db), clock });
  const companies = createCompanyService({
    companies: createCompanyRepository(db),
    memberships: createCompanyMembershipRepository(db),
    invites: createCompanyInviteRepository(db),
    mailbox,
    unitOfWork,
    audit,
    clock,
    baseUrl: 'http://example.test/',
  });
  const approvals = createApprovalService({
    approvals: createApprovalRepository(db),
    companies,
    mailbox,
    unitOfWork,
    audit,
    clock,
  });
  const addUser = (email: string) =>
    Number(
      (
        db
          .prepare(
            `INSERT INTO users (email, display_name, password_hash, password_salt, role)
           VALUES (?, 'Test user', 'hash', 'salt', 'customer') RETURNING id`,
          )
          .get(email) as { id: number }
      ).id,
    );
  const ownerId = addUser('owner@example.test');
  const buyerId = addUser('buyer@example.test');
  const approverId = addUser('approver@example.test');
  const otherUserId = addUser('other@example.test');
  const companyId = Number(
    db
      .prepare(
        `INSERT INTO company_accounts (name, created_by_user_id, approval_threshold_cents, created_at, updated_at)
         VALUES ('Approval Co', ?, 0, ?, ?) RETURNING id`,
      )
      .get(ownerId, now.toISOString(), now.toISOString()).id,
  );
  for (const [userId, role] of [
    [ownerId, 'owner'],
    [buyerId, 'buyer'],
    [approverId, 'approver'],
  ] as const) {
    db.prepare(
      `INSERT INTO company_memberships (company_id, user_id, role, active, created_at)
       VALUES (?, ?, ?, 1, ?)`,
    ).run(companyId, userId, role, now.toISOString());
  }
  const carts = createCartRepository(db);
  const cartId = createCart(carts).cartId;
  const variantId = (
    db.prepare('SELECT id FROM product_variants WHERE active = 1 ORDER BY id LIMIT 1').get() as {
      id: number;
    }
  ).id;
  addItem(carts, cartId, String(variantId));
  const checkout = createCheckoutService({
    unitOfWork,
    carts,
    promos: createPromoRepository(db),
    payments: createPaymentRepository(db),
    orders: createOrderRepository(db),
    mailbox,
    gateway: simulatedPaymentGateway,
    clock,
    products: createProductRepository(db),
    audit,
    inventory: createInventoryService({ repository: createInventoryRepository(db) }),
    approvals,
    companies,
    ...checkoutDepthDependencies(db, clock),
  });
  const params: CheckoutParams = {
    cartId,
    customerName: 'Buyer',
    customerEmail: 'buyer@example.test',
    deliveryDestination: adhocDestination,
    billingSelection: adhocBilling,
    deliverySlot: bookableSlot(now),
    cardNumber: '4242 4242 4242 4242',
    cardExpiry: '12/99',
    cardCvc: '123',
    idempotencyKey: 'approval-same-key',
    userId: buyerId,
    auditContext: { actor: { type: 'user', userId: buyerId }, requestId: 'approval-checkout' },
  };
  const pending = await checkout.process(params);
  assert.equal(pending.success, false);
  assert.equal(pending.success === false && pending.error, 'PENDING_APPROVAL');
  if (pending.success || pending.error !== 'PENDING_APPROVAL') throw new Error('Expected approval');
  assert.equal(
    (
      db
        .prepare("SELECT COUNT(*) AS count FROM orders WHERE customer_email = 'buyer@example.test'")
        .get() as { count: number }
    ).count,
    0,
  );
  assert.equal(
    (
      db
        .prepare(
          'SELECT COUNT(*) AS count FROM inventory_reservations WHERE payment_idempotency_key = ?',
        )
        .get(params.idempotencyKey) as { count: number }
    ).count,
    0,
  );
  assert.equal(
    (
      db
        .prepare('SELECT COUNT(*) AS count FROM cart_reservations WHERE cart_id = ?')
        .get(cartId) as {
        count: number;
      }
    ).count,
    0,
  );
  const decision = approvals.decide(
    approverId,
    Number(pending.approvalRequestId),
    'approve',
    undefined,
    { actor: { type: 'user', userId: approverId }, requestId: 'approval-decision' },
  );
  assert.equal(decision.ok, true);
  const changedPayload = await checkout.process({ ...params, customerName: 'Changed buyer' });
  assert.equal(changedPayload.success, false);
  assert.equal(changedPayload.success === false && changedPayload.error, 'IDEMPOTENT_CONFLICT');
  const signedOutRetry = await checkout.process({
    ...params,
    userId: null,
    auditContext: {
      actor: { type: 'anonymous', userId: null },
      requestId: 'approval-signed-out-retry',
    },
  });
  assert.equal(signedOutRetry.success, false);
  assert.equal(signedOutRetry.success === false && signedOutRetry.error, 'CHECKOUT_FAILED');
  const otherUserRetry = await checkout.process({
    ...params,
    userId: otherUserId,
    auditContext: {
      actor: { type: 'user', userId: otherUserId },
      requestId: 'approval-other-user-retry',
    },
  });
  assert.equal(otherUserRetry.success, false);
  assert.equal(otherUserRetry.success === false && otherUserRetry.error, 'CHECKOUT_FAILED');
  assert.deepEqual(
    db
      .prepare('SELECT status, response_json FROM payments WHERE idempotency_key = ?')
      .get(params.idempotencyKey),
    {
      status: 'failed_pre_gateway',
      response_json: JSON.stringify({
        success: false,
        error: 'PENDING_APPROVAL',
        approvalRequestId: pending.approvalRequestId,
      }),
    },
  );
  assert.equal((await checkout.process(params)).success, true);
  assert.deepEqual(
    db.prepare("SELECT action FROM audit_events WHERE action LIKE 'approval.%' ORDER BY id").all(),
    [{ action: 'approval.requested' }, { action: 'approval.approved' }],
  );
});
