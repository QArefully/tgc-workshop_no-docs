import type { Migration } from '../migrate.js';

/** Stores fixed curated-bundle headers and their product-only components. */
export const curatedBundlesMigration: Migration = {
  version: '012',
  name: 'curated bundles',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS curated_bundles (
        id INTEGER PRIMARY KEY,
        key TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        sort_order INTEGER NOT NULL UNIQUE CHECK (sort_order > 0)
      );

      CREATE TABLE IF NOT EXISTS curated_bundle_components (
        bundle_id INTEGER NOT NULL REFERENCES curated_bundles(id) ON DELETE CASCADE,
        product_id INTEGER NOT NULL REFERENCES products(id),
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        sort_order INTEGER NOT NULL CHECK (sort_order > 0),
        PRIMARY KEY (bundle_id, product_id),
        UNIQUE (bundle_id, sort_order)
      );

      CREATE INDEX IF NOT EXISTS curated_bundle_components_product_bundle_idx
        ON curated_bundle_components(product_id, bundle_id);
    `);
  },
};
