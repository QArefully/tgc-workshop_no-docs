import type Database from 'better-sqlite3';
import { MIXING_GROUPS } from '@shop/catalog';

const SACK_WEIGHT_GRAMS = 25_000;
const supportedMixingGroupPlaceholders = MIXING_GROUPS.map(() => '?').join(', ');

/**
 * Repository filters are deliberately limited to presentation search. Compatibility and
 * pigment policy belong to the resolver, not to SQL.
 */
export interface CustomBlendCandidateQuery {
  q?: string;
  category?: string;
}

export interface CustomBlendFactRow {
  product_id: number;
  product_name: string;
  product_description: string;
  category: string;
  product_slug: string;
  consumption_classification: string;
  details_json: string | null;
  mixing_group: string;
  variant_id: number;
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
  variant_active: number;
  sort_order: number;
}

export interface CustomBlendRepository {
  findEligibleVariant(variantId: number): CustomBlendFactRow | undefined;
  /** Returns all eligible 25 kg candidate lots; the resolver applies blend policy. */
  listCandidateFacts(query?: CustomBlendCandidateQuery): CustomBlendFactRow[];
  /** Compatibility-shaped legacy surface; SQL still returns candidates only. */
  listCompatibleIngredients(base: CustomBlendFactRow): CustomBlendFactRow[];
}

const factColumns = `
  p.id AS product_id,
  p.name AS product_name,
  p.description AS product_description,
  p.category,
  p.slug AS product_slug,
  p.consumption_classification,
  p.details_json,
  p.mixing_group,
  pv.id AS variant_id,
  pv.sku,
  pv.label,
  pv.weight_grams,
  pv.price_cents,
  pv.moq_sacks,
  pv.compare_at_price_cents,
  pv.clearance_price_cents,
  pv.clearance_starts_at,
  pv.clearance_ends_at,
  pv.stock_count,
  pv.backorderable,
  pv.backorder_lead_days,
  pv.delivery_class,
  pv.active AS variant_active,
  pv.sort_order`;

const eligibleLotPredicate = `
  p.active = 1
  AND pv.active = 1
  AND pv.sort_order = 1
  AND pv.weight_grams = ${SACK_WEIGHT_GRAMS}
  AND p.mixing_group IN (${supportedMixingGroupPlaceholders})`;

function normalizeCandidateQuery(query?: CustomBlendCandidateQuery): {
  q?: string;
  category?: string;
} {
  if (query === undefined) return {};
  if (typeof query !== 'object' || query === null || Array.isArray(query)) {
    throw new TypeError('Custom Blend candidate query must be an object.');
  }

  const q = typeof query.q === 'string' ? query.q.trim() : undefined;
  const category = typeof query.category === 'string' ? query.category.trim() : undefined;
  if (query.q !== undefined && q === undefined) {
    throw new TypeError('Custom Blend candidate query q must be a string.');
  }
  if (query.category !== undefined && category === undefined) {
    throw new TypeError('Custom Blend candidate query category must be a string.');
  }
  if (q !== undefined && q.length > 200) {
    throw new RangeError('Custom Blend candidate query q is too long.');
  }
  if (category !== undefined && category.length > 100) {
    throw new RangeError('Custom Blend candidate query category is too long.');
  }
  return {
    ...(q ? { q } : {}),
    ...(category ? { category } : {}),
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

/** Resolves only public, active, supported 25 kg Custom Blend lots. */
export function createCustomBlendRepository(db: Database.Database): CustomBlendRepository {
  const listCandidateFacts = (query?: CustomBlendCandidateQuery): CustomBlendFactRow[] => {
    const normalized = normalizeCandidateQuery(query);
    const conditions = [eligibleLotPredicate];
    const params: unknown[] = [...MIXING_GROUPS];
    if (normalized.q) {
      const pattern = `%${escapeLike(normalized.q)}%`;
      conditions.push(
        "(LOWER(p.name) LIKE LOWER(?) ESCAPE '\\' OR LOWER(p.description) LIKE LOWER(?) ESCAPE '\\')",
      );
      params.push(pattern, pattern);
    }
    if (normalized.category) {
      conditions.push('LOWER(p.category) = LOWER(?)');
      params.push(normalized.category);
    }
    return db
      .prepare(
        `SELECT ${factColumns}
         FROM product_variants pv
         INNER JOIN products p ON p.id = pv.product_id
         WHERE ${conditions.join(' AND ')}
         ORDER BY p.mixing_group COLLATE NOCASE ASC,
                  p.name COLLATE NOCASE ASC,
                  pv.id ASC`,
      )
      .all(...params) as CustomBlendFactRow[];
  };

  return {
    findEligibleVariant(variantId) {
      return db
        .prepare(
          `SELECT ${factColumns}
           FROM product_variants pv
           INNER JOIN products p ON p.id = pv.product_id
           WHERE pv.id = ? AND ${eligibleLotPredicate}`,
        )
        .get(variantId, ...MIXING_GROUPS) as CustomBlendFactRow | undefined;
    },
    listCandidateFacts,
    listCompatibleIngredients(base) {
      // Keep this method for the existing options route while making the SQL layer policy-free:
      // the resolver, rather than this query, decides which groups may combine.
      return listCandidateFacts().filter((fact) => fact.variant_id !== base.variant_id);
    },
  };
}
