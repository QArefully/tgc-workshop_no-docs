import { Type, type Static } from '@sinclair/typebox';
import { MoneyCents, PositiveIntegerString, PurchaseOrderReference, Uuid } from './common.js';
import { PostalAddress } from './address.js';
import { DeliverySlot } from './delivery.js';
import { BillingEntitySnapshot } from './tradeAccount.js';

const UtcIsoInstant = Type.String({
  minLength: 24,
  maxLength: 24,
  pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$',
});
const DecisionReason = Type.String({ minLength: 1, maxLength: 500, pattern: '^[^<>]*$' });

export const OrderApprovalStatus = Type.Union([
  Type.Literal('pending'),
  Type.Literal('approved'),
  Type.Literal('rejected'),
  Type.Literal('expired'),
]);
export type OrderApprovalStatus = Static<typeof OrderApprovalStatus>;

/** Immutable checkout commitments held before an approved request is re-submitted by its buyer. */
export const OrderApproval = Type.Object(
  {
    id: PositiveIntegerString,
    companyId: PositiveIntegerString,
    requestedByUserId: PositiveIntegerString,
    cartId: Uuid,
    idempotencyKey: Uuid,
    quoteTotalCents: MoneyCents,
    deliverySiteId: Type.Union([PositiveIntegerString, Type.Null()]),
    deliveryAddress: PostalAddress,
    billingEntity: BillingEntitySnapshot,
    deliverySlot: DeliverySlot,
    purchaseOrderReference: Type.Union([PurchaseOrderReference, Type.Null()]),
    status: OrderApprovalStatus,
    approvedByUserId: Type.Union([PositiveIntegerString, Type.Null()]),
    decisionReason: Type.Union([DecisionReason, Type.Null()]),
    requestedAt: UtcIsoInstant,
    resolvedAt: Type.Union([UtcIsoInstant, Type.Null()]),
    leaseExpiresAt: UtcIsoInstant,
  },
  { additionalProperties: false },
);
export type OrderApproval = Static<typeof OrderApproval>;

export const ApprovalListResponse = Type.Array(OrderApproval);
export type ApprovalListResponse = Static<typeof ApprovalListResponse>;

export const ApprovalDecisionAction = Type.Union([Type.Literal('approve'), Type.Literal('reject')]);
export type ApprovalDecisionAction = Static<typeof ApprovalDecisionAction>;

export const ApprovalDecisionBody = Type.Object(
  { action: ApprovalDecisionAction, reason: Type.Optional(DecisionReason) },
  { additionalProperties: false },
);
export type ApprovalDecisionBody = Static<typeof ApprovalDecisionBody>;

export const ApprovalIdParams = Type.Object(
  { approvalId: PositiveIntegerString },
  { additionalProperties: false },
);
export type ApprovalIdParams = Static<typeof ApprovalIdParams>;

/** Checkout has not created an order, payment capture, or inventory reservation for this result. */
export const PendingApprovalResult = Type.Object(
  {
    success: Type.Literal(false),
    error: Type.Literal('PENDING_APPROVAL'),
    approvalRequestId: PositiveIntegerString,
  },
  { additionalProperties: false },
);
export type PendingApprovalResult = Static<typeof PendingApprovalResult>;
