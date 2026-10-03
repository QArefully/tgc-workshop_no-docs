import { SUPPORTED_COUNTRIES, type Country } from '@shop/contracts/country';

const textEncoder = new TextEncoder();

export const AUDIT_ACTIONS = [
  'auth.user_signed_up',
  'auth.session_created',
  'auth.session_destroyed',
  'auth.session_revoked',
  'auth.preferences_updated',
  'auth.data_exported',
  'auth.account_deleted',
  'auth.password_changed',
  'auth.password_reset_requested',
  'auth.password_reset_completed',
  'company.created',
  'company.member_invited',
  'company.invite_revoked',
  'company.member_joined',
  'company.member_revoked',
  'company.member_role_changed',
  'company.threshold_changed',
  'company.credit_limit_changed',
  'company.credit_state_changed',
  'approval.requested',
  'approval.approved',
  'approval.rejected',
  'approval.expired',
  'cart.created',
  'cart.product_added',
  'cart.product_quantity_changed',
  'cart.product_removed',
  'cart.bundle_added',
  'cart.reorder_added',
  'cart.quick_order_added',
  'checkout.cart_consumed',
  'payment.pre_gateway_failed',
  'payment.declined',
  'payment.timed_out',
  'payment.succeeded',
  'invoice.issued',
  'invoice.settled',
  'invoice.voided',
  'order.created',
  'order.shipment_packed',
  'order.cancelled',
  'shipment.transitioned',
  'shipment.tracking_updated',
  'review.created',
  'review.updated',
  'review.deleted',
  'review.hidden',
  'review.restored',
  'review.helpful_added',
  'review.helpful_removed',
  'review.report_created',
  'review.report_withdrawn',
  'review.reports_dismissed',
  'return.requested',
  'return.approved',
  'return.rejected',
  'return.received',
  'payment.refunded',
  'product.created',
  'product.updated',
  'product.retired',
  'variant.created',
  'variant.updated',
  'variant.retired',
  'variant.clearance_set',
  'variant.clearance_cleared',
  'promo.created',
  'promo.updated',
  'promo.deactivated',
  'user.role_changed',
  'user.suspended',
  'user.reactivated',
  'user.display_name_updated',
  'feature_flag.created',
  'feature_flag.updated',
  'feature_flag.deleted',
  'payment.admin_refunded',
  'saved_list.created',
  'saved_list.renamed',
  'saved_list.deleted',
  'saved_list.item_added',
  'saved_list.item_updated',
  'saved_list.item_removed',
  'cart.saved_list_added',
  'job.enqueued',
  'job.succeeded',
  'job.retry_scheduled',
  'job.dead_lettered',
  'job.reclaimed',
  'job.retried_by_admin',
  'notification.created',
  'notification.delivered',
  'notification.delivery_skipped',
  'notification.read',
  'webhook.captured',
  'webhook.processed',
  'webhook.ignored_stale',
  'webhook.rejected',
  'standing_order.created',
  'standing_order.updated',
  'standing_order.deleted',
  'standing_order.run_started',
  'standing_order.run_completed',
  'standing_order.run_failed',
  'back_in_stock.subscribed',
  'back_in_stock.cancelled',
  'back_in_stock.notified',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];
export type AuditEntityType =
  | 'user'
  | 'cart'
  | 'payment'
  | 'order'
  | 'shipment'
  | 'review'
  | 'return'
  | 'company'
  | 'membership'
  | 'invite'
  | 'approval'
  | 'invoice'
  | 'product'
  | 'variant'
  | 'promo'
  | 'feature_flag'
  | 'saved_list'
  | 'job'
  | 'notification'
  | 'webhook'
  | 'standing_order'
  | 'back_in_stock_subscription';
export type AuditActor =
  | { type: 'anonymous'; userId: null }
  | { type: 'user'; userId: number }
  | { type: 'system'; userId: null };

/** Request-scoped facts that are safe to retain with a domain mutation. */
export interface AuditContext {
  actor: AuditActor;
  requestId: string | null;
  /** Country selected by an administrator for this request, when applicable. */
  standingCountry?: Country;
}

export const PRE_GATEWAY_FAILURE_CODES = [
  'CART_NOT_FOUND',
  'CART_EMPTY',
  'PROMO_INVALID',
  'CARD_INVALID',
  'PENDING_APPROVAL',
  'CHECKOUT_FAILED',
] as const;

export type PreGatewayFailureCode = (typeof PRE_GATEWAY_FAILURE_CODES)[number];

