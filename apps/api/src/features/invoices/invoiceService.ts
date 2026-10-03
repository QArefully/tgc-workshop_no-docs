import { createHash } from 'node:crypto';
import { Value } from '@sinclair/typebox/value';
import { SUPPORTED_COUNTRIES, type Country } from '@shop/contracts/country';
import {
  BillingEntitySnapshot,
  type BillingEntitySnapshot as BillingEntitySnapshotType,
} from '@shop/contracts/trade-account';
import {
  Invoice,
  InvoiceLineV1,
  InvoiceDocumentV1,
  type InvoiceSettlementBody,
  type InvoiceLifecycleStatus,
} from '@shop/contracts/trade-credit';
import type { UnitOfWork } from '../../db/unitOfWork.js';
import type { AuditContext } from '../audit/auditEvent.js';
import type { AuditWriter, Clock } from '../audit/auditService.js';
import { calculateInvoiceDueAt } from '../tradeCredit/tradeCreditRules.js';
import { InvoiceDomainError } from './invoiceErrors.js';
import type {
  InvoiceAdminListQuery,
  InvoiceInsert,
  InvoiceOrderReview,
  InvoicePaymentReview,
  InvoiceRepository,
} from './invoiceRepository.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const INVOICE_STATUSES = new Set<InvoiceLifecycleStatus>(['open', 'overdue', 'paid', 'voided']);

export interface InvoiceReviewLine {
  lineId: string | number;
  description?: string;
  productId?: string | number;
  variantId?: string | number;
  sku?: string;
  quantity: number;
  unitPriceCents: number;
  netCents: number;
}

/** Facts reviewed by the caller and frozen into the invoice document. */
export interface InvoiceReviewedFacts {
  orderId: number;
  paymentIdempotencyKey: string;
  companyId: number;
  userId: number;
  country: Country;
  billingEntity: BillingEntitySnapshotType;
  purchaseOrderReference: string | null;
  lines: InvoiceReviewLine[];
  netCents: number;
  vatRateBasisPoints: number;
  vatCents: number;
  grossCents: number;
  issuedAt?: string;
}

/** Input accepts both the canonical reviewedFacts envelope and flat internal callers. */
export interface InvoiceIssueInput extends Partial<InvoiceReviewedFacts> {
  orderId: number;
  paymentIdempotencyKey: string;
  reviewedFacts?: Partial<InvoiceReviewedFacts>;
  facts?: Partial<InvoiceReviewedFacts>;
  reviewedOrder?: Partial<InvoiceOrderReview>;
  reviewedPayment?: Partial<InvoicePaymentReview>;
  document?: Partial<InvoiceDocumentV1>;
  invoiceDocument?: Partial<InvoiceDocumentV1>;
  issuedAt?: string;
  now?: string;
  [key: string]: unknown;
}

export interface InvoiceSettlementInput extends InvoiceSettlementBody {
  invoiceId: number;
  /** Request-scoped actor and standing-country facts used by the lifecycle audit event. */
  context: AuditContext;
  /** Country boundary supplied by the authenticated/admin request. */
  standingCountry: Country;
  actorUserId?: number | null;
  userId?: number | null;
  /** Compatibility alias for internal callers that call this field version. */
  version?: number;
  [key: string]: unknown;
}

export interface InvoiceVoidInput {
  invoiceId: number;
  expectedVersion: number;
  idempotencyKey: string;
  reason: string;
  /** Request-scoped actor and standing-country facts used by the lifecycle audit event. */
  context: AuditContext;
  /** Country boundary supplied by the authenticated/admin request. */
  standingCountry: Country;
  actorUserId?: number | null;
  userId?: number | null;
  version?: number;
  [key: string]: unknown;
}

export interface InvoiceListPage {
  items: Invoice[];
  total: number;
  page: number;
  pageSize: number;
}

export interface InvoiceService {
  issue(input: InvoiceIssueInput): Invoice;
  /** Alias retained for finalizers that call the command create(). */
  create(input: InvoiceIssueInput): Invoice;
  get(invoiceId: number, userId?: number): Invoice;
  getOwned(invoiceId: number, userId: number): Invoice;
  getAdmin(invoiceId: number, standingCountry?: Country): Invoice;
  listAdmin(query?: Partial<InvoiceAdminListQuery>, standingCountry?: Country): InvoiceListPage;
  settle(input: InvoiceSettlementInput): Invoice;
  settleInvoice(input: InvoiceSettlementInput): Invoice;
  void(input: InvoiceVoidInput): Invoice;
  voidInvoice(input: InvoiceVoidInput): Invoice;
}

