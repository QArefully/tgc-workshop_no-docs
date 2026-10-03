import assert from 'node:assert/strict';
import test from 'node:test';
import { openSeededDatabase } from '../support/seededDatabase.js';
import { createUnitOfWork } from '../../src/db/unitOfWork.js';
import { createAuditRepository } from '../../src/features/audit/auditRepository.js';
import { createAuditWriter } from '../../src/features/audit/auditService.js';
import { createInventoryRepository } from '../../src/features/inventory/inventoryRepository.js';
import { createInventoryService } from '../../src/features/inventory/inventoryService.js';
import { createInvoiceRepository } from '../../src/features/invoices/invoiceRepository.js';
import { createInvoiceService } from '../../src/features/invoices/invoiceService.js';
import { InvoiceDomainError } from '../../src/features/invoices/invoiceErrors.js';
import { createOrderAccessService } from '../../src/features/orders/orderAccessService.js';
import { createOrderRepository } from '../../src/features/orders/orderRepository.js';
import { createOrderService } from '../../src/features/orders/orderService.js';

const creditBillingEntity = {
  legalName: 'Cancellation Materials Ltd',
  registrationNumber: null,
  vatNumber: null,
  address: {
    line1: '1 Cancellation Lane',
    city: 'London',
    postcode: 'EC1A 1BB',
    countryCode: 'GB',
  },
} as const;

function createCreditCancellationFixture(t: test.TestContext) {
  const { db } = openSeededDatabase(t);
  const issuedAt = '2026-09-01T09:00:00.000Z';
  const now = new Date('2026-09-02T09:00:00.000Z');
  const userId = 9301;
  const companyId = 9301;
  const repository = createOrderRepository(db);
  db.prepare(
    `INSERT INTO users (id, email, display_name, password_hash, password_salt, role, country)
     VALUES (?, ?, 'Cancellation Buyer', 'hash', 'salt', 'customer', 'UK')`,
  ).run(userId, `cancellation-${userId}@example.test`);
  db.prepare(
    `INSERT INTO company_accounts
      (id, name, created_by_user_id, active, approval_threshold_cents, credit_limit_cents,
       credit_terms_days, credit_state, credit_version, created_at, updated_at, country)
     VALUES (?, 'Cancellation Materials Ltd', ?, 1, 0, 100000, 30, 'active', 0, ?, ?, 'UK')`,
  ).run(companyId, userId, issuedAt, issuedAt);
  const orderId = repository.create({
    country: 'UK',
    customerName: 'Cancellation Buyer',
    customerEmail: `cancellation-${userId}@example.test`,
    shippingAddress: '1 Cancellation Lane',
    promoApplied: null,
    subtotalCents: 10000,
    discountCents: 0,
    totalCents: 12000,
    paymentMethod: 'trade_credit',
    companyId,
    netCents: 10000,
    vatRateBasisPoints: 2000,
    vatCents: 2000,
    grossCents: 12000,
    userId,
    billingEntity: creditBillingEntity,
    purchaseOrderReference: 'PO-CANCEL-9301',
    items: [
      {
        productId: '1',
        productName: 'Material sacks',
        unitPriceCents: 10000,
        quantity: 1,
        discountableTotalCents: 10000,
        blendingFeeCents: 0,
        lineTotalCents: 10000,
      },
    ],
    createdAt: issuedAt,
  });
  const paymentKey = '123e4567-e89b-42d3-a456-426614174901';
  db.prepare(
    `INSERT INTO payments
      (id, order_id, idempotency_key, request_fingerprint, status, amount_cents,
       card_last4, card_brand, created_at, payment_method, company_id, user_id)
     VALUES (?, ?, ?, 'cancellation-fingerprint', 'authorized_pending_finalize', 12000,
             NULL, NULL, ?, 'trade_credit', ?, ?)`,
  ).run(9301, orderId, paymentKey, issuedAt, companyId, userId);
  db.prepare(
    `INSERT INTO credit_exposure_holds
      (id, company_id, payment_idempotency_key, amount_cents, status,
       authorized_at, created_at, updated_at)
     VALUES (?, ?, ?, 12000, 'authorized', ?, ?, ?)`,
  ).run(9301, companyId, paymentKey, issuedAt, issuedAt, issuedAt);
  const invoiceRepository = createInvoiceRepository(db);
  const invoiceService = createInvoiceService({
    repository: invoiceRepository,
    unitOfWork: createUnitOfWork(db),
    clock: { now: () => now },
    audit: createAuditWriter({ repository: createAuditRepository(db), clock: { now: () => now } }),
  });
  const invoice = invoiceService.issue({
    orderId,
    paymentIdempotencyKey: paymentKey,
    companyId,
    userId,
    country: 'UK',
    billingEntity: creditBillingEntity,
    purchaseOrderReference: 'PO-CANCEL-9301',
    netCents: 10000,
    vatRateBasisPoints: 2000,
    vatCents: 2000,
    grossCents: 12000,
    issuedAt,
  });
  const service = createOrderService({
    repository,
    unitOfWork: createUnitOfWork(db),
    clock: { now: () => now },
    audit: createAuditWriter({ repository: createAuditRepository(db), clock: { now: () => now } }),
    inventory: createInventoryService({ repository: createInventoryRepository(db) }),
    invoiceRepository,
    invoices: invoiceService,
  });
  return {
    db,
    repository,
    service,
    invoiceService,
    invoiceRepository,
    invoice,
    orderId,
    paymentKey,
    now,
  };
}

