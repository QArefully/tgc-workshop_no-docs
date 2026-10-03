import assert from 'node:assert/strict';
import test from 'node:test';
import { openSeededDatabase } from '../support/seededDatabase.js';
import { createUnitOfWork } from '../../src/db/unitOfWork.js';
import { createAuditRepository } from '../../src/features/audit/auditRepository.js';
import { createAuditWriter } from '../../src/features/audit/auditService.js';
import { createCartRepository } from '../../src/features/cart/cartRepository.js';
import { createCart } from '../../src/features/cart/cartService.js';
import {
  createCheckoutService,
  type CheckoutParams,
} from '../../src/features/checkout/checkoutService.js';
import { createInventoryRepository } from '../../src/features/inventory/inventoryRepository.js';
import { createInventoryService } from '../../src/features/inventory/inventoryService.js';
import { InventoryError } from '../../src/features/inventory/inventoryTypes.js';
import { createMailboxRepository } from '../../src/features/mailbox/mailboxRepository.js';
import { createOrderRepository } from '../../src/features/orders/orderRepository.js';
import {
  createPaymentRepository,
  parsePersistedCheckoutQuote,
} from '../../src/features/payments/paymentRepository.js';
import type { PaymentGateway } from '../../src/features/payments/paymentGateway.js';
import { createProductRepository } from '../../src/features/catalog/productRepository.js';
import { createPromoRepository } from '../../src/features/promos/promoRepository.js';
import { createCompanyMembershipRepository } from '../../src/features/companyAccounts/companyMembershipRepository.js';
import { createCompanyRepository } from '../../src/features/companyAccounts/companyRepository.js';
import { createCompanyInviteRepository } from '../../src/features/companyAccounts/companyInviteRepository.js';
import { createCompanyService } from '../../src/features/companyAccounts/companyService.js';
import { createApprovalRepository } from '../../src/features/orderApprovals/approvalRepository.js';
import { createApprovalService } from '../../src/features/orderApprovals/approvalService.js';
import { createInvoiceRepository } from '../../src/features/invoices/invoiceRepository.js';
import { createInvoiceService } from '../../src/features/invoices/invoiceService.js';
import { createCreditAccountRepository } from '../../src/features/tradeCredit/creditAccountRepository.js';
import { createCreditHoldRepository } from '../../src/features/tradeCredit/creditHoldRepository.js';
import { createCreditAccountService } from '../../src/features/tradeCredit/creditAccountService.js';
import { createDeliverySiteRepository } from '../../src/features/tradeAccount/deliverySiteRepository.js';
import { createDeliverySiteService } from '../../src/features/tradeAccount/deliverySiteService.js';
import { createBillingEntityRepository } from '../../src/features/tradeAccount/billingEntityRepository.js';
import { createBillingEntityService } from '../../src/features/tradeAccount/billingEntityService.js';
import { createDeliverySlotService } from '../../src/features/delivery/deliverySlotService.js';
import { createCartService } from '../../src/features/cart/cartService.js';
import { adhocBilling, adhocDestination, bookableSlot } from './checkoutDepthFixtures.js';

const NOW = new Date('2026-09-03T09:00:00.000Z');