type WithContext = { context: AuditContext };
type UserEventAction = Exclude<
  AuditAction,
  | `cart.${string}`
  | `checkout.${string}`
  | `payment.${string}`
  | `invoice.${string}`
  | `order.${string}`
  | `shipment.${string}`
  | `review.${string}`
  | `return.${string}`
  | `company.${string}`
  | `approval.${string}`
  | `saved_list.${string}`
  | `job.${string}`
  | `notification.${string}`
  | `webhook.${string}`
  | `standing_order.${string}`
  | `back_in_stock.${string}`
>;

export type AuditEventInput =
  | (WithContext & { action: 'auth.user_signed_up'; userId: number })
  | (WithContext & { action: 'company.created'; companyId: number })
  | (WithContext & {
      action: 'company.member_invited';
      companyId: number;
      inviteId: number;
      role: 'buyer' | 'approver';
    })
  | (WithContext & { action: 'company.invite_revoked'; companyId: number; inviteId: number })
  | (WithContext & { action: 'company.member_joined'; companyId: number; membershipId: number })
  | (WithContext & {
      action: 'company.member_revoked';
      companyId: number;
      membershipId: number;
      revokedUserId: number;
    })
  | (WithContext & {
      action: 'company.member_role_changed';
      companyId: number;
      membershipId: number;
      oldRole: 'buyer' | 'approver';
      newRole: 'buyer' | 'approver';
    })
  | (WithContext & {
      action: 'company.threshold_changed';
      companyId: number;
      oldThresholdCents: number | null;
      newThresholdCents: number | null;
    })
  | (WithContext & {
      action: 'company.credit_limit_changed';
      companyId: number;
      oldCreditLimitCents: number;
      newCreditLimitCents: number;
    })
  | (WithContext & {
      action: 'company.credit_state_changed';
      companyId: number;
      oldState: 'active' | 'on_hold' | 'suspended';
      newState: 'active' | 'on_hold' | 'suspended';
      reason: string | null;
    })
  | (WithContext & {
      action: 'approval.requested';
      approvalId: number;
      companyId: number;
      requestedByUserId: number;
      quoteTotalCents: number;
    })
  | (WithContext & {
      action: 'approval.approved' | 'approval.rejected' | 'approval.expired';
      approvalId: number;
      companyId: number;
    })
  | (WithContext & { action: 'auth.session_created'; userId: number; source: 'signup' | 'login' })
  | (WithContext & {
      action: Exclude<UserEventAction, 'auth.user_signed_up' | 'auth.session_created'>;
      userId: number;
    })
  | (WithContext & { action: 'cart.created'; cartId: string })
  | (WithContext & {
      action: 'cart.product_added' | 'cart.product_quantity_changed';
      cartId: string;
      productId: number;
      quantity: number;
    })
  | (WithContext & { action: 'cart.product_removed'; cartId: string; productId: number })
  | (WithContext & {
      action: 'cart.bundle_added';
      cartId: string;
      bundleId: number;
      componentCount: number;
      quantity: number;
    })
  | (WithContext & {
      action: 'cart.reorder_added';
      cartId: string;
      orderId: number;
      addedLineCount: number;
      skippedLineCount: number;
    })
  | (WithContext & {
      action: 'cart.quick_order_added';
      cartId: string;
      lineCount: number;
      addedLineCount: number;
      skippedLineCount: number;
    })
  | (WithContext & {
      action: 'cart.saved_list_added';
      cartId: string;
      savedListId: number;
      itemCount: number;
      addedLineCount: number;
      skippedLineCount: number;
    })
  | (WithContext & { action: 'checkout.cart_consumed'; cartId: string })
  | (WithContext & {
      action: 'payment.pre_gateway_failed';
      paymentId: number;
      errorCode: PreGatewayFailureCode;
    })
  | (WithContext & { action: 'payment.declined' | 'payment.timed_out'; paymentId: number })
  | (WithContext & {
      action: 'payment.succeeded';
      paymentId: number;
      orderId: number;
      amountCents: number;
    })
  | (WithContext & {
      action: 'invoice.issued';
      invoiceId: number;
      orderId: number;
      companyId: number;
      grossCents: number;
    })
  | (WithContext & {
      action: 'invoice.settled';
      invoiceId: number;
      orderId: number;
      companyId: number;
      amountCents: number;
    })
  | (WithContext & {
      action: 'invoice.voided';
      invoiceId: number;
      orderId: number;
      companyId: number;
      grossCents: number;
      reason: string;
    })
  | (WithContext & {
      action: 'order.created';
      orderId: number;
      totalCents: number;
      itemCount: number;
    })
  | (WithContext & { action: 'order.shipment_packed'; orderId: number; shipmentCount: number })
  | (WithContext & { action: 'order.cancelled'; orderId: number })
  | (WithContext & {
      action: 'shipment.transitioned';
      shipmentId: number;
      orderId: number;
      status: 'shipped' | 'delivered' | 'delivery_failed';
    })
  | (WithContext & { action: 'shipment.tracking_updated'; shipmentId: number; orderId: number })
  | (WithContext & {
      action: 'review.created' | 'review.updated';
      reviewId: number;
      productId: number;
      rating: number;
    })
  | (WithContext & {
      action: 'review.deleted' | 'review.hidden' | 'review.restored';
      reviewId: number;
      productId: number;
    })
  | (WithContext & {
      action: 'review.helpful_added' | 'review.helpful_removed' | 'review.report_withdrawn';
      reviewId: number;
      productId: number;
    })
  | (WithContext & {
      action: 'review.report_created';
      reviewId: number;
      productId: number;
      reason: 'spam' | 'harassment' | 'unsafe' | 'off_topic' | 'other';
    })
  | (WithContext & {
      action: 'review.reports_dismissed';
      reviewId: number;
      productId: number;
      resolvedReportCount: number;
    })
  // ── return events ──────────────────────────────────────────────
  | (WithContext & { action: 'return.requested'; returnId: number; orderId: number })
  | (WithContext & { action: 'return.approved'; returnId: number; orderId: number })
  | (WithContext & { action: 'return.rejected'; returnId: number; orderId: number })
  | (WithContext & { action: 'return.received'; returnId: number; orderId: number })
  | (WithContext & {
      action: 'payment.refunded';
      returnId: number;
      orderId: number;
      amountCents: number;
    })
  | (WithContext & {
      action: 'product.created' | 'product.updated' | 'product.retired';
      productId: number;
    })
  | (WithContext & {
      action:
        | 'variant.created'
        | 'variant.updated'
        | 'variant.retired'
        | 'variant.clearance_set'
        | 'variant.clearance_cleared';
      variantId: number;
    })
  | (WithContext & {
      action: 'promo.created' | 'promo.updated' | 'promo.deactivated';
      promoCode: string;
    })
  | (WithContext & {
      action: 'feature_flag.created' | 'feature_flag.updated' | 'feature_flag.deleted';
      featureFlagKey: string;
    })
  | (WithContext & {
      action: 'saved_list.created' | 'saved_list.renamed';
      savedListId: number;
      name: string;
    })
  | (WithContext & { action: 'saved_list.deleted'; savedListId: number })
  | (WithContext & {
      action: 'saved_list.item_added';
      savedListId: number;
      variantId: number;
      quantity: number;
    })
  | (WithContext & {
      action: 'saved_list.item_updated';
      savedListId: number;
      itemId: number;
      quantity: number;
    })
  | (WithContext & { action: 'saved_list.item_removed'; savedListId: number; itemId: number })
  | (WithContext & {
      action: 'payment.admin_refunded';
      paymentId: number;
      orderId: number;
      amountCents: number;
    })
  | (WithContext & {
      action: `job.${'enqueued' | 'succeeded' | 'retry_scheduled' | 'dead_lettered' | 'reclaimed' | 'retried_by_admin'}`;
      jobId: number;
    })
  | (WithContext & {
      action: `notification.${'created' | 'delivered' | 'delivery_skipped' | 'read'}`;
      notificationId: number;
    })
  | (WithContext & {
      action: `webhook.${'captured' | 'processed' | 'ignored_stale' | 'rejected'}`;
      webhookId: number;
    })
  | (WithContext & {
      action: `standing_order.${'created' | 'updated' | 'deleted' | 'run_started' | 'run_completed' | 'run_failed'}`;
      standingOrderId: number;
    })
  | (WithContext & {
      action: `back_in_stock.${'subscribed' | 'cancelled' | 'notified'}`;
      subscriptionId: number;
    });

