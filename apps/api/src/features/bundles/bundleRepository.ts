import type Database from 'better-sqlite3';
import type { ProductRow } from '../catalog/productRepository.js';

export interface BundleComponentRow {
  productId: number;
  variantId: number | null;
  quantity: number;
  sortOrder: number;
  product: ProductRow | undefined;
}

/** Persisted bundle definition. Product rows intentionally include inactive state for add validation. */
export interface BundleRow {
  id: number;
  key: string;
  name: string;
  description: string;
  active: number;
  sortOrder: number;
  components: BundleComponentRow[];
}

export interface BundleRepository {
  /** Lists persisted bundles, optionally constrained to bundles containing one product. */
  list(productId?: string): BundleRow[];
  /** Internal lookup; does not hide inactive bundles or components. */
  findById(bundleId: string): BundleRow | undefined;
}

type BundleJoinRow = ProductRow & {
  bundle_id: number;
  bundle_key: string;
  bundle_name: string;
  bundle_description: string;
  bundle_active: number;
  bundle_sort_order: number;
  component_product_id: number | null;
  component_variant_id: number | null;
  component_quantity: number | null;
  component_sort_order: number | null;
};

const bundleColumns = `
  b.id AS bundle_id,
  b.key AS bundle_key,
  b.name AS bundle_name,
  b.description AS bundle_description,
  b.active AS bundle_active,
  b.sort_order AS bundle_sort_order,
  c.product_id AS component_product_id,
  c.variant_id AS component_variant_id,
  c.quantity AS component_quantity,
  c.sort_order AS component_sort_order,
  p.*`;

function hydrateBundles(rows: readonly BundleJoinRow[]): BundleRow[] {
  const bundles = new Map<number, BundleRow>();
  for (const row of rows) {
    let bundle = bundles.get(row.bundle_id);
    if (!bundle) {
      bundle = {
        id: row.bundle_id,
        key: row.bundle_key,
        name: row.bundle_name,
        description: row.bundle_description,
        active: row.bundle_active,
        sortOrder: row.bundle_sort_order,
        components: [],
      };
      bundles.set(bundle.id, bundle);
    }
    if (
      row.component_product_id === null ||
      row.component_variant_id === null ||
      row.component_quantity === null ||
      row.component_sort_order === null
    ) {
      continue;
    }
    bundle.components.push({
      productId: row.component_product_id,
      variantId: row.component_variant_id,
      quantity: row.component_quantity,
      sortOrder: row.component_sort_order,
      product:
        row.id === null
          ? undefined
          : {
              id: row.id,
              name: row.name,
              description: row.description,
              price_cents: row.price_cents,
              category: row.category,
              stock_count: row.stock_count,
              image_set_id: row.image_set_id,
              slug: row.slug,
              compare_at_price_cents: row.compare_at_price_cents,
              sales_count: row.sales_count,
              active: row.active,
              created_at: row.created_at,
              consumption_classification: row.consumption_classification,
              mixing_group: row.mixing_group,
              details_json: row.details_json,
              default_variant_id: row.default_variant_id,
              blend_source_variant_id: row.blend_source_variant_id,
            },
    });
  }
  return [...bundles.values()];
}

/** Direct curated-bundle storage. Callers own customer visibility and transaction rules. */
export function createBundleRepository(db: Database.Database): BundleRepository {
  const listAll = db.prepare(`
    SELECT ${bundleColumns}
    FROM curated_bundles b
    LEFT JOIN curated_bundle_components c ON c.bundle_id = b.id
    LEFT JOIN products p ON p.id = c.product_id
    ORDER BY b.sort_order ASC, b.id ASC, c.sort_order ASC, c.product_id ASC
  `);
  const listForProduct = db.prepare(`
    SELECT ${bundleColumns}
    FROM curated_bundles b
    INNER JOIN curated_bundle_components filter_component
      ON filter_component.bundle_id = b.id AND filter_component.product_id = ?
    LEFT JOIN curated_bundle_components c ON c.bundle_id = b.id
    LEFT JOIN products p ON p.id = c.product_id
    ORDER BY b.sort_order ASC, b.id ASC, c.sort_order ASC, c.product_id ASC
  `);
  const find = db.prepare(`
    SELECT ${bundleColumns}
    FROM curated_bundles b
    LEFT JOIN curated_bundle_components c ON c.bundle_id = b.id
    LEFT JOIN products p ON p.id = c.product_id
    WHERE b.id = ?
    ORDER BY c.sort_order ASC, c.product_id ASC
  `);

  return {
    list(productId) {
      const rows = (
        productId === undefined ? listAll.all() : listForProduct.all(productId)
      ) as BundleJoinRow[];
      return hydrateBundles(rows);
    },
    findById(bundleId) {
      const bundles = hydrateBundles(find.all(bundleId) as BundleJoinRow[]);
      return bundles[0];
    },
  };
}
