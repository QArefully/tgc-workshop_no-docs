import type Database from 'better-sqlite3';
import type { Country } from '@shop/contracts/country';
import type { PromoRecord } from './promoRepository.js';

interface PromoRow {
  id: number;
  code: string;
  discount_percent: number;
  min_item_count: number;
  active: number;
  kind: 'percent' | 'fixed';
  amount_cents: number | null;
  min_subtotal_cents: number | null;
  category_scope: string | null;
  start_at: string | null;
  end_at: string | null;
  max_redemptions: number | null;
  redemption_count: number;
  per_user_limit: number | null;
}

export interface PromoAdminWrite {
  code: string;
  discountPercent: number;
  minItemCount: number;
  kind: 'percent' | 'fixed';
  amountCents: number | null;
  minSubtotalCents: number | null;
  categoryScope: string | null;
  countries?: Country[];
  startAt: string | null;
  endAt: string | null;
  maxRedemptions: number | null;
  perUserLimit: number | null;
}

export interface PromoAdminRepository {
  list(input?: { code?: string; active?: boolean }, country?: Country): PromoRecord[];
  get(code: string, country?: Country): PromoRecord | undefined;
  create(input: PromoAdminWrite): PromoRecord;
  update(code: string, input: Omit<PromoAdminWrite, 'code'>): PromoRecord | undefined;
  replaceTargetedCountries(code: string, countries: readonly Country[]): void;
  deactivate(code: string): PromoRecord | undefined;
  activeReservationCount(code: string): number;
}

function toRecord(row: PromoRow): PromoRecord {
  return {
    code: row.code,
    discountPercent: row.discount_percent,
    minItemCount: row.min_item_count,
    active: row.active === 1,
    kind: row.kind,
    amountCents: row.amount_cents,
    minSubtotalCents: row.min_subtotal_cents,
    categoryScope: row.category_scope,
    startAt: row.start_at,
    endAt: row.end_at,
    maxRedemptions: row.max_redemptions,
    redemptionCount: row.redemption_count,
    perUserLimit: row.per_user_limit,
  };
}

export function createPromoAdminRepository(db: Database.Database): PromoAdminRepository {
  const select = `SELECT id, code, discount_percent, min_item_count, active, kind, amount_cents,
    min_subtotal_cents, category_scope, start_at, end_at, max_redemptions, redemption_count,
    per_user_limit FROM promo_codes`;
  const targetedCountriesForId = (promoCodeId: number): Country[] =>
    db
      .prepare(
        'SELECT country FROM promo_code_countries WHERE promo_code_id = ? ORDER BY rowid ASC',
      )
      .all(promoCodeId)
      .map((row) => (row as { country: Country }).country);
  const toAdminRecord = (row: PromoRow): PromoRecord => {
    const record = toRecord(row);
    const countries = targetedCountriesForId(row.id);
    return countries.length > 0 ? { ...record, countries } : record;
  };
  const get = (code: string, country?: Country): PromoRecord | undefined => {
    const countryClause = country
      ? ` AND (NOT EXISTS (SELECT 1 FROM promo_code_countries pc0 WHERE pc0.promo_code_id = promo_codes.id)
              OR EXISTS (SELECT 1 FROM promo_code_countries pc1 WHERE pc1.promo_code_id = promo_codes.id AND pc1.country = ?))`
      : '';
    const row = db
      .prepare(`${select} WHERE code = ?${countryClause}`)
      .get(...(country ? [code, country] : [code])) as PromoRow | undefined;
    return row ? toAdminRecord(row) : undefined;
  };

  return {
    list(input = {}, country) {
      const clauses: string[] = [];
      const values: (string | number)[] = [];
      if (input.code !== undefined) {
        clauses.push('code LIKE ?');
        values.push(`%${input.code}%`);
      }
      if (input.active !== undefined) {
        clauses.push('active = ?');
        values.push(input.active ? 1 : 0);
      }
      if (country) {
        clauses.push(
          '(NOT EXISTS (SELECT 1 FROM promo_code_countries pc0 WHERE pc0.promo_code_id = promo_codes.id) OR EXISTS (SELECT 1 FROM promo_code_countries pc1 WHERE pc1.promo_code_id = promo_codes.id AND pc1.country = ?))',
        );
        values.push(country);
      }
      const where = clauses.length === 0 ? '' : ` WHERE ${clauses.join(' AND ')}`;
      return db
        .prepare(`${select}${where} ORDER BY code ASC`)
        .all(...values)
        .map((row) => toAdminRecord(row as PromoRow));
    },
    get,
    create(input) {
      db.prepare(
        `INSERT INTO promo_codes
          (code, discount_percent, min_item_count, active, kind, amount_cents, min_subtotal_cents,
           category_scope, start_at, end_at, max_redemptions, per_user_limit)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        input.code,
        input.discountPercent,
        input.minItemCount,
        input.kind,
        input.amountCents,
        input.minSubtotalCents,
        input.categoryScope,
        input.startAt,
        input.endAt,
        input.maxRedemptions,
        input.perUserLimit,
      );
      return get(input.code)!;
    },
    update(code, input) {
      const result = db
        .prepare(
          `UPDATE promo_codes
           SET discount_percent = ?, min_item_count = ?, kind = ?, amount_cents = ?,
               min_subtotal_cents = ?, category_scope = ?, start_at = ?, end_at = ?,
               max_redemptions = ?, per_user_limit = ?
           WHERE code = ?`,
        )
        .run(
          input.discountPercent,
          input.minItemCount,
          input.kind,
          input.amountCents,
          input.minSubtotalCents,
          input.categoryScope,
          input.startAt,
          input.endAt,
          input.maxRedemptions,
          input.perUserLimit,
          code,
        );
      return result.changes === 1 ? get(code) : undefined;
    },
    replaceTargetedCountries(code, countries) {
      const row = db.prepare('SELECT id FROM promo_codes WHERE code = ?').get(code) as
        { id: number } | undefined;
      if (!row) throw new Error('Cannot target an unknown promo code');
      db.prepare('DELETE FROM promo_code_countries WHERE promo_code_id = ?').run(row.id);
      const insert = db.prepare(
        'INSERT INTO promo_code_countries (promo_code_id, country) VALUES (?, ?)',
      );
      for (const country of countries) insert.run(row.id, country);
    },
    deactivate(code) {
      const result = db.prepare('UPDATE promo_codes SET active = 0 WHERE code = ?').run(code);
      return result.changes === 1 ? get(code) : undefined;
    },
    activeReservationCount(code) {
      return (
        db
          .prepare('SELECT COUNT(*) AS count FROM promo_reservations WHERE promo_code = ?')
          .get(code) as { count: number }
      ).count;
    },
  };
}
