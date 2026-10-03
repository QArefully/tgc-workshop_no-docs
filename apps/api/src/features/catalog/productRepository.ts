import type Database from 'better-sqlite3';
import {
  CATALOG_SPECIFICATION_DEFINITIONS,
  CATALOG_SPECIFICATION_GROUPS,
} from './catalogSpecifications.js';
import type { CatalogSpecificationDefinition } from './catalogSpecifications.js';
import type {
  ProductFilterOptionsResponse,
  ProductQuery,
  ProductSpecificationGroup,
  ProductTag,
} from '@shop/contracts/products';
import {
  availableToSellSql,
  buildCatalogPredicate,
  buildCountryExclusionPredicate,
  catalogOrderBy,
  type CatalogCountryExclusions,
} from './catalogSql.js';
import { normalizeCatalogQuery } from './catalogQuery.js';

export interface ProductRow {
  id: number;
  name: string;
  description: string;
  price_cents: number;
  category: string;
  stock_count: number;
  available_to_sell?: number;
  backorderable?: number;
  backorder_lead_days?: number | null;
  image_set_id: string | null;
  slug: string;
  compare_at_price_cents: number | null;
  sales_count: number;
  active: number;
  created_at: string;
  consumption_classification: string;
  mixing_group: string | null;
  details_json: string | null;
  default_variant_id: number | null;
  blend_source_variant_id: number | null;
  has_active_clearance?: number;
  /** Admin-only annotation; never used as a customer visibility predicate. */
  blocked_in_country?: number;
}

export interface CustomerProductRow extends ProductRow {
  tags: ProductTag[];
  specificationGroups: ProductSpecificationGroup[];
}

export interface VariantRow {
  id: number;
  product_id: number;
  sku: string;
  label: string;
  weight_grams: number;
  price_cents: number;
  moq_sacks: number;
  compare_at_price_cents: number | null;
  clearance_price_cents: number | null;
  clearance_starts_at: string | null;
  clearance_ends_at: string | null;
  stock_count: number;
  backorderable: number;
  backorder_lead_days: number | null;
  delivery_class: string;
  active: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
  /** Admin-only annotation; never used as a customer visibility predicate. */
  blocked_in_country?: number;
}

export interface VariantWithProductRow extends VariantRow {
  product_name: string;
}