function createCancellationService(
  fixture: ReturnType<typeof createCreditCancellationFixture>,
  invoiceRepository = fixture.invoiceRepository,
) {
  return createOrderService({
    repository: fixture.repository,
    unitOfWork: createUnitOfWork(fixture.db),
    clock: { now: () => fixture.now },
    audit: createAuditWriter({
      repository: createAuditRepository(fixture.db),
      clock: { now: () => fixture.now },
    }),
    inventory: createInventoryService({ repository: createInventoryRepository(fixture.db) }),
    invoiceRepository,
    invoices: fixture.invoiceService,
  });
}

function assertCancellationDidNotMutate(
  fixture: ReturnType<typeof createCreditCancellationFixture>,
  orderId: number,
): void {
  assert.equal(fixture.repository.getOrderState(orderId)?.status, 'processing');
  assert.equal(
    (
      fixture.db
        .prepare('SELECT COUNT(*) AS count FROM order_lifecycle_events WHERE order_id = ?')
        .get(orderId) as { count: number }
    ).count,
    1,
  );
  assert.equal(
    (
      fixture.db
        .prepare('SELECT COUNT(*) AS count FROM order_shipments WHERE order_id = ?')
        .get(orderId) as { count: number }
    ).count,
    0,
  );
  assert.deepEqual(
    fixture.db
      .prepare(
        `SELECT status, invoice_id FROM credit_exposure_holds
         WHERE payment_idempotency_key = ?`,
      )
      .get(fixture.paymentKey),
    { status: 'committed', invoice_id: Number(fixture.invoice.id) },
  );
  assert.equal(fixture.invoiceService.get(Number(fixture.invoice.id)).status, 'open');
}

void test('order lifecycle repository creates initial immutable event', (t) => {
  const { db } = openSeededDatabase(t);
  const repository = createOrderRepository(db);
  const orderId = repository.create({
    customerName: 'Order Test',
    customerEmail: 'order@example.test',
    shippingAddress: '1 Test St',
    promoApplied: null,
    subtotalCents: 500,
    discountCents: 0,
    totalCents: 500,
    userId: null,
    items: [
      {
        productId: '1',
        productName: 'Snapshot product',
        unitPriceCents: 500,
        quantity: 1,
        discountableTotalCents: 500,
        blendingFeeCents: 0,
        lineTotalCents: 500,
      },
    ],
    createdAt: '2026-07-19T00:00:00.000Z',
  });
  const detail = repository.findDetailById(orderId);
  assert.equal(detail?.status, 'processing');
  assert.equal(detail?.version, 0);
  assert.deepEqual(
    detail?.items[0] && {
      inventoryStatus: detail.items[0].inventoryStatus,
      allocatedQuantity: detail.items[0].allocatedQuantity,
      backorderedQuantity: detail.items[0].backorderedQuantity,
    },
    { inventoryStatus: 'allocated', allocatedQuantity: 1, backorderedQuantity: 0 },
  );
  assert.match(detail?.items[0]?.lineId ?? '', /^[1-9]\d*$/);
  assert.deepEqual(
    detail?.events.map((event) => event.type),
    ['order_created'],
  );
  assert.throws(() =>
    db
      .prepare("UPDATE order_lifecycle_events SET title = 'changed' WHERE order_id = ?")
      .run(orderId),
  );
});

