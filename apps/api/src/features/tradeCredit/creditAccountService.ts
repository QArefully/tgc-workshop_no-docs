import { createHash } from 'node:crypto';
import type { Country } from '@shop/contracts/country';
import { SUPPORTED_COUNTRIES } from '@shop/contracts/country';
import type {
  CreditAccountAdminView,
  CreditAccountMemberView,
  CreditAccountState,
} from '@shop/contracts/trade-credit';
import type { UnitOfWork } from '../../db/unitOfWork.js';
import type { AuditContext, AuditActor } from '../audit/auditEvent.js';
import type { Clock } from '../audit/auditService.js';
import type {
  CompanyMembershipRepository,
  CompanyMembershipRow,
} from '../companyAccounts/companyMembershipRepository.js';
import type {
  CreditAccountEventRow,
  CreditAccountListQuery,
  CreditAccountOrder,
  CreditAccountRepository,
  CreditAccountRow,
} from './creditAccountRepository.js';
import type {
  CreditExposureSummary,
  CreditHoldRepository,
  CreditHoldRow,
} from './creditHoldRepository.js';
import { evaluateTradeCreditEligibility } from './tradeCreditRules.js';

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
const CREDIT_STATES = new Set<CreditAccountState>(['active', 'on_hold', 'suspended']);
const COUNTRIES = new Set<string>(SUPPORTED_COUNTRIES);
const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;

/** Errors are stable at the service boundary; routes can map these codes to public errors. */
export type CreditAccountErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_QUERY'
  | 'CREDIT_ACCOUNT_NOT_FOUND'
  | 'CREDIT_ACCOUNT_FORBIDDEN'
  | 'CREDIT_ACCOUNT_ALREADY_EXISTS'
  | 'CREDIT_ACCOUNT_ON_HOLD'
  | 'CREDIT_ACCOUNT_SUSPENDED'
  | 'CREDIT_NOT_ELIGIBLE'
  | 'CREDIT_LIMIT_EXCEEDED'
  | 'CREDIT_LIMIT_INVALID'
  | 'CREDIT_TERMS_INVALID'
  | 'NO_ACTIVE_MEMBERSHIP'
  | 'MEMBERSHIP_ROLE_NOT_ELIGIBLE'
  | 'STALE_VERSION'
  | 'IDEMPOTENCY_CONFLICT'
  | 'HOLD_NOT_FOUND'
  | 'HOLD_INVALID_TRANSITION'
  | 'CREDIT_DATA_CORRUPT';

export class CreditAccountError extends Error {
  constructor(
    public readonly code: CreditAccountErrorCode,
    message: string = code,
    public readonly meta?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'CreditAccountError';
  }
}

/** Audit input is local until the later API packet extends the closed global audit union. */
export type CreditAccountAuditInput =
  | {
      action: 'company.credit_limit_changed';
      companyId: number;
      oldCreditLimitCents: number;
      newCreditLimitCents: number;
      context: AuditContext;
    }
  | {
      action: 'company.credit_state_changed';
      companyId: number;
      oldState: CreditAccountState;
      newState: CreditAccountState;
      reason: string | null;
      context: AuditContext;
    };

export interface CreditAccountAuditWriter {
  append(input: CreditAccountAuditInput): void;
}

export interface CreditAccountMutationInput {
  expectedVersion: number;
  idempotencyKey: string;
  creditLimitCents?: number;
  state?: CreditAccountState;
  /** Read-only alias accepted by admin callers. */
  status?: CreditAccountState;
  reason?: string;
}

export interface CreditAccountAdminQuery extends Partial<
  Omit<CreditAccountListQuery, 'page' | 'pageSize'>
> {
  page?: number;
  pageSize?: number;
  /** Alternate query spelling used by some admin clients. */
  sort?: CreditAccountOrder;
}

export interface AcquireCreditHoldInput {
  paymentIdempotencyKey?: string;
  /** Compatibility alias accepted by payment-intent callers. */
  idempotencyKey?: string;
  amountCents: number;
  expiresAt: string;
  /** Optional assertion; company authority still comes from the active membership. */
  companyId?: number;
  createdAt?: string;
}