export interface BuiltAuditEvent {
  actorType: AuditActor['type'];
  actorUserId: number | null;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string;
  requestId: string | null;
  metadata: Readonly<Record<string, string | number>>;
  metadataJson: string;
}

export class AuditEventValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuditEventValidationError';
  }
}

const auditActionSet = new Set<string>(AUDIT_ACTIONS);
const preGatewayFailureCodeSet = new Set<string>(PRE_GATEWAY_FAILURE_CODES);
const MAX_METADATA_BYTES = 2_048;
const MAX_ENTITY_ID_LENGTH = 255;
const MAX_REQUEST_ID_LENGTH = 255;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requirePositiveSafeInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new AuditEventValidationError(`${name} must be a positive safe integer`);
  }
  return value as number;
}

function requireNonNegativeSafeInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new AuditEventValidationError(`${name} must be a non-negative safe integer`);
  }
  return value as number;
}

function requireBoundedString(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new AuditEventValidationError(
      `${name} must be a non-empty string of at most ${maxLength} characters`,
    );
  }
  return value;
}

function requireContext(value: unknown): AuditContext {
  if (!isRecord(value) || !isRecord(value.actor)) {
    throw new AuditEventValidationError('context must include a valid actor');
  }
  const { actor, requestId, standingCountry } = value;
  if (actor.type === 'user') {
    requirePositiveSafeInteger(actor.userId, 'actor.userId');
  } else if ((actor.type !== 'anonymous' && actor.type !== 'system') || actor.userId !== null) {
    throw new AuditEventValidationError(
      'actor must be anonymous, user, or system with a valid userId shape',
    );
  }
  if (requestId !== null) requireBoundedString(requestId, 'requestId', MAX_REQUEST_ID_LENGTH);
  if (actor.type !== 'system' && requestId === null) {
    throw new AuditEventValidationError('requestId is required for anonymous and user actors');
  }
  if (
    standingCountry !== undefined &&
    (actor.type !== 'user' ||
      typeof standingCountry !== 'string' ||
      !(SUPPORTED_COUNTRIES as readonly string[]).includes(standingCountry))
  ) {
    throw new AuditEventValidationError(
      'standingCountry must be a supported country for user actors',
    );
  }
  return {
    actor: actor as AuditActor,
    requestId: requestId as string | null,
    ...(standingCountry === undefined ? {} : { standingCountry: standingCountry as Country }),
  };
}