void test('lifecycle snapshots use frozen order country while tracking text stays raw', (t) => {
  const { db } = openSeededDatabase(t);
  const clock = { now: () => new Date('2026-07-19T12:00:00.000Z') };
  const repository = createOrderRepository(db);
  const service = createOrderService({
    repository,
    unitOfWork: createUnitOfWork(db),
    clock,
    audit: createAuditWriter({ repository: createAuditRepository(db), clock }),
    inventory: createInventoryService({ repository: createInventoryRepository(db) }),
  });
  const create = (country: 'DE' | 'FR') =>
    repository.create({
      country,
      customerName: 'Lifecycle Country Test',
      customerEmail: 'lifecycle-country@example.test',
      shippingAddress: '1 Test St',
      promoApplied: null,
      subtotalCents: 500,
      discountCents: 0,
      totalCents: 500,
      userId: 1,
      items: [
        {
          productId: '1',
          productName: 'Snapshot product',
          unitPriceCents: 500,
          quantity: 1,
          discountableTotalCents: 500,
          blendingFeeCents: 0,
          lineTotalCents: 500,
        },
      ],
      createdAt: '2026-07-19T00:00:00.000Z',
    });
  const context = {
    actor: { type: 'user' as const, userId: 1 },
    requestId: 'localised-order-lifecycle',
  };
  const frenchOrderId = create('FR');
  const frenchLineId = repository.findDetailById(frenchOrderId)?.items[0]?.lineId;
  if (!frenchLineId) throw new Error('Expected French order line');
  const packed = service.pack({
    orderId: frenchOrderId,
    version: 0,
    idempotencyKey: 'localised-pack-key',
    context,
    shipments: [{ lines: [{ lineId: frenchLineId, quantity: 1 }] }],
  });
  const shipmentId = Number(packed.shipments[0]?.id);
  assert.ok(shipmentId > 0);
  const shipped = service.transitionShipment({
    shipmentId,
    version: 0,
    status: 'shipped',
    idempotencyKey: 'localised-ship-key',
    context,
  });
  const tracked = service.addTrackingEvent({
    shipmentId,
    version: 1,
    code: 'in_transit',
    title: 'Carrier checkpoint (operator text)',
    detail: 'Driver supplied detail remains raw',
    location: 'Depot 7',
    idempotencyKey: 'localised-track-key',
    context,
  });
  const frenchEvents = tracked.events.map((event) => ({
    type: event.type,
    title: event.title,
    detail: event.detail,
  }));
  assert.deepEqual(frenchEvents, [
    { type: 'order_created', title: 'Commande cr\u00e9\u00e9e', detail: null },
    { type: 'shipment_packed', title: 'Envoi emball\u00e9', detail: null },
    { type: 'shipment_shipped', title: 'Envoi exp\u00e9di\u00e9', detail: null },
    {
      type: 'shipment_tracking_updated',
      title: 'Carrier checkpoint (operator text)',
      detail: 'Driver supplied detail remains raw',
    },
  ]);
  assert.equal(repository.country(frenchOrderId), 'FR');
  assert.equal(repository.findDetailById(frenchOrderId, 'DE'), undefined);
  assert.equal(shipped.status, 'shipped');

  const germanOrderId = create('DE');
  const cancelled = service.cancel({
    orderId: germanOrderId,
    version: 0,
    idempotencyKey: 'localised-cancel-key',
    context,
  });
  assert.deepEqual(
    cancelled.events.map((event) => ({ type: event.type, title: event.title })),
    [
      { type: 'order_created', title: 'Bestellung erstellt' },
      { type: 'order_cancelled', title: 'Bestellung storniert' },
    ],
  );
  assert.equal(repository.country(germanOrderId), 'DE');
});

