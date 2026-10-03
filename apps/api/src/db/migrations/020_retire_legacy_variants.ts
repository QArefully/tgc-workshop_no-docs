import type { Migration } from '../migrate.js';

/**
 * Retires the `sort_order 0` legacy variants that `018`'s backfill created for every
 * pre-existing product. Those rows violate the contract's `sortOrder >= 1` minimum and, once a
 * product has gained a real canonical variant (`sort_order >= 1`), are dead weight that still
 * surfaces through the active-variant read path.
 *
 * Deactivation only, never deletion: legacy variant ids are referenced by
 * `cart_line_items`, `inventory_reservations`, `order_inventory_allocations`, and
 * `inventory_stock_movements` (the last carries ABORT triggers on UPDATE/DELETE, so it is never
 * touched here). A product whose only variant is the legacy row is left untouched and stays
 * purchasable through it.
 */
export const retireLegacyVariantsMigration: Migration = {
  version: '020',
  name: 'retire legacy variants',
  up(db) {
    // -----------------------------------------------------------------------
    // 1. Find legacy variants safe to retire: sort_order < 1, currently active, whose product
    //    already owns at least one active canonical (sort_order >= 1) variant.
    // -----------------------------------------------------------------------
    const legacyVariantIds = (
      db
        .prepare(
          `SELECT v.id FROM product_variants v
           WHERE v.sort_order < 1
             AND v.active = 1
             AND EXISTS (
               SELECT 1 FROM product_variants c
               WHERE c.product_id = v.product_id AND c.sort_order >= 1 AND c.active = 1
             )`,
        )
        .all() as { id: number }[]
    ).map((row) => row.id);

    if (legacyVariantIds.length > 0) {
      const placeholders = legacyVariantIds.map(() => '?').join(', ');

      // -----------------------------------------------------------------------
      // 2. Deactivate the legacy rows. Rows and every FK reference stay intact.
      // -----------------------------------------------------------------------
      db.prepare(
        `UPDATE product_variants
         SET active = 0, updated_at = datetime('now')
         WHERE id IN (${placeholders})`,
      ).run(...legacyVariantIds);

      // -----------------------------------------------------------------------
      // 3. Repoint products.default_variant_id off any legacy variant just retired, to that
      //    product's lowest-sort_order remaining active variant.
      // -----------------------------------------------------------------------
      db.prepare(
        `UPDATE products
         SET default_variant_id = (
           SELECT id FROM product_variants
           WHERE product_id = products.id AND active = 1
           ORDER BY sort_order ASC LIMIT 1
         )
         WHERE default_variant_id IN (${placeholders})`,
      ).run(...legacyVariantIds);
    }

    // -----------------------------------------------------------------------
    // 4. Validate. Runs unconditionally so a no-op re-run still asserts the invariant holds.
    // -----------------------------------------------------------------------
    const remainingLegacyActive = (
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM product_variants v
           WHERE v.sort_order < 1
             AND v.active = 1
             AND EXISTS (
               SELECT 1 FROM product_variants c
               WHERE c.product_id = v.product_id AND c.sort_order >= 1 AND c.active = 1
             )`,
        )
        .get() as { count: number }
    ).count;
    if (remainingLegacyActive > 0) {
      throw new Error(
        `${remainingLegacyActive} legacy (sort_order < 1) variants remain active for products that own a canonical variant`,
      );
    }

    const danglingDefaults = (
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM products p
           WHERE p.default_variant_id IS NULL
              OR NOT EXISTS (
                SELECT 1 FROM product_variants v
                WHERE v.id = p.default_variant_id AND v.active = 1
              )`,
        )
        .get() as { count: number }
    ).count;
    if (danglingDefaults > 0) {
      throw new Error(
        `${danglingDefaults} products have default_variant_id referencing an inactive or missing variant`,
      );
    }

    const fkViolations = db.pragma('foreign_key_check') as unknown[];
    if (fkViolations && fkViolations.length > 0) {
      throw new Error(
        `Foreign key violations after v20 migration: ${JSON.stringify(fkViolations)}`,
      );
    }
  },
};
