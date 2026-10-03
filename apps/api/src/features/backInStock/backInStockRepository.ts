import type Database from 'better-sqlite3';
import type { BackInStockStatus } from '@shop/contracts/back-in-stock';
import type { Country } from '@shop/contracts/country';

export interface BackInStockRow {
  id: number;
  user_id: number;
  variant_id: number;
  status: BackInStockStatus;
  requested_at: string;
  notified_at: string | null;
  cancelled_at: string | null;
  notification_id: number | null;
  created_at: string;
  updated_at: string;
}

/** Subscription row joined with the catalog facts a buyer-facing list needs. */
export interface BackInStockSubscriptionRow extends BackInStockRow {
  sku: string;
  label: string;
  product_id: number;
  product_name: string;
  product_category: string;
  product_slug: string;
  weight_grams: number;
  moq_sacks: number;
  active: number;
}

/** Catalog facts required to judge and render one subscription target. */
export interface BackInStockVariantFacts {
  variant_id: number;
  sku: string;
  label: string;
  product_id: number;
  product_name: string;
  product_category: string;
  product_slug: string;
  weight_grams: number;
  moq_sacks: number;
  active: number;
}

export interface BackInStockRepository {
  insert(input: { userId: number; variantId: number; now: string }): BackInStockRow;
  findPending(userId: number, variantId: number): BackInStockRow | undefined;
  findOwned(subscriptionId: number, userId: number): BackInStockSubscriptionRow | undefined;
  listOwned(userId: number, status?: BackInStockStatus): BackInStockSubscriptionRow[];
  countPending(userId: number): number;
  hasPendingForVariant(variantId: number): boolean;
  listPendingForVariant(variantId: number): BackInStockRow[];
  markNotified(id: number, notificationId: number | null, at: string): void;
  markCancelled(id: number, at: string): void;
  variantFacts(variantId: number): BackInStockVariantFacts | undefined;
  userCountry(userId: number): Country | undefined;
}

const SUBSCRIPTION_COLUMNS = `id, user_id, variant_id, status, requested_at, notified_at,
  cancelled_at, notification_id, created_at, updated_at`;
const SUBSCRIPTION_COLUMNS_WITH_ALIAS = `s.id, s.user_id, s.variant_id, s.status, s.requested_at,
  s.notified_at, s.cancelled_at, s.notification_id, s.created_at, s.updated_at`;
const VARIANT_FACT_COLUMNS = `v.sku, v.label, v.weight_grams, v.moq_sacks, v.active,
  p.id AS product_id, p.name AS product_name, p.category AS product_category,
  p.slug AS product_slug`;
/** Newest interest first; the id tiebreak keeps same-instant rows deterministically ordered. */
const SUBSCRIPTION_ORDER = 'ORDER BY s.requested_at DESC, s.id DESC';

/** Owns SQL and row types for back-in-stock subscriptions. Creates no transaction. */
export function createBackInStockRepository(db: Database.Database): BackInStockRepository {
  const joinedSelect = `SELECT ${SUBSCRIPTION_COLUMNS_WITH_ALIAS}, ${VARIANT_FACT_COLUMNS}
    FROM back_in_stock_subscriptions s
    JOIN product_variants v ON v.id = s.variant_id
    JOIN products p ON p.id = v.product_id`;
  return {
    insert({ userId, variantId, now }) {
      const result = db
        .prepare(
          `INSERT INTO back_in_stock_subscriptions
             (user_id, variant_id, status, requested_at, created_at, updated_at)
           VALUES (?, ?, 'pending', ?, ?, ?)`,
        )
        .run(userId, variantId, now, now, now);
      return db
        .prepare(`SELECT ${SUBSCRIPTION_COLUMNS} FROM back_in_stock_subscriptions WHERE id = ?`)
        .get(Number(result.lastInsertRowid)) as BackInStockRow;
    },
    findPending(userId, variantId) {
      return db
        .prepare(
          `SELECT ${SUBSCRIPTION_COLUMNS} FROM back_in_stock_subscriptions
           WHERE user_id = ? AND variant_id = ? AND status = 'pending'`,
        )
        .get(userId, variantId) as BackInStockRow | undefined;
    },
    findOwned(subscriptionId, userId) {
      return db
        .prepare(`${joinedSelect} WHERE s.id = ? AND s.user_id = ?`)
        .get(subscriptionId, userId) as BackInStockSubscriptionRow | undefined;
    },
    listOwned(userId, status) {
      return status === undefined
        ? (db
            .prepare(`${joinedSelect} WHERE s.user_id = ? ${SUBSCRIPTION_ORDER}`)
            .all(userId) as BackInStockSubscriptionRow[])
        : (db
            .prepare(`${joinedSelect} WHERE s.user_id = ? AND s.status = ? ${SUBSCRIPTION_ORDER}`)
            .all(userId, status) as BackInStockSubscriptionRow[]);
    },
    countPending(userId) {
      return (
        db
          .prepare(
            `SELECT COUNT(*) AS total FROM back_in_stock_subscriptions
             WHERE user_id = ? AND status = 'pending'`,
          )
          .get(userId) as { total: number }
      ).total;
    },
    hasPendingForVariant(variantId) {
      return (
        db
          .prepare(
            `SELECT 1 AS found FROM back_in_stock_subscriptions
             WHERE variant_id = ? AND status = 'pending' LIMIT 1`,
          )
          .get(variantId) !== undefined
      );
    },
    listPendingForVariant(variantId) {
      return db
        .prepare(
          `SELECT ${SUBSCRIPTION_COLUMNS} FROM back_in_stock_subscriptions
           WHERE variant_id = ? AND status = 'pending'
           ORDER BY requested_at ASC, id ASC`,
        )
        .all(variantId) as BackInStockRow[];
    },
    markNotified(id, notificationId, at) {
      db.prepare(
        `UPDATE back_in_stock_subscriptions
         SET status = 'notified', notified_at = ?, notification_id = ?, updated_at = ?
         WHERE id = ? AND status = 'pending'`,
      ).run(at, notificationId, at, id);
    },
    markCancelled(id, at) {
      db.prepare(
        `UPDATE back_in_stock_subscriptions
         SET status = 'cancelled', cancelled_at = ?, updated_at = ?
         WHERE id = ? AND status = 'pending'`,
      ).run(at, at, id);
    },
    variantFacts(variantId) {
      return db
        .prepare(
          `SELECT v.id AS variant_id, ${VARIANT_FACT_COLUMNS}
           FROM product_variants v JOIN products p ON p.id = v.product_id
           WHERE v.id = ?`,
        )
        .get(variantId) as BackInStockVariantFacts | undefined;
    },
    userCountry(userId) {
      return db.prepare('SELECT country FROM users WHERE id = ?').pluck().get(userId) as
        Country | undefined;
    },
  };
}
