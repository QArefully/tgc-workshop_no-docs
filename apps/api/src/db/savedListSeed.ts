import { LEGACY_DATA_COUNTRY } from '@shop/contracts';
import type Database from 'better-sqlite3';

const SEED_INSTANT = '2026-08-01T09:00:00.000Z';

const FAVOURITE_SLUGS = [
  'all-purpose-flour',
  'whey-protein-isolate',
  'matcha-green-tea-powder',
] as const;

// These are intentionally ordinary catalog variants. The seed establishes the two unavailable
// states so the list add-to-cart journey always demonstrates partial success on a fresh database.
const MONTHLY_RESTOCK_ITEMS = [
  { sku: 'GDN-1043-001', quantity: 4 }, // added
  { sku: 'SPN-0008-001', quantity: 1 }, // rounded to the four-sack MOQ by list add-to-cart
  { sku: 'SPN-0009-002', quantity: 4 }, // retired below
  { sku: 'SPN-1007-001', quantity: 20 }, // stock is 15
] as const;

function findUserId(db: Database.Database, email: string, country: string): number | undefined {
  const row = db
    .prepare('SELECT id FROM users WHERE email = ? AND country = ?')
    .get(email, country) as { id: number } | undefined;
  return row?.id;
}

/** Installs Alice's deterministic saved-list fixtures without touching buyer-created lists. */
export function seedSavedLists(db: Database.Database): void {
  const aliceId = findUserId(db, 'alice@example.com', LEGACY_DATA_COUNTRY);
  if (aliceId === undefined) return;

  // A retired lot remains addressable for historical lists, but is unavailable to a fresh cart.
  db.prepare(
    `UPDATE product_variants
     SET active = 0, sort_order = 0, updated_at = ?
     WHERE sku = 'SPN-0009-002'`,
  ).run(SEED_INSTANT);

  const insertDefaultList = db.prepare(
    `INSERT INTO saved_lists (user_id, name, is_default, created_at, updated_at)
     SELECT ?, 'Favourites', 1, ?, ?
     WHERE NOT EXISTS (
       SELECT 1 FROM saved_lists WHERE user_id = ? AND is_default = 1
     )`,
  );
  insertDefaultList.run(aliceId, SEED_INSTANT, SEED_INSTANT, aliceId);

  // `created_at` is written once and cannot be changed through the buyer workflow. It identifies
  // this deterministic fixture without treating a buyer's same-named replacement as seed-owned.
  const insertRestockFixture = db.prepare(
    `INSERT OR IGNORE INTO saved_lists (user_id, name, is_default, created_at, updated_at)
     VALUES (?, 'Monthly restock', 0, ?, ?)`,
  );
  insertRestockFixture.run(aliceId, SEED_INSTANT, SEED_INSTANT);

  const findDefaultListId = db.prepare(
    'SELECT id FROM saved_lists WHERE user_id = ? AND is_default = 1',
  );
  const findRestockFixtureId = db.prepare(
    `SELECT id FROM saved_lists
     WHERE user_id = ? AND name = 'Monthly restock' COLLATE NOCASE AND created_at = ?`,
  );
  const favouritesId = (findDefaultListId.get(aliceId) as { id: number } | undefined)?.id;
  const restockId = (findRestockFixtureId.get(aliceId, SEED_INSTANT) as { id: number } | undefined)
    ?.id;
  if (favouritesId === undefined) {
    throw new Error('Saved-list seed default is missing');
  }

  const insertItemBySlug = db.prepare(
    `INSERT INTO saved_list_items (saved_list_id, variant_id, quantity, created_at, updated_at)
     SELECT ?, products.default_variant_id, 4, ?, ?
     FROM products
     WHERE products.slug = ? AND products.default_variant_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM saved_list_items
         WHERE saved_list_id = ? AND variant_id = products.default_variant_id
       )`,
  );
  for (const slug of FAVOURITE_SLUGS) {
    insertItemBySlug.run(favouritesId, SEED_INSTANT, SEED_INSTANT, slug, favouritesId);
  }

  const insertItemBySku = db.prepare(
    `INSERT INTO saved_list_items (saved_list_id, variant_id, quantity, created_at, updated_at)
     SELECT ?, product_variants.id, ?, ?, ?
     FROM product_variants
     WHERE product_variants.sku = ?
       AND NOT EXISTS (
         SELECT 1 FROM saved_list_items
         WHERE saved_list_id = ? AND variant_id = product_variants.id
       )`,
  );
  if (restockId !== undefined) {
    for (const item of MONTHLY_RESTOCK_ITEMS) {
      insertItemBySku.run(
        restockId,
        item.quantity,
        SEED_INSTANT,
        SEED_INSTANT,
        item.sku,
        restockId,
      );
    }
  }
}