function serializeMetadata(metadata: Record<string, string | number>): string {
  const json = JSON.stringify(metadata);
  if (textEncoder.encode(json).byteLength > MAX_METADATA_BYTES) {
    throw new AuditEventValidationError(
      `metadata must not exceed ${MAX_METADATA_BYTES} UTF-8 bytes`,
    );
  }
  return json;
}

function userEntity(input: Record<string, unknown>): { entityType: 'user'; entityId: string } {
  return {
    entityType: 'user',
    entityId: String(requirePositiveSafeInteger(input.userId, 'userId')),
  };
}

function cartEntity(input: Record<string, unknown>): { entityType: 'cart'; entityId: string } {
  return {
    entityType: 'cart',
    entityId: requireBoundedString(input.cartId, 'cartId', MAX_ENTITY_ID_LENGTH),
  };
}

function paymentEntity(input: Record<string, unknown>): {
  entityType: 'payment';
  entityId: string;
} {
  return {
    entityType: 'payment',
    entityId: String(requirePositiveSafeInteger(input.paymentId, 'paymentId')),
  };
}

function orderEntity(input: Record<string, unknown>): { entityType: 'order'; entityId: string } {
  return {
    entityType: 'order',
    entityId: String(requirePositiveSafeInteger(input.orderId, 'orderId')),
  };
}

function shipmentEntity(input: Record<string, unknown>): {
  entityType: 'shipment';
  entityId: string;
} {
  return {
    entityType: 'shipment',
    entityId: String(requirePositiveSafeInteger(input.shipmentId, 'shipmentId')),
  };
}

function reviewEntity(input: Record<string, unknown>): { entityType: 'review'; entityId: string } {
  return {
    entityType: 'review',
    entityId: String(requirePositiveSafeInteger(input.reviewId, 'reviewId')),
  };
}

function returnEntity(input: Record<string, unknown>): { entityType: 'return'; entityId: string } {
  return {
    entityType: 'return',
    entityId: String(requirePositiveSafeInteger(input.returnId, 'returnId')),
  };
}

function companyEntity(input: Record<string, unknown>): {
  entityType: 'company';
  entityId: string;
} {
  return {
    entityType: 'company',
    entityId: String(requirePositiveSafeInteger(input.companyId, 'companyId')),
  };
}

function invoiceEntity(input: Record<string, unknown>): {
  entityType: 'invoice';
  entityId: string;
} {
  return {
    entityType: 'invoice',
    entityId: String(requirePositiveSafeInteger(input.invoiceId, 'invoiceId')),
  };
}

function membershipEntity(input: Record<string, unknown>): {
  entityType: 'membership';
  entityId: string;
} {
  return {
    entityType: 'membership',
    entityId: String(requirePositiveSafeInteger(input.membershipId, 'membershipId')),
  };
}

function inviteEntity(input: Record<string, unknown>): { entityType: 'invite'; entityId: string } {
  return {
    entityType: 'invite',
    entityId: String(requirePositiveSafeInteger(input.inviteId, 'inviteId')),
  };
}

