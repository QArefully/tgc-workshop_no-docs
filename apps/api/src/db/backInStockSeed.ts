import { LEGACY_DATA_COUNTRY } from '@shop/contracts';
import type Database from 'better-sqlite3';

/** Fixed instant for every back-in-stock seed row, so repeat seeds stay byte-identical. */
const BACK_IN_STOCK_SEED_INSTANT = '2026-08-02T09:00:00.000Z';

/**
 * The seeded sold-out lot: the pallet lot of Plaster of Paris. Its `sort_order` is 2, so it is
 * never the product's default variant — the sack lot stays stocked and the product stays
 * purchasable while this lot reads as sold out. It is active and not backorderable, which is
 * exactly the state that makes a back-in-stock subscription the only way to express interest.
 */
const SOLD_OUT_SKU = 'TCM-0034-002';

/** The buyer holding the seeded pending subscription. */
const SUBSCRIBER_EMAIL = 'alice@example.com';

function findUserId(db: Database.Database, email: string, country: string): number | undefined {
  const row = db
    .prepare('SELECT id FROM users WHERE email = ? AND country = ?')
    .get(email, country) as { id: number } | undefined;
  return row?.id;
}

function findVariantId(db: Database.Database, sku: string): number | undefined {
  const row = db.prepare('SELECT id FROM product_variants WHERE sku = ?').get(sku) as
    { id: number } | undefined;
  return row?.id;
}

/**
 * Installs the deterministic back-in-stock starting state: one sold-out lot and one pending
 * subscription against it.
 *
 * The stock write runs after the canonical catalog upsert, which restores the catalog stock count
 * on every seed, so the sold-out state is re-established rather than accumulated. The subscription
 * insert is guarded on the absence of *any* row for the pair, so a buyer's own subscription is
 * never clobbered and a cancelled or notified row is never resurrected as pending.
 */
export function seedBackInStock(db: Database.Database): void {
  const subscriberId = findUserId(db, SUBSCRIBER_EMAIL, LEGACY_DATA_COUNTRY);
  if (subscriberId === undefined) return;
  const variantId = findVariantId(db, SOLD_OUT_SKU);
  if (variantId === undefined) return;

  db.prepare(
    `UPDATE product_variants
     SET stock_count = 0, updated_at = ?
     WHERE sku = ?`,
  ).run(BACK_IN_STOCK_SEED_INSTANT, SOLD_OUT_SKU);

  db.prepare(
    `INSERT INTO back_in_stock_subscriptions
       (user_id, variant_id, status, requested_at, notified_at, cancelled_at, notification_id,
        created_at, updated_at)
     SELECT ?, ?, 'pending', ?, NULL, NULL, NULL, ?, ?
     WHERE NOT EXISTS (
       SELECT 1 FROM back_in_stock_subscriptions WHERE user_id = ? AND variant_id = ?
     )`,
  ).run(
    subscriberId,
    variantId,
    BACK_IN_STOCK_SEED_INSTANT,
    BACK_IN_STOCK_SEED_INSTANT,
    BACK_IN_STOCK_SEED_INSTANT,
    subscriberId,
    variantId,
  );
}