export type CreditHoldAcquireResult =
  | { readonly ok: true; readonly hold: CreditHoldRow }
  | {
      readonly ok: false;
      readonly code:
        | 'NO_ACTIVE_MEMBERSHIP'
        | 'MEMBERSHIP_ROLE_NOT_ELIGIBLE'
        | 'CREDIT_ACCOUNT_ON_HOLD'
        | 'CREDIT_ACCOUNT_SUSPENDED'
        | 'CREDIT_LIMIT_EXCEEDED';
      readonly availableCreditCents?: number;
    };

export interface CreditAccountService {
  getMember(userId: number): CreditAccountMemberView | null;
  getMemberSummary(userId: number): CreditAccountMemberView | null;
  getForMember(userId: number): CreditAccountMemberView | null;
  listAdmin(
    query?: CreditAccountAdminQuery,
    standingCountry?: Country,
  ): { items: CreditAccountAdminView[]; total: number; page: number; pageSize: number };
  getAdminDetail(accountId: number, standingCountry?: Country): CreditAccountAdminView;
  getAdmin(accountId: number, standingCountry?: Country): CreditAccountAdminView;
  update(
    accountId: number,
    input: CreditAccountMutationInput,
    context: AuditContext,
    standingCountry?: Country,
  ): CreditAccountAdminView;
  updateLimit(
    accountId: number,
    input: CreditAccountMutationInput,
    context: AuditContext,
    standingCountry?: Country,
  ): CreditAccountAdminView;
  updateState(
    accountId: number,
    input: CreditAccountMutationInput,
    context: AuditContext,
    standingCountry?: Country,
  ): CreditAccountAdminView;
  setState(
    accountId: number,
    input: CreditAccountMutationInput,
    context: AuditContext,
    standingCountry?: Country,
  ): CreditAccountAdminView;
  getExposure(companyId: number, at?: string): CreditExposureSummary;
  acquireHoldForUser(userId: number, input: AcquireCreditHoldInput): CreditHoldRow;
  /** Uses the caller's already-open UnitOfWork (for checkout preparation composition). */
  acquireHoldForUserInTransaction(userId: number, input: AcquireCreditHoldInput): CreditHoldRow;
  acquireHold(input: { userId: number } & AcquireCreditHoldInput): CreditHoldRow;
  acquireHoldInTransaction(input: { userId: number } & AcquireCreditHoldInput): CreditHoldRow;
  tryAcquireHold(userId: number, input: AcquireCreditHoldInput): CreditHoldAcquireResult;
  /** Non-owning transaction variant; caller must provide the UnitOfWork boundary. */
  tryAcquireHoldInTransaction(
    userId: number,
    input: AcquireCreditHoldInput,
  ): CreditHoldAcquireResult;
  authorizeHold(paymentIdempotencyKey: string, at?: string): CreditHoldRow;
  commitHold(paymentIdempotencyKey: string, invoiceId: number, at?: string): CreditHoldRow;
  releaseHold(paymentIdempotencyKey: string, at?: string): CreditHoldRow;
  expirePreparedHolds(at?: string): string[];
}

export interface CreditAccountServiceDependencies {
  /** Canonical repository dependency. `repository` is retained as a construction alias. */
  accounts?: CreditAccountRepository;
  repository?: CreditAccountRepository;
  holds?: CreditHoldRepository;
  creditHolds?: CreditHoldRepository;
  memberships?: Pick<CompanyMembershipRepository, 'findActiveByUser'>;
  companyMemberships?: Pick<CompanyMembershipRepository, 'findActiveByUser'>;
  unitOfWork: UnitOfWork;
  clock: Clock;
  audit?: CreditAccountAuditWriter;
}

function requireSafeNonNegative(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new CreditAccountError('INVALID_INPUT', `${name} must be a non-negative safe integer`);
  }
  return value;
}

function requirePositiveId(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new CreditAccountError('INVALID_INPUT', `${name} must be a positive safe integer`);
  }
  return value;
}

function requireUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new CreditAccountError('INVALID_INPUT', 'idempotencyKey must be a UUID');
  }
  return value;
}

function requireInstant(value: string, name: string): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new CreditAccountError('INVALID_INPUT', `${name} must be an ISO instant`);
  }
  return value;
}