function approvalEntity(input: Record<string, unknown>): {
  entityType: 'approval';
  entityId: string;
} {
  return {
    entityType: 'approval',
    entityId: String(requirePositiveSafeInteger(input.approvalId, 'approvalId')),
  };
}

function productEntity(input: Record<string, unknown>): {
  entityType: 'product';
  entityId: string;
} {
  return {
    entityType: 'product',
    entityId: String(requirePositiveSafeInteger(input.productId, 'productId')),
  };
}

function variantEntity(input: Record<string, unknown>): {
  entityType: 'variant';
  entityId: string;
} {
  return {
    entityType: 'variant',
    entityId: String(requirePositiveSafeInteger(input.variantId, 'variantId')),
  };
}

function promoEntity(input: Record<string, unknown>): { entityType: 'promo'; entityId: string } {
  return {
    entityType: 'promo',
    entityId: requireBoundedString(input.promoCode, 'promoCode', MAX_ENTITY_ID_LENGTH),
  };
}

function featureFlagEntity(input: Record<string, unknown>): {
  entityType: 'feature_flag';
  entityId: string;
} {
  return {
    entityType: 'feature_flag',
    entityId: requireBoundedString(input.featureFlagKey, 'featureFlagKey', MAX_ENTITY_ID_LENGTH),
  };
}

function savedListEntity(input: Record<string, unknown>): {
  entityType: 'saved_list';
  entityId: string;
} {
  return {
    entityType: 'saved_list',
    entityId: String(requirePositiveSafeInteger(input.savedListId, 'savedListId')),
  };
}

function backInStockEntity(input: Record<string, unknown>): {
  entityType: 'back_in_stock_subscription';
  entityId: string;
} {
  return {
    entityType: 'back_in_stock_subscription',
    entityId: String(requirePositiveSafeInteger(input.subscriptionId, 'subscriptionId')),
  };
}

function asyncEntity(
  input: Record<string, unknown>,
  field: 'jobId' | 'notificationId' | 'webhookId' | 'standingOrderId',
  entityType: 'job' | 'notification' | 'webhook' | 'standing_order',
): { entityType: 'job' | 'notification' | 'webhook' | 'standing_order'; entityId: string } {
  return { entityType, entityId: String(requirePositiveSafeInteger(input[field], field)) };
}

function requireReviewRating(value: unknown): number {
  const rating = requirePositiveSafeInteger(value, 'rating');
  if (rating > 5) throw new AuditEventValidationError('rating must be an integer between 1 and 5');
  return rating;
}

function requireCreditState(value: unknown, name: 'oldState' | 'newState'): string {
  if (value !== 'active' && value !== 'on_hold' && value !== 'suspended') {
    throw new AuditEventValidationError(`${name} is not an allowed credit account state`);
  }
  return value;
}

function requirePlainText(value: unknown, name: string, maxLength: number): string {
  const text = requireBoundedString(value, name, maxLength);
  if (/[<>]/.test(text)) {
    throw new AuditEventValidationError(`${name} must not contain markup delimiters`);
  }
  return text;
}