export interface InvoiceServiceDependencies {
  repository: InvoiceRepository;
  unitOfWork: UnitOfWork;
  clock: Clock;
  audit: AuditWriter;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positiveId(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new InvoiceDomainError('INVOICE_SETTLEMENT_INVALID', `${name} is invalid`);
  }
  return value;
}

function nonNegativeMoney(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new InvoiceDomainError('INVOICE_TOTAL_MISMATCH', `${name} is invalid`);
  }
  return value;
}

function requiredText(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 255) {
    throw new InvoiceDomainError('INVOICE_SETTLEMENT_INVALID', `${name} is invalid`);
  }
  return value;
}

function requireUtc(value: unknown, name: string): string {
  if (typeof value !== 'string' || !ISO_UTC_PATTERN.test(value)) {
    throw new InvoiceDomainError('INVOICE_TOTAL_MISMATCH', `${name} is invalid`);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new InvoiceDomainError('INVOICE_TOTAL_MISMATCH', `${name} is invalid`);
  }
  return value;
}

function mergeIssueFacts(input: InvoiceIssueInput): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const nested of [input.reviewedOrder, input.facts, input.reviewedFacts]) {
    if (isRecord(nested)) Object.assign(result, nested);
  }
  // Flat fields are authoritative when both an envelope and compatibility aliases are present.
  for (const [key, value] of Object.entries(input)) {
    if (
      ![
        'reviewedOrder',
        'facts',
        'reviewedFacts',
        'reviewedPayment',
        'document',
        'invoiceDocument',
      ].includes(key)
    ) {
      if (value !== undefined) result[key] = value;
    }
  }
  return result;
}

function canonicalFingerprint(
  operation: 'settle' | 'void',
  input: {
    invoiceId: number;
    expectedVersion: number;
    reason?: string;
  },
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        operation,
        invoiceId: input.invoiceId,
        expectedVersion: input.expectedVersion,
        ...(operation === 'void' ? { reason: input.reason } : {}),
      }),
    )
    .digest('hex');
}

function actorId(input: { actorUserId?: number | null; userId?: number | null }): number | null {
  const value = input.actorUserId ?? input.userId ?? null;
  if (value === null) return null;
  return positiveId(value, 'actor user id');
}

function normalizeLines(value: unknown): InvoiceLineV1[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 1_000) {
    throw new InvoiceDomainError('INVOICE_TOTAL_MISMATCH', 'Invoice lines are invalid');
  }
  return value.map((lineValue, index) => {
    if (!isRecord(lineValue)) {
      throw new InvoiceDomainError(
        'INVOICE_TOTAL_MISMATCH',
        `Invoice line ${index + 1} is invalid`,
      );
    }
    const lineId = lineValue.lineId;
    const quantity = lineValue.quantity;
    const unitPriceCents = lineValue.unitPriceCents;
    const netCents = lineValue.netCents;
    const line: Record<string, unknown> = {
      lineId: typeof lineId === 'number' ? String(lineId) : lineId,
      description:
        typeof lineValue.description === 'string'
          ? lineValue.description
          : typeof lineValue.productName === 'string'
            ? lineValue.productName
            : undefined,
      quantity,
      unitPriceCents,
      netCents,
    };
    for (const key of ['productId', 'variantId', 'sku']) {
      const valueForKey = lineValue[key];
      if (valueForKey !== undefined) {
        if (key === 'productId' || key === 'variantId') {
          line[key] =
            typeof valueForKey === 'string' || typeof valueForKey === 'number'
              ? String(valueForKey)
              : valueForKey;
        } else {
          line[key] = valueForKey;
        }
      }
    }
    if (!Value.Check(InvoiceLineV1, line)) {
      throw new InvoiceDomainError(
        'INVOICE_TOTAL_MISMATCH',
        `Invoice line ${index + 1} is invalid`,
      );
    }
    return line;
  });
}

function compareOptionalSnapshot(
  actual: BillingEntitySnapshotType | null | undefined,
  expected: BillingEntitySnapshotType | null | undefined,
): boolean {
  const canonicalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (isRecord(value)) {
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, canonicalize(value[key])]),
      );
    }
    return value;
  };
  return (
    JSON.stringify(canonicalize(actual ?? null)) === JSON.stringify(canonicalize(expected ?? null))
  );
}