function requireState(value: unknown, name = 'state'): CreditAccountState {
  if (typeof value !== 'string' || !CREDIT_STATES.has(value as CreditAccountState)) {
    throw new CreditAccountError('INVALID_INPUT', `${name} must be active, on_hold, or suspended`);
  }
  return value as CreditAccountState;
}

function normalizeReason(value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value !== 'string')
    throw new CreditAccountError('INVALID_INPUT', 'reason must be plain text');
  const reason = value.trim();
  if (reason.length < 1 || reason.length > 500 || /[<>]/.test(reason)) {
    throw new CreditAccountError(
      'INVALID_INPUT',
      'reason must be plain text of at most 500 characters',
    );
  }
  return reason;
}

function normalizeAccountId(value: unknown): number {
  return requirePositiveId(value, 'creditAccountId');
}

function normalizeCountry(value: unknown): Country | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !COUNTRIES.has(value)) {
    throw new CreditAccountError('INVALID_QUERY', 'standing country is not supported');
  }
  return value as Country;
}

function normalizePage(value: unknown, name: 'page' | 'pageSize'): number {
  const fallback = name === 'page' ? 1 : 25;
  const maximum = name === 'page' ? 10_000 : 100;
  const result = value === undefined ? fallback : value;
  if (
    typeof result !== 'number' ||
    !Number.isSafeInteger(result) ||
    result < 1 ||
    result > maximum
  ) {
    throw new CreditAccountError('INVALID_QUERY', `${name} is outside its supported range`);
  }
  return result;
}

function normalizeSearch(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new CreditAccountError('INVALID_QUERY', 'search is invalid');
  const search = value.trim();
  if (search.length === 0) return undefined;
  if (search.length > 160) throw new CreditAccountError('INVALID_QUERY', 'search is too long');
  return search;
}

const ORDER_ALIASES: Record<string, CreditAccountOrder> = {
  id: 'id',
  accountId: 'id',
  companyId: 'id',
  companyName: 'companyName',
  company_name: 'companyName',
  name: 'companyName',
  createdAt: 'createdAt',
  created_at: 'createdAt',
  updatedAt: 'updatedAt',
  updated_at: 'updatedAt',
  creditLimitCents: 'creditLimitCents',
  credit_limit_cents: 'creditLimitCents',
  state: 'state',
  status: 'state',
  version: 'version',
};

function normalizeOrder(value: unknown): CreditAccountOrder {
  if (value === undefined) return 'updatedAt';
  if (typeof value !== 'string' || ORDER_ALIASES[value] === undefined) {
    throw new CreditAccountError('INVALID_QUERY', 'order is not allowlisted');
  }
  return ORDER_ALIASES[value];
}

