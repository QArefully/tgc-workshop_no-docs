import type Database from 'better-sqlite3';
import type { VariantRow } from './productRepository.js';
import type { CatalogCountryExclusions } from './catalogSql.js';

export interface CreateVariantRecord {
  productId: number;
  sku: string;
  label: string;
  weightGrams: number;
  priceCents: number;
  stockCount: number;
  backorderable: boolean;
  backorderLeadDays: number | null;
  deliveryClass: 'parcel' | 'freight';
  sortOrder: number;
  moqSacks: number;
  createdAt: string;
}

export interface UpdateVariantRecord {
  sku?: string;
  label?: string;
  weightGrams?: number;
  priceCents?: number;
  stockCount?: number;
  backorderable?: boolean;
  backorderLeadDays?: number | null;
  deliveryClass?: 'parcel' | 'freight';
  sortOrder?: number;
  moqSacks?: number;
  updatedAt: string;
}

export interface ClearanceRecord {
  priceCents: number;
  startsAt: string;
  endsAt: string;
  updatedAt: string;
}

export interface VariantAdminRepository {
  listAdmin(productId: number, exclusions?: CatalogCountryExclusions): VariantRow[];
  findById(id: number): VariantRow | undefined;
  findActiveReplacement(productId: number, retiredId: number): VariantRow | undefined;
  create(input: CreateVariantRecord): VariantRow;
  update(id: number, input: UpdateVariantRecord): VariantRow | undefined;
  retire(id: number, updatedAt: string): VariantRow | undefined;
  replaceDefaultVariant(productId: number, retiredId: number, replacementId: number): void;
  setClearance(
    id: number,
    clearance: ClearanceRecord | null,
    updatedAt: string,
  ): VariantRow | undefined;
  orderReferenceCount(id: number): number;
}

export function createVariantAdminRepository(db: Database.Database): VariantAdminRepository {
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
  const findById = (id: number): VariantRow | undefined =>
    db.prepare('SELECT * FROM product_variants WHERE id = ?').get(id) as VariantRow | undefined;

  return {
    listAdmin(productId, exclusions) {
      const blocked = blockedSelect(exclusions);
      return db
        .prepare(
          `SELECT v.*, ${blocked.expression} FROM product_variants v
           INNER JOIN products p ON p.id = v.product_id
           WHERE v.product_id = ? ORDER BY v.active DESC, v.sort_order ASC, v.id ASC`,
        )
        .all(...blocked.params, productId) as VariantRow[];
    },
    findById,
    findActiveReplacement(productId, retiredId) {
      return db
        .prepare(
          `SELECT * FROM product_variants
           WHERE product_id = ? AND id != ? AND active = 1
           ORDER BY sort_order ASC, id ASC LIMIT 1`,
        )
        .get(productId, retiredId) as VariantRow | undefined;
    },
    create(input) {
      const result = db
        .prepare(
          `INSERT INTO product_variants
            (product_id, sku, label, weight_grams, price_cents, stock_count, backorderable,
             backorder_lead_days, delivery_class, active, sort_order, moq_sacks, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
        )
        .run(
          input.productId,
          input.sku,
          input.label,
          input.weightGrams,
          input.priceCents,
          input.stockCount,
          input.backorderable ? 1 : 0,
          input.backorderable ? input.backorderLeadDays : null,
          input.deliveryClass,
          input.sortOrder,
          input.moqSacks,
          input.createdAt,
          input.createdAt,
        );
      return findById(Number(result.lastInsertRowid))!;
    },
    update(id, input) {
      const fields: string[] = [];
      const values: Array<string | number | null> = [];
      const add = (column: string, value: string | number | null | undefined): void => {
        if (value === undefined) return;
        fields.push(`${column} = ?`);
        values.push(value);
      };
      add('sku', input.sku);
      add('label', input.label);
      add('weight_grams', input.weightGrams);
      add('price_cents', input.priceCents);
      add('stock_count', input.stockCount);
      if (input.backorderable !== undefined) add('backorderable', input.backorderable ? 1 : 0);
      if (input.backorderable === false) add('backorder_lead_days', null);
      else add('backorder_lead_days', input.backorderLeadDays);
      add('delivery_class', input.deliveryClass);
      add('sort_order', input.sortOrder);
      add('moq_sacks', input.moqSacks);
      fields.push('updated_at = ?');
      values.push(input.updatedAt, id);
      const result = db
        .prepare(`UPDATE product_variants SET ${fields.join(', ')} WHERE id = ?`)
        .run(...values);
      return result.changes === 0 ? undefined : findById(id);
    },
    retire(id, updatedAt) {
      const result = db
        .prepare(
          'UPDATE product_variants SET active = 0, sort_order = 0, updated_at = ? WHERE id = ?',
        )
        .run(updatedAt, id);
      return result.changes === 0 ? undefined : findById(id);
    },
    replaceDefaultVariant(productId, retiredId, replacementId) {
      db.prepare(
        'UPDATE products SET default_variant_id = ? WHERE id = ? AND default_variant_id = ?',
      ).run(replacementId, productId, retiredId);
    },
    setClearance(id, clearance, updatedAt) {
      const result = db
        .prepare(
          `UPDATE product_variants
           SET clearance_price_cents = ?, clearance_starts_at = ?, clearance_ends_at = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          clearance?.priceCents ?? null,
          clearance?.startsAt ?? null,
          clearance?.endsAt ?? null,
          updatedAt,
          id,
        );
      return result.changes === 0 ? undefined : findById(id);
    },
    orderReferenceCount(id) {
      return (
        db
          .prepare('SELECT COUNT(*) AS count FROM order_line_items WHERE variant_id = ?')
          .get(id) as {
          count: number;
        }
      ).count;
    },
  };
}