function sourceFieldsMatch(
  facts: Record<string, unknown>,
  order: InvoiceOrderReview,
  payment: InvoicePaymentReview | undefined,
): void {
  if (
    order.paymentMethod !== 'trade_credit' ||
    order.companyId === null ||
    order.userId === null ||
    order.netCents === null ||
    order.vatRateBasisPoints === null ||
    order.vatCents === null ||
    order.grossCents === null
  ) {
    throw new InvoiceDomainError('INVOICE_TOTAL_MISMATCH');
  }
  const checks: Array<[string, unknown]> = [
    ['country', order.country],
    ['companyId', order.companyId],
    ['userId', order.userId],
    ['netCents', order.netCents],
    ['vatRateBasisPoints', order.vatRateBasisPoints],
    ['vatCents', order.vatCents],
    ['grossCents', order.grossCents],
    ['purchaseOrderReference', order.purchaseOrderReference],
  ];
  for (const [key, expected] of checks) {
    if (facts[key] !== undefined && facts[key] !== expected) {
      throw new InvoiceDomainError('INVOICE_TOTAL_MISMATCH');
    }
  }
  if (
    facts.billingEntity !== undefined &&
    !compareOptionalSnapshot(facts.billingEntity as BillingEntitySnapshotType, order.billingEntity)
  ) {
    throw new InvoiceDomainError('INVOICE_TOTAL_MISMATCH');
  }
  if (payment !== undefined) {
    if (
      payment.paymentMethod !== 'trade_credit' ||
      payment.orderId !== order.id ||
      payment.companyId !== order.companyId ||
      payment.amountCents !== order.grossCents ||
      payment.status !== 'authorized_pending_finalize'
    ) {
      throw new InvoiceDomainError('INVOICE_TOTAL_MISMATCH');
    }
  }
}

/** Rejects compatibility document aliases that disagree with the reviewed source facts. */
function assertDocumentMatches(
  documentInput: Record<string, unknown>,
  expected: {
    orderId: number;
    paymentIdempotencyKey: string;
    companyId: number;
    userId: number;
    country: Country;
    billingEntity: BillingEntitySnapshotType;
    purchaseOrderReference: string | null;
    lines: InvoiceLineV1[];
    netCents: number;
    vatRateBasisPoints: number;
    vatCents: number;
    grossCents: number;
    issuedAt: string;
    dueAt: string;
  },
): void {
  const matches = (key: string, value: unknown): boolean =>
    documentInput[key] === undefined || documentInput[key] === value;
  const matchesStringNumber = (key: string, value: number): boolean =>
    documentInput[key] === undefined ||
    documentInput[key] === value ||
    documentInput[key] === String(value);
  if (
    (documentInput.version !== undefined && documentInput.version !== 1) ||
    !matchesStringNumber('orderId', expected.orderId) ||
    !matchesStringNumber('companyId', expected.companyId) ||
    !matchesStringNumber('userId', expected.userId) ||
    !matches('country', expected.country) ||
    !matches('paymentMethod', 'trade_credit') ||
    !matches('currency', 'GBP') ||
    (documentInput.terms !== undefined &&
      documentInput.terms !== 'net_30' &&
      documentInput.terms !== 30) ||
    (documentInput.termsDays !== undefined && documentInput.termsDays !== 30) ||
    !matches('netCents', expected.netCents) ||
    !matches('vatRateBasisPoints', expected.vatRateBasisPoints) ||
    !matches('vatCents', expected.vatCents) ||
    !matches('grossCents', expected.grossCents) ||
    !matches('issuedAt', expected.issuedAt) ||
    !matches('dueAt', expected.dueAt) ||
    !matches('purchaseOrderReference', expected.purchaseOrderReference) ||
    (documentInput.paymentIdempotencyKey !== undefined &&
      (documentInput.paymentIdempotencyKey !== expected.paymentIdempotencyKey ||
        typeof documentInput.paymentIdempotencyKey !== 'string' ||
        !UUID_PATTERN.test(documentInput.paymentIdempotencyKey))) ||
    (documentInput.billingEntity !== undefined &&
      !compareOptionalSnapshot(
        documentInput.billingEntity as BillingEntitySnapshotType,
        expected.billingEntity,
      ))
  ) {
    throw new InvoiceDomainError('INVOICE_TOTAL_MISMATCH');
  }
  if (documentInput.lines !== undefined) {
    const lines = normalizeLines(documentInput.lines);
    if (JSON.stringify(lines) !== JSON.stringify(expected.lines)) {
      throw new InvoiceDomainError('INVOICE_TOTAL_MISMATCH');
    }
  }
}