/** Builds one immutable, privacy-allowlisted audit row from scalar domain facts. */
export function buildAuditEvent(input: AuditEventInput): BuiltAuditEvent {
  if (!isRecord(input) || !auditActionSet.has(input.action)) {
    throw new AuditEventValidationError('action is not an allowed audit action');
  }
  const context = requireContext(input.context);
  let entity: { entityType: AuditEntityType; entityId: string };
  let metadata: Record<string, string | number>;

  switch (input.action) {
    case 'job.enqueued':
    case 'job.succeeded':
    case 'job.retry_scheduled':
    case 'job.dead_lettered':
    case 'job.reclaimed':
    case 'job.retried_by_admin':
      entity = asyncEntity(input, 'jobId', 'job');
      metadata = {};
      break;
    case 'notification.created':
    case 'notification.delivered':
    case 'notification.delivery_skipped':
    case 'notification.read':
      entity = asyncEntity(input, 'notificationId', 'notification');
      metadata = {};
      break;
    case 'webhook.captured':
    case 'webhook.processed':
    case 'webhook.ignored_stale':
    case 'webhook.rejected':
      entity = asyncEntity(input, 'webhookId', 'webhook');
      metadata = {};
      break;
    case 'standing_order.created':
    case 'standing_order.updated':
    case 'standing_order.deleted':
    case 'standing_order.run_started':
    case 'standing_order.run_completed':
    case 'standing_order.run_failed':
      entity = asyncEntity(input, 'standingOrderId', 'standing_order');
      metadata = {};
      break;
    case 'back_in_stock.subscribed':
    case 'back_in_stock.cancelled':
    case 'back_in_stock.notified':
      entity = backInStockEntity(input);
      metadata = {};
      break;
    case 'company.created':
      entity = companyEntity(input);
      metadata = {};
      break;
    case 'company.member_invited':
      entity = inviteEntity(input);
      metadata = {
        companyId: requirePositiveSafeInteger(input.companyId, 'companyId'),
        role: requireBoundedString(input.role, 'role', 16),
      };
      break;
    case 'company.invite_revoked':
      entity = inviteEntity(input);
      metadata = { companyId: requirePositiveSafeInteger(input.companyId, 'companyId') };
      break;
    case 'company.member_joined':
      entity = membershipEntity(input);
      metadata = { companyId: requirePositiveSafeInteger(input.companyId, 'companyId') };
      break;
    case 'company.member_revoked':
      entity = membershipEntity(input);
      metadata = {
        companyId: requirePositiveSafeInteger(input.companyId, 'companyId'),
        revokedUserId: requirePositiveSafeInteger(input.revokedUserId, 'revokedUserId'),
      };
      break;
    case 'company.member_role_changed':
      entity = membershipEntity(input);
      metadata = {
        companyId: requirePositiveSafeInteger(input.companyId, 'companyId'),
        oldRole: requireBoundedString(input.oldRole, 'oldRole', 16),
        newRole: requireBoundedString(input.newRole, 'newRole', 16),
      };
      break;
    case 'company.threshold_changed':
      entity = companyEntity(input);
      metadata = {
        oldThresholdCents:
          input.oldThresholdCents === null
            ? 'null'
            : requireNonNegativeSafeInteger(input.oldThresholdCents, 'oldThresholdCents'),
        newThresholdCents:
          input.newThresholdCents === null
            ? 'null'
            : requireNonNegativeSafeInteger(input.newThresholdCents, 'newThresholdCents'),
      };
      break;
    case 'company.credit_limit_changed':
      entity = companyEntity(input);
      metadata = {
        oldCreditLimitCents: requireNonNegativeSafeInteger(
          input.oldCreditLimitCents,
          'oldCreditLimitCents',
        ),
        newCreditLimitCents: requireNonNegativeSafeInteger(
          input.newCreditLimitCents,
          'newCreditLimitCents',
        ),
      };
      break;
    case 'company.credit_state_changed':
      entity = companyEntity(input);
      metadata = {
        oldState: requireCreditState(input.oldState, 'oldState'),
        newState: requireCreditState(input.newState, 'newState'),
        reason: input.reason === null ? 'null' : requirePlainText(input.reason, 'reason', 500),
      };
      break;
    case 'approval.requested':
      entity = approvalEntity(input);
      metadata = {
        companyId: requirePositiveSafeInteger(input.companyId, 'companyId'),
        requestedByUserId: requirePositiveSafeInteger(input.requestedByUserId, 'requestedByUserId'),
        quoteTotalCents: requireNonNegativeSafeInteger(input.quoteTotalCents, 'quoteTotalCents'),
      };
      break;
    case 'approval.approved':
    case 'approval.rejected':
    case 'approval.expired':
      entity = approvalEntity(input);
      metadata = { companyId: requirePositiveSafeInteger(input.companyId, 'companyId') };
      break;
    case 'auth.user_signed_up':
    case 'auth.session_destroyed':
    case 'auth.session_revoked':
    case 'auth.preferences_updated':
    case 'auth.data_exported':
    case 'auth.account_deleted':
    case 'auth.password_changed':
    case 'auth.password_reset_requested':
    case 'auth.password_reset_completed':
    case 'user.role_changed':
    case 'user.suspended':
    case 'user.reactivated':
    case 'user.display_name_updated':
      entity = userEntity(input);
      metadata = {};
      break;
    case 'auth.session_created':
      entity = userEntity(input);
      if (input.source !== 'signup' && input.source !== 'login') {
        throw new AuditEventValidationError('source must be signup or login');
      }
      metadata = { source: input.source };
      break;
    case 'cart.created':
    case 'checkout.cart_consumed':
      entity = cartEntity(input);
      metadata = {};
      break;
    case 'cart.product_added':
    case 'cart.product_quantity_changed':
      entity = cartEntity(input);
      metadata = {
        productId: requirePositiveSafeInteger(input.productId, 'productId'),
        quantity: requirePositiveSafeInteger(input.quantity, 'quantity'),
      };
      break;
    case 'cart.product_removed':
      entity = cartEntity(input);
      metadata = { productId: requirePositiveSafeInteger(input.productId, 'productId') };
      break;
    case 'cart.bundle_added':
      entity = cartEntity(input);
      metadata = {
        bundleId: requirePositiveSafeInteger(input.bundleId, 'bundleId'),
        componentCount: requirePositiveSafeInteger(input.componentCount, 'componentCount'),
        quantity: requirePositiveSafeInteger(input.quantity, 'quantity'),
      };
      break;
    case 'cart.reorder_added':
      entity = cartEntity(input);
      metadata = {
        orderId: requirePositiveSafeInteger(input.orderId, 'orderId'),
        addedLineCount: requireNonNegativeSafeInteger(input.addedLineCount, 'addedLineCount'),
        skippedLineCount: requireNonNegativeSafeInteger(input.skippedLineCount, 'skippedLineCount'),
      };
      break;
    case 'cart.quick_order_added':
      entity = cartEntity(input);
      metadata = {
        lineCount: requireNonNegativeSafeInteger(input.lineCount, 'lineCount'),
        addedLineCount: requireNonNegativeSafeInteger(input.addedLineCount, 'addedLineCount'),
        skippedLineCount: requireNonNegativeSafeInteger(input.skippedLineCount, 'skippedLineCount'),
      };
      break;
    case 'cart.saved_list_added':
      entity = cartEntity(input);
      metadata = {
        savedListId: requirePositiveSafeInteger(input.savedListId, 'savedListId'),
        itemCount: requireNonNegativeSafeInteger(input.itemCount, 'itemCount'),
        addedLineCount: requireNonNegativeSafeInteger(input.addedLineCount, 'addedLineCount'),
        skippedLineCount: requireNonNegativeSafeInteger(input.skippedLineCount, 'skippedLineCount'),
      };
      break;
    case 'payment.pre_gateway_failed':
      entity = paymentEntity(input);
      if (!preGatewayFailureCodeSet.has(input.errorCode)) {
        throw new AuditEventValidationError('errorCode is not an allowed pre-gateway failure code');
      }
      metadata = { errorCode: input.errorCode };
      break;
    case 'payment.declined':
    case 'payment.timed_out':
      entity = paymentEntity(input);
      metadata = {};
      break;
    case 'payment.succeeded':
      entity = paymentEntity(input);
      metadata = {
        orderId: requirePositiveSafeInteger(input.orderId, 'orderId'),
        amountCents: requireNonNegativeSafeInteger(input.amountCents, 'amountCents'),
      };
      break;
    case 'invoice.issued':
      entity = invoiceEntity(input);
      metadata = {
        orderId: requirePositiveSafeInteger(input.orderId, 'orderId'),
        companyId: requirePositiveSafeInteger(input.companyId, 'companyId'),
        grossCents: requireNonNegativeSafeInteger(input.grossCents, 'grossCents'),
      };
      break;
    case 'invoice.settled':
      entity = invoiceEntity(input);
      metadata = {
        orderId: requirePositiveSafeInteger(input.orderId, 'orderId'),
        companyId: requirePositiveSafeInteger(input.companyId, 'companyId'),
        amountCents: requirePositiveSafeInteger(input.amountCents, 'amountCents'),
      };
      break;
    case 'invoice.voided':
      entity = invoiceEntity(input);
      metadata = {
        orderId: requirePositiveSafeInteger(input.orderId, 'orderId'),
        companyId: requirePositiveSafeInteger(input.companyId, 'companyId'),
        grossCents: requireNonNegativeSafeInteger(input.grossCents, 'grossCents'),
        reason: requirePlainText(input.reason, 'reason', 500),
      };
      break;
    case 'order.created':
      entity = orderEntity(input);
      metadata = {
        totalCents: requireNonNegativeSafeInteger(input.totalCents, 'totalCents'),
        itemCount: requireNonNegativeSafeInteger(input.itemCount, 'itemCount'),
      };
      break;
    case 'order.shipment_packed':
      entity = orderEntity(input);
      metadata = {
        shipmentCount: requirePositiveSafeInteger(input.shipmentCount, 'shipmentCount'),
      };
      break;
    case 'order.cancelled':
      entity = orderEntity(input);
      metadata = {};
      break;
    case 'shipment.transitioned':
      entity = shipmentEntity(input);
      if (!['shipped', 'delivered', 'delivery_failed'].includes(input.status)) {
        throw new AuditEventValidationError('status is not an allowed shipment status');
      }
      metadata = {
        orderId: requirePositiveSafeInteger(input.orderId, 'orderId'),
        status: input.status,
      };
      break;
    case 'shipment.tracking_updated':
      entity = shipmentEntity(input);
      metadata = { orderId: requirePositiveSafeInteger(input.orderId, 'orderId') };
      break;
    case 'review.created':
    case 'review.updated':
      entity = reviewEntity(input);
      metadata = {
        productId: requirePositiveSafeInteger(input.productId, 'productId'),
        rating: requireReviewRating(input.rating),
      };
      break;
    case 'review.deleted':
    case 'review.hidden':
    case 'review.restored':
    case 'review.helpful_added':
    case 'review.helpful_removed':
    case 'review.report_withdrawn':
      entity = reviewEntity(input);
      metadata = { productId: requirePositiveSafeInteger(input.productId, 'productId') };
      break;
    case 'review.report_created':
      entity = reviewEntity(input);
      if (!['spam', 'harassment', 'unsafe', 'off_topic', 'other'].includes(input.reason)) {
        throw new AuditEventValidationError('reason is not an allowed review report reason');
      }
      metadata = {
        productId: requirePositiveSafeInteger(input.productId, 'productId'),
        reason: input.reason,
      };
      break;
    case 'review.reports_dismissed':
      entity = reviewEntity(input);
      metadata = {
        productId: requirePositiveSafeInteger(input.productId, 'productId'),
        resolvedReportCount: requireNonNegativeSafeInteger(
          input.resolvedReportCount,
          'resolvedReportCount',
        ),
      };
      break;
    case 'return.requested':
    case 'return.approved':
    case 'return.rejected':
    case 'return.received':
      entity = returnEntity(input);
      metadata = {
        orderId: requirePositiveSafeInteger(input.orderId, 'orderId'),
      };
      break;
    case 'payment.refunded':
      entity = returnEntity(input);
      metadata = {
        orderId: requirePositiveSafeInteger(input.orderId, 'orderId'),
        amountCents: requireNonNegativeSafeInteger(input.amountCents, 'amountCents'),
      };
      break;
    case 'product.created':
    case 'product.updated':
    case 'product.retired':
      entity = productEntity(input);
      metadata = {};
      break;
    case 'variant.created':
    case 'variant.updated':
    case 'variant.retired':
    case 'variant.clearance_set':
    case 'variant.clearance_cleared':
      entity = variantEntity(input);
      metadata = {};
      break;
    case 'promo.created':
    case 'promo.updated':
    case 'promo.deactivated':
      entity = promoEntity(input);
      metadata = {};
      break;
    case 'feature_flag.created':
    case 'feature_flag.updated':
    case 'feature_flag.deleted':
      entity = featureFlagEntity(input);
      metadata = {};
      break;
    case 'saved_list.created':
    case 'saved_list.renamed':
      entity = savedListEntity(input);
      metadata = {
        savedListId: requirePositiveSafeInteger(input.savedListId, 'savedListId'),
        name: requireBoundedString(input.name, 'name', 80),
      };
      break;
    case 'saved_list.deleted':
      entity = savedListEntity(input);
      metadata = { savedListId: requirePositiveSafeInteger(input.savedListId, 'savedListId') };
      break;
    case 'saved_list.item_added':
      entity = savedListEntity(input);
      metadata = {
        savedListId: requirePositiveSafeInteger(input.savedListId, 'savedListId'),
        variantId: requirePositiveSafeInteger(input.variantId, 'variantId'),
        quantity: requirePositiveSafeInteger(input.quantity, 'quantity'),
      };
      break;
    case 'saved_list.item_updated':
      entity = savedListEntity(input);
      metadata = {
        savedListId: requirePositiveSafeInteger(input.savedListId, 'savedListId'),
        itemId: requirePositiveSafeInteger(input.itemId, 'itemId'),
        quantity: requirePositiveSafeInteger(input.quantity, 'quantity'),
      };
      break;
    case 'saved_list.item_removed':
      entity = savedListEntity(input);
      metadata = {
        savedListId: requirePositiveSafeInteger(input.savedListId, 'savedListId'),
        itemId: requirePositiveSafeInteger(input.itemId, 'itemId'),
      };
      break;
    case 'payment.admin_refunded':
      entity = paymentEntity(input);
      metadata = {
        orderId: requirePositiveSafeInteger(input.orderId, 'orderId'),
        amountCents: requireNonNegativeSafeInteger(input.amountCents, 'amountCents'),
      };
      break;
  }

  // Standing country is retained only for explicitly annotated user contexts (admin routes).
  // Customer and system contexts omit it, leaving their metadata unchanged.
  if (context.actor.type === 'user' && context.standingCountry !== undefined) {
    metadata = { ...metadata, country: context.standingCountry };
  }

  const metadataJson = serializeMetadata(metadata);
  return Object.freeze({
    actorType: context.actor.type,
    actorUserId: context.actor.userId,
    action: input.action,
    entityType: entity.entityType,
    entityId: entity.entityId,
    requestId: context.requestId,
    metadata: Object.freeze({ ...metadata }),
    metadataJson,
  });
}
