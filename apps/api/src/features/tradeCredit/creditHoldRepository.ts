import type Database from 'better-sqlite3';
import type { CreditAccountState, TradeCreditState } from '@shop/contracts/trade-credit';
import { calculateAvailableCredit, calculateCreditExposure } from './tradeCreditRules.js';

const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;

export type CreditHoldStatus = 'prepared' | 'authorized' | 'committed' | 'released';

export interface CreditHoldRow {
  id: number;
  company_id: number;
  payment_idempotency_key: string;
  amount_cents: number;
  status: CreditHoldStatus;
  expires_at: string | null;
  invoice_id: number | null;
  authorized_at: string | null;
  committed_at: string | null;
  released_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Canonical exposure tuple. Every amount is GBP pence and a safe non-negative integer. */
export interface CreditExposureSummary {
  outstandingInvoiceCents: number;
  /** Alias used by account/checkout callers. */
  outstandingCents: number;
  preparedHoldCents: number;
  authorizedHoldCents: number;
  heldCents: number;
  exposureCents: number;
  availableCreditCents: number;
  creditLimitCents: number;
}

export interface CreditHoldAuthorizeInput {
  paymentIdempotencyKey: string;
  authorizedAt: string;
}

export interface CreditHoldCommitInput {
  paymentIdempotencyKey: string;
  committedAt: string;
  /** Every committed hold must be linked to its immutable invoice. */
  invoiceId: number;
}

export interface CreditHoldReleaseInput {
  paymentIdempotencyKey: string;
  releasedAt: string;
}

export interface CreditHoldRepository {
  findById(id: number): CreditHoldRow | null;
  findByPaymentIdempotencyKey(paymentIdempotencyKey: string): CreditHoldRow | null;
  /** Alias used by payment-intent integrations. */
  findByKey(paymentIdempotencyKey: string): CreditHoldRow | null;
  exposure(companyId: number, now: string): CreditExposureSummary;
  getExposure(companyId: number, now: string): CreditExposureSummary;
  /** Releases only prepared rows whose explicit expiry has elapsed. */
  expirePrepared(now: string): string[];
  /** Alias used by expiry workers. */
  expire(now: string): string[];
  /** Optional writer boundary used by service authorization checks before their first read. */
  lockCompany?(companyId: number): boolean;
  /**
   * Acquires a prepared hold. The caller must invoke this inside its UnitOfWork. The repository
   * takes a write lock on the company row before reading exposure, so two connections cannot both
   * approve the final available amount.
   */
  acquire(input: {
    companyId: number;
    paymentIdempotencyKey?: string;
    /** Compatibility alias accepted by checkout integrations. */
    idempotencyKey?: string;
    amountCents: number;
    expiresAt: string;
    createdAt: string;
    updatedAt?: string;
  }): CreditHoldRow | null;
  acquireHold(input: Parameters<CreditHoldRepository['acquire']>[0]): CreditHoldRow | null;
  /** Idempotent prepared -> authorized CAS. */
  authorize(paymentIdempotencyKey: string, authorizedAt: string): CreditHoldRow | null;
  authorize(input: CreditHoldAuthorizeInput): CreditHoldRow | null;
  authorizeHold(paymentIdempotencyKey: string, authorizedAt: string): CreditHoldRow | null;
  authorizeHold(input: CreditHoldAuthorizeInput): CreditHoldRow | null;
  /** Idempotent authorized -> committed CAS with a validated invoice link. */
  commit(
    paymentIdempotencyKey: string,
    committedAt: string,
    invoiceId: number,
  ): CreditHoldRow | null;
  commit(input: CreditHoldCommitInput): CreditHoldRow | null;
  commitHold(
    paymentIdempotencyKey: string,
    committedAt: string,
    invoiceId: number,
  ): CreditHoldRow | null;
  commitHold(input: CreditHoldCommitInput): CreditHoldRow | null;
  /** Idempotent prepared/authorized -> released CAS. */
  release(paymentIdempotencyKey: string, releasedAt: string): CreditHoldRow | null;
  release(input: CreditHoldReleaseInput): CreditHoldRow | null;
  releaseHold(paymentIdempotencyKey: string, releasedAt: string): CreditHoldRow | null;
  releaseHold(input: CreditHoldReleaseInput): CreditHoldRow | null;
}

const holdColumns = `id, company_id, payment_idempotency_key, amount_cents, status, expires_at,
  invoice_id, authorized_at, committed_at, released_at, created_at, updated_at`;

function safeMoney(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
  return value;
}

function requirePositiveId(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function safeAdd(left: number, right: number, name: string): number {
  safeMoney(left, `${name} left operand`);
  safeMoney(right, `${name} right operand`);
  if (right > MAX_SAFE_INTEGER - left) throw new RangeError(`${name} is outside safe range`);
  return left + right;
}

function requireInstant(value: string, name: string): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new RangeError(`${name} must be an ISO instant`);
  }
  return value;
}

