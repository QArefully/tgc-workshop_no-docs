import type {
  ApprovalDecisionAction,
  BillingEntitySnapshot,
  OrderApproval,
  PostalAddress,
} from '@shop/contracts';
import type { CompanyMembership } from '@shop/contracts/company-accounts';
import { orderApprovalCopy } from '@shop/localisation/messages/asyncContent';
import type { ApprovalRow, ApprovalRepository } from './approvalRepository.js';
import { approvalError, approvalOk, type ApprovalResult } from './approvalErrors.js';
import type { AuditContext } from '../audit/auditEvent.js';
import type { AuditWriter, Clock } from '../audit/auditService.js';
import type { CompanyService } from '../companyAccounts/companyService.js';
import type { MailboxRepository } from '../mailbox/mailboxRepository.js';
import type { UnitOfWork } from '../../db/unitOfWork.js';

export const APPROVAL_LEASE_MS = 24 * 60 * 60_000;
const TOTAL_DRIFT_PERCENT = 0.01;

export type ApprovalEvaluation =
  | { gate: 'pass' }
  | { gate: 'defer'; approvalRequestId: string }
  | { gate: 'approved-retry'; approvedApprovalRequestId: string }
  | { gate: 'requester-mismatch' }
  | { gate: 'rejected' }
  | { gate: 'expired' }
  | { gate: 'total-drift' };

export interface ApprovalService {
  evaluate(input: {
    userId: number | null;
    cartId: string;
    quoteTotalCents: number;
    resolvedCommitments: {
      deliverySiteId: number | null;
      deliveryAddress: PostalAddress;
      billingEntity: BillingEntitySnapshot;
      deliverySlot: { date: string; window: 'am' | 'pm' };
      purchaseOrderReference: string | null;
    };
    idempotencyKey: string;
    context: AuditContext;
  }): ApprovalEvaluation;
  decide(
    userId: number,
    approvalId: number,
    action: ApprovalDecisionAction,
    reason: string | undefined,
    context: AuditContext,
  ): ApprovalResult<OrderApproval>;
  getForApprover(userId: number, approvalId: number): ApprovalResult<OrderApproval>;
  listPendingForApprover(userId: number): ApprovalResult<OrderApproval[]>;
  listForRequester(userId: number): OrderApproval[];
}

export interface ApprovalServiceDependencies {
  approvals: ApprovalRepository;
  companies: CompanyService;
  mailbox: MailboxRepository;
  unitOfWork: UnitOfWork;
  audit: AuditWriter;
  clock: Clock;
}

function toApproval(row: ApprovalRow): OrderApproval {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    requestedByUserId: String(row.requested_by_user_id),
    cartId: row.cart_id,
    idempotencyKey: row.idempotency_key,
    quoteTotalCents: row.quote_total_cents,
    deliverySiteId: row.delivery_site_id === null ? null : String(row.delivery_site_id),
    deliveryAddress: JSON.parse(row.delivery_address_json) as PostalAddress,
    billingEntity: JSON.parse(row.billing_entity_json) as BillingEntitySnapshot,
    deliverySlot: { date: row.delivery_slot_date, window: row.delivery_slot_window },
    purchaseOrderReference: row.purchase_order_reference,
    status: row.status,
    approvedByUserId: row.approved_by_user_id === null ? null : String(row.approved_by_user_id),
    decisionReason: row.decision_reason,
    requestedAt: row.requested_at,
    resolvedAt: row.resolved_at,
    leaseExpiresAt: row.lease_expires_at,
  };
}

function exceedsDrift(previous: number, current: number): boolean {
  if (previous === current) return false;
  if (previous === 0) return true;
  return Math.abs(current - previous) / previous > TOTAL_DRIFT_PERCENT;
}

function isApprover(membership: CompanyMembership | null): boolean {
  return membership?.role === 'owner' || membership?.role === 'approver';
}

function isBuyer(membership: CompanyMembership | null): boolean {
  return membership?.role === 'owner' || membership?.role === 'buyer';
}