function setup(
  t: test.TestContext,
  options: {
    creditLimitCents?: number;
    approvalThresholdCents?: number | null;
    creditState?: 'active' | 'on_hold' | 'suspended';
    membershipRole?: 'owner' | 'buyer' | 'approver';
  } = {},
) {
  const { db } = openSeededDatabase(t);
  const clock = { now: () => NOW };
  const unitOfWork = createUnitOfWork(db);
  const mailbox = createMailboxRepository(db);
  const audit = createAuditWriter({ repository: createAuditRepository(db), clock });
  const userId = Number(
    (
      db
        .prepare(
          `INSERT INTO users (email, display_name, password_hash, password_salt, role)
           VALUES (?, 'Credit Buyer', 'hash', 'salt', 'customer') RETURNING id`,
        )
        .get('credit-buyer@example.test') as { id: number }
    ).id,
  );
  const companyId = Number(
    (
      db
        .prepare(
          `INSERT INTO company_accounts
             (name, created_by_user_id, active, approval_threshold_cents, credit_limit_cents,
              credit_terms_days, credit_state, credit_version, created_at, updated_at)
           VALUES ('Checkout Credit Ltd', ?, 1, ?, ?, 30, ?, 0, ?, ?) RETURNING id`,
        )
        .get(
          userId,
          options.approvalThresholdCents ?? null,
          options.creditLimitCents ?? 100_000,
          options.creditState ?? 'active',
          NOW.toISOString(),
          NOW.toISOString(),
        ) as { id: number }
    ).id,
  );
  db.prepare(
    `INSERT INTO company_memberships (company_id, user_id, role, active, created_at)
     VALUES (?, ?, ?, 1, ?)`,
  ).run(companyId, userId, options.membershipRole ?? 'buyer', NOW.toISOString());

  const carts = createCartRepository(db);
  const cartId = createCart(carts, 'UK').cartId;
  const variant = db
    .prepare(
      `SELECT id, moq_sacks FROM product_variants
       WHERE active = 1 ORDER BY id LIMIT 1`,
    )
    .get() as { id: number; moq_sacks: number };
  carts.addLineQuantity(cartId, String(variant.id), variant.moq_sacks);

  const inventory = createInventoryService({ repository: createInventoryRepository(db) });
  const memberships = createCompanyMembershipRepository(db);
  const creditAccounts = createCreditAccountService({
    accounts: createCreditAccountRepository(db),
    holds: createCreditHoldRepository(db),
    memberships,
    unitOfWork,
    clock,
  });
  const companies = createCompanyService({
    companies: createCompanyRepository(db),
    memberships,
    invites: createCompanyInviteRepository(db),
    mailbox,
    unitOfWork,
    audit,
    clock,
    baseUrl: 'http://example.test/',
  });
  const approvals =
    options.approvalThresholdCents === undefined
      ? undefined
      : createApprovalService({
          approvals: createApprovalRepository(db),
          companies,
          mailbox,
          unitOfWork,
          audit,
          clock,
        });
  const deps = {
    unitOfWork,
    carts,
    promos: createPromoRepository(db),
    payments: createPaymentRepository(db),
    orders: createOrderRepository(db),
    mailbox,
    invoices: createInvoiceService({
      repository: createInvoiceRepository(db),
      unitOfWork,
      clock,
      audit,
    }),
    gateway: {
      process: () => Promise.resolve({ status: 'success' as const, reference: 'gateway-unused' }),
    },
    clock,
    products: createProductRepository(db),
    audit,
    inventory,
    companies,
    creditAccounts,
    ...(approvals ? { approvals } : {}),
    tradeAccount: {
      sites: createDeliverySiteService({
        repository: createDeliverySiteRepository(db),
        unitOfWork,
        clock,
      }),
      billingEntities: createBillingEntityService({
        repository: createBillingEntityRepository(db),
        unitOfWork,
        clock,
      }),
    },
    deliverySlots: createDeliverySlotService({ cart: createCartService(carts), clock }),
  };
  const params: CheckoutParams = {
    cartId,
    customerName: 'Credit Buyer',
    customerEmail: 'credit-buyer@example.test',
    deliveryDestination: adhocDestination,
    billingSelection: adhocBilling,
    deliverySlot: bookableSlot(NOW),
    paymentMethod: 'trade_credit',
    idempotencyKey: '00000000-0000-4000-8000-000000000011',
    userId,
    auditContext: { actor: { type: 'user', userId }, requestId: 'credit-checkout-request' },
  };
  return { db, deps, params, inventory, creditAccounts, companyId };
}

void test('trade-credit checkout computes gross, never calls the gateway, and authorizes its hold', async (t) => {
  const { db, deps, params } = setup(t);
  let gatewayCalls = 0;
  const gateway: PaymentGateway = {
    process: () => {
      gatewayCalls += 1;
      return Promise.resolve({ status: 'success', reference: 'must-not-run' });
    },
  };
  const result = await createCheckoutService({ ...deps, gateway }).process(params);
  assert.equal(gatewayCalls, 0);
  assert.equal(result.success, true);
  const payment = deps.payments.load(params.idempotencyKey);
  assert.equal(payment?.paymentMethod, 'trade_credit');
  assert.equal(payment?.status, 'succeeded');
  const quote = payment?.quoteJson ? parsePersistedCheckoutQuote(payment.quoteJson) : undefined;
  assert.equal(quote?.paymentMethod, 'trade_credit');
  assert.equal(quote?.grossCents, quote?.totalCents);
  assert.equal(payment?.amountCents, quote?.grossCents);
  const hold = db
    .prepare('SELECT status FROM credit_exposure_holds WHERE payment_idempotency_key = ?')
    .get(params.idempotencyKey) as { status: string } | undefined;
  assert.ok(hold && (hold.status === 'authorized' || hold.status === 'committed'));
});

