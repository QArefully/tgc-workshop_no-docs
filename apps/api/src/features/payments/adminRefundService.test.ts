import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type Database from 'better-sqlite3';
import { closeDatabase, openDatabase } from '../../db/index.js';
import { createUnitOfWork } from '../../db/unitOfWork.js';
import { createAuditRepository } from '../audit/auditRepository.js';
import { createAuditWriter } from '../audit/auditService.js';
import { createRefundGateway } from '../returns/refundGateway.js';
import { AdminRefundError, createAdminRefundService } from './adminRefundService.js';

function fixture(t: test.TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'shop-admin-refund-'));
  const db = openDatabase({ path: join(directory, 'shop.db') });
  t.after(() => {
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  });
  const userId = Number(
    db
      .prepare(
        `INSERT INTO users (email, display_name, password_hash, password_salt, role)
         VALUES ('admin@example.test', 'Admin', 'hash', 'salt', 'admin')`,
      )
      .run().lastInsertRowid,
  );
  const orderId = Number(
    db
      .prepare(
        `INSERT INTO orders
          (customer_name, customer_email, shipping_address, subtotal_cents, discount_cents,
           total_cents, user_id, created_at, lifecycle_status, version)
         VALUES ('Buyer', 'buyer@example.test', 'address', 1000, 0, 1000, ?, ?, 'processing', 0)`,
      )
      .run(userId, '2026-07-29T10:00:00.000Z').lastInsertRowid,
  );
  const paymentId = Number(
    db
      .prepare(
        `INSERT INTO payments
          (order_id, idempotency_key, request_fingerprint, status, amount_cents, card_last4,
           card_brand, created_at)
         VALUES (?, 'captured-payment', 'fingerprint', 'succeeded', 1000, '4242', 'visa', ?)`,
      )
      .run(orderId, '2026-07-29T10:00:00.000Z').lastInsertRowid,
  );
  // Existing returns-flow refund consumes 300p of the same captured payment.
  const returnId = Number(
    db
      .prepare(
        `INSERT INTO return_requests
          (order_id, user_id, status, reason, version, requested_at, approved_at, received_at, refunded_at)
         VALUES (?, ?, 'refunded', 'other', 3, ?, ?, ?, ?)`,
      )
      .run(
        orderId,
        userId,
        '2026-07-01T00:00:00.000Z',
        '2026-07-02T00:00:00.000Z',
        '2026-07-03T00:00:00.000Z',
        '2026-07-04T00:00:00.000Z',
      ).lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO refunds
      (return_request_id, payment_id, idempotency_key, gross_subtotal_cents, discount_share_cents,
       net_refund_cents, processor, simulated_reference, created_at)
     VALUES (?, ?, 'return-refund', 300, 0, 300, 'simulated', 'return-ref', ?)`,
  ).run(returnId, paymentId, '2026-07-04T00:00:00.000Z');
  const service = createAdminRefundService({
    db,
    unitOfWork: createUnitOfWork(db),
    audit: createAuditWriter({
      repository: createAuditRepository(db),
      clock: { now: () => new Date('2026-07-29T10:00:00.000Z') },
    }),
    clock: { now: () => new Date('2026-07-29T10:00:00.000Z') },
    refundGateway: createRefundGateway(),
  });
  return {
    db,
    service,
    paymentId,
    orderId,
    context: { actor: { type: 'user' as const, userId }, requestId: 'admin-refund-test' },
  };
}

function setSettlementMethods(
  db: Database.Database,
  orderId: number,
  paymentId: number,
  orderMethod: string,
  paymentMethod: string,
): void {
  db.pragma('ignore_check_constraints = ON');
  try {
    db.prepare('UPDATE orders SET payment_method = ? WHERE id = ?').run(orderMethod, orderId);
    db.prepare('UPDATE payments SET payment_method = ? WHERE id = ?').run(paymentMethod, paymentId);
  } finally {
    db.pragma('ignore_check_constraints = OFF');
  }
}

void test('admin refund shares return cap, replays idempotently, and audits once', (t) => {
  const { db, service, paymentId, orderId, context } = fixture(t);
  const request = {
    paymentId,
    orderId,
    amountCents: 700,
    reason: 'Commercial goodwill',
    idempotencyKey: 'admin-refund-replay-key',
    context,
  };
  const refunded = service.refund(request);
  assert.equal(refunded.amountCents, 700);
  assert.equal(service.refund(request).id, refunded.id);

  setSettlementMethods(db, orderId, paymentId, 'trade_credit', 'card');
  assert.throws(
    () => service.refund(request),
    (error: unknown) =>
      error instanceof AdminRefundError && error.code === 'PAYMENT_NOT_REFUNDABLE',
  );
  setSettlementMethods(db, orderId, paymentId, 'card', 'trade_credit');
  assert.throws(
    () => service.refund(request),
    (error: unknown) =>
      error instanceof AdminRefundError && error.code === 'PAYMENT_NOT_REFUNDABLE',
  );
  setSettlementMethods(db, orderId, paymentId, 'card', 'card');
  assert.equal(service.refund(request).id, refunded.id, 'valid-card replay remains idempotent');

  assert.equal(
    (
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM audit_events WHERE action = 'payment.admin_refunded'",
        )
        .get() as { count: number }
    ).count,
    1,
  );
  assert.throws(
    () => service.refund({ ...request, amountCents: 1, idempotencyKey: 'refund-over-cap' }),
    AdminRefundError,
  );
});

void test('succeeded trade-credit intent has no refundable balance and never calls the gateway', (t) => {
  const { db, orderId, context } = fixture(t);
  const now = '2026-07-29T10:00:00.000Z';
  const companyId = Number(
    db
      .prepare(
        `INSERT INTO company_accounts
           (name, created_by_user_id, active, approval_threshold_cents, credit_limit_cents,
            credit_terms_days, credit_state, credit_version, created_at, updated_at)
         VALUES ('Refund Credit Ltd', ?, 1, NULL, 100000, 30, 'active', 0, ?, ?)`,
      )
      .run(context.actor.userId, now, now).lastInsertRowid,
  );
  const paymentId = Number(
    db
      .prepare(
        `INSERT INTO payments
           (order_id, idempotency_key, request_fingerprint, status, amount_cents, created_at,
            payment_method, company_id, user_id)
         VALUES (?, 'credit-admin-refund-payment', 'credit-admin-refund-fingerprint', 'succeeded',
                 1000, ?, 'trade_credit', ?, ?)`,
      )
      .run(orderId, now, companyId, context.actor.userId).lastInsertRowid,
  );
  let gatewayCalls = 0;
  const service = createAdminRefundService({
    db,
    unitOfWork: createUnitOfWork(db),
    audit: createAuditWriter({
      repository: createAuditRepository(db),
      clock: { now: () => new Date(now) },
    }),
    clock: { now: () => new Date(now) },
    refundGateway: {
      refund() {
        gatewayCalls += 1;
        return { processor: 'simulated', simulatedReference: 'must-not-run' };
      },
    },
  });

  assert.throws(
    () =>
      service.refund({
        paymentId,
        orderId,
        amountCents: 100,
        reason: 'Credit return should not refund',
        idempotencyKey: 'credit-admin-refund-request',
        context,
      }),
    (error: unknown) =>
      error instanceof AdminRefundError && error.code === 'PAYMENT_NOT_REFUNDABLE',
  );
  assert.equal(gatewayCalls, 0);
  assert.equal(
    (
      db
        .prepare('SELECT COUNT(*) AS count FROM admin_refunds WHERE payment_id = ?')
        .get(paymentId) as { count: number }
    ).count,
    0,
  );
});