void test('lifecycle commands are idempotent, versioned, audited, and transactional', (t) => {
  const { db } = openSeededDatabase(t);
  const clock = { now: () => new Date('2026-07-19T12:00:00.000Z') };
  const repository = createOrderRepository(db);
  const service = createOrderService({
    repository,
    unitOfWork: createUnitOfWork(db),
    clock,
    audit: createAuditWriter({ repository: createAuditRepository(db), clock }),
    inventory: createInventoryService({ repository: createInventoryRepository(db) }),
  });
  const create = (userId: number | null = 1) =>
    repository.create({
      customerName: 'Lifecycle Test',
      customerEmail: 'lifecycle@example.test',
      shippingAddress: '1 Test St',
      promoApplied: null,
      subtotalCents: 500,
      discountCents: 0,
      totalCents: 500,
      userId,
      items: [
        {
          productId: '1',
          productName: 'Snapshot product',
          unitPriceCents: 500,
          quantity: 1,
          discountableTotalCents: 500,
          blendingFeeCents: 0,
          lineTotalCents: 500,
        },
      ],
      createdAt: '2026-07-19T00:00:00.000Z',
    });
  const context = {
    actor: { type: 'user' as const, userId: 1 },
    requestId: 'order-command-request',
  };
  const orderId = create();
  const lineId = repository.findDetailById(orderId)?.items[0]?.lineId;
  if (!lineId) throw new Error('Expected persisted product line');
  const packed = service.pack({
    orderId,
    version: 0,
    idempotencyKey: 'pack-key',
    context,
    shipments: [{ lines: [{ lineId, quantity: 1 }] }],
  });
  assert.equal(packed.status, 'packed');
  assert.equal(
    service.pack({
      orderId,
      version: 0,
      idempotencyKey: 'pack-key',
      context,
      shipments: [{ lines: [{ lineId, quantity: 1 }] }],
    }).version,
    1,
  );
  assert.throws(
    () =>
      service.pack({
        orderId,
        version: 0,
        idempotencyKey: 'pack-key',
        context,
        shipments: [{ trackingReference: 'changed', lines: [{ lineId, quantity: 1 }] }],
      }),
    { name: 'OrderDomainError', code: 'IDEMPOTENCY_CONFLICT' },
  );
  const backorderedOrderId = create();
  const backorderedLineId = Number(repository.findDetailById(backorderedOrderId)?.items[0]?.lineId);
  db.prepare(
    `INSERT INTO order_inventory_allocations
      (order_line_item_id, variant_id, allocated_quantity, backordered_quantity, cancelled_quantity,
       stock_debited_quantity, created_at, updated_at)
     VALUES (?, (SELECT id FROM product_variants WHERE product_id = 1 ORDER BY sort_order LIMIT 1), 0, 1, 0, 0, ?, ?)`,
  ).run(backorderedLineId, '2026-07-19T12:00:00.000Z', '2026-07-19T12:00:00.000Z');
  assert.throws(
    () =>
      service.pack({
        orderId: backorderedOrderId,
        version: 0,
        idempotencyKey: 'backorder-pack-key',
        context,
        shipments: [{ lines: [{ lineId: String(backorderedLineId), quantity: 1 }] }],
      }),
    { name: 'OrderDomainError', code: 'OUTSTANDING_BACKORDER' },
  );
  db.prepare('DELETE FROM order_inventory_allocations WHERE order_line_item_id = ?').run(
    backorderedLineId,
  );
  const shipmentId = packed.shipments[0]?.id;
  if (!shipmentId) throw new Error('Expected shipment');
  const shipped = service.transitionShipment({
    shipmentId: Number(shipmentId),
    version: 0,
    status: 'shipped',
    idempotencyKey: 'ship-key',
    context,
  });
  assert.equal(shipped.status, 'shipped');
  const tracked = service.addTrackingEvent({
    shipmentId: Number(shipmentId),
    version: 1,
    code: 'in_transit',
    title: 'In transit',
    idempotencyKey: 'track-key',
    context,
  });
  assert.equal(tracked.events.at(-1)?.code, 'in_transit');
  assert.throws(
    () =>
      service.transitionShipment({
        shipmentId: Number(shipmentId),
        version: 1,
        status: 'delivered',
        idempotencyKey: 'stale-key',
        context,
      }),
    { name: 'OrderDomainError', code: 'STALE_VERSION' },
  );
  assert.equal(
    service.transitionShipment({
      shipmentId: Number(shipmentId),
      version: 2,
      status: 'delivered',
      idempotencyKey: 'delivered-key',
      context,
    }).status,
    'delivered',
  );

  const cancellableOrderId = create();
  const cancelled = service.cancel({
    orderId: cancellableOrderId,
    version: 0,
    idempotencyKey: 'cancel-key',
    context,
  });
  assert.equal(cancelled.status, 'cancelled');
  assert.deepEqual(
    cancelled.events.map((event) => event.type),
    ['order_created', 'order_cancelled'],
  );

  const restoredOrderId = create();
  const restoredLineId = Number(repository.findDetailById(restoredOrderId)?.items[0]?.lineId);
  db.prepare(
    `INSERT INTO order_inventory_allocations
      (order_line_item_id, variant_id, allocated_quantity, backordered_quantity, cancelled_quantity,
       stock_debited_quantity, created_at, updated_at)
     VALUES (?, (SELECT id FROM product_variants WHERE product_id = 1 ORDER BY sort_order LIMIT 1), 1, 0, 0, 1, ?, ?)`,
  ).run(restoredLineId, '2026-07-19T12:00:00.000Z', '2026-07-19T12:00:00.000Z');
  const variantId = (
    db
      .prepare('SELECT id FROM product_variants WHERE product_id = 1 ORDER BY sort_order LIMIT 1')
      .get() as { id: number }
  ).id;
  const stockBeforeRestore = (
    db.prepare('SELECT stock_count FROM product_variants WHERE id = ?').get(variantId) as {
      stock_count: number;
    }
  ).stock_count;
  assert.equal(
    service.cancel({
      orderId: restoredOrderId,
      version: 0,
      idempotencyKey: 'restore-cancel-key',
      context,
    }).status,
    'cancelled',
  );
  assert.equal(
    (
      db.prepare('SELECT stock_count FROM product_variants WHERE id = ?').get(variantId) as {
        stock_count: number;
      }
    ).stock_count,
    stockBeforeRestore + 1,
  );

  const rollbackOrderId = create();
  const rollbackLineId = repository.findDetailById(rollbackOrderId)?.items[0]?.lineId;
  if (!rollbackLineId) throw new Error('Expected rollback line');
  db.exec(
    "CREATE TRIGGER abort_order_audit BEFORE INSERT ON audit_events WHEN NEW.action = 'order.shipment_packed' BEGIN SELECT RAISE(ABORT, 'audit failure'); END",
  );
  try {
    assert.throws(() =>
      service.pack({
        orderId: rollbackOrderId,
        version: 0,
        idempotencyKey: 'rollback-key',
        context,
        shipments: [{ lines: [{ lineId: rollbackLineId, quantity: 1 }] }],
      }),
    );
    assert.equal(repository.findDetailById(rollbackOrderId)?.status, 'processing');
    assert.equal(repository.findDetailById(rollbackOrderId)?.shipments.length, 0);
  } finally {
    db.exec('DROP TRIGGER abort_order_audit');
  }

  const access = createOrderAccessService({
    repository,
    clock,
    tokenSource: () => 'fixed-access-token',
  });
  const grant = access.issue(orderId);
  assert.equal(grant.expiresAt, '2026-07-20T12:00:00.000Z');
  assert.equal(access.validate(orderId, 'fixed-access-token'), true);
  assert.equal(access.validate(orderId, 'wrong-token'), false);
  assert.equal(
    service.listOwned(1, 1, 50).items.some((order) => order.id === String(orderId)),
    true,
  );
});

