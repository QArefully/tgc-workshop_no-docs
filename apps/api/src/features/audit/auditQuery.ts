import { AUDIT_ACTIONS, type AuditAction, type AuditEntityType } from './auditEvent.js';

export interface AuditEventQueryInput {
  action?: string;
  entityType?: string;
  entityId?: string;
  actorUserId?: number;
  requestId?: string;
  occurredFrom?: string;
  occurredTo?: string;
  page?: number;
  pageSize?: number;
}

export interface NormalizedAuditEventQuery {
  action?: AuditAction;
  entityType?: AuditEntityType;
  entityId?: string;
  actorUserId?: number;
  requestId?: string;
  /** Inclusive UTC instant at start of occurredFrom day. */
  occurredFrom?: string;
  /** Inclusive UTC instant at end of occurredTo day. */
  occurredTo?: string;
  page: number;
  pageSize: number;
}

export class AuditQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuditQueryError';
  }
}

const actionSet = new Set<string>(AUDIT_ACTIONS);
const entityTypeSet = new Set<AuditEntityType>([
  'user',
  'company',
  'membership',
  'invite',
  'approval',
  'cart',
  'payment',
  'invoice',
  'order',
  'shipment',
  'review',
  'return',
  'product',
  'variant',
  'promo',
  'feature_flag',
  'saved_list',
  'job',
  'notification',
  'webhook',
  'standing_order',
  'back_in_stock_subscription',
]);

function normalizeDate(value: string, field: 'occurredFrom' | 'occurredTo'): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new AuditQueryError(`${field} must be a valid YYYY-MM-DD date`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new AuditQueryError(`${field} must be a valid YYYY-MM-DD date`);
  }
  return field === 'occurredFrom' ? `${value}T00:00:00.000Z` : `${value}T23:59:59.999Z`;
}

function optionalNonEmptyString(value: string | undefined, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (value.length === 0) throw new AuditQueryError(`${field} must not be empty`);
  return value;
}

function normalizePage(
  value: number | undefined,
  field: 'page' | 'pageSize',
  max: number,
  fallback: number,
): number {
  const parsed = value ?? fallback;
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
    throw new AuditQueryError(`${field} must be an integer between 1 and ${max}`);
  }
  return parsed;
}

/** Normalizes exact audit filters and expands UTC dates to inclusive day boundaries. */
export function normalizeAuditEventQuery(query: AuditEventQueryInput): NormalizedAuditEventQuery {
  if (query.action !== undefined && !actionSet.has(query.action)) {
    throw new AuditQueryError('action is not an allowed audit action');
  }
  if (query.entityType !== undefined && !entityTypeSet.has(query.entityType as AuditEntityType)) {
    throw new AuditQueryError('entityType is not an allowed audit entity type');
  }
  if (
    query.actorUserId !== undefined &&
    (!Number.isSafeInteger(query.actorUserId) || query.actorUserId <= 0)
  ) {
    throw new AuditQueryError('actorUserId must be a positive safe integer');
  }

  const occurredFrom = query.occurredFrom
    ? normalizeDate(query.occurredFrom, 'occurredFrom')
    : undefined;
  const occurredTo = query.occurredTo ? normalizeDate(query.occurredTo, 'occurredTo') : undefined;
  if (occurredFrom && occurredTo && occurredFrom > occurredTo) {
    throw new AuditQueryError('occurredFrom must be on or before occurredTo');
  }

  return {
    ...(query.action ? { action: query.action as AuditAction } : {}),
    ...(query.entityType ? { entityType: query.entityType as AuditEntityType } : {}),
    ...(optionalNonEmptyString(query.entityId, 'entityId') ? { entityId: query.entityId } : {}),
    ...(query.actorUserId !== undefined ? { actorUserId: query.actorUserId } : {}),
    ...(optionalNonEmptyString(query.requestId, 'requestId') ? { requestId: query.requestId } : {}),
    ...(occurredFrom ? { occurredFrom } : {}),
    ...(occurredTo ? { occurredTo } : {}),
    page: normalizePage(query.page, 'page', 10_000, 1),
    pageSize: normalizePage(query.pageSize, 'pageSize', 100, 50),
  };
}
