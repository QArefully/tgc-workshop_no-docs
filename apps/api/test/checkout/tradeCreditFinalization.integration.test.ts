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
import { createMailboxRepository } from '../../src/features/mailbox/mailboxRepository.js';
import { createOrderRepository } from '../../src/features/orders/orderRepository.js';
import { createPaymentRepository } from '../../src/features/payments/paymentRepository.js';
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

type FinalizationSetupOptions = { withPromo?: boolean };

function setup(t: test.TestContext, options: FinalizationSetupOptions = {}) {
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
           VALUES (?, 'Finalization Buyer', 'hash', 'salt', 'customer') RETURNING id`,
        )
        .get('finalization-buyer@example.test') as { id: number }
    ).id,
  );
  const companyId = Number(
    (
      db
        .prepare(
          `INSERT INTO company_accounts
             (name, created_by_user_id, active, approval_threshold_cents, credit_limit_cents,
              credit_terms_days, credit_state, credit_version, created_at, updated_at)
           VALUES ('Finalization Materials Ltd', ?, 1, NULL, 100000, 30, 'active', 0, ?, ?)
           RETURNING id`,
        )
        .get(userId, NOW.toISOString(), NOW.toISOString()) as { id: number }
    ).id,
  );
  db.prepare(
    `INSERT INTO company_memberships (company_id, user_id, role, active, created_at)
     VALUES (?, ?, 'buyer', 1, ?)`,
  ).run(companyId, userId, NOW.toISOString());

  const carts = createCartRepository(db);
  const cartId = createCart(carts, 'UK').cartId;
  const variant = db
    .prepare(
      'SELECT id, moq_sacks, stock_count FROM product_variants WHERE active = 1 ORDER BY id LIMIT 1',
    )
    .get() as { id: number; moq_sacks: number; stock_count: number };
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
  const approvals = createApprovalService({
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
      process: () => Promise.resolve({ status: 'success' as const, reference: 'unused' }),
    },
    clock,
    products: createProductRepository(db),
    audit,
    inventory,
    companies,
    approvals,
    creditAccounts,
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
    ...(options.withPromo ? { promoCode: 'WELCOME5' } : {}),
    customerName: 'Finalization Buyer',
    customerEmail: 'finalization-buyer@example.test',
    deliveryDestination: adhocDestination,
    billingSelection: adhocBilling,
    deliverySlot: bookableSlot(NOW),
    paymentMethod: 'trade_credit',
    idempotencyKey: '00000000-0000-4000-8000-000000000012',
    userId,
    auditContext: { actor: { type: 'user', userId }, requestId: 'credit-finalization-request' },
  };
  return { db, deps, params, variantId: variant.id, stockBefore: variant.stock_count };
}

type FinalizationFailureStage =
  'order' | 'inventory' | 'promo' | 'invoice' | 'mailbox' | 'cart' | 'payment' | 'audit';

const FINALIZATION_FAILURE_STAGES: readonly FinalizationFailureStage[] = [
  'order',
  'inventory',
  'promo',
  'invoice',
  'mailbox',
  'cart',
  'payment',
  'audit',
];

function injectFailureAfterStage(
  deps: ReturnType<typeof setup>['deps'],
  stage: FinalizationFailureStage,
): void {
  let fail = true;
  const failOnce = (): void => {
    if (!fail) return;
    fail = false;
    throw new Error(`injected finalization failure after ${stage}`);
  };

  switch (stage) {
    case 'order': {
      const original = deps.orders.create.bind(deps.orders);
      deps.orders.create = (input) => {
        const orderId = original(input);
        failOnce();
        return orderId;
      };
      break;
    }
    case 'inventory': {
      const original = deps.inventory.commitReservation.bind(deps.inventory);
      deps.inventory.commitReservation = (input) => {
        original(input);
        failOnce();
      };
      break;
    }
    case 'promo': {
      const original = deps.promos.commitReservation.bind(deps.promos);
      deps.promos.commitReservation = (input) => {
        const committed = original(input);
        failOnce();
        return committed;
      };
      break;
    }
    case 'invoice': {
      const original = deps.invoices.issue.bind(deps.invoices);
      deps.invoices.issue = (input) => {
        const invoice = original(input);
        failOnce();
        return invoice;
      };
      break;
    }
    case 'mailbox': {
      const original = deps.mailbox.add.bind(deps.mailbox);
      deps.mailbox.add = (input) => {
        original(input);
        failOnce();
      };
      break;
    }
    case 'cart': {
      const original = deps.carts.remove.bind(deps.carts);
      deps.carts.remove = (cartId) => {
        original(cartId);
        failOnce();
      };
      break;
    }
    case 'payment': {
      const original = deps.payments.transition.bind(deps.payments);
      deps.payments.transition = (input) => {
        const transitioned = original(input);
        // Credit finalization first links the payment to its order while retaining the authorized
        // status; inject only after the terminal succeeded transition.
        if (input.nextStatus === 'succeeded') failOnce();
        return transitioned;
      };
      break;
    }
    case 'audit': {
      const original = deps.audit.append.bind(deps.audit);
      deps.audit.append = (input) => {
        original(input);
        failOnce();
      };
      break;
    }
  }
}

function count(db: ReturnType<typeof setup>['db'], sql: string, ...params: unknown[]): number {
  return Number((db.prepare(sql).get(...params) as { count: number }).count);
}

function finalizationArtifacts(fixture: ReturnType<typeof setup>) {
  const { db, params, variantId } = fixture;
  const orderWhere = 'customer_email = ?';
  return {
    orders: count(
      db,
      `SELECT COUNT(*) AS count FROM orders WHERE ${orderWhere}`,
      params.customerEmail,
    ),
    orderLines: count(
      db,
      `SELECT COUNT(*) AS count FROM order_line_items
       WHERE order_id IN (SELECT id FROM orders WHERE ${orderWhere})`,
      params.customerEmail,
    ),
    orderEvents: count(
      db,
      `SELECT COUNT(*) AS count FROM order_lifecycle_events
       WHERE order_id IN (SELECT id FROM orders WHERE ${orderWhere})`,
      params.customerEmail,
    ),
    invoices: count(
      db,
      'SELECT COUNT(*) AS count FROM invoices WHERE payment_idempotency_key = ?',
      params.idempotencyKey,
    ),
    invoiceStates: count(
      db,
      `SELECT COUNT(*) AS count FROM invoice_states
       WHERE invoice_id IN (SELECT id FROM invoices WHERE payment_idempotency_key = ?)`,
      params.idempotencyKey,
    ),
    invoiceEvents: count(
      db,
      `SELECT COUNT(*) AS count FROM invoice_events
       WHERE invoice_id IN (SELECT id FROM invoices WHERE payment_idempotency_key = ?)`,
      params.idempotencyKey,
    ),
    mailbox: count(
      db,
      `SELECT COUNT(*) AS count FROM dev_mailbox
       WHERE recipient = ? AND kind IN ('invoice_issued', 'order_receipt')`,
      params.customerEmail,
    ),
    payment: count(
      db,
      'SELECT COUNT(*) AS count FROM payments WHERE idempotency_key = ?',
      params.idempotencyKey,
    ),
    paymentStatus: db
      .prepare('SELECT status FROM payments WHERE idempotency_key = ?')
      .pluck()
      .get(params.idempotencyKey) as string | undefined,
    hold: count(
      db,
      'SELECT COUNT(*) AS count FROM credit_exposure_holds WHERE payment_idempotency_key = ?',
      params.idempotencyKey,
    ),
    holdStatus: db
      .prepare('SELECT status FROM credit_exposure_holds WHERE payment_idempotency_key = ?')
      .pluck()
      .get(params.idempotencyKey) as string | undefined,
    holdInvoiceId: db
      .prepare('SELECT invoice_id FROM credit_exposure_holds WHERE payment_idempotency_key = ?')
      .pluck()
      .get(params.idempotencyKey) as number | null | undefined,
    cartLines: count(
      db,
      'SELECT COUNT(*) AS count FROM cart_line_items WHERE cart_id = ?',
      params.cartId,
    ),
    cartReservation: count(
      db,
      'SELECT COUNT(*) AS count FROM cart_reservations WHERE payment_idempotency_key = ?',
      params.idempotencyKey,
    ),
    inventoryReservations: count(
      db,
      'SELECT COUNT(*) AS count FROM inventory_reservations WHERE payment_idempotency_key = ?',
      params.idempotencyKey,
    ),
    inventoryAllocations: count(
      db,
      `SELECT COUNT(*) AS count FROM order_inventory_allocations allocation
       JOIN order_line_items line ON line.id = allocation.order_line_item_id
       JOIN orders ON orders.id = line.order_id
       WHERE orders.customer_email = ?`,
      params.customerEmail,
    ),
    inventoryMovements: count(
      db,
      `SELECT COUNT(*) AS count FROM inventory_stock_movements
       WHERE payment_idempotency_key = ? OR order_id IN
         (SELECT id FROM orders WHERE ${orderWhere})`,
      params.idempotencyKey,
      params.customerEmail,
    ),
    promoReservation: count(
      db,
      'SELECT COUNT(*) AS count FROM promo_reservations WHERE payment_idempotency_key = ?',
      params.idempotencyKey,
    ),
    promoRedemption: count(
      db,
      `SELECT COUNT(*) AS count FROM promo_redemptions
       WHERE order_id IN (SELECT id FROM orders WHERE ${orderWhere})`,
      params.customerEmail,
    ),
    audit: count(
      db,
      'SELECT COUNT(*) AS count FROM audit_events WHERE request_id = ?',
      params.auditContext.requestId,
    ),
    stock: Number(
      (
        db.prepare('SELECT stock_count FROM product_variants WHERE id = ?').get(variantId) as {
          stock_count: number;
        }
      ).stock_count,
    ),
    stockConsumed: Number(
      (
        db
          .prepare(
            'SELECT COALESCE(-SUM(quantity_delta), 0) AS consumed FROM inventory_stock_movements WHERE payment_idempotency_key = ?',
          )
          .get(params.idempotencyKey) as { consumed: number }
      ).consumed,
    ),
  };
}

function assertAuthorizedRollback(fixture: ReturnType<typeof setup>): void {
  const artifacts = finalizationArtifacts(fixture);
  assert.deepEqual(
    artifacts,
    {
      orders: 0,
      orderLines: 0,
      orderEvents: 0,
      invoices: 0,
      invoiceStates: 0,
      invoiceEvents: 0,
      mailbox: 0,
      payment: 1,
      paymentStatus: 'authorized_pending_finalize',
      hold: 1,
      holdStatus: 'authorized',
      holdInvoiceId: null,
      cartLines: 1,
      cartReservation: 1,
      inventoryReservations: 1,
      inventoryAllocations: 0,
      inventoryMovements: 0,
      promoReservation: fixture.params.promoCode ? 1 : 0,
      promoRedemption: 0,
      audit: 0,
      stock: fixture.stockBefore,
      stockConsumed: 0,
    },
    'post-order failure must roll back all finalization artifacts but retain authorization',
  );
}

function assertSuccessfulUniqueness(fixture: ReturnType<typeof setup>): void {
  const artifacts = finalizationArtifacts(fixture);
  assert.deepEqual(
    artifacts,
    {
      orders: 1,
      orderLines: 1,
      orderEvents: 1,
      invoices: 1,
      invoiceStates: 1,
      invoiceEvents: 1,
      mailbox: 1,
      payment: 1,
      paymentStatus: 'succeeded',
      hold: 1,
      holdStatus: 'committed',
      holdInvoiceId: artifacts.holdInvoiceId,
      cartLines: 0,
      cartReservation: 0,
      inventoryReservations: 0,
      inventoryAllocations: 1,
      inventoryMovements: 1,
      promoReservation: 0,
      promoRedemption: fixture.params.promoCode ? 1 : 0,
      audit: 3,
      stock: artifacts.stock,
      stockConsumed: artifacts.stockConsumed,
    },
    'same-key retry must create exactly one set of finalization artifacts',
  );
  assert.equal(
    artifacts.stock,
    fixture.stockBefore - artifacts.stockConsumed,
    'inventory stock must change only by the committed movement',
  );
  assert.equal(typeof artifacts.holdInvoiceId, 'number');
  assert.ok(artifacts.holdInvoiceId > 0);
  assert.ok(artifacts.stockConsumed > 0, 'successful finalization must debit reserved stock');
}

void test('trade-credit finalization atomically issues one invoice and hydrates one mailbox descriptor', async (t) => {
  const { db, deps, params } = setup(t);
  const result = await createCheckoutService(deps).process(params);
  assert.equal(result.success, true);

  const order = db
    .prepare(
      `SELECT id, payment_method, company_id, net_cents, vat_rate_basis_points, vat_cents,
              gross_cents, total_cents FROM orders WHERE customer_email = ?`,
    )
    .get(params.customerEmail) as Record<string, number | string>;
  assert.equal(order.payment_method, 'trade_credit');
  assert.equal(order.company_id !== null, true);
  assert.equal(order.gross_cents, order.total_cents);

  const invoice = db
    .prepare(
      `SELECT id, order_id, payment_idempotency_key, net_cents, vat_rate_basis_points,
              vat_cents, gross_cents FROM invoices WHERE payment_idempotency_key = ?`,
    )
    .get(params.idempotencyKey) as Record<string, number | string>;
  assert.equal(invoice.order_id, order.id);
  assert.equal(invoice.gross_cents, order.gross_cents);
  assert.deepEqual(
    db
      .prepare(
        `SELECT status, invoice_id FROM credit_exposure_holds WHERE payment_idempotency_key = ?`,
      )
      .get(params.idempotencyKey),
    { status: 'committed', invoice_id: invoice.id },
  );
  assert.deepEqual(
    db
      .prepare(`SELECT kind, subject, body, invoice_id FROM dev_mailbox WHERE invoice_id = ?`)
      .get(invoice.id),
    { kind: 'invoice_issued', subject: '', body: '', invoice_id: invoice.id },
  );
  assert.deepEqual(
    deps.mailbox.list().find((message) => message.kind === 'invoice_issued'),
    {
      id: String(
        (
          db.prepare('SELECT id FROM dev_mailbox WHERE invoice_id = ?').get(invoice.id) as {
            id: number;
          }
        ).id,
      ),
      recipient: params.customerEmail,
      subject: '',
      body: '',
      created: NOW.toISOString(),
      kind: 'invoice_issued',
      invoiceId: String(invoice.id),
    },
  );
  assert.equal(
    (
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM audit_events
           WHERE action = 'payment.succeeded' AND request_id = ?`,
        )
        .get(params.auditContext.requestId) as { count: number }
    ).count,
    0,
  );
});