/** Retried issuance is idempotent only when supplied reviewed facts remain immutable-compatible. */
function assertIssueReplayMatches(
  existing: Invoice,
  input: InvoiceIssueInput,
  orderId: number,
  paymentIdempotencyKey: string,
): void {
  const facts = mergeIssueFacts(input);
  const checks: Array<[string, unknown]> = [
    ['companyId', Number(existing.companyId)],
    ['userId', Number(existing.userId)],
    ['country', existing.country],
    ['purchaseOrderReference', existing.purchaseOrderReference],
    ['netCents', existing.netCents],
    ['vatRateBasisPoints', existing.vatRateBasisPoints],
    ['vatCents', existing.vatCents],
    ['grossCents', existing.grossCents],
    ['issuedAt', existing.issuedAt],
  ];
  for (const [key, expected] of checks) {
    if (facts[key] !== undefined && facts[key] !== expected) {
      throw new InvoiceDomainError('INVOICE_TOTAL_MISMATCH');
    }
  }
  if (
    facts.billingEntity !== undefined &&
    !compareOptionalSnapshot(
      facts.billingEntity as BillingEntitySnapshotType,
      existing.billingEntity,
    )
  ) {
    throw new InvoiceDomainError('INVOICE_TOTAL_MISMATCH');
  }
  if (facts.lines !== undefined) {
    const lines = normalizeLines(facts.lines);
    if (JSON.stringify(lines) !== JSON.stringify(existing.lines)) {
      throw new InvoiceDomainError('INVOICE_TOTAL_MISMATCH');
    }
  }
  const documentInput =
    (isRecord(input.document) && input.document) ||
    (isRecord(input.invoiceDocument) && input.invoiceDocument);
  if (documentInput) {
    assertDocumentMatches(documentInput, {
      orderId,
      paymentIdempotencyKey,
      companyId: Number(existing.companyId),
      userId: Number(existing.userId),
      country: existing.country,
      billingEntity: existing.billingEntity,
      purchaseOrderReference: existing.purchaseOrderReference,
      lines: existing.lines,
      netCents: existing.netCents,
      vatRateBasisPoints: existing.vatRateBasisPoints,
      vatCents: existing.vatCents,
      grossCents: existing.grossCents,
      issuedAt: existing.issuedAt,
      dueAt: existing.dueAt,
    });
  }
}

function fallbackLines(order: InvoiceOrderReview, netCents: number): InvoiceLineV1[] {
  const direct = order.lines
    .filter(
      (line) =>
        Number.isSafeInteger(line.quantity) &&
        line.quantity > 0 &&
        Number.isSafeInteger(line.unitPriceCents) &&
        line.unitPriceCents >= 0 &&
        line.unitPriceCents * line.quantity === line.netCents,
    )
    .map((line) => ({
      lineId: String(line.lineId),
      description: line.description,
      ...(line.productId === undefined ? {} : { productId: String(line.productId) }),
      ...(line.variantId === null || line.variantId === undefined
        ? {}
        : { variantId: String(line.variantId) }),
      ...(line.sku === null || line.sku === undefined ? {} : { sku: line.sku }),
      quantity: line.quantity,
      unitPriceCents: line.unitPriceCents,
      netCents: line.netCents,
    })) as InvoiceLineV1[];
  if (direct.length > 0 && direct.reduce((total, line) => total + line.netCents, 0) === netCents) {
    return direct;
  }
  // A historic order can have discounts/delivery that are not represented on line rows. Keep one
  // synthetic reviewed total rather than inventing a discount allocation in the invoice service.
  return [
    {
      lineId: '1',
      description: 'Order total',
      quantity: 1,
      unitPriceCents: netCents,
      netCents,
    },
  ];
}

/**
 * Order lines are server-owned invoice facts. A caller may repeat them for compatibility, but
 * cannot use a reviewed/document alias to replace the persisted order snapshot.
 */
function deriveInvoiceLines(
  sourceOrder: InvoiceOrderReview,
  netCents: number,
  requestedLines: unknown,
): InvoiceLineV1[] {
  const persistedLines = normalizeLines(
    fallbackLines(sourceOrder, sourceOrder.netCents ?? netCents),
  );
  if (requestedLines !== undefined) {
    const reviewedLines = normalizeLines(requestedLines);
    if (JSON.stringify(reviewedLines) !== JSON.stringify(persistedLines)) {
      throw new InvoiceDomainError('INVOICE_TOTAL_MISMATCH');
    }
  }
  return persistedLines;
}

function pageNumber(value: unknown, name: 'page' | 'pageSize'): number {
  const fallback = name === 'page' ? 1 : 25;
  const maximum = name === 'page' ? 10_000 : 100;
  const result = value === undefined ? fallback : value;
  if (
    typeof result !== 'number' ||
    !Number.isSafeInteger(result) ||
    result < 1 ||
    result > maximum
  ) {
    throw new InvoiceDomainError(
      'INVOICE_SETTLEMENT_INVALID',
      'Invoice query pagination is invalid',
    );
  }
  return result;
}

function optionalPositive(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  return positiveId(value, 'company id');
}

function optionalStatus(value: unknown): InvoiceLifecycleStatus | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !INVOICE_STATUSES.has(value as InvoiceLifecycleStatus)) {
    throw new InvoiceDomainError('INVOICE_SETTLEMENT_INVALID', 'Invoice status filter is invalid');
  }
  return value as InvoiceLifecycleStatus;
}

