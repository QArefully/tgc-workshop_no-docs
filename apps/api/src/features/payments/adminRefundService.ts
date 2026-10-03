import type Database from 'better-sqlite3';
import type { UnitOfWork } from '../../db/unitOfWork.js';
import type { AuditContext } from '../audit/auditEvent.js';
import type { AuditWriter, Clock } from '../audit/auditService.js';
import type { RefundGateway } from '../returns/refundGateway.js';

export class AdminRefundError extends Error {
  constructor(
    readonly code: 'INVALID_REFUND' | 'PAYMENT_NOT_REFUNDABLE' | 'PAYMENT_ORDER_MISMATCH',
  ) {
    super(code);
    this.name = 'AdminRefundError';
  }
}

export interface AdminRefundRecord {
  id: string;
  paymentId: string;
  orderId: string;
  actorUserId: string;
  amountCents: number;
  reason: string;
  idempotencyKey: string;
  processor: string;
  simulatedReference: string;
  createdAt: string;
}

export interface AdminRefundService {
  refund(params: {
    paymentId: number;
    orderId: number;
    amountCents: number;
    reason: string;
    idempotencyKey: string;
    context: AuditContext;
  }): AdminRefundRecord;
}

interface Row {
  id: number;
  payment_id: number;
  order_id: number;
  actor_user_id: number;
  amount_cents: number;
  reason: string;
  idempotency_key: string;
  processor: string;
  simulated_reference: string;
  created_at: string;
}

interface RefundablePayment {
  id: number;
  order_id: number | null;
  amount_cents: number;
  status: unknown;
  payment_method: unknown;
  order_payment_method: unknown;
}

function map(row: Row): AdminRefundRecord {
  return {
    id: String(row.id),
    paymentId: String(row.payment_id),
    orderId: String(row.order_id),
    actorUserId: String(row.actor_user_id),
    amountCents: row.amount_cents,
    reason: row.reason,
    idempotencyKey: row.idempotency_key,
    processor: row.processor,
    simulatedReference: row.simulated_reference,
    createdAt: row.created_at,
  };
}

function validPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

/** Standalone refunds share a payment-level cap with the returns workflow. */
export function createAdminRefundService(deps: {
  db: Database.Database;
  unitOfWork: UnitOfWork;
  audit: AuditWriter;
  clock: Clock;
  refundGateway: RefundGateway;
}): AdminRefundService {
  const findByKey = (key: string): Row | undefined =>
    deps.db.prepare('SELECT * FROM admin_refunds WHERE idempotency_key = ?').get(key) as
      Row | undefined;

  const requireCardPayment = (paymentId: number, orderId: number): RefundablePayment => {
    const payment = deps.db
      .prepare(
        `SELECT p.id, p.order_id, p.amount_cents, p.status, p.payment_method,
                o.payment_method AS order_payment_method
         FROM payments p
         LEFT JOIN orders o ON o.id = p.order_id
         WHERE p.id = ?`,
      )
      .get(paymentId) as RefundablePayment | undefined;
    if (!payment) throw new AdminRefundError('PAYMENT_NOT_REFUNDABLE');
    if (payment.order_id !== orderId) throw new AdminRefundError('PAYMENT_ORDER_MISMATCH');

    // Validate the authoritative order and every linked payment, not only the selected row. A
    // malformed or mixed method set must never reach the refund balance or gateway.
    const linkedPayments = deps.db
      .prepare('SELECT payment_method FROM payments WHERE order_id = ? ORDER BY id ASC')
      .all(orderId) as Array<{ payment_method: unknown }>;
    if (
      payment.order_payment_method !== 'card' ||
      payment.payment_method !== 'card' ||
      linkedPayments.length === 0 ||
      linkedPayments.some((linked) => linked.payment_method !== 'card') ||
      payment.status !== 'succeeded'
    ) {
      throw new AdminRefundError('PAYMENT_NOT_REFUNDABLE');
    }
    return payment;
  };

  return {
    refund({ paymentId, orderId, amountCents, reason, idempotencyKey, context }) {
      if (
        !validPositiveInteger(paymentId) ||
        !validPositiveInteger(orderId) ||
        !validPositiveInteger(amountCents) ||
        typeof idempotencyKey !== 'string' ||
        !idempotencyKey.trim() ||
        typeof reason !== 'string' ||
        !reason.trim() ||
        reason.trim().length > 500 ||
        context.actor.type !== 'user'
      ) {
        throw new AdminRefundError('INVALID_REFUND');
      }
      return deps.unitOfWork.run(() => {
        const payment = requireCardPayment(paymentId, orderId);
        const replay = findByKey(idempotencyKey);
        if (replay) {
          if (replay.payment_id !== paymentId || replay.order_id !== orderId) {
            throw new AdminRefundError('PAYMENT_ORDER_MISMATCH');
          }
          return map(replay);
        }
        const prior = deps.db
          .prepare(
            `SELECT
              COALESCE((SELECT SUM(net_refund_cents) FROM refunds WHERE payment_id = ?), 0) +
              COALESCE((SELECT SUM(amount_cents) FROM admin_refunds WHERE payment_id = ?), 0)
              AS amount`,
          )
          .get(paymentId, paymentId) as { amount: number };
        if (prior.amount + amountCents > payment.amount_cents) {
          throw new AdminRefundError('PAYMENT_NOT_REFUNDABLE');
        }
        const gateway = deps.refundGateway.refund(idempotencyKey);
        const createdAt = deps.clock.now().toISOString();
        const result = deps.db
          .prepare(
            `INSERT INTO admin_refunds
             (payment_id, order_id, actor_user_id, amount_cents, reason, idempotency_key,
              processor, simulated_reference, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            paymentId,
            orderId,
            context.actor.userId,
            amountCents,
            reason.trim(),
            idempotencyKey,
            gateway.processor,
            gateway.simulatedReference,
            createdAt,
          );
        const row = deps.db
          .prepare('SELECT * FROM admin_refunds WHERE id = ?')
          .get(Number(result.lastInsertRowid)) as Row | undefined;
        if (!row) throw new Error('Inserted admin refund disappeared');
        deps.audit.append({
          action: 'payment.admin_refunded',
          context,
          paymentId,
          orderId,
          amountCents,
        });
        return map(row);
      });
    },
  };
}
