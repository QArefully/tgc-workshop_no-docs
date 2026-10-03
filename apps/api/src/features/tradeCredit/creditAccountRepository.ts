import type Database from 'better-sqlite3';
import type { Country } from '@shop/contracts/country';
import type { TradeCreditState } from '@shop/contracts/trade-credit';

/** SQLite's INTEGER is wider than JavaScript's exact integer range. */
export const MAX_SAFE_CREDIT_INTEGER = Number.MAX_SAFE_INTEGER;

/**
 * The account is deliberately denormalised onto `company_accounts` by migration 035.  Keep the
 * company name/country on this row so every admin query applies the same tenant boundary while
 * still returning the display data required by the admin view.
 */
export interface CreditAccountRow {
  id: number;
  company_id: number;
  company_name: string;
  country: Country;
  active: number;
  credit_limit_cents: number;
  credit_terms_days: 30;
  credit_state: TradeCreditState;
  credit_version: number;
  created_at: string;
  updated_at: string;
}

/** Immutable command ledger row used for replay/conflict checks. */
export interface CreditAccountEventRow {
  id: number;
  company_id: number;
  event_type: string;
  credit_limit_cents: number;
  credit_terms_days: 30;
  credit_state: TradeCreditState;
  credit_version: number;
  amount_cents: number | null;
  reason: string | null;
  idempotency_key: string;
  request_fingerprint: string;
  occurred_at: string;
}

/** SQL order keys are closed here; callers never interpolate user-provided column names. */
export type CreditAccountOrder =
  'id' | 'companyName' | 'createdAt' | 'updatedAt' | 'creditLimitCents' | 'state' | 'version';

export type CreditAccountOrderDirection = 'asc' | 'desc';

export interface CreditAccountListQuery {
  companyId?: number;
  state?: TradeCreditState;
  /** Read-only alias accepted by admin callers. */
  status?: TradeCreditState;
  search?: string;
  order?: CreditAccountOrder;
  orderBy?: CreditAccountOrder;
  direction?: CreditAccountOrderDirection;
  sortDirection?: CreditAccountOrderDirection;
  page: number;
  pageSize: number;
  /** Standing administrator country; omitted only for legacy in-process callers. */
  country?: Country;
}

export interface CreditAccountListRows {
  rows: CreditAccountRow[];
  total: number;
}

export interface CreditAccountRepository {
  /** Active account for a company id (account id and company id are the same identity). */
  findByCompanyId(companyId: number): CreditAccountRow | null;
  /** Alias that makes the account/company identity explicit to checkout callers. */
  findActiveByCompanyId(companyId: number): CreditAccountRow | null;
  /** Active company/account reached through an active membership, with no client company input. */
  findForMember(userId: number): CreditAccountRow | null;
  findAdmin(accountId: number, country?: Country): CreditAccountRow | null;
  /** Optional writer boundary used by versioned admin mutations before their first read. */
  lockCompany?(accountId: number, country?: Country): boolean;
  listAdmin(query: CreditAccountListQuery): CreditAccountListRows;
  findEventByIdempotencyKey(idempotencyKey: string): CreditAccountEventRow | null;
  findLatestReason(companyId: number, state: TradeCreditState): string | null;
  updateCas(input: {
    companyId: number;
    expectedVersion: number;
    creditLimitCents: number;
    creditState: TradeCreditState;
    updatedAt: string;
  }): boolean;
  appendEvent(input: {
    companyId: number;
    eventType: string;
    creditLimitCents: number;
    creditTermsDays: 30;
    creditState: TradeCreditState;
    creditVersion: number;
    amountCents?: number | null;
    reason?: string | null;
    idempotencyKey: string;
    requestFingerprint: string;
    occurredAt: string;
  }): CreditAccountEventRow;
}

const accountColumns = `
  c.id,
  c.id AS company_id,
  c.name AS company_name,
  c.country,
  c.active,
  c.credit_limit_cents,
  c.credit_terms_days,
  c.credit_state,
  c.credit_version,
  c.created_at,
  c.updated_at`;

const accountOrderColumns: Record<CreditAccountOrder, string> = {
  id: 'c.id',
  companyName: 'c.name COLLATE NOCASE',
  createdAt: 'c.created_at',
  updatedAt: 'c.updated_at',
  creditLimitCents: 'c.credit_limit_cents',
  state: 'c.credit_state',
  version: 'c.credit_version',
};

const accountStates = new Set<TradeCreditState>(['active', 'on_hold', 'suspended']);
const accountOrderKeys = new Set<CreditAccountOrder>(
  Object.keys(accountOrderColumns) as CreditAccountOrder[],
);

function toAccountRow(row: unknown): CreditAccountRow {
  return row as CreditAccountRow;
}

function getAccount(
  db: Database.Database,
  where: string,
  values: readonly unknown[],
): CreditAccountRow | null {
  const row = db
    .prepare(`SELECT ${accountColumns} FROM company_accounts c ${where}`)
    .get(...values);
  return row === undefined ? null : toAccountRow(row);
}

