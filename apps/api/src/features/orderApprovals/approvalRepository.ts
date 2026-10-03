import type Database from 'better-sqlite3';
import type { OrderApprovalStatus } from '@shop/contracts/order-approvals';

export interface ApprovalRow {
  id: number;
  company_id: number;
  requested_by_user_id: number;
  cart_id: string;
  idempotency_key: string;
  quote_total_cents: number;
  delivery_site_id: number | null;
  delivery_address_json: string;
  billing_entity_json: string;
  delivery_slot_date: string;
  delivery_slot_window: 'am' | 'pm';
  purchase_order_reference: string | null;
  status: OrderApprovalStatus;
  approved_by_user_id: number | null;
  decision_reason: string | null;
  requested_at: string;
  resolved_at: string | null;
  lease_expires_at: string;
}

export interface ApprovalRepository {
  create(
    input: Omit<
      ApprovalRow,
      'id' | 'status' | 'approved_by_user_id' | 'decision_reason' | 'resolved_at'
    >,
  ): ApprovalRow;
  findById(id: number): ApprovalRow | null;
  findByIdempotencyKey(idempotencyKey: string): ApprovalRow | null;
  listPendingByCompany(companyId: number): ApprovalRow[];
  listByRequester(userId: number): ApprovalRow[];
  transition(input: {
    id: number;
    expectedStatus: OrderApprovalStatus;
    nextStatus: Exclude<OrderApprovalStatus, 'pending'>;
    approvedByUserId?: number | null;
    decisionReason?: string | null;
    resolvedAt: string;
  }): boolean;
  expireStale(now: string): ApprovalRow[];
}

const columns = `id, company_id, requested_by_user_id, cart_id, idempotency_key,
  quote_total_cents, delivery_site_id, delivery_address_json, billing_entity_json,
  delivery_slot_date, delivery_slot_window, purchase_order_reference, status,
  approved_by_user_id, decision_reason, requested_at, resolved_at, lease_expires_at`;

export function createApprovalRepository(db: Database.Database): ApprovalRepository {
  const byId = (id: number) =>
    (db.prepare(`SELECT ${columns} FROM order_approvals WHERE id = ?`).get(id) as
      ApprovalRow | undefined) ?? null;
  return {
    create(input) {
      const id = Number(
        db
          .prepare(
            `INSERT INTO order_approvals (
              company_id, requested_by_user_id, cart_id, idempotency_key, quote_total_cents,
              delivery_site_id, delivery_address_json, billing_entity_json, delivery_slot_date,
              delivery_slot_window, purchase_order_reference, status, requested_at, lease_expires_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
          )
          .run(
            input.company_id,
            input.requested_by_user_id,
            input.cart_id,
            input.idempotency_key,
            input.quote_total_cents,
            input.delivery_site_id,
            input.delivery_address_json,
            input.billing_entity_json,
            input.delivery_slot_date,
            input.delivery_slot_window,
            input.purchase_order_reference,
            input.requested_at,
            input.lease_expires_at,
          ).lastInsertRowid,
      );
      return byId(id)!;
    },
    findById: byId,
    findByIdempotencyKey(idempotencyKey) {
      return (
        (db
          .prepare(`SELECT ${columns} FROM order_approvals WHERE idempotency_key = ?`)
          .get(idempotencyKey) as ApprovalRow | undefined) ?? null
      );
    },
    listPendingByCompany(companyId) {
      return db
        .prepare(
          `SELECT ${columns} FROM order_approvals
           WHERE company_id = ? AND status = 'pending' ORDER BY requested_at, id`,
        )
        .all(companyId) as ApprovalRow[];
    },
    listByRequester(userId) {
      return db
        .prepare(
          `SELECT ${columns} FROM order_approvals
           WHERE requested_by_user_id = ? ORDER BY requested_at DESC, id DESC`,
        )
        .all(userId) as ApprovalRow[];
    },
    transition({
      id,
      expectedStatus,
      nextStatus,
      approvedByUserId = null,
      decisionReason = null,
      resolvedAt,
    }) {
      return (
        db
          .prepare(
            `UPDATE order_approvals
             SET status = ?, approved_by_user_id = ?, decision_reason = ?, resolved_at = ?
             WHERE id = ? AND status = ?`,
          )
          .run(nextStatus, approvedByUserId, decisionReason, resolvedAt, id, expectedStatus)
          .changes === 1
      );
    },
    expireStale(now) {
      const stale = db
        .prepare(
          `SELECT ${columns} FROM order_approvals
           WHERE status IN ('pending', 'approved') AND lease_expires_at <= ?`,
        )
        .all(now) as ApprovalRow[];
      const update = db.prepare(
        `UPDATE order_approvals SET status = 'expired', resolved_at = ?
         WHERE id = ? AND status IN ('pending', 'approved')`,
      );
      return stale.filter((row) => update.run(now, row.id).changes === 1);
    },
  };
}