export interface ProductList {
  items: CustomerProductRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ProductRepository {
  list(query: ProductQuery, now?: string, exclusions?: CatalogCountryExclusions): ProductList;
  listFilterOptions(exclusions?: CatalogCountryExclusions): ProductFilterOptionsResponse;
  findById(id: number, exclusions?: CatalogCountryExclusions): ProductRow | undefined;
  findActiveById(
    id: number,
    now?: string,
    exclusions?: CatalogCountryExclusions,
  ): CustomerProductRow | undefined;
  listCategories(exclusions?: CatalogCountryExclusions): string[];
  listBestsellers(
    limit?: number,
    now?: string,
    exclusions?: CatalogCountryExclusions,
  ): CustomerProductRow[];
  listByIds(
    ids: readonly number[],
    now?: string,
    exclusions?: CatalogCountryExclusions,
  ): CustomerProductRow[];
  listActiveCandidatesExcluding(
    sourceId: number,
    now?: string,
    exclusions?: CatalogCountryExclusions,
  ): CustomerProductRow[];
  findAllVariants(productId: number, exclusions?: CatalogCountryExclusions): VariantRow[];
  findVariantById(variantId: number, exclusions?: CatalogCountryExclusions): VariantRow | undefined;
  findVariantsByIds(
    variantIds: readonly number[],
    exclusions?: CatalogCountryExclusions,
  ): VariantRow[];
  findVariantsBySkus(
    skus: readonly string[],
    exclusions?: CatalogCountryExclusions,
  ): VariantWithProductRow[];
  findDefaultVariant(
    productId: number,
    exclusions?: CatalogCountryExclusions,
  ): VariantRow | undefined;
}

export function createProductRepository(db: Database.Database): ProductRepository {
  const currentTime = (now?: string): string => now ?? new Date().toISOString();
  const customerColumns = `p.*, ${availableToSellSql} AS available_to_sell`;

  function hydrateCustomerRows(rows: readonly ProductRow[]): CustomerProductRow[] {
    if (rows.length === 0) return [];
    const productIds = [...new Set(rows.map((row) => row.id))];
    const placeholders = productIds.map(() => '?').join(', ');
    const tagRows = db
      .prepare(
        `SELECT pt.product_id, ct.key, ct.label
         FROM product_tags pt
         INNER JOIN catalog_tags ct ON ct.key = pt.tag_key
         WHERE pt.product_id IN (${placeholders})
         ORDER BY ct.label COLLATE NOCASE ASC, ct.key ASC`,
      )
      .all(...productIds) as Array<{ product_id: number; key: string; label: string }>;
    const specificationRows = db
      .prepare(
        `SELECT product_id, specification_key, value_key, display_value
         FROM product_specifications
         WHERE product_id IN (${placeholders})`,
      )
      .all(...productIds) as Array<{
      product_id: number;
      specification_key: string;
      value_key: string;
      display_value: string;
    }>;
    const tagsByProduct = new Map<number, ProductTag[]>();
    for (const tag of tagRows) {
      const tags = tagsByProduct.get(tag.product_id) ?? [];
      tags.push({ key: tag.key, label: tag.label });
      tagsByProduct.set(tag.product_id, tags);
    }
    const specificationsByProduct = new Map<
      number,
      Map<string, ProductSpecificationGroup['specifications']>
    >();
    for (const specification of specificationRows) {
      const definition = (
        CATALOG_SPECIFICATION_DEFINITIONS as readonly CatalogSpecificationDefinition[]
      ).find((candidate) => candidate.key === specification.specification_key);
      if (!definition) continue;
      const productSpecifications =
        specificationsByProduct.get(specification.product_id) ??
        new Map<string, ProductSpecificationGroup['specifications']>();
      const groupSpecifications = productSpecifications.get(definition.group) ?? [];
      groupSpecifications.push({
        key: definition.key,
        label: definition.label,
        valueKey: specification.value_key,
        value: specification.display_value,
      });
      productSpecifications.set(definition.group, groupSpecifications);
      specificationsByProduct.set(specification.product_id, productSpecifications);
    }
    return rows.map((row) => {
      const groupedSpecifications = specificationsByProduct.get(row.id);
      const specificationGroups = CATALOG_SPECIFICATION_GROUPS.flatMap((group) => {
        const specifications = groupedSpecifications?.get(group.key);
        if (!specifications?.length) return [];
        specifications.sort((left, right) => {
          const leftDef = (
            CATALOG_SPECIFICATION_DEFINITIONS as readonly CatalogSpecificationDefinition[]
          ).find((d) => d.key === left.key)!;
          const rightDef = (
            CATALOG_SPECIFICATION_DEFINITIONS as readonly CatalogSpecificationDefinition[]
          ).find((d) => d.key === right.key)!;
          return leftDef.order - rightDef.order || left.key.localeCompare(right.key);
        });
        return [{ key: group.key, label: group.label, order: group.order, specifications }];
      });
      return { ...row, tags: tagsByProduct.get(row.id) ?? [], specificationGroups };
    });
  }

  return {
    list(query, now, exclusions) {
      const at = currentTime(now);
      const normalized = normalizeCatalogQuery(query);
      const predicate = buildCatalogPredicate(normalized, at, exclusions);
      const total = (
        db
          .prepare(`SELECT COUNT(*) AS count FROM products p ${predicate.where}`)
          .get(...predicate.params) as {
          count: number;
        }
      ).count;
      const items = db
        .prepare(
          `SELECT ${customerColumns},
             EXISTS (
               SELECT 1 FROM product_variants pv
               WHERE pv.product_id = p.id
                 AND pv.active = 1
                 AND pv.clearance_price_cents IS NOT NULL
                 AND pv.clearance_price_cents > 0
                 AND pv.clearance_price_cents < pv.price_cents
                 AND pv.clearance_starts_at IS NOT NULL
                 AND pv.clearance_ends_at IS NOT NULL
                 AND julianday(pv.clearance_starts_at) < julianday(pv.clearance_ends_at)
                 AND julianday(pv.clearance_starts_at) <= julianday(?)
                 AND julianday(pv.clearance_ends_at) > julianday(?)
             ) AS has_active_clearance
           FROM products p ${predicate.where} ${catalogOrderBy(normalized.sort)} LIMIT ? OFFSET ?`,
        )
        .all(
          at,
          at,
          at,
          ...predicate.params,
          normalized.pageSize,
          (normalized.page - 1) * normalized.pageSize,
        ) as ProductRow[];
      return {
        items: hydrateCustomerRows(items),
        total,
        page: normalized.page,
        pageSize: normalized.pageSize,
      };
    },
    listFilterOptions(exclusions) {
      const countryExclusions = buildCountryExclusionPredicate(exclusions);
      const tags = db
        .prepare(
          `SELECT DISTINCT ct.key, ct.label
           FROM catalog_tags ct
           INNER JOIN product_tags pt ON pt.tag_key = ct.key
           INNER JOIN products p ON p.id = pt.product_id
           WHERE p.active = 1${countryExclusions.sql}
           ORDER BY ct.label COLLATE NOCASE ASC, ct.key ASC`,
        )
        .all(...countryExclusions.params) as ProductFilterOptionsResponse['tags'];
      const values = db
        .prepare(
          `SELECT DISTINCT ps.specification_key, ps.value_key, ps.display_value
           FROM product_specifications ps
           INNER JOIN products p ON p.id = ps.product_id
           WHERE p.active = 1${countryExclusions.sql}`,
        )
        .all(...countryExclusions.params) as Array<{
        specification_key: string;
        value_key: string;
        display_value: string;
      }>;
      const valuesBySpecification = new Map<string, Map<string, string>>();
      for (const value of values) {
        const definition = (
          CATALOG_SPECIFICATION_DEFINITIONS as readonly CatalogSpecificationDefinition[]
        ).find((candidate) => candidate.key === value.specification_key);
        if (!definition?.filterable) continue;
        const specificationValues =
          valuesBySpecification.get(definition.key) ?? new Map<string, string>();
        specificationValues.set(value.value_key, value.display_value);
        valuesBySpecification.set(definition.key, specificationValues);
      }
      const specificationGroups = CATALOG_SPECIFICATION_GROUPS.flatMap((group) => {
        const specifications = (
          CATALOG_SPECIFICATION_DEFINITIONS as readonly CatalogSpecificationDefinition[]
        ).flatMap((definition) => {
          if (definition.group !== group.key || !definition.filterable) return [];
          const valuesForDefinition = valuesBySpecification.get(definition.key);
          if (!valuesForDefinition?.size) return [];
          return [
            {
              key: definition.key,
              label: definition.label,
              values: [...valuesForDefinition]
                .sort(
                  ([leftKey, leftLabel], [rightKey, rightLabel]) =>
                    leftLabel.localeCompare(rightLabel, undefined, { sensitivity: 'base' }) ||
                    leftKey.localeCompare(rightKey),
                )
                .map(([key, label]) => ({ key, label })),
            },
          ];
        });
        return specifications.length
          ? [{ key: group.key, label: group.label, order: group.order, specifications }]
          : [];
      });
      return { tags, specificationGroups };
    },
    findById(id, exclusions) {
      const countryExclusions = buildCountryExclusionPredicate(exclusions);
      return db
        .prepare(`SELECT p.* FROM products p WHERE p.id = ?${countryExclusions.sql}`)
        .get(id, ...countryExclusions.params) as ProductRow | undefined;
    },
    findActiveById(id, now, exclusions) {
      const countryExclusions = buildCountryExclusionPredicate(exclusions);
      const row = db
        .prepare(
          `SELECT ${customerColumns} FROM products p
           WHERE p.id = ? AND p.active = 1${countryExclusions.sql}`,
        )
        .get(currentTime(now), id, ...countryExclusions.params) as ProductRow | undefined;
      return row ? hydrateCustomerRows([row])[0] : undefined;
    },
    listCategories(exclusions) {
      const countryExclusions = buildCountryExclusionPredicate(exclusions);
      return (
        db
          .prepare(
            `SELECT DISTINCT p.category FROM products p
             WHERE p.active = 1${countryExclusions.sql} ORDER BY p.category ASC`,
          )
          .all(...countryExclusions.params) as {
          category: string;
        }[]
      ).map((row) => row.category);
    },
    listBestsellers(limit = 8, now, exclusions) {
      const countryExclusions = buildCountryExclusionPredicate(exclusions);
      const rows = db
        .prepare(
          `SELECT ${customerColumns} FROM products p
           WHERE p.active = 1 AND p.sales_count >= 250${countryExclusions.sql}
           ORDER BY p.sales_count DESC, p.id ASC LIMIT ?`,
        )
        .all(currentTime(now), ...countryExclusions.params, limit) as ProductRow[];
      return hydrateCustomerRows(rows);
    },
    listByIds(ids, now, exclusions) {
      if (ids.length === 0) return [];
      const placeholders = ids.map(() => '?').join(', ');
      const countryExclusions = buildCountryExclusionPredicate(exclusions);
      const rows = db
        .prepare(
          `SELECT ${customerColumns} FROM products p
           WHERE p.id IN (${placeholders})${countryExclusions.sql}`,
        )
        .all(currentTime(now), ...ids, ...countryExclusions.params) as ProductRow[];
      return hydrateCustomerRows(rows);
    },
    listActiveCandidatesExcluding(sourceId, now, exclusions) {
      const countryExclusions = buildCountryExclusionPredicate(exclusions);
      const rows = db
        .prepare(
          `SELECT ${customerColumns} FROM products p
           WHERE p.active = 1 AND p.id != ?${countryExclusions.sql} ORDER BY p.id ASC`,
        )
        .all(currentTime(now), sourceId, ...countryExclusions.params) as ProductRow[];
      return hydrateCustomerRows(rows);
    },
    findAllVariants(productId, exclusions) {
      const countryExclusions = buildCountryExclusionPredicate(exclusions);
      return db
        .prepare(
          `SELECT v.* FROM product_variants v
           INNER JOIN products p ON p.id = v.product_id
           WHERE v.product_id = ? AND v.active = 1${countryExclusions.sql}
           ORDER BY v.sort_order ASC`,
        )
        .all(productId, ...countryExclusions.params) as VariantRow[];
    },
    findVariantById(variantId, exclusions) {
      const countryExclusions = buildCountryExclusionPredicate(exclusions);
      return db
        .prepare(
          `SELECT v.* FROM product_variants v
           INNER JOIN products p ON p.id = v.product_id
           WHERE v.id = ?${countryExclusions.sql}`,
        )
        .get(variantId, ...countryExclusions.params) as VariantRow | undefined;
    },
    findVariantsByIds(variantIds, exclusions) {
      if (variantIds.length === 0) return [];
      const placeholders = variantIds.map(() => '?').join(', ');
      const countryExclusions = buildCountryExclusionPredicate(exclusions);
      return db
        .prepare(
          `SELECT v.* FROM product_variants v
           INNER JOIN products p ON p.id = v.product_id
           WHERE v.id IN (${placeholders})${countryExclusions.sql}
           ORDER BY v.sort_order ASC`,
        )
        .all(...variantIds, ...countryExclusions.params) as VariantRow[];
    },
    findVariantsBySkus(skus, exclusions) {
      if (skus.length === 0) return [];
      const placeholders = skus.map(() => '?').join(', ');
      const countryExclusions = buildCountryExclusionPredicate(exclusions);
      return db
        .prepare(
          `SELECT v.*, p.name AS product_name
           FROM product_variants v
           INNER JOIN products p ON p.id = v.product_id
           WHERE v.sku IN (${placeholders})${countryExclusions.sql}
           ORDER BY v.id ASC`,
        )
        .all(...skus, ...countryExclusions.params) as VariantWithProductRow[];
    },
    findDefaultVariant(productId, exclusions) {
      const countryExclusions = buildCountryExclusionPredicate(exclusions);
      return db
        .prepare(
          `SELECT v.* FROM product_variants v
           INNER JOIN products p ON p.id = v.product_id
           WHERE v.product_id = ? AND v.sort_order = 1 AND v.active = 1${countryExclusions.sql}
           LIMIT 1`,
        )
        .get(productId, ...countryExclusions.params) as VariantRow | undefined;
    },
  };
}