function searchPattern(value: string): string {
  // Search is a human-facing substring query. Treat LIKE metacharacters literally so the search
  // field cannot silently broaden an admin result set beyond the requested text.
  return `%${value.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

/**
 * Persistence for the company-owned credit policy and its immutable command ledger.  This module
 * owns SQL/row shapes only; transaction ownership remains with the workflow service/UoW.
 */
export function createCreditAccountRepository(db: Database.Database): CreditAccountRepository {
  const byCompany = (companyId: number): CreditAccountRow | null =>
    getAccount(db, 'WHERE c.id = ? AND c.active = 1', [companyId]);

  return {
    findByCompanyId: byCompany,
    findActiveByCompanyId: byCompany,
    lockCompany(accountId, country) {
      const predicates = ['id = ?', 'active = 1'];
      const values: unknown[] = [accountId];
      if (country !== undefined) {
        predicates.push('country = ?');
        values.push(country);
      }
      return (
        db
          .prepare(
            `UPDATE company_accounts SET updated_at = updated_at
             WHERE ${predicates.join(' AND ')}`,
          )
          .run(...values).changes === 1
      );
    },
    findForMember(userId) {
      return getAccount(
        db,
        `JOIN company_memberships membership ON membership.company_id = c.id
         WHERE membership.user_id = ? AND membership.active = 1 AND c.active = 1
         LIMIT 1`,
        [userId],
      );
    },
    findAdmin(accountId, country) {
      const predicates = ['c.id = ?', 'c.active = 1'];
      const values: unknown[] = [accountId];
      if (country !== undefined) {
        predicates.push('c.country = ?');
        values.push(country);
      }
      return getAccount(db, `WHERE ${predicates.join(' AND ')}`, values);
    },
    listAdmin(query) {
      const predicates = ['c.active = 1'];
      const values: unknown[] = [];
      const state = query.state ?? query.status;
      if (query.companyId !== undefined) {
        predicates.push('c.id = ?');
        values.push(query.companyId);
      }
      if (state !== undefined) {
        // Service validation normally catches this. Keep the repository fail-closed for direct
        // callers rather than returning all states for an unrecognised value.
        if (!accountStates.has(state)) return { rows: [], total: 0 };
        predicates.push('c.credit_state = ?');
        values.push(state);
      }
      if (query.country !== undefined) {
        predicates.push('c.country = ?');
        values.push(query.country);
      }
      if (query.search !== undefined && query.search.trim() !== '') {
        const pattern = searchPattern(query.search.trim());
        predicates.push(
          `(c.name LIKE ? ESCAPE '\\' COLLATE NOCASE
            OR CAST(c.id AS TEXT) LIKE ? ESCAPE '\\')`,
        );
        values.push(pattern, pattern);
      }
      const where = `WHERE ${predicates.join(' AND ')}`;
      const total = (
        db.prepare(`SELECT COUNT(*) AS count FROM company_accounts c ${where}`).get(...values) as {
          count: number;
        }
      ).count;
      const orderKey = query.orderBy ?? query.order ?? 'updatedAt';
      const orderColumn = accountOrderKeys.has(orderKey) ? accountOrderColumns[orderKey] : null;
      if (orderColumn === null) return { rows: [], total };
      const direction =
        (query.sortDirection ?? query.direction ?? 'desc') === 'asc' ? 'ASC' : 'DESC';
      const offset = (query.page - 1) * query.pageSize;
      const rows = db
        .prepare(
          `SELECT ${accountColumns} FROM company_accounts c ${where}
           ORDER BY ${orderColumn} ${direction}, c.id ASC LIMIT ? OFFSET ?`,
        )
        .all(...values, query.pageSize, offset)
        .map(toAccountRow);
      return { rows, total };
    },
    findEventByIdempotencyKey(idempotencyKey) {
      return (
        (db
          .prepare(
            `SELECT id, company_id, event_type, credit_limit_cents, credit_terms_days,
                    credit_state, credit_version, amount_cents, reason, idempotency_key,
                    request_fingerprint, occurred_at
             FROM company_credit_events WHERE idempotency_key = ?`,
          )
          .get(idempotencyKey) as CreditAccountEventRow | undefined) ?? null
      );
    },
    findLatestReason(companyId, state) {
      const row = db
        .prepare(
          `SELECT reason FROM company_credit_events
           WHERE company_id = ? AND event_type = 'state_changed' AND credit_state = ?
           ORDER BY id DESC LIMIT 1`,
        )
        .get(companyId, state) as { reason: string | null } | undefined;
      return row?.reason ?? null;
    },
    updateCas({ companyId, expectedVersion, creditLimitCents, creditState, updatedAt }) {
      return (
        db
          .prepare(
            `UPDATE company_accounts
             SET credit_limit_cents = ?, credit_state = ?, credit_version = ?, updated_at = ?
             WHERE id = ? AND active = 1 AND credit_version = ?`,
          )
          .run(
            creditLimitCents,
            creditState,
            expectedVersion + 1,
            updatedAt,
            companyId,
            expectedVersion,
          ).changes === 1
      );
    },
    appendEvent(input) {
      const id = Number(
        db
          .prepare(
            `INSERT INTO company_credit_events
              (company_id, event_type, credit_limit_cents, credit_terms_days, credit_state,
               credit_version, amount_cents, reason, idempotency_key, request_fingerprint,
               occurred_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            input.companyId,
            input.eventType,
            input.creditLimitCents,
            input.creditTermsDays,
            input.creditState,
            input.creditVersion,
            input.amountCents ?? null,
            input.reason ?? null,
            input.idempotencyKey,
            input.requestFingerprint,
            input.occurredAt,
          ).lastInsertRowid,
      );
      const event = db
        .prepare(
          `SELECT id, company_id, event_type, credit_limit_cents, credit_terms_days,
                  credit_state, credit_version, amount_cents, reason, idempotency_key,
                  request_fingerprint, occurred_at
           FROM company_credit_events WHERE id = ?`,
        )
        .get(id) as CreditAccountEventRow | undefined;
      if (!event) throw new Error('Credit account event disappeared after insert');
      return event;
    },
  };
}

/** Naming aliases used by callers that call the company row a credit-account record. */
export const createCompanyCreditAccountRepository = createCreditAccountRepository;
export const createTradeCreditAccountRepository = createCreditAccountRepository;