void test('credit cancellation rejects a missing or mismatched invoice before mutations', (t) => {
  const missing = createCreditCancellationFixture(t);
  const missingInvoiceRepository = {
    ...missing.invoiceRepository,
    findByOrderId: () => undefined,
  };
  assert.throws(
    () =>
      createCancellationService(missing, missingInvoiceRepository).cancel({
        orderId: missing.orderId,
        version: 0,
        idempotencyKey: '623e4567-e89b-42d3-a456-426614174901',
        context: {
          actor: { type: 'user' as const, userId: 9301 },
          requestId: 'missing-invoice-cancellation-request',
        },
      }),
    (error: unknown) =>
      error instanceof InvoiceDomainError && error.code === 'INVOICE_TOTAL_MISMATCH',
  );
  assertCancellationDidNotMutate(missing, missing.orderId);

  const mismatched = createCreditCancellationFixture(t);
  const mismatchedInvoiceRepository = {
    ...mismatched.invoiceRepository,
    findByOrderId: () => ({ ...mismatched.invoice, orderId: String(mismatched.orderId + 1) }),
  };
  assert.throws(
    () =>
      createCancellationService(mismatched, mismatchedInvoiceRepository).cancel({
        orderId: mismatched.orderId,
        version: 0,
        idempotencyKey: '723e4567-e89b-42d3-a456-426614174901',
        context: {
          actor: { type: 'user' as const, userId: 9301 },
          requestId: 'mismatched-invoice-cancellation-request',
        },
      }),
    (error: unknown) =>
      error instanceof InvoiceDomainError && error.code === 'INVOICE_TOTAL_MISMATCH',
  );
  assertCancellationDidNotMutate(mismatched, mismatched.orderId);
});