function isBusySnapshot(error: unknown): boolean {
  return isRecord(error) && error.code === 'SQLITE_BUSY_SNAPSHOT';
}

function lifecycleContext(input: { context?: unknown; standingCountry?: unknown }): {
  context: AuditContext;
  standingCountry: Country;
} {
  if (!isRecord(input.context)) {
    throw new InvoiceDomainError(
      'INVOICE_SETTLEMENT_INVALID',
      'Invoice lifecycle audit context is required',
    );
  }
  const context = input.context as unknown as AuditContext;
  const standingCountry = input.standingCountry;
  if (
    typeof standingCountry !== 'string' ||
    !(SUPPORTED_COUNTRIES as readonly string[]).includes(standingCountry)
  ) {
    throw new InvoiceDomainError(
      'INVOICE_SETTLEMENT_INVALID',
      'Invoice standing country is required',
    );
  }
  if (context.standingCountry !== undefined && context.standingCountry !== standingCountry) {
    throw new InvoiceDomainError(
      'INVOICE_SETTLEMENT_INVALID',
      'Invoice standing country does not match audit context',
    );
  }
  const country = standingCountry as Country;
  return {
    context: {
      ...context,
      ...(context.standingCountry === undefined ? { standingCountry: country } : {}),
    },
    standingCountry: country,
  };
}