void test('trade-credit limit denial is authoritative and leaves no hold or inventory reservation', async (t) => {
  const { db, deps, params } = setup(t, { creditLimitCents: 1 });
  let gatewayCalls = 0;
  const gateway: PaymentGateway = {
    process: () => {
      gatewayCalls += 1;
      return Promise.resolve({ status: 'success', reference: 'must-not-run' });
    },
  };
  const result = await createCheckoutService({ ...deps, gateway }).process(params);
  assert.equal(result.success, false);
  assert.equal(result.success === false && result.error, 'CREDIT_LIMIT_EXCEEDED');
  assert.equal(gatewayCalls, 0);
  assert.equal(
    (
      db
        .prepare(
          'SELECT COUNT(*) AS count FROM credit_exposure_holds WHERE payment_idempotency_key = ?',
        )
        .get(params.idempotencyKey) as { count: number }
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
});

void test('credit checkout maps membership role and account state without exposing account facts', async (t) => {
  for (const [options, expected] of [
    [{ membershipRole: 'approver' as const }, 'CREDIT_NOT_ELIGIBLE' as const],
    [{ creditState: 'on_hold' as const }, 'CREDIT_ACCOUNT_ON_HOLD' as const],
    [{ creditState: 'suspended' as const }, 'CREDIT_ACCOUNT_SUSPENDED' as const],
  ] as const) {
    const { deps, params } = setup(t, options);
    const result = await createCheckoutService(deps).process(params);
    assert.equal(result.success, false);
    assert.equal(result.success === false && result.error, expected);
  }
});

void test('anonymous trade-credit checkout returns company-required without creating an intent', async (t) => {
  const { db, deps, params } = setup(t);
  const result = await createCheckoutService(deps).process({
    ...params,
    userId: null,
    auditContext: { actor: { type: 'anonymous', userId: null }, requestId: 'credit-anonymous' },
  });
  assert.deepEqual(result, { success: false, error: 'COMPANY_REQUIRED' });
  assert.equal(
    (
      db
        .prepare('SELECT COUNT(*) AS count FROM payments WHERE idempotency_key = ?')
        .get(params.idempotencyKey) as { count: number }
    ).count,
    0,
  );
});

void test('pending trade-credit approval creates no inventory or exposure hold', async (t) => {
  const { db, deps, params } = setup(t, { approvalThresholdCents: 0 });
  let gatewayCalls = 0;
  const gateway: PaymentGateway = {
    process: () => {
      gatewayCalls += 1;
      return Promise.resolve({ status: 'success', reference: 'must-not-run' });
    },
  };
  const result = await createCheckoutService({ ...deps, gateway }).process(params);
  assert.equal(result.success, false);
  assert.equal(result.success === false && result.error, 'PENDING_APPROVAL');
  assert.equal(gatewayCalls, 0);
  assert.deepEqual(
    db
      .prepare('SELECT status, amount_cents FROM payments WHERE idempotency_key = ?')
      .get(params.idempotencyKey),
    { status: 'failed_pre_gateway', amount_cents: 0 },
  );
  assert.equal(
    (
      db
        .prepare(
          'SELECT COUNT(*) AS count FROM credit_exposure_holds WHERE payment_idempotency_key = ?',
        )
        .get(params.idempotencyKey) as { count: number }
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
});

void test('credit authorization expiry releases the prepared hold', async (t) => {
  const { db, deps, params, inventory } = setup(t);
  const originalAuthorize = inventory.authorizeReservation.bind(inventory);
  inventory.authorizeReservation = (key, at) => {
    if (key === params.idempotencyKey) throw new InventoryError('RESERVATION_EXPIRED');
    originalAuthorize(key, at);
  };
  const result = await createCheckoutService(deps).process(params);
  assert.deepEqual(result, {
    success: false,
    error: 'RESERVATION_EXPIRED',
    reservationExpiresAt: '2026-09-03T09:15:00.000Z',
  });
  assert.equal(
    (
      db
        .prepare('SELECT status FROM credit_exposure_holds WHERE payment_idempotency_key = ?')
        .get(params.idempotencyKey) as { status: string } | undefined
    )?.status,
    'released',
  );
  assert.equal(deps.payments.load(params.idempotencyKey)?.status, 'failed_pre_gateway');
});

void test('same-key credit retry resumes an authorized hold and changed body conflicts', async (t) => {
  const { db, deps, params } = setup(t);
  const originalCreate = deps.orders.create.bind(deps.orders);
  let failFinalization = true;
  deps.orders.create = (input) => {
    if (failFinalization) throw new Error('finalizer fixture failure');
    return originalCreate(input);
  };
  const service = createCheckoutService(deps);
  const first = await service.process(params);
  assert.deepEqual(first, { success: false, error: 'IDEMPOTENT_IN_PROGRESS' });
  assert.equal(deps.payments.load(params.idempotencyKey)?.status, 'authorized_pending_finalize');
  assert.equal(
    (
      db
        .prepare('SELECT status FROM credit_exposure_holds WHERE payment_idempotency_key = ?')
        .get(params.idempotencyKey) as { status: string }
    ).status,
    'authorized',
  );

  failFinalization = false;
  const retry = await service.process(params);
  assert.equal(retry.success, true);
  assert.equal(deps.payments.load(params.idempotencyKey)?.status, 'succeeded');
  const conflict = await service.process({ ...params, purchaseOrderReference: 'changed' });
  assert.deepEqual(conflict, { success: false, error: 'IDEMPOTENT_CONFLICT' });
});