void test('credit finalization failure after invoice/mailbox writes rolls everything back and exact retry reuses the hold', async (t) => {
  const { db, deps, params } = setup(t);
  const originalRemove = deps.carts.remove.bind(deps.carts);
  let fail = true;
  deps.carts.remove = (id) => {
    if (fail) throw new Error('post-mailbox failure');
    originalRemove(id);
  };
  const service = createCheckoutService(deps);
  const first = await service.process(params);
  assert.deepEqual(first, { success: false, error: 'IDEMPOTENT_IN_PROGRESS' });
  assert.equal(
    (
      db
        .prepare('SELECT COUNT(*) AS count FROM orders WHERE customer_email = ?')
        .get(params.customerEmail) as { count: number }
    ).count,
    0,
  );
  assert.equal(
    (
      db
        .prepare('SELECT COUNT(*) AS count FROM invoices WHERE payment_idempotency_key = ?')
        .get(params.idempotencyKey) as { count: number }
    ).count,
    0,
  );
  assert.equal(
    (
      db
        .prepare('SELECT COUNT(*) AS count FROM dev_mailbox WHERE recipient = ?')
        .get(params.customerEmail) as { count: number }
    ).count,
    0,
  );
  assert.deepEqual(
    db
      .prepare(
        'SELECT status, invoice_id FROM credit_exposure_holds WHERE payment_idempotency_key = ?',
      )
      .get(params.idempotencyKey),
    { status: 'authorized', invoice_id: null },
  );
  assert.equal(deps.payments.load(params.idempotencyKey)?.status, 'authorized_pending_finalize');

  fail = false;
  const retry = await service.process(params);
  assert.equal(retry.success, true);
  assert.equal(
    (
      db
        .prepare('SELECT COUNT(*) AS count FROM orders WHERE customer_email = ?')
        .get(params.customerEmail) as { count: number }
    ).count,
    1,
  );
  assert.equal(
    (
      db
        .prepare('SELECT COUNT(*) AS count FROM invoices WHERE payment_idempotency_key = ?')
        .get(params.idempotencyKey) as { count: number }
    ).count,
    1,
  );
  assert.equal(deps.payments.load(params.idempotencyKey)?.status, 'succeeded');
});