export function createApprovalService(dependencies: ApprovalServiceDependencies): ApprovalService {
  const now = () => dependencies.clock.now().toISOString();
  const expire = (): void => {
    for (const approval of dependencies.approvals.expireStale(now())) {
      dependencies.audit.append({
        action: 'approval.expired',
        approvalId: approval.id,
        companyId: approval.company_id,
        context: { actor: { type: 'system', userId: null }, requestId: null },
      });
    }
  };
  const active = (userId: number) => dependencies.companies.findActiveByUser(userId);
  return {
    evaluate(input) {
      return dependencies.unitOfWork.run(() => {
        expire();
        const existing = dependencies.approvals.findByIdempotencyKey(input.idempotencyKey);
        if (existing) {
          if (input.userId !== existing.requested_by_user_id) return { gate: 'requester-mismatch' };
          if (existing.cart_id !== input.cartId) return { gate: 'total-drift' };
          if (existing.status === 'rejected') return { gate: 'rejected' };
          if (existing.status === 'expired') return { gate: 'expired' };
          if (existing.status === 'approved') {
            return exceedsDrift(existing.quote_total_cents, input.quoteTotalCents)
              ? { gate: 'total-drift' }
              : { gate: 'approved-retry', approvedApprovalRequestId: String(existing.id) };
          }
          return { gate: 'defer', approvalRequestId: String(existing.id) };
        }

        if (input.userId === null) return { gate: 'pass' };
        const userId = input.userId;

        const company = active(userId);
        if (
          !company ||
          !isBuyer(company.membership) ||
          company.company.approvalThresholdCents === null ||
          input.quoteTotalCents < company.company.approvalThresholdCents
        ) {
          return { gate: 'pass' };
        }
        const requestedAt = now();
        const row = dependencies.approvals.create({
          company_id: Number(company.company.id),
          requested_by_user_id: userId,
          cart_id: input.cartId,
          idempotency_key: input.idempotencyKey,
          quote_total_cents: input.quoteTotalCents,
          delivery_site_id: input.resolvedCommitments.deliverySiteId,
          delivery_address_json: JSON.stringify(input.resolvedCommitments.deliveryAddress),
          billing_entity_json: JSON.stringify(input.resolvedCommitments.billingEntity),
          delivery_slot_date: input.resolvedCommitments.deliverySlot.date,
          delivery_slot_window: input.resolvedCommitments.deliverySlot.window,
          purchase_order_reference: input.resolvedCommitments.purchaseOrderReference,
          requested_at: requestedAt,
          lease_expires_at: new Date(Date.parse(requestedAt) + APPROVAL_LEASE_MS).toISOString(),
        });
        dependencies.audit.append({
          action: 'approval.requested',
          approvalId: row.id,
          companyId: row.company_id,
          requestedByUserId: row.requested_by_user_id,
          quoteTotalCents: row.quote_total_cents,
          context: input.context,
        });
        const members = dependencies.companies.listMembers(userId);
        if (members.ok) {
          for (const member of members.value) {
            if (!isApprover(member) || !member.user) continue;
            const country = member.user.country;
            const copy = orderApprovalCopy(country, {
              companyName: company.company.name,
              approvalRequestId: String(row.id),
              // Approval totals are canonical GBP pence. Display conversion belongs to the
              // eventual mailbox renderer, never this persisted producer snapshot.
              totalCents: row.quote_total_cents,
            });
            dependencies.mailbox.add({
              recipient: member.user.email,
              subject: copy.subject,
              body: copy.body,
              kind: 'template',
              templateKey: 'order_approval_request',
              templateParams: {
                companyName: company.company.name,
                approvalRequestId: String(row.id),
                totalCents: row.quote_total_cents,
              },
              country,
              createdAt: requestedAt,
            });
          }
        }
        return { gate: 'defer', approvalRequestId: String(row.id) };
      });
    },
    decide(userId, approvalId, action, reason, context) {
      if (context.actor.type !== 'user' || context.actor.userId !== userId)
        throw new Error('Approval decision audit requires authenticated actor');
      return dependencies.unitOfWork.run(() => {
        expire();
        const approval = dependencies.approvals.findById(approvalId);
        if (!approval) return approvalError('APPROVAL_NOT_FOUND');
        const current = active(userId)?.membership ?? null;
        if (current?.companyId !== String(approval.company_id))
          return approvalError('APPROVAL_NOT_FOUND');
        if (!isApprover(current)) return approvalError('NOT_APPROVER');
        if (approval.status === 'expired') return approvalError('APPROVAL_EXPIRED');
        if (approval.status !== 'pending') return approvalError('APPROVAL_ALREADY_RESOLVED');
        const timestamp = now();
        const nextStatus = action === 'approve' ? 'approved' : 'rejected';
        if (
          !dependencies.approvals.transition({
            id: approval.id,
            expectedStatus: 'pending',
            nextStatus,
            approvedByUserId: userId,
            decisionReason: reason?.trim() || null,
            resolvedAt: timestamp,
          })
        ) {
          return approvalError('APPROVAL_ALREADY_RESOLVED');
        }
        dependencies.audit.append({
          action: nextStatus === 'approved' ? 'approval.approved' : 'approval.rejected',
          approvalId: approval.id,
          companyId: approval.company_id,
          context,
        });
        return approvalOk(toApproval(dependencies.approvals.findById(approval.id)!));
      });
    },
    getForApprover(userId, approvalId) {
      return dependencies.unitOfWork.run(() => {
        expire();
        const approval = dependencies.approvals.findById(approvalId);
        const membership = active(userId)?.membership ?? null;
        if (!approval || membership?.companyId !== String(approval.company_id))
          return approvalError('APPROVAL_NOT_FOUND');
        if (!isApprover(membership)) return approvalError('NOT_APPROVER');
        return approvalOk(toApproval(approval));
      });
    },
    listPendingForApprover(userId) {
      return dependencies.unitOfWork.run(() => {
        expire();
        const membership = active(userId)?.membership ?? null;
        if (!membership) return approvalError('APPROVAL_NOT_FOUND');
        if (!isApprover(membership)) return approvalError('NOT_APPROVER');
        return approvalOk(
          dependencies.approvals.listPendingByCompany(Number(membership.companyId)).map(toApproval),
        );
      });
    },
    listForRequester(userId) {
      return dependencies.unitOfWork.run(() => {
        expire();
        return dependencies.approvals.listByRequester(userId).map(toApproval);
      });
    },
  };
}