function normalizeDirection(value: unknown): 'asc' | 'desc' {
  if (value === undefined) return 'desc';
  if (value !== 'asc' && value !== 'desc') {
    throw new CreditAccountError('INVALID_QUERY', 'direction must be asc or desc');
  }
  return value;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

/** Stable SHA-256 command fingerprint; never includes mutable exposure or secret payment data. */
export function creditAccountFingerprint(
  operation: 'limit' | 'state',
  input: {
    accountId: number;
    expectedVersion: number;
    creditLimitCents?: number;
    state?: CreditAccountState;
    reason?: string | null;
    context: AuditContext;
    standingCountry?: Country;
  },
): string {
  const actor: AuditActor = input.context.actor;
  return createHash('sha256')
    .update(
      JSON.stringify(
        canonicalize({
          operation,
          accountId: input.accountId,
          expectedVersion: input.expectedVersion,
          creditLimitCents: input.creditLimitCents ?? null,
          state: input.state ?? null,
          reason: input.reason ?? null,
          actor: { type: actor.type, userId: actor.userId },
          standingCountry: input.standingCountry ?? null,
        }),
      ),
    )
    .digest('hex');
}

function mapEligibilityError(code: string): CreditAccountErrorCode {
  switch (code) {
    case 'NO_ACTIVE_COMPANY':
      return 'CREDIT_ACCOUNT_NOT_FOUND';
    case 'NO_ACTIVE_MEMBERSHIP':
      return 'NO_ACTIVE_MEMBERSHIP';
    case 'MEMBERSHIP_ROLE_NOT_ELIGIBLE':
      return 'MEMBERSHIP_ROLE_NOT_ELIGIBLE';
    case 'CREDIT_ACCOUNT_NOT_ACTIVE':
      return 'CREDIT_NOT_ELIGIBLE';
    default:
      return 'CREDIT_NOT_ELIGIBLE';
  }
}

function mapAccount(
  row: CreditAccountRow,
  exposure: CreditExposureSummary,
  reason: string | null,
  admin: true,
): CreditAccountAdminView;
function mapAccount(
  row: CreditAccountRow,
  exposure: CreditExposureSummary,
  reason: string | null,
  admin: false,
): CreditAccountMemberView;
function mapAccount(
  row: CreditAccountRow,
  exposure: CreditExposureSummary,
  reason: string | null,
  admin: boolean,
): CreditAccountAdminView | CreditAccountMemberView {
  if (row.credit_terms_days !== 30) throw new CreditAccountError('CREDIT_DATA_CORRUPT');
  const state = requireState(row.credit_state, 'stored credit state');
  const creditLimitCents = requireSafeNonNegative(row.credit_limit_cents, 'creditLimitCents');
  const view = {
    companyId: String(row.company_id),
    state,
    status: state,
    creditLimitCents,
    outstandingCents: requireSafeNonNegative(exposure.outstandingCents, 'outstandingCents'),
    outstandingInvoiceCents: requireSafeNonNegative(
      exposure.outstandingInvoiceCents,
      'outstandingInvoiceCents',
    ),
    heldCents: requireSafeNonNegative(exposure.heldCents, 'heldCents'),
    heldExposureCents: requireSafeNonNegative(exposure.heldCents, 'heldExposureCents'),
    exposureCents: requireSafeNonNegative(exposure.exposureCents, 'exposureCents'),
    totalExposureCents: requireSafeNonNegative(exposure.exposureCents, 'totalExposureCents'),
    availableCreditCents: requireSafeNonNegative(
      exposure.availableCreditCents,
      'availableCreditCents',
    ),
    availableCents: requireSafeNonNegative(exposure.availableCreditCents, 'availableCents'),
    terms: 'net_30' as const,
    termsDays: 30 as const,
    holdReason: state === 'active' ? null : reason,
    version: requireSafeNonNegative(row.credit_version, 'creditVersion'),
    updatedAt: row.updated_at,
  };
  if (!admin) return view;
  return {
    ...view,
    id: String(row.id),
    companyName: row.company_name,
    createdAt: row.created_at,
  };
}

function commandInput(input: CreditAccountMutationInput): {
  expectedVersion: number;
  idempotencyKey: string;
  operation: 'limit' | 'state';
  creditLimitCents?: number;
  state?: CreditAccountState;
  reason: string | null;
} {
  if (input === null || typeof input !== 'object')
    throw new CreditAccountError('INVALID_INPUT', 'credit mutation input is required');
  const expectedVersion = requireSafeNonNegative(input.expectedVersion, 'expectedVersion');
  const idempotencyKey = requireUuid(input.idempotencyKey);
  const hasLimit = Object.prototype.hasOwnProperty.call(input, 'creditLimitCents');
  const hasState = Object.prototype.hasOwnProperty.call(input, 'state');
  const hasStatus = Object.prototype.hasOwnProperty.call(input, 'status');
  if (hasLimit === hasState || (hasState && hasStatus) || (hasLimit && hasStatus)) {
    throw new CreditAccountError('INVALID_INPUT', 'exactly one credit mutation is required');
  }
  const reason = normalizeReason(input.reason);
  if (hasLimit) {
    return {
      expectedVersion,
      idempotencyKey,
      operation: 'limit',
      creditLimitCents: requireSafeNonNegative(input.creditLimitCents, 'creditLimitCents'),
      reason,
    };
  }
  const state = requireState(hasState ? input.state : input.status, hasState ? 'state' : 'status');
  return { expectedVersion, idempotencyKey, operation: 'state', state, reason };
}

function holdKey(input: AcquireCreditHoldInput): string {
  if (input === null || typeof input !== 'object')
    throw new CreditAccountError('INVALID_INPUT', 'credit hold input is required');
  const key = input.paymentIdempotencyKey || input.idempotencyKey;
  if (typeof key !== 'string' || key.length < 1 || key.length > 255) {
    throw new CreditAccountError('INVALID_INPUT', 'paymentIdempotencyKey is required');
  }
  return key;
}

function membershipCompany(
  memberships: Pick<CompanyMembershipRepository, 'findActiveByUser'>,
  userId: number,
): CompanyMembershipRow | null {
  return memberships.findActiveByUser(userId);
}

/**
 * Builds the member/admin credit surface and owns all policy mutations. Reads intentionally use
 * active membership and company rows rather than accepting a caller-provided company id.
 */
export function createCreditAccountService(
  dependencies: CreditAccountServiceDependencies,
): CreditAccountService {
  const accounts = dependencies.accounts ?? dependencies.repository;
  const holds = dependencies.holds ?? dependencies.creditHolds;
  const memberships = dependencies.memberships ?? dependencies.companyMemberships;
  if (!accounts || !holds || !memberships)
    throw new Error('Credit account service requires account, hold, and membership repositories');
  const unitOfWork = dependencies.unitOfWork;
  const clock = dependencies.clock;
  const audit: CreditAccountAuditWriter = dependencies.audit ?? { append: () => undefined };
  const now = () => clock.now().toISOString();
  const lockCompany = (accountId: number, country?: Country): boolean | undefined =>
    accounts.lockCompany?.(accountId, country);
  const lockHoldCompany = (companyId: number): boolean | undefined =>
    holds.lockCompany?.(companyId);

  const viewMember = (userId: number): CreditAccountMemberView | null => {
    const membership = membershipCompany(memberships, userId);
    if (!membership || membership.active !== 1) return null;
    const row = accounts.findByCompanyId(membership.company_id);
    if (!row) return null;
    const at = now();
    const exposure = holds.exposure(row.company_id, at);
    return mapAccount(
      row,
      exposure,
      accounts.findLatestReason(row.company_id, row.credit_state),
      false,
    );
  };

  const viewAdmin = (accountId: number, standingCountry?: Country): CreditAccountAdminView => {
    const row = accounts.findAdmin(accountId, standingCountry);
    if (!row) throw new CreditAccountError('CREDIT_ACCOUNT_NOT_FOUND');
    const at = now();
    const exposure = holds.exposure(row.company_id, at);
    return mapAccount(
      row,
      exposure,
      accounts.findLatestReason(row.company_id, row.credit_state),
      true,
    );
  };

  const replayOrConflict = (
    event: CreditAccountEventRow,
    fingerprint: string,
    standingCountry?: Country,
  ): CreditAccountAdminView => {
    if (event.request_fingerprint !== fingerprint)
      throw new CreditAccountError('IDEMPOTENCY_CONFLICT');
    return viewAdmin(event.company_id, standingCountry);
  };

  const update = (
    accountId: number,
    rawInput: CreditAccountMutationInput,
    context: AuditContext,
    standingCountry?: Country,
  ): CreditAccountAdminView => {
    const id = normalizeAccountId(accountId);
    const country = normalizeCountry(standingCountry ?? context.standingCountry);
    const input = commandInput(rawInput);
    const fingerprint = creditAccountFingerprint(input.operation, {
      accountId: id,
      expectedVersion: input.expectedVersion,
      creditLimitCents: input.creditLimitCents,
      state: input.state,
      reason: input.reason,
      context,
      standingCountry: country,
    });
    return unitOfWork.run(() => {
      // Acquire the writer boundary before reading the idempotency ledger/account. This avoids a
      // deferred SQLite read->write upgrade observing a stale snapshot under two connections.
      lockCompany(id, country);
      const prior = accounts.findEventByIdempotencyKey(input.idempotencyKey);
      if (prior) return replayOrConflict(prior, fingerprint, country);
      const current = accounts.findAdmin(id, country);
      if (!current) throw new CreditAccountError('CREDIT_ACCOUNT_NOT_FOUND');
      if (current.credit_version !== input.expectedVersion)
        throw new CreditAccountError('STALE_VERSION');
      const nextLimit = input.creditLimitCents ?? current.credit_limit_cents;
      const nextState = input.state ?? current.credit_state;
      requireSafeNonNegative(nextLimit, 'creditLimitCents');
      requireState(nextState);
      if (nextLimit === current.credit_limit_cents && nextState === current.credit_state) {
        throw new CreditAccountError(
          'INVALID_INPUT',
          'credit mutation must change the credit limit or state',
        );
      }
      if (current.credit_version >= MAX_SAFE_INTEGER) throw new CreditAccountError('STALE_VERSION');
      if (
        !accounts.updateCas({
          companyId: current.company_id,
          expectedVersion: current.credit_version,
          creditLimitCents: nextLimit,
          creditState: nextState,
          updatedAt: now(),
        })
      ) {
        const concurrent = accounts.findEventByIdempotencyKey(input.idempotencyKey);
        if (concurrent) return replayOrConflict(concurrent, fingerprint, country);
        throw new CreditAccountError('STALE_VERSION');
      }
      const version = current.credit_version + 1;
      accounts.appendEvent({
        companyId: current.company_id,
        eventType: input.operation === 'limit' ? 'limit_changed' : 'state_changed',
        creditLimitCents: nextLimit,
        creditTermsDays: 30,
        creditState: nextState,
        creditVersion: version,
        amountCents: null,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
        requestFingerprint: fingerprint,
        occurredAt: now(),
      });
      if (input.operation === 'limit') {
        audit.append({
          action: 'company.credit_limit_changed',
          companyId: current.company_id,
          oldCreditLimitCents: current.credit_limit_cents,
          newCreditLimitCents: nextLimit,
          context,
        });
      } else {
        audit.append({
          action: 'company.credit_state_changed',
          companyId: current.company_id,
          oldState: current.credit_state,
          newState: nextState,
          reason: input.reason,
          context,
        });
      }
      return viewAdmin(current.company_id, country);
    });
  };

  const tryAcquire = (
    userId: number,
    input: AcquireCreditHoldInput,
    ownsTransaction = true,
  ): CreditHoldAcquireResult => {
    requirePositiveId(userId, 'userId');
    if (input === null || typeof input !== 'object')
      throw new CreditAccountError('INVALID_INPUT', 'credit hold input is required');
    const key = holdKey(input);
    const amountCents = requireSafeNonNegative(input.amountCents, 'amountCents');
    const expiresAt = requireInstant(input.expiresAt, 'expiresAt');
    const createdAt = requireInstant(input.createdAt ?? now(), 'createdAt');
    if (expiresAt <= createdAt)
      throw new CreditAccountError('INVALID_INPUT', 'expiresAt must be after createdAt');
    const initialMembership = membershipCompany(memberships, userId);
    if (!initialMembership || initialMembership.active !== 1)
      return { ok: false, code: 'NO_ACTIVE_MEMBERSHIP' };
    if (input.companyId !== undefined && input.companyId !== initialMembership.company_id) {
      return { ok: false, code: 'NO_ACTIVE_MEMBERSHIP' };
    }
    const companyId = initialMembership.company_id;
    const decision = (): CreditHoldAcquireResult => {
      // Lock first, then re-read membership/account facts. The first write makes a concurrent
      // last-capacity decision wait and evaluate current exposure after the winner commits.
      if (lockHoldCompany(companyId) === false) return { ok: false, code: 'NO_ACTIVE_MEMBERSHIP' };
      const membership = membershipCompany(memberships, userId);
      if (!membership || membership.active !== 1)
        return { ok: false, code: 'NO_ACTIVE_MEMBERSHIP' };
      if (membership.company_id !== companyId) {
        return { ok: false, code: 'NO_ACTIVE_MEMBERSHIP' };
      }
      // Expire before looking up an existing key. Otherwise a lease that elapsed between the
      // original acquisition and this retry would be returned as a successful replay. An owning
      // call performs this maintenance in its own committed UoW below so a replay conflict cannot
      // roll the expiry write back.
      if (!ownsTransaction) holds.expirePrepared(now());
      const account = accounts.findByCompanyId(membership.company_id);
      if (!account) return { ok: false, code: 'NO_ACTIVE_MEMBERSHIP' };
      const eligibility = evaluateTradeCreditEligibility({
        company: { id: account.company_id, active: account.active === 1 },
        membership: {
          companyId: membership.company_id,
          active: membership.active === 1,
          role: membership.role,
        },
        creditAccount: { companyId: account.company_id, state: account.credit_state },
      });
      if (!eligibility.eligible) {
        const code = mapEligibilityError(eligibility.code);
        if (code === 'CREDIT_NOT_ELIGIBLE') {
          if (account.credit_state === 'on_hold')
            return { ok: false, code: 'CREDIT_ACCOUNT_ON_HOLD' };
          if (account.credit_state === 'suspended')
            return { ok: false, code: 'CREDIT_ACCOUNT_SUSPENDED' };
        }
        if (code === 'MEMBERSHIP_ROLE_NOT_ELIGIBLE')
          return { ok: false, code: 'MEMBERSHIP_ROLE_NOT_ELIGIBLE' };
        return { ok: false, code: code === 'NO_ACTIVE_MEMBERSHIP' ? code : 'NO_ACTIVE_MEMBERSHIP' };
      }
      const existing = holds.findByPaymentIdempotencyKey(key);
      if (existing) {
        if (
          existing.company_id !== membership.company_id ||
          existing.amount_cents !== amountCents
        ) {
          throw new CreditAccountError('IDEMPOTENCY_CONFLICT');
        }
        if (existing.status === 'prepared' || existing.status === 'authorized') {
          return { ok: true, hold: existing };
        }
        // A released/committed key is terminal for acquisition. Reusing it must not appear to
        // reserve capacity a second time or hide an expired lease from the caller.
        throw new CreditAccountError('IDEMPOTENCY_CONFLICT');
      }
      const hold = holds.acquire({
        companyId: membership.company_id,
        paymentIdempotencyKey: key,
        amountCents,
        expiresAt,
        createdAt,
        updatedAt: now(),
      });
      if (hold) return { ok: true, hold };
      const currentExposure = holds.exposure(membership.company_id, now());
      // The repository also checks current state under its company-row lock. Distinguish a policy
      // denial from a limit denial using a fresh account read after that atomic decision.
      const currentAccount = accounts.findByCompanyId(membership.company_id);
      if (!currentAccount) return { ok: false, code: 'NO_ACTIVE_MEMBERSHIP' };
      if (currentAccount?.credit_state === 'on_hold')
        return { ok: false, code: 'CREDIT_ACCOUNT_ON_HOLD' };
      if (currentAccount?.credit_state === 'suspended')
        return { ok: false, code: 'CREDIT_ACCOUNT_SUSPENDED' };
      return {
        ok: false,
        code: 'CREDIT_LIMIT_EXCEEDED',
        availableCreditCents: currentExposure.availableCreditCents,
      };
    };
    if (ownsTransaction) unitOfWork.run(() => holds.expirePrepared(now()));
    return ownsTransaction ? unitOfWork.run(decision) : decision();
  };

  const acquireForUser = (
    userId: number,
    input: AcquireCreditHoldInput,
    ownsTransaction = true,
  ): CreditHoldRow => {
    const result = tryAcquire(userId, input, ownsTransaction);
    if (result.ok) return result.hold;
    if (result.code === 'CREDIT_LIMIT_EXCEEDED') {
      throw new CreditAccountError(result.code, result.code, {
        requestedCents: input.amountCents,
        availableCreditCents: result.availableCreditCents ?? 0,
      });
    }
    throw new CreditAccountError(result.code);
  };

  // Keep aliases as closures rather than calling through `this`: callers commonly destructure
  // service methods from the composition root, so alias calls must not depend on receiver state.
  const getMember = (userId: number): CreditAccountMemberView | null => {
    requirePositiveId(userId, 'userId');
    return unitOfWork.run(() => viewMember(userId));
  };
  const getAdminDetail = (accountId: number, standingCountry?: Country): CreditAccountAdminView =>
    unitOfWork.run(() =>
      viewAdmin(normalizeAccountId(accountId), normalizeCountry(standingCountry)),
    );

  return {
    getMember,
    getMemberSummary(userId) {
      return getMember(userId);
    },
    getForMember(userId) {
      return getMember(userId);
    },
    listAdmin(query = {}, standingCountry) {
      // Route callers pass the authenticated standing country separately; the query fallback keeps
      // this in-process service compatible with other admin list services without widening scope.
      const country = normalizeCountry(standingCountry ?? query.country);
      const page = normalizePage(query.page, 'page');
      const pageSize = normalizePage(query.pageSize, 'pageSize');
      const search = normalizeSearch(query.search);
      const state = query.state === undefined ? query.status : query.state;
      if (query.state !== undefined && query.status !== undefined && query.state !== query.status)
        throw new CreditAccountError('INVALID_QUERY', 'state and status must agree');
      const normalizedState = state === undefined ? undefined : requireState(state);
      const order = normalizeOrder(query.orderBy ?? query.order ?? query.sort);
      const direction = normalizeDirection(query.direction ?? query.sortDirection);
      const companyId =
        query.companyId === undefined ? undefined : normalizeAccountId(query.companyId);
      const result = accounts.listAdmin({
        companyId,
        state: normalizedState,
        status: normalizedState,
        search,
        order,
        orderBy: order,
        direction,
        sortDirection: direction,
        page,
        pageSize,
        country,
      });
      const items = result.rows.map((row) => {
        const exposure = holds.exposure(row.company_id, now());
        return mapAccount(
          row,
          exposure,
          accounts.findLatestReason(row.company_id, row.credit_state),
          true,
        );
      });
      return { items, total: result.total, page, pageSize };
    },
    getAdminDetail,
    getAdmin(accountId, standingCountry) {
      return getAdminDetail(accountId, standingCountry);
    },
    update,
    updateLimit(accountId, input, context, standingCountry) {
      if (
        input.creditLimitCents === undefined ||
        input.state !== undefined ||
        input.status !== undefined
      )
        throw new CreditAccountError(
          'INVALID_INPUT',
          'limit update requires creditLimitCents only',
        );
      return update(accountId, input, context, standingCountry);
    },
    updateState(accountId, input, context, standingCountry) {
      if (input.state === undefined && input.status === undefined)
        throw new CreditAccountError('INVALID_INPUT', 'state update requires state');
      return update(accountId, input, context, standingCountry);
    },
    setState(accountId, input, context, standingCountry) {
      if (input.state === undefined && input.status === undefined)
        throw new CreditAccountError('INVALID_INPUT', 'state update requires state');
      return update(accountId, input, context, standingCountry);
    },
    getExposure(companyId, at = now()) {
      return unitOfWork.run(() => holds.exposure(requirePositiveId(companyId, 'companyId'), at));
    },
    acquireHoldForUser: acquireForUser,
    acquireHoldForUserInTransaction(userId, input) {
      return acquireForUser(userId, input, false);
    },
    acquireHold(input) {
      return acquireForUser(input.userId, input);
    },
    acquireHoldInTransaction(input) {
      return acquireForUser(input.userId, input, false);
    },
    tryAcquireHold: tryAcquire,
    tryAcquireHoldInTransaction(userId, input) {
      return tryAcquire(userId, input, false);
    },
    authorizeHold(paymentIdempotencyKey, at = now()) {
      const key = holdKey({ paymentIdempotencyKey, amountCents: 0, expiresAt: at });
      return unitOfWork.run(() => {
        holds.expirePrepared(at);
        const hold = holds.authorize(key, at);
        if (!hold) throw new CreditAccountError('HOLD_INVALID_TRANSITION');
        return hold;
      });
    },
    commitHold(paymentIdempotencyKey, invoiceId, at) {
      const committedInvoiceId = requirePositiveId(invoiceId, 'invoiceId');
      const committedAt = requireInstant(at ?? now(), 'committedAt');
      const key = holdKey({
        paymentIdempotencyKey,
        amountCents: 0,
        expiresAt: committedAt,
      });
      return unitOfWork.run(() => {
        const hold = holds.commit(key, committedAt, committedInvoiceId);
        if (!hold) throw new CreditAccountError('HOLD_INVALID_TRANSITION');
        return hold;
      });
    },
    releaseHold(paymentIdempotencyKey, at = now()) {
      const key = holdKey({ paymentIdempotencyKey, amountCents: 0, expiresAt: at });
      return unitOfWork.run(() => {
        const hold = holds.release(key, at);
        if (!hold) throw new CreditAccountError('HOLD_INVALID_TRANSITION');
        return hold;
      });
    },
    expirePreparedHolds(at = now()) {
      return unitOfWork.run(() => holds.expirePrepared(at));
    },
  };
}

export const createTradeCreditAccountService = createCreditAccountService;
export const createCompanyCreditAccountService = createCreditAccountService;
