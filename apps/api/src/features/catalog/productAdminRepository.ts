import type Database from 'better-sqlite3';
import type { ProductRow } from './productRepository.js';
import type { CatalogCountryExclusions } from './catalogSql.js';

export type ProductAdminInsert = Pick<
  ProductRow,
  | 'name'
  | 'description'
  | 'price_cents'
  | 'category'
  | 'stock_count'
  | 'image_set_id'
  | 'slug'
  | 'compare_at_price_cents'
  | 'consumption_classification'
  | 'mixing_group'
  | 'details_json'
> & { created_at: string };

export type ProductAdminUpdate = Partial<
  Pick<
    ProductRow,
    | 'name'
    | 'description'
    | 'price_cents'
    | 'category'
    | 'stock_count'
    | 'image_set_id'
    | 'slug'
    | 'compare_at_price_cents'
    | 'consumption_classification'
    | 'mixing_group'
    | 'details_json'
  >
>;

export interface ProductAdminRepository {
  list(includeRetired: boolean, exclusions?: CatalogCountryExclusions): ProductRow[];
  findById(id: number, exclusions?: CatalogCountryExclusions): ProductRow | undefined;
  findByCategoryAndSlug(category: string, slug: string): ProductRow | undefined;
  insert(input: ProductAdminInsert): ProductRow;
  update(id: number, patch: ProductAdminUpdate): void;
  retire(id: number): void;
  hasOrderReferences(productId: number): boolean;
}

const writeColumns = [
  'name',
  'description',
  'price_cents',
  'category',
  'stock_count',
  'image_set_id',
  'slug',
  'compare_at_price_cents',
  'consumption_classification',
  'mixing_group',
  'details_json',
] as const;

/** Catalog admin SQL surface. Deliberately has no DELETE operation: orders retain product history. */
export function createProductAdminRepository(db: Database.Database): ProductAdminRepository {
  const blockedSelect = (
    exclusions?: CatalogCountryExclusions,
  ): { expression: string; params: string[] } => {
    if (
      !exclusions ||
      (exclusions.blockedCategories.length === 0 && exclusions.blockedSlugs.length === 0)
    )
      return { expression: '0 AS blocked_in_country', params: [] };
    const categories = exclusions.blockedCategories.map(() => '?').join(', ');
    const slugs = exclusions.blockedSlugs.map(() => '?').join(', ');
    return {
      expression: `CASE WHEN p.category IN (${categories}) OR p.slug IN (${slugs}) THEN 1 ELSE 0 END AS blocked_in_country`,
      params: [...exclusions.blockedCategories, ...exclusions.blockedSlugs],
    };
  };
  return {
    list(includeRetired, exclusions) {
      const blocked = blockedSelect(exclusions);
      return db
        .prepare(
          `SELECT p.*, ${blocked.expression} FROM products p${includeRetired ? '' : ' WHERE p.active = 1'}
           ORDER BY category COLLATE NOCASE ASC, name COLLATE NOCASE ASC, id ASC`,
        )
        .all(...blocked.params) as ProductRow[];
    },
    findById(id, exclusions) {
      const blocked = blockedSelect(exclusions);
      return db
        .prepare(`SELECT p.*, ${blocked.expression} FROM products p WHERE p.id = ?`)
        .get(...blocked.params, id) as ProductRow | undefined;
    },
    findByCategoryAndSlug(category, slug) {
      return db
        .prepare('SELECT * FROM products WHERE category = ? AND slug = ? LIMIT 1')
        .get(category, slug) as ProductRow | undefined;
    },
    insert(input) {
      const result = db
        .prepare(
          `INSERT INTO products
            (name, description, price_cents, category, stock_count, image_set_id, slug,
             compare_at_price_cents, consumption_classification, mixing_group, details_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.name,
          input.description,
          input.price_cents,
          input.category,
          input.stock_count,
          input.image_set_id,
          input.slug,
          input.compare_at_price_cents,
          input.consumption_classification,
          input.mixing_group,
          input.details_json,
          input.created_at,
        );
      return this.findById(Number(result.lastInsertRowid))!;
    },
    update(id, patch) {
      const entries = writeColumns.flatMap((column) =>
        patch[column] === undefined ? [] : [[column, patch[column]] as const],
      );
      if (entries.length === 0) return;
      const assignments = entries.map(([column]) => `${column} = ?`).join(', ');
      db.prepare(`UPDATE products SET ${assignments} WHERE id = ?`).run(
        ...entries.map(([, value]) => value),
        id,
      );
    },
    retire(id) {
      db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(id);
    },
    hasOrderReferences(productId) {
      const row = db
        .prepare('SELECT EXISTS(SELECT 1 FROM order_line_items WHERE product_id = ?) AS exists_ref')
        .get(productId) as { exists_ref: number };
      return row.exists_ref === 1;
    },
  };
}
