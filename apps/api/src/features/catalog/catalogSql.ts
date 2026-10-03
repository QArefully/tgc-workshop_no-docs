import type { NormalizedCatalogQuery } from './catalogQuery.js';

export interface CatalogPredicate {
  where: string;
  params: readonly unknown[];
}

export interface CatalogCountryExclusions {
  blockedCategories: readonly string[];
  blockedSlugs: readonly string[];
}

const NO_COUNTRY_EXCLUSIONS: CatalogCountryExclusions = {
  blockedCategories: [],
  blockedSlugs: [],
};

/** Builds bound country clauses for SQL statements whose product alias is fixed as `p`. */
export function buildCountryExclusionPredicate(
  exclusions: CatalogCountryExclusions = NO_COUNTRY_EXCLUSIONS,
): { sql: string; params: readonly string[] } {
  const conditions: string[] = [];
  const params: string[] = [];
  if (exclusions.blockedCategories.length > 0) {
    conditions.push(
      `p.category NOT IN (${exclusions.blockedCategories.map(() => '?').join(', ')})`,
    );
    params.push(...exclusions.blockedCategories);
  }
  if (exclusions.blockedSlugs.length > 0) {
    conditions.push(`p.slug NOT IN (${exclusions.blockedSlugs.map(() => '?').join(', ')})`);
    params.push(...exclusions.blockedSlugs);
  }
  return {
    sql: conditions.length > 0 ? ` AND ${conditions.join(' AND ')}` : '',
    params,
  };
}

/**
 * Bound-time available-to-sell expression. `p` is intentionally fixed so no
 * caller can introduce a dynamic SQL identifier.
 */
export const availableToSellSql = `COALESCE((
  SELECT SUM(MAX(0, v.stock_count - COALESCE(reserved.total_reserved, 0)))
  FROM product_variants v
  LEFT JOIN (
    SELECT r.variant_id, SUM(r.reserved_quantity) AS total_reserved
    FROM inventory_reservations r
    WHERE r.expires_at IS NULL OR r.expires_at > ?
    GROUP BY r.variant_id
  ) reserved ON reserved.variant_id = v.id
  WHERE v.product_id = p.id AND v.active = 1
), 0)`;

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

/** Builds one active-first predicate shared exactly by catalog count and list queries. */
export function buildCatalogPredicate(
  query: NormalizedCatalogQuery,
  now: string,
  exclusions: CatalogCountryExclusions = NO_COUNTRY_EXCLUSIONS,
): CatalogPredicate {
  const conditions: string[] = ['p.active = 1'];
  const params: unknown[] = [];
  const countryExclusions = buildCountryExclusionPredicate(exclusions);
  if (countryExclusions.sql) {
    conditions.push(countryExclusions.sql.slice(' AND '.length));
    params.push(...countryExclusions.params);
  }
  if (query.q) {
    const escaped = escapeLike(query.q);
    conditions.push("(p.name LIKE ? ESCAPE '\\' OR p.description LIKE ? ESCAPE '\\')");
    params.push(`%${escaped}%`, `%${escaped}%`);
  }
  if (query.category) {
    conditions.push('LOWER(p.category) = LOWER(?)');
    params.push(query.category);
  }
  if (query.onSale) {
    conditions.push(`(
      p.compare_at_price_cents IS NOT NULL
      OR EXISTS (
        SELECT 1
        FROM product_variants pv
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
      )
    )`);
    params.push(now, now);
  }
  if (query.minPriceCents !== undefined) {
    conditions.push('p.price_cents >= ?');
    params.push(query.minPriceCents);
  }
  if (query.maxPriceCents !== undefined) {
    conditions.push('p.price_cents <= ?');
    params.push(query.maxPriceCents);
  }
  if (query.addedFrom) {
    conditions.push('julianday(p.created_at) >= julianday(?)');
    params.push(`${query.addedFrom}T00:00:00.000Z`);
  }
  if (query.addedTo) {
    conditions.push('julianday(p.created_at) <= julianday(?)');
    params.push(`${query.addedTo}T23:59:59.999Z`);
  }
  for (const tag of query.tags) {
    conditions.push(
      'EXISTS (SELECT 1 FROM product_tags pt WHERE pt.product_id = p.id AND pt.tag_key = ?)',
    );
    params.push(tag);
  }
  for (const specification of query.specifications) {
    conditions.push(
      'EXISTS (SELECT 1 FROM product_specifications ps WHERE ps.product_id = p.id AND ps.specification_key = ? AND ps.value_key = ?)',
    );
    params.push(specification.key, specification.valueKey);
  }
  if (query.availability === 'available') {
    conditions.push(`${availableToSellSql} > 0`);
    params.push(now);
  }
  if (query.availability === 'backorder') {
    conditions.push(`${availableToSellSql} = 0 AND p.backorderable = 1`);
    params.push(now);
  }
  if (query.availability === 'out_of_stock') {
    conditions.push(`${availableToSellSql} = 0 AND p.backorderable = 0`);
    params.push(now);
  }
  return { where: `WHERE ${conditions.join(' AND ')}`, params };
}

const ORDER_BY = {
  newest: 'ORDER BY p.created_at DESC, p.id ASC',
  oldest: 'ORDER BY p.created_at ASC, p.id ASC',
  name_asc: 'ORDER BY p.name COLLATE NOCASE ASC, p.id ASC',
  price_asc: 'ORDER BY p.price_cents ASC, p.id ASC',
  price_desc: 'ORDER BY p.price_cents DESC, p.id ASC',
  bestselling: 'ORDER BY p.sales_count DESC, p.id ASC',
} as const;

/** SQL identifier selection remains entirely allowlisted. */
export function catalogOrderBy(sort: NormalizedCatalogQuery['sort']): string {
  return ORDER_BY[sort];
}
