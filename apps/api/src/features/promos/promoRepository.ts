import type Database from 'better-sqlite3';
import type { Country } from '@shop/contracts/country';

export interface PromoRecord {
  code: string;
  discountPercent: number;
  minItemCount: number;
  active: boolean;
  kind: 'percent' | 'fixed';
  amountCents: number | null;
  minSubtotalCents: number | null;
  categoryScope: string | null;
  startAt: string | null;
  endAt: string | null;
  maxRedemptions: number | null;
  redemptionCount: number;
  perUserLimit: number | null;
  countries?: Country[];
}

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

export interface PromoRepository {
  findByCode(code: string): PromoRecord | undefined;
  targetedCountries(code: string): Country[];
  replaceTargetedCountries(code: string, countries: readonly Country[]): void;
  redemptionCountForUser(code: string, userId: number): number;
  activeReservationCount(code: string): number;
  activeReservationCountForUser(code: string, userId: number): number;
  reserve(input: {
    code: string;
    userId: number | null;
    paymentIdempotencyKey: string;
    createdAt: string;
  }): boolean;
  commitReservation(input: { paymentIdempotencyKey: string; orderId: number }): boolean;
  releaseReservation(paymentIdempotencyKey: string): boolean;
  recordRedemption(input: { code: string; userId: number | null; orderId: number }): void;
}

function toRecord(row: PromoRow, countries: Country[] = []): PromoRecord {
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
    ...(countries.length > 0 ? { countries } : {}),
  };
}

export function createPromoRepository(db: Database.Database): PromoRepository {
  const targetedCountriesForId = (promoCodeId: number): Country[] =>
    db
      .prepare(
        'SELECT country FROM promo_code_countries WHERE promo_code_id = ? ORDER BY rowid ASC',
      )
      .all(promoCodeId)
      .map((row) => (row as { country: Country }).country);

  return {
    findByCode(code) {
      const row = db.prepare('SELECT * FROM promo_codes WHERE code = ?').get(code) as
        PromoRow | undefined;
      return row ? toRecord(row, targetedCountriesForId(row.id)) : undefined;
    },
    targetedCountries(code) {
      const row = db.prepare('SELECT id FROM promo_codes WHERE code = ?').get(code) as
        { id: number } | undefined;
      return row ? targetedCountriesForId(row.id) : [];
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
    redemptionCountForUser(code, userId) {
      return (
        db
          .prepare('SELECT COUNT(*) AS count FROM promo_redemptions WHERE code = ? AND user_id = ?')
          .get(code, userId) as { count: number }
      ).count;
    },
    activeReservationCount(code) {
      return (
        db
          .prepare('SELECT COUNT(*) AS count FROM promo_reservations WHERE promo_code = ?')
          .get(code) as { count: number }
      ).count;
    },
    activeReservationCountForUser(code, userId) {
      return (
        db
          .prepare(
            'SELECT COUNT(*) AS count FROM promo_reservations WHERE promo_code = ? AND user_id = ?',
          )
          .get(code, userId) as { count: number }
      ).count;
    },
    reserve({ code, userId, paymentIdempotencyKey, createdAt }) {
      const result = db
        .prepare(
          `INSERT INTO promo_reservations (promo_code, user_id, payment_idempotency_key, created_at)
           SELECT ?, ?, ?, ?
           WHERE EXISTS (
             SELECT 1 FROM promo_codes
             WHERE code = ?
               AND (max_redemptions IS NULL OR redemption_count +
                 (SELECT COUNT(*) FROM promo_reservations WHERE promo_code = ?) < max_redemptions)
               AND (per_user_limit IS NULL OR (? IS NOT NULL AND
                 (SELECT COUNT(*) FROM promo_redemptions WHERE code = ? AND user_id = ?) +
                 (SELECT COUNT(*) FROM promo_reservations WHERE promo_code = ? AND user_id = ?) < per_user_limit))
           )
           ON CONFLICT(payment_idempotency_key) DO NOTHING`,
        )
        .run(
          code,
          userId,
          paymentIdempotencyKey,
          createdAt,
          code,
          code,
          userId,
          code,
          userId,
          code,
          userId,
        );
      if (result.changes === 1) return true;
      return (
        db
          .prepare(
            `SELECT 1 FROM promo_reservations
             WHERE payment_idempotency_key = ? AND promo_code = ? AND user_id IS ?`,
          )
          .get(paymentIdempotencyKey, code, userId) !== undefined
      );
    },
    commitReservation({ paymentIdempotencyKey, orderId }) {
      const reservation = db
        .prepare(
          `SELECT promo_code, user_id FROM promo_reservations
           WHERE payment_idempotency_key = ?`,
        )
        .get(paymentIdempotencyKey) as { promo_code: string; user_id: number | null } | undefined;
      if (!reservation) return false;
      db.prepare('INSERT INTO promo_redemptions (code, user_id, order_id) VALUES (?, ?, ?)').run(
        reservation.promo_code,
        reservation.user_id,
        orderId,
      );
      db.prepare(
        'UPDATE promo_codes SET redemption_count = redemption_count + 1 WHERE code = ?',
      ).run(reservation.promo_code);
      db.prepare('DELETE FROM promo_reservations WHERE payment_idempotency_key = ?').run(
        paymentIdempotencyKey,
      );
      return true;
    },
    releaseReservation(paymentIdempotencyKey) {
      return (
        db
          .prepare('DELETE FROM promo_reservations WHERE payment_idempotency_key = ?')
          .run(paymentIdempotencyKey).changes > 0
      );
    },
    recordRedemption({ code, userId, orderId }) {
      db.prepare('INSERT INTO promo_redemptions (code, user_id, order_id) VALUES (?, ?, ?)').run(
        code,
        userId,
        orderId,
      );
      db.prepare(
        'UPDATE promo_codes SET redemption_count = redemption_count + 1 WHERE code = ?',
      ).run(code);
    },
  };
}
