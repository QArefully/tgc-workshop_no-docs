import type Database from 'better-sqlite3';
import type { Country } from '@shop/contracts/country';
import type { TradeCreditState } from '@shop/contracts/trade-credit';

export interface CompanyRow {
  id: number;
  country: Country;
  name: string;
  created_by_user_id: number;
  active: number;
  approval_threshold_cents: number | null;
  /**
   * Credit policy lives on the company row rather than in a separate account table.  Keep these
   * fields on the persistence row even though the legacy company transport intentionally omits
   * them; the trade-credit feature maps them into its own member/admin views.
   */
  credit_limit_cents: number;
  credit_terms_days: 30;
  credit_state: TradeCreditState;
  credit_version: number;
  created_at: string;
  updated_at: string;
}

export interface CompanyRepository {
  /** Reads the immutable identity country used to partition a creator's company account. */
  findUserCountry(userId: number): Country | undefined;
  create(input: {
    name: string;
    createdByUserId: number;
    country: Country;
    now: string;
  }): CompanyRow;
  findActiveById(id: number): CompanyRow | null;
  /** Reads a company row with its embedded credit policy. Alias keeps the authority explicit. */
  findActiveCreditById(id: number): CompanyRow | null;
  updateThreshold(id: number, thresholdCents: number | null, now: string): void;
}

export function createCompanyRepository(db: Database.Database): CompanyRepository {
  const get = (id: number) =>
    (db
      .prepare(
        `SELECT id, country, name, created_by_user_id, active,
    approval_threshold_cents, credit_limit_cents, credit_terms_days, credit_state, credit_version,
    created_at, updated_at FROM company_accounts WHERE id = ? AND active = 1`,
      )
      .get(id) as CompanyRow | undefined) ?? null;
  return {
    findUserCountry(userId) {
      const row = db.prepare('SELECT country FROM users WHERE id = ?').get(userId) as
        { country?: Country } | undefined;
      return row?.country;
    },
    create({ name, createdByUserId, country, now }) {
      const id = Number(
        db
          .prepare(
            `INSERT INTO company_accounts
        (country, name, created_by_user_id, active, created_at, updated_at)
        VALUES (?, ?, ?, 1, ?, ?)`,
          )
          .run(country, name, createdByUserId, now, now).lastInsertRowid,
      );
      return get(id)!;
    },
    findActiveById: get,
    findActiveCreditById: get,
    updateThreshold(id, thresholdCents, now) {
      db.prepare(
        `UPDATE company_accounts SET approval_threshold_cents = ?, updated_at = ?
        WHERE id = ? AND active = 1`,
      ).run(thresholdCents, now, id);
    },
  };
}