void test('credit cancellation rejects a payment linkage mismatch before mutations', (t) => {
  const fixture = createCreditCancellationFixture(t);
  const mismatchedPaymentRepository = {
    ...fixture.invoiceRepository,
    findPaymentForIssue: () => ({
      ...fixture.invoiceRepository.findPaymentForIssue!(fixture.paymentKey),
      orderId: fixture.orderId + 1,
    }),
  };
  assert.throws(
    () =>
      createCancellationService(fixture, mismatchedPaymentRepository).cancel({
        orderId: fixture.orderId,
        version: 0,
        idempotencyKey: '823e4567-e89b-42d3-a456-426614174901',
        context: {
          actor: { type: 'user' as const, userId: 9301 },
          requestId: 'mismatched-payment-cancellation-request',
        },
      }),
    (error: unknown) =>
      error instanceof InvoiceDomainError && error.code === 'INVOICE_TOTAL_MISMATCH',
  );
  assertCancellationDidNotMutate(fixture, fixture.orderId);
});

void test('card and legacy cancellation reject any linked invoice before mutations', (t) => {
  const fixture = createCreditCancellationFixture(t);
  const cardOrderId = fixture.repository.create({
    customerName: 'Card Cancellation Buyer',
    customerEmail: 'card-cancellation@example.test',
    shippingAddress: '1 Card Cancellation Lane',
    promoApplied: null,
    subtotalCents: 500,
    discountCents: 0,
    totalCents: 500,
    userId: 1,
    items: [
      {
        productId: '1',
        productName: 'Material sacks',
        unitPriceCents: 500,
        quantity: 1,
        discountableTotalCents: 500,
        blendingFeeCents: 0,
        lineTotalCents: 500,
      },
    ],
    createdAt: '2026-09-01T09:00:00.000Z',
  });
  const linkedInvoiceRepository = {
    ...fixture.invoiceRepository,
    findByOrderId: (orderId: number, now?: string) =>
      orderId === cardOrderId
        ? fixture.invoice
        : fixture.invoiceRepository.findByOrderId(orderId, now),
  };
  assert.throws(
    () =>
      createCancellationService(fixture, linkedInvoiceRepository).cancel({
        orderId: cardOrderId,
        version: 0,
        idempotencyKey: '923e4567-e89b-42d3-a456-426614174901',
        context: {
          actor: { type: 'user' as const, userId: 1 },
          requestId: 'card-linked-invoice-cancellation-request',
        },
      }),
    (error: unknown) =>
      error instanceof InvoiceDomainError && error.code === 'INVOICE_TOTAL_MISMATCH',
  );
  assert.equal(fixture.repository.getOrderState(cardOrderId)?.status, 'processing');
  assert.equal(
    (
      fixture.db
        .prepare('SELECT COUNT(*) AS count FROM order_lifecycle_events WHERE order_id = ?')
        .get(cardOrderId) as { count: number }
    ).count,
    1,
  );
  assert.equal(fixture.invoiceService.get(Number(fixture.invoice.id)).status, 'open');
});