void test('credit finalization without the canonical invoice capability preserves intent and hold before writes', async (t) => {
  const fixture = setup(t);
  const { db, deps, params } = fixture;
  const result = await createCheckoutService({ ...deps, invoices: undefined }).process(params);

  assert.deepEqual(result, { success: false, error: 'IDEMPOTENT_IN_PROGRESS' });
  assertAuthorizedRollback(fixture);
  assert.equal(
    (
      db
        .prepare('SELECT COUNT(*) AS count FROM invoices WHERE payment_idempotency_key = ?')
        .get(params.idempotencyKey) as { count: number }
    ).count,
    0,
  );
});

void test('V10 finalization uses the frozen line SKU after the live variant is edited and retired', async (t) => {
  const fixture = setup(t);
  const { db, deps, params, variantId } = fixture;
  const originalSku = (
    db.prepare('SELECT sku FROM product_variants WHERE id = ?').get(variantId) as { sku: string }
  ).sku;
  const originalIssue = deps.invoices.issue.bind(deps.invoices);
  let failFirstAttempt = true;
  deps.invoices.issue = (input) => {
    if (failFirstAttempt) {
      failFirstAttempt = false;
      throw new Error('pause before invoice so catalogue can change');
    }
    return originalIssue(input);
  };

  const service = createCheckoutService(deps);
  assert.deepEqual(await service.process(params), {
    success: false,
    error: 'IDEMPOTENT_IN_PROGRESS',
  });
  assertAuthorizedRollback(fixture);

  db.prepare('UPDATE product_variants SET sku = ?, active = 0 WHERE id = ?').run(
    'SKU-RETIRED-AFTER-AUTH',
    variantId,
  );
  const retry = await service.process(params);
  assert.equal(retry.success, true);
  const line = db
    .prepare(
      `SELECT line.sku FROM order_line_items line
       JOIN orders ON orders.id = line.order_id
       WHERE orders.customer_email = ?`,
    )
    .get(params.customerEmail) as { sku: string };
  assert.equal(line.sku, originalSku);
});

for (const stage of FINALIZATION_FAILURE_STAGES) {
  void test(`credit finalization rolls back exactly after ${stage} and retries idempotently`, async (t) => {
    const fixture = setup(t, { withPromo: stage === 'promo' });
    const { deps, params } = fixture;
    injectFailureAfterStage(deps, stage);
    const service = createCheckoutService(deps);

    const first = await service.process(params);
    assert.deepEqual(first, { success: false, error: 'IDEMPOTENT_IN_PROGRESS' });
    assertAuthorizedRollback(fixture);

    const retry = await service.process(params);
    assert.equal(retry.success, true);
    assertSuccessfulUniqueness(fixture);

    // A second same-key call is a replay, not another finalization transaction.
    const replay = await service.process(params);
    assert.equal(replay.success, true);
    assertSuccessfulUniqueness(fixture);
  });
}