export function createInvoiceService(dependencies: InvoiceServiceDependencies): InvoiceService {
  const { repository, unitOfWork, clock, audit } = dependencies;
  if (!audit || typeof audit.append !== 'function') {
    throw new Error('Invoice lifecycle mutations require audit dependencies');
  }
  const now = (): string => clock.now().toISOString();

  const requireInvoice = (invoiceId: number, standingCountry?: Country): Invoice => {
    const invoice =
      standingCountry === undefined
        ? repository.findById(invoiceId, now())
        : repository.findAdminById(invoiceId, standingCountry, now());
    if (!invoice) throw new InvoiceDomainError('INVOICE_NOT_FOUND');
    return invoice;
  };

  const replayOrConflict = (
    idempotencyKey: string,
    fingerprint: string,
    operation: 'settled' | 'voided',
    standingCountry: Country,
  ): Invoice | undefined => {
    const event = repository.findEventByIdempotencyKey(idempotencyKey);
    if (!event) return undefined;
    // Scope the replay row before checking its operation/fingerprint. A key owned by another
    // standing country is indistinguishable from a missing key to this caller.
    const invoice = repository.findAdminById(event.invoice_id, standingCountry, now());
    if (!invoice) throw new InvoiceDomainError('INVOICE_NOT_FOUND');
    if (event.event_type !== operation || event.request_fingerprint !== fingerprint) {
      throw new InvoiceDomainError(
        operation === 'settled' ? 'INVOICE_SETTLEMENT_CONFLICT' : 'IDEMPOTENCY_CONFLICT',
      );
    }
    return invoice;
  };

  const settle = (input: InvoiceSettlementInput): Invoice => {
    const { context, standingCountry } = lifecycleContext(input);
    const invoiceId = positiveId(input.invoiceId, 'invoice id');
    if (Object.prototype.hasOwnProperty.call(input, 'amountCents')) {
      throw new InvoiceDomainError(
        'INVOICE_SETTLEMENT_INVALID',
        'Settlement amount is server-owned',
      );
    }
    const expectedVersion = input.expectedVersion ?? input.version;
    if (
      typeof expectedVersion !== 'number' ||
      !Number.isSafeInteger(expectedVersion) ||
      expectedVersion < 0
    ) {
      throw new InvoiceDomainError('INVOICE_SETTLEMENT_INVALID', 'Settlement version is invalid');
    }
    const idempotencyKey = requiredText(input.idempotencyKey, 'Settlement idempotency key');
    if (!UUID_PATTERN.test(idempotencyKey)) {
      throw new InvoiceDomainError(
        'INVOICE_SETTLEMENT_INVALID',
        'Settlement idempotency key is invalid',
      );
    }
    const fingerprint = canonicalFingerprint('settle', { invoiceId, expectedVersion });
    const work = (): Invoice =>
      unitOfWork.run(() => {
        // The first statement must be a write. Reading the replay event first can leave a WAL
        // snapshot that cannot later be upgraded to a writer after a competing lifecycle commit.
        repository.lockLifecycle?.(invoiceId);
        // Scope the requested invoice before consulting the global replay ledger. A foreign
        // invoice must be indistinguishable from a missing invoice, even when its key has replayed.
        const initial = requireInvoice(invoiceId, standingCountry);
        const replay = replayOrConflict(idempotencyKey, fingerprint, 'settled', standingCountry);
        if (replay) return replay;
        const current = initial;
        if (current.lifecycleVersion !== expectedVersion) {
          throw new InvoiceDomainError('INVOICE_SETTLEMENT_CONFLICT');
        }
        if (current.status === 'paid') {
          throw new InvoiceDomainError('INVOICE_ALREADY_SETTLED');
        }
        if (current.status === 'voided') throw new InvoiceDomainError('INVOICE_VOIDED');
        if (current.status !== 'open' && current.status !== 'overdue') {
          throw new InvoiceDomainError('INVOICE_NOT_SETTLEABLE');
        }
        const occurredAt = now();
        if (
          !repository.updateLifecycle({
            invoiceId,
            expectedVersion,
            nextStatus: 'paid',
            settledAt: occurredAt,
            updatedAt: occurredAt,
          })
        ) {
          throw new InvoiceDomainError('INVOICE_SETTLEMENT_CONFLICT');
        }
        repository.insertEvent({
          invoiceId,
          type: 'settled',
          occurredAt,
          idempotencyKey,
          requestFingerprint: fingerprint,
          actorUserId: actorId(input),
        });
        const release = repository.releaseExposure({
          invoiceId,
          grossCents: current.grossCents,
          releasedAt: occurredAt,
        });
        if (release.mismatch) throw new InvoiceDomainError('INVOICE_TOTAL_MISMATCH');
        audit.append({
          action: 'invoice.settled',
          context,
          invoiceId,
          orderId: Number(current.orderId),
          companyId: Number(current.companyId),
          amountCents: current.grossCents,
        });
        const result = repository.findAdminById(invoiceId, standingCountry, now());
        if (!result) throw new InvoiceDomainError('INVOICE_NOT_FOUND');
        return result;
      });
    for (let attempt = 0; ; attempt += 1) {
      try {
        return work();
      } catch (error) {
        if (attempt === 0 && isBusySnapshot(error)) continue;
        throw error;
      }
    }
  };

  const voidInvoice = (input: InvoiceVoidInput): Invoice => {
    const { context, standingCountry } = lifecycleContext(input);
    const invoiceId = positiveId(input.invoiceId, 'invoice id');
    const expectedVersion = input.expectedVersion ?? input.version;
    if (
      typeof expectedVersion !== 'number' ||
      !Number.isSafeInteger(expectedVersion) ||
      expectedVersion < 0
    ) {
      throw new InvoiceDomainError('INVOICE_SETTLEMENT_INVALID', 'Void version is invalid');
    }
    const idempotencyKey = requiredText(input.idempotencyKey, 'Void idempotency key');
    if (!UUID_PATTERN.test(idempotencyKey)) {
      throw new InvoiceDomainError('INVOICE_SETTLEMENT_INVALID', 'Void idempotency key is invalid');
    }
    if (
      typeof input.reason !== 'string' ||
      input.reason.trim().length === 0 ||
      input.reason.length > 500
    ) {
      throw new InvoiceDomainError('INVOICE_SETTLEMENT_INVALID', 'Void reason is invalid');
    }
    const reason = input.reason;
    const fingerprint = canonicalFingerprint('void', { invoiceId, expectedVersion, reason });
    const work = (): Invoice =>
      unitOfWork.run(() => {
        // See settle(): lifecycle replay/version reads must happen after the writer lock.
        repository.lockLifecycle?.(invoiceId);
        // Scope the requested invoice before consulting the global replay ledger. A foreign
        // invoice must be indistinguishable from a missing invoice, even when its key has replayed.
        const initial = requireInvoice(invoiceId, standingCountry);
        const replay = replayOrConflict(idempotencyKey, fingerprint, 'voided', standingCountry);
        if (replay) return replay;
        const current = initial;
        if (current.lifecycleVersion !== expectedVersion) {
          throw new InvoiceDomainError('INVOICE_SETTLEMENT_CONFLICT');
        }
        if (current.status === 'paid') throw new InvoiceDomainError('INVOICE_ALREADY_PAID');
        if (current.status === 'voided') throw new InvoiceDomainError('INVOICE_ALREADY_VOID');
        if (current.status !== 'open' && current.status !== 'overdue') {
          throw new InvoiceDomainError('INVOICE_NOT_SETTLEABLE');
        }
        const occurredAt = now();
        if (
          !repository.updateLifecycle({
            invoiceId,
            expectedVersion,
            nextStatus: 'voided',
            settledAt: null,
            updatedAt: occurredAt,
          })
        ) {
          throw new InvoiceDomainError('INVOICE_SETTLEMENT_CONFLICT');
        }
        repository.insertEvent({
          invoiceId,
          type: 'voided',
          occurredAt,
          idempotencyKey,
          requestFingerprint: fingerprint,
          actorUserId: actorId(input),
        });
        const release = repository.releaseExposure({
          invoiceId,
          grossCents: current.grossCents,
          releasedAt: occurredAt,
        });
        if (release.mismatch) throw new InvoiceDomainError('INVOICE_TOTAL_MISMATCH');
        audit.append({
          action: 'invoice.voided',
          context,
          invoiceId,
          orderId: Number(current.orderId),
          companyId: Number(current.companyId),
          grossCents: current.grossCents,
          reason,
        });
        const result = repository.findAdminById(invoiceId, standingCountry, now());
        if (!result) throw new InvoiceDomainError('INVOICE_NOT_FOUND');
        return result;
      });
    for (let attempt = 0; ; attempt += 1) {
      try {
        return work();
      } catch (error) {
        if (attempt === 0 && isBusySnapshot(error)) continue;
        throw error;
      }
    }
  };

  const issue = (input: InvoiceIssueInput): Invoice => {
    const orderId = positiveId(input.orderId, 'order id');
    const paymentIdempotencyKey = requiredText(
      input.paymentIdempotencyKey,
      'Payment idempotency key',
    );
    return unitOfWork.run(() => {
      const facts = mergeIssueFacts(input);
      const timestamp = requireUtc(
        input.issuedAt ?? input.now ?? facts.issuedAt ?? now(),
        'issuedAt',
      );
      const existingReadAt = now();
      const existingByOrder = repository.findByOrderId(orderId, existingReadAt);
      const existingByPayment = repository.findByPaymentIdempotencyKey(
        paymentIdempotencyKey,
        existingReadAt,
      );
      if (existingByOrder || existingByPayment) {
        if (
          existingByOrder &&
          existingByPayment &&
          existingByOrder.id === existingByPayment.id &&
          existingByOrder.orderId === String(orderId) &&
          existingByOrder.paymentIdempotencyKey === paymentIdempotencyKey
        ) {
          assertIssueReplayMatches(existingByOrder, input, orderId, paymentIdempotencyKey);
          return existingByOrder;
        }
        throw new InvoiceDomainError('INVOICE_TOTAL_MISMATCH');
      }

      const sourceOrder = repository.findOrderForIssue?.(orderId);
      const sourcePayment = repository.findPaymentForIssue?.(paymentIdempotencyKey);

      const documentInput =
        (isRecord(input.document) && input.document) ||
        (isRecord(input.invoiceDocument) && input.invoiceDocument) ||
        {};
      const companyId = positiveId(
        facts.companyId ?? documentInput.companyId ?? sourceOrder?.companyId,
        'company id',
      );
      const userId = positiveId(
        facts.userId ?? documentInput.userId ?? sourceOrder?.userId,
        'user id',
      );
      const country = facts.country ?? documentInput.country ?? sourceOrder?.country;
      if (
        country !== 'UK' &&
        country !== 'US' &&
        country !== 'CN' &&
        country !== 'PL' &&
        country !== 'ES' &&
        country !== 'DE' &&
        country !== 'FR'
      ) {
        throw new InvoiceDomainError('INVOICE_TOTAL_MISMATCH');
      }
      const billingEntity =
        facts.billingEntity ?? documentInput.billingEntity ?? sourceOrder?.billingEntity;
      if (!Value.Check(BillingEntitySnapshot, billingEntity)) {
        throw new InvoiceDomainError('INVOICE_TOTAL_MISMATCH');
      }
      const purchaseOrderReference =
        facts.purchaseOrderReference ??
        documentInput.purchaseOrderReference ??
        sourceOrder?.purchaseOrderReference ??
        null;
      if (purchaseOrderReference !== null && typeof purchaseOrderReference !== 'string') {
        throw new InvoiceDomainError('INVOICE_TOTAL_MISMATCH');
      }
      const netCents = nonNegativeMoney(
        facts.netCents ?? documentInput.netCents ?? sourceOrder?.netCents,
        'netCents',
      );
      const linesValue = facts.lines ?? documentInput.lines;
      const lines = sourceOrder
        ? deriveInvoiceLines(sourceOrder, netCents, linesValue)
        : normalizeLines(linesValue);
      const vatRateBasisPoints = nonNegativeMoney(
        facts.vatRateBasisPoints ??
          documentInput.vatRateBasisPoints ??
          sourceOrder?.vatRateBasisPoints,
        'vatRateBasisPoints',
      );
      const vatCents = nonNegativeMoney(
        facts.vatCents ?? documentInput.vatCents ?? sourceOrder?.vatCents,
        'vatCents',
      );
      const grossCents = nonNegativeMoney(
        facts.grossCents ?? documentInput.grossCents ?? sourceOrder?.grossCents,
        'grossCents',
      );
      const dueAt = calculateInvoiceDueAt(timestamp);
      assertDocumentMatches(documentInput, {
        orderId,
        paymentIdempotencyKey,
        companyId,
        userId,
        country,
        billingEntity,
        purchaseOrderReference,
        lines,
        netCents,
        vatRateBasisPoints,
        vatCents,
        grossCents,
        issuedAt: timestamp,
        dueAt,
      });
      if (sourceOrder) {
        sourceFieldsMatch(
          {
            ...facts,
            companyId,
            userId,
            country,
            billingEntity,
            purchaseOrderReference,
            netCents,
            vatRateBasisPoints,
            vatCents,
            grossCents,
          },
          sourceOrder,
          sourcePayment,
        );
      } else if (
        sourcePayment &&
        (sourcePayment.paymentMethod !== 'trade_credit' ||
          sourcePayment.orderId !== orderId ||
          sourcePayment.companyId !== companyId ||
          sourcePayment.amountCents !== grossCents ||
          sourcePayment.status !== 'authorized_pending_finalize')
      ) {
        throw new InvoiceDomainError('INVOICE_TOTAL_MISMATCH');
      }
      const invoiceNumber = repository.allocateNumber(Number(timestamp.slice(0, 4)));
      // Number allocation is the first write in this transaction. This obtains SQLite's writer
      // lock before deriving the explicit document identity, so concurrent issuers cannot observe
      // the same MAX(invoice.id) candidate.
      const invoiceId = repository.nextId();
      const document: InvoiceDocumentV1 = {
        version: 1,
        id: String(invoiceId),
        invoiceNumber,
        orderId: String(orderId),
        companyId: String(companyId),
        userId: String(userId),
        country,
        paymentMethod: 'trade_credit',
        currency: 'GBP',
        terms: 'net_30',
        billingEntity,
        purchaseOrderReference,
        ...(UUID_PATTERN.test(paymentIdempotencyKey) ? { paymentIdempotencyKey } : {}),
        lines,
        netCents,
        vatRateBasisPoints,
        vatCents,
        grossCents,
        issuedAt: timestamp,
        dueAt,
      };
      if (!Value.Check(InvoiceDocumentV1, document)) {
        throw new InvoiceDomainError('INVOICE_TOTAL_MISMATCH');
      }
      const invoiceInsert: InvoiceInsert = {
        id: invoiceId,
        invoiceNumber,
        orderId,
        paymentIdempotencyKey,
        companyId,
        userId,
        country,
        document,
        netCents,
        vatRateBasisPoints,
        vatCents,
        grossCents,
        issuedAt: timestamp,
        dueAt,
      };
      repository.insert(invoiceInsert);
      repository.insertState({ invoiceId, updatedAt: timestamp });
      repository.insertEvent({ invoiceId, type: 'issued', occurredAt: timestamp });
      const holdCommitted = repository.commitExposureHold({
        invoiceId,
        paymentIdempotencyKey,
        companyId,
        grossCents,
        committedAt: timestamp,
      });
      if (!holdCommitted) throw new InvoiceDomainError('INVOICE_TOTAL_MISMATCH');
      const result = repository.findById(invoiceId, now());
      if (!result) throw new InvoiceDomainError('INVOICE_NOT_FOUND');
      return result;
    });
  };

  const service: InvoiceService = {
    issue,
    create: issue,
    get(invoiceId, userId) {
      const id = positiveId(invoiceId, 'invoice id');
      if (userId === undefined) return requireInvoice(id);
      const invoice = repository.findOwnedById(id, positiveId(userId, 'user id'), now());
      if (!invoice) throw new InvoiceDomainError('INVOICE_NOT_FOUND');
      return invoice;
    },
    getOwned(invoiceId, userId) {
      const invoice = repository.findOwnedById(
        positiveId(invoiceId, 'invoice id'),
        positiveId(userId, 'user id'),
        now(),
      );
      if (!invoice) throw new InvoiceDomainError('INVOICE_NOT_FOUND');
      return invoice;
    },
    getAdmin(invoiceId, standingCountry) {
      return requireInvoice(positiveId(invoiceId, 'invoice id'), standingCountry);
    },
    listAdmin(query = {}, standingCountry) {
      const page = pageNumber(query.page, 'page');
      const pageSize = pageNumber(query.pageSize, 'pageSize');
      const normalized: InvoiceAdminListQuery = {
        companyId: optionalPositive(query.companyId),
        status: optionalStatus(query.status),
        country: standingCountry ?? query.country,
        page,
        pageSize,
        now: now(),
      };
      const result = repository.listAdmin(normalized);
      return { ...result, page, pageSize };
    },
    settle,
    settleInvoice: settle,
    void: voidInvoice,
    voidInvoice,
  };
  return service;
}