void test('unpaid credit cancellation voids its invoice and releases exposure exactly once', (t) => {
  const fixture = createCreditCancellationFixture(t);
  const context = {
    actor: { type: 'user' as const, userId: 9301 },
    requestId: 'credit-cancellation-request',
  };
  const cancellationKey = '223e4567-e89b-42d3-a456-426614174901';
  const cancelled = fixture.service.cancel({
    orderId: fixture.orderId,
    version: 0,
    idempotencyKey: cancellationKey,
    context,
  });
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(fixture.invoiceService.get(Number(fixture.invoice.id)).status, 'voided');
  assert.deepEqual(
    fixture.db
      .prepare(
        `SELECT status FROM credit_exposure_holds
         WHERE payment_idempotency_key = ?`,
      )
      .get('123e4567-e89b-42d3-a456-426614174901'),
    { status: 'released' },
  );
  assert.equal(
    (
      fixture.db
        .prepare(
          `SELECT COUNT(*) AS count FROM invoice_events
           WHERE invoice_id = ? AND event_type = 'voided'`,
        )
        .get(Number(fixture.invoice.id)) as { count: number }
    ).count,
    1,
  );
  assert.equal(
    (
      fixture.db
        .prepare(
          `SELECT COUNT(*) AS count FROM audit_events
           WHERE action = 'invoice.voided' AND entity_id = ?`,
        )
        .get(String(fixture.invoice.id)) as { count: number }
    ).count,
    1,
  );

  const replay = fixture.service.cancel({
    orderId: fixture.orderId,
    version: 0,
    idempotencyKey: cancellationKey,
    context,
  });
  assert.equal(replay.status, 'cancelled');
  assert.equal(
    (
      fixture.db
        .prepare(
          `SELECT COUNT(*) AS count FROM invoice_events
           WHERE invoice_id = ? AND event_type = 'voided'`,
        )
        .get(Number(fixture.invoice.id)) as { count: number }
    ).count,
    1,
  );
  assert.equal(
    (
      fixture.db
        .prepare(
          `SELECT COUNT(*) AS count FROM audit_events
           WHERE action = 'invoice.voided' AND entity_id = ?`,
        )
        .get(String(fixture.invoice.id)) as { count: number }
    ).count,
    1,
  );
  assert.throws(
    () =>
      fixture.service.cancel({
        orderId: fixture.orderId,
        version: 0,
        idempotencyKey: '323e4567-e89b-42d3-a456-426614174901',
        context,
      }),
    { name: 'OrderDomainError', code: 'STALE_VERSION' },
  );
});

void test('paid credit cancellation rejects before order or exposure mutation', (t) => {
  const fixture = createCreditCancellationFixture(t);
  fixture.invoiceService.settle({
    invoiceId: Number(fixture.invoice.id),
    expectedVersion: 0,
    idempotencyKey: '423e4567-e89b-42d3-a456-426614174901',
    context: {
      actor: { type: 'user' as const, userId: 9301 },
      requestId: 'paid-invoice-settlement-request',
      standingCountry: 'UK',
    },
    standingCountry: 'UK',
  });
  assert.throws(
    () =>
      fixture.service.cancel({
        orderId: fixture.orderId,
        version: 0,
        idempotencyKey: '523e4567-e89b-42d3-a456-426614174901',
        context: {
          actor: { type: 'user' as const, userId: 9301 },
          requestId: 'paid-credit-cancellation-request',
        },
      }),
    (error: unknown) =>
      error instanceof InvoiceDomainError && error.code === 'INVOICE_ALREADY_PAID',
  );
  assert.equal(fixture.repository.getOrderState(fixture.orderId)?.status, 'processing');
  assert.equal(fixture.invoiceService.get(Number(fixture.invoice.id)).status, 'paid');
  assert.deepEqual(
    fixture.db
      .prepare(
        `SELECT status FROM credit_exposure_holds
         WHERE payment_idempotency_key = ?`,
      )
      .get('123e4567-e89b-42d3-a456-426614174901'),
    { status: 'released' },
  );
  assert.equal(
    (
      fixture.db
        .prepare(
          `SELECT COUNT(*) AS count FROM invoice_events
           WHERE invoice_id = ? AND event_type = 'voided'`,
        )
        .get(Number(fixture.invoice.id)) as { count: number }
    ).count,
    0,
  );
});