function accountState(value: unknown): TradeCreditState {
  if (value !== 'active' && value !== 'on_hold' && value !== 'suspended') {
    throw new Error('Invalid persisted credit account state');
  }
  return value;
}

function accountRow(
  db: Database.Database,
  companyId: number,
): { credit_limit_cents: number; credit_state: CreditAccountState; active: number } | null {
  const row = db
    .prepare(
      `SELECT credit_limit_cents, credit_state, active
       FROM company_accounts WHERE id = ?`,
    )
    .get(companyId) as
    { credit_limit_cents: number; credit_state: CreditAccountState; active: number } | undefined;
  return row ?? null;
}

/**
 * SQL for this repository stays static. In particular, exposure is read as individual rows and
 * summed with JavaScript guards rather than relying on an unbounded SQLite SUM result.
 */
export function createCreditHoldRepository(db: Database.Database): CreditHoldRepository {
  // better-sqlite3 normally supplies a busy timeout, but set one explicitly so a second local
  // connection waits for the first UnitOfWork's company-row lock and then evaluates fresh exposure.
  db.pragma('busy_timeout = 5000');

  const findById = (id: number): CreditHoldRow | null =>
    (db.prepare(`SELECT ${holdColumns} FROM credit_exposure_holds WHERE id = ?`).get(id) as
      CreditHoldRow | undefined) ?? null;
  const findByKey = (paymentIdempotencyKey: string): CreditHoldRow | null =>
    (db
      .prepare(
        `SELECT ${holdColumns} FROM credit_exposure_holds
         WHERE payment_idempotency_key = ?`,
      )
      .get(paymentIdempotencyKey) as CreditHoldRow | undefined) ?? null;

  const expirePrepared = (now: string): string[] => {
    requireInstant(now, 'now');
    const candidates = db
      .prepare(
        `SELECT id, payment_idempotency_key FROM credit_exposure_holds
         WHERE status = 'prepared' AND expires_at IS NOT NULL AND expires_at <= ?
         ORDER BY id ASC`,
      )
      .all(now) as Array<{ id: number; payment_idempotency_key: string }>;
    const update = db.prepare(
      `UPDATE credit_exposure_holds
       SET status = 'released', released_at = ?, updated_at = ?
       WHERE id = ? AND status = 'prepared' AND expires_at IS NOT NULL AND expires_at <= ?`,
    );
    return candidates
      .filter((candidate) => update.run(now, now, candidate.id, now).changes === 1)
      .map((candidate) => candidate.payment_idempotency_key);
  };

  const lockCompany = (companyId: number): boolean =>
    db
      .prepare(
        `UPDATE company_accounts SET updated_at = updated_at
         WHERE id = ? AND active = 1`,
      )
      .run(companyId).changes === 1;

  const exposure = (companyId: number, now: string): CreditExposureSummary => {
    requireInstant(now, 'now');
    // Expiry is a CAS write and therefore safe when this read is already inside the caller's UoW;
    // direct repository readers also get the same live-hold semantics.
    expirePrepared(now);
    const account = accountRow(db, companyId);
    if (!account) throw new Error('Credit account not found');
    const creditLimitCents = safeMoney(account.credit_limit_cents, 'creditLimitCents');

    const invoiceRows = db
      .prepare(
        `SELECT i.gross_cents
         FROM invoices i
         JOIN invoice_states state ON state.invoice_id = i.id
         WHERE i.company_id = ? AND state.status IN ('open', 'overdue')
         ORDER BY i.id ASC`,
      )
      .all(companyId) as Array<{ gross_cents: number }>;
    let outstandingInvoiceCents = 0;
    for (const row of invoiceRows)
      outstandingInvoiceCents = safeAdd(
        outstandingInvoiceCents,
        safeMoney(row.gross_cents, 'invoice grossCents'),
        'outstanding invoice exposure',
      );

    const preparedRows = db
      .prepare(
        `SELECT amount_cents
         FROM credit_exposure_holds
         WHERE company_id = ? AND status = 'prepared'
           AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY id ASC`,
      )
      .all(companyId, now) as Array<{ amount_cents: number }>;
    let preparedHoldCents = 0;
    for (const row of preparedRows)
      preparedHoldCents = safeAdd(
        preparedHoldCents,
        safeMoney(row.amount_cents, 'prepared hold amountCents'),
        'prepared hold exposure',
      );

    const authorizedRows = db
      .prepare(
        `SELECT amount_cents
         FROM credit_exposure_holds
         WHERE company_id = ? AND status = 'authorized'
         ORDER BY id ASC`,
      )
      .all(companyId) as Array<{ amount_cents: number }>;
    let authorizedHoldCents = 0;
    for (const row of authorizedRows)
      authorizedHoldCents = safeAdd(
        authorizedHoldCents,
        safeMoney(row.amount_cents, 'authorized hold amountCents'),
        'authorized hold exposure',
      );

    // Reuse the reviewed pure rules so this persistence boundary cannot drift from checkout's
    // arithmetic or available-credit clamp.
    const heldCents = calculateCreditExposure({
      outstandingInvoiceCents: 0,
      preparedHoldCents,
      authorizedHoldCents,
    });
    // `calculateCreditExposure` above intentionally calculates held amounts as exposure from zero;
    // use the named helper result for the final outstanding + held tuple.
    const exposureCents = calculateCreditExposure({
      outstandingInvoiceCents,
      preparedHoldCents,
      authorizedHoldCents,
    });
    const availableCreditCents = calculateAvailableCredit(creditLimitCents, exposureCents);
    return {
      outstandingInvoiceCents,
      outstandingCents: outstandingInvoiceCents,
      preparedHoldCents,
      authorizedHoldCents,
      heldCents,
      exposureCents,
      availableCreditCents,
      creditLimitCents,
    };
  };

  const acquire = (input: Parameters<CreditHoldRepository['acquire']>[0]): CreditHoldRow | null => {
    const paymentIdempotencyKey = input.paymentIdempotencyKey || input.idempotencyKey;
    if (!paymentIdempotencyKey) throw new RangeError('paymentIdempotencyKey is required');
    safeMoney(input.amountCents, 'amountCents');
    requireInstant(input.expiresAt, 'expiresAt');
    requireInstant(input.createdAt, 'createdAt');
    const updatedAt = input.updatedAt ?? input.createdAt;
    requireInstant(updatedAt, 'updatedAt');

    // A no-op write takes SQLite's single-writer lock before the exposure read. This is the
    // critical race boundary: another connection cannot read the same stale capacity and insert a
    // competing hold between our read and insert.
    if (!lockCompany(input.companyId)) return null;

    expirePrepared(updatedAt);
    const existing = findByKey(paymentIdempotencyKey);
    if (existing) {
      return existing.status === 'prepared' || existing.status === 'authorized' ? existing : null;
    }
    const payment = db
      .prepare(
        `SELECT payment_method, company_id, amount_cents
         FROM payments WHERE idempotency_key = ?`,
      )
      .get(paymentIdempotencyKey) as
      { payment_method: string; company_id: number | null; amount_cents: number } | undefined;
    // The hold is a reservation against one trade-credit intent, not a free-standing balance
    // adjustment. Fail closed if a caller supplies a card/missing/mismatched payment identity.
    if (
      !payment ||
      payment.payment_method !== 'trade_credit' ||
      payment.company_id !== input.companyId ||
      payment.amount_cents !== input.amountCents
    )
      return null;
    const account = accountRow(db, input.companyId);
    if (!account || account.active !== 1 || accountState(account.credit_state) !== 'active') {
      return null;
    }
    const current = exposure(input.companyId, updatedAt);
    if (input.amountCents > current.availableCreditCents) return null;

    try {
      db.prepare(
        `INSERT INTO credit_exposure_holds
          (company_id, payment_idempotency_key, amount_cents, status, expires_at,
           created_at, updated_at)
         VALUES (?, ?, ?, 'prepared', ?, ?, ?)`,
      ).run(
        input.companyId,
        paymentIdempotencyKey,
        input.amountCents,
        input.expiresAt,
        input.createdAt,
        updatedAt,
      );
    } catch (error) {
      // A concurrent same-key insertion is an idempotent replay. Re-read it; unrelated constraint
      // failures still surface to the transaction owner rather than being hidden as no capacity.
      const replay = findByKey(paymentIdempotencyKey);
      if (replay) {
        return replay.status === 'prepared' || replay.status === 'authorized' ? replay : null;
      }
      throw error;
    }
    return findByKey(paymentIdempotencyKey);
  };

  const authorize = (
    keyOrInput: string | CreditHoldAuthorizeInput,
    authorizedAt?: string,
  ): CreditHoldRow | null => {
    const paymentIdempotencyKey =
      typeof keyOrInput === 'string' ? keyOrInput : keyOrInput.paymentIdempotencyKey;
    const at = typeof keyOrInput === 'string' ? authorizedAt : keyOrInput.authorizedAt;
    if (typeof at !== 'string') throw new RangeError('authorizedAt is required');
    requireInstant(at, 'authorizedAt');
    // A direct repository caller should receive the same expiry semantics as the service wrapper:
    // an elapsed prepared hold cannot be promoted after its deadline.
    expirePrepared(at);
    const existing = findByKey(paymentIdempotencyKey);
    if (!existing) return null;
    if (existing.status === 'authorized') return existing;
    if (existing.status !== 'prepared') return null;
    db.prepare(
      `UPDATE credit_exposure_holds
       SET status = 'authorized', expires_at = NULL, authorized_at = ?, updated_at = ?
       WHERE id = ? AND status = 'prepared'`,
    ).run(at, at, existing.id);
    const next = findByKey(paymentIdempotencyKey);
    return next?.status === 'authorized' || next?.status === 'committed' ? next : null;
  };

  const commit = (
    keyOrInput: string | CreditHoldCommitInput,
    committedAtOrInvoiceId?: string,
    invoiceIdOrCommittedAt?: number,
  ): CreditHoldRow | null => {
    const paymentIdempotencyKey =
      typeof keyOrInput === 'string' ? keyOrInput : keyOrInput.paymentIdempotencyKey;
    const committedAt =
      typeof keyOrInput === 'string' ? committedAtOrInvoiceId : keyOrInput.committedAt;
    const invoiceId =
      typeof keyOrInput === 'string' ? invoiceIdOrCommittedAt : keyOrInput.invoiceId;
    if (typeof committedAt !== 'string') throw new RangeError('committedAt is required');
    requireInstant(committedAt, 'committedAt');
    const committedInvoiceId = requirePositiveId(invoiceId, 'invoiceId');
    const existing = findByKey(paymentIdempotencyKey);
    if (!existing) return null;
    if (existing.status === 'committed') {
      return existing.invoice_id === committedInvoiceId ? existing : null;
    }
    if (existing.status !== 'authorized') return null;
    const changed = db
      .prepare(
        `UPDATE credit_exposure_holds
         SET status = 'committed', invoice_id = ?, committed_at = ?, updated_at = ?
         WHERE id = ? AND status = 'authorized'
           AND EXISTS (
             SELECT 1
             FROM invoices
             WHERE invoices.id = ?
               AND invoices.payment_idempotency_key = credit_exposure_holds.payment_idempotency_key
               AND invoices.company_id = credit_exposure_holds.company_id
               AND invoices.gross_cents = credit_exposure_holds.amount_cents
           )`,
      )
      .run(committedInvoiceId, committedAt, committedAt, existing.id, committedInvoiceId).changes;
    if (changed !== 1) return null;
    return findByKey(paymentIdempotencyKey);
  };

  const release = (
    keyOrInput: string | CreditHoldReleaseInput,
    releasedAt?: string,
  ): CreditHoldRow | null => {
    const paymentIdempotencyKey =
      typeof keyOrInput === 'string' ? keyOrInput : keyOrInput.paymentIdempotencyKey;
    const at = typeof keyOrInput === 'string' ? releasedAt : keyOrInput.releasedAt;
    if (typeof at !== 'string') throw new RangeError('releasedAt is required');
    requireInstant(at, 'releasedAt');
    const existing = findByKey(paymentIdempotencyKey);
    if (!existing) return null;
    if (existing.status === 'released') return existing;
    if (existing.status !== 'prepared' && existing.status !== 'authorized') return null;
    db.prepare(
      `UPDATE credit_exposure_holds
       SET status = 'released', released_at = ?, updated_at = ?
       WHERE id = ? AND status IN ('prepared', 'authorized')`,
    ).run(at, at, existing.id);
    const next = findByKey(paymentIdempotencyKey);
    return next?.status === 'released' ? next : null;
  };

  return {
    findById,
    findByPaymentIdempotencyKey: findByKey,
    findByKey,
    exposure,
    getExposure: exposure,
    expirePrepared,
    expire: expirePrepared,
    lockCompany,
    acquire,
    acquireHold: acquire,
    authorize,
    authorizeHold: authorize,
    commit,
    commitHold: commit,
    release,
    releaseHold: release,
  };
}

export const createTradeCreditHoldRepository = createCreditHoldRepository;
export const createCreditExposureHoldRepository = createCreditHoldRepository;
