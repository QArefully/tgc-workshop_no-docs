import type Database from 'better-sqlite3';
import type { Country } from '@shop/contracts/country';
import type { VariantRow } from '../catalog/productRepository.js';

export interface CartLineRow {
  variant_id: number;
  config_key: string;
  custom_blend_json: string | null;
  product_id: number;
  quantity: number;
  price_cents: number;
  product_name: string;
  product_description: string;
  product_category: string;
  product_image_set_id: string | null;
  product_slug: string;
  product_compare_at_price_cents: number | null;
  product_sales_count: number;
  product_active: number;
  product_created_at: string;
  product_consumption_classification: string;
  variant_sku: string;
  variant_label: string;
  variant_weight_grams: number;
  variant_moq_sacks: number;
  variant_clearance_price_cents?: number | null;
  variant_clearance_starts_at?: string | null;
  variant_clearance_ends_at?: string | null;
  variant_delivery_class: string;
  variant_backorderable: number;
  variant_backorder_lead_days: number | null;
  variant_active: number;
  product_default_variant_id: number | null;
  product_blend_source_variant_id: number | null;
}

export interface CartCountryVariantFact {
  country: Country;
  variant_id: number;
  product_category: string;
  product_slug: string;
}

export interface CartRepository {
  create(id: string, country: string): void;
  exists(cartId: string): boolean;
  country(cartId: string): Country | undefined;
  listCountryVariantFacts(cartId: string, variantIds: readonly number[]): CartCountryVariantFact[];
  listLines(cartId: string): CartLineRow[];
  variantExists(variantId: string): boolean;
  lineQuantity(cartId: string, variantId: string, configKey?: string): number;
  addLine(cartId: string, variantId: string, configKey?: string): void;
  addLineQuantity(cartId: string, variantId: string, quantity: number, configKey?: string): void;
  addConfiguredLineQuantity(
    cartId: string,
    variantId: string,
    configKey: string,
    customBlendJson: string,
    quantity: number,
  ): void;
  replaceConfiguredLine(
    cartId: string,
    variantId: string,
    previousConfigKey: string,
    configKey: string,
    customBlendJson: string,
  ): boolean;
  updateLine(cartId: string, variantId: string, quantity: number, configKey?: string): boolean;
  removeLine(cartId: string, variantId: string, configKey?: string): boolean;
  reserve(cartId: string, paymentIdempotencyKey: string, createdAt: string): boolean;
  releaseReservation(paymentIdempotencyKey: string): boolean;
  /** Expired prepared checkout locks do not block cart mutation. */
  isReserved(cartId: string, now?: string): boolean;
  touch(cartId: string): void;
  remove(cartId: string): void;
  /** Look up a product's default variant ID for ambiguous productId requests. */
  findDefaultVariantId(productId: string): number | undefined;
  /** Count active variants for a product to detect ambiguity. */
  countActiveVariants(productId: string): number;
  /** Look up a variant row by ID. */
  getVariant(variantId: number): VariantRow | undefined;
}

export function createCartRepository(db: Database.Database): CartRepository {
  return {
    create(id, country) {
      db.prepare('INSERT INTO carts (id, country) VALUES (?, ?)').run(id, country);
    },
    exists(cartId) {
      return db.prepare('SELECT 1 FROM carts WHERE id = ?').get(cartId) !== undefined;
    },
    country(cartId) {
      return db.prepare('SELECT country FROM carts WHERE id = ?').pluck().get(cartId) as
        Country | undefined;
    },
    listCountryVariantFacts(cartId, variantIds) {
      if (variantIds.length === 0) return [];
      const placeholders = variantIds.map(() => '?').join(', ');
      return db
        .prepare(
          `SELECT c.country, pv.id AS variant_id,
                  p.category AS product_category, p.slug AS product_slug
           FROM carts c
           INNER JOIN product_variants pv ON pv.id IN (${placeholders})
           INNER JOIN products p ON p.id = pv.product_id
           WHERE c.id = ?`,
        )
        .all(...variantIds, cartId) as CartCountryVariantFact[];
    },
    listLines(cartId) {
      return db
        .prepare(
          `SELECT cli.variant_id, cli.config_key, cli.custom_blend_json, cli.quantity,
            p.id AS product_id, p.name AS product_name, p.description AS product_description,
            v.price_cents AS price_cents, p.category AS product_category,
            p.image_set_id AS product_image_set_id, p.slug AS product_slug,
            p.compare_at_price_cents AS product_compare_at_price_cents,
            p.sales_count AS product_sales_count,
            p.active AS product_active, p.created_at AS product_created_at,
            p.consumption_classification AS product_consumption_classification,
            p.default_variant_id AS product_default_variant_id,
            p.blend_source_variant_id AS product_blend_source_variant_id,
            v.sku AS variant_sku, v.label AS variant_label,
            v.weight_grams AS variant_weight_grams,
            v.moq_sacks AS variant_moq_sacks,
            v.clearance_price_cents AS variant_clearance_price_cents,
            v.clearance_starts_at AS variant_clearance_starts_at,
            v.clearance_ends_at AS variant_clearance_ends_at,
            v.delivery_class AS variant_delivery_class,
            v.backorderable AS variant_backorderable,
            v.backorder_lead_days AS variant_backorder_lead_days,
            v.active AS variant_active
         FROM cart_line_items cli
         JOIN product_variants v ON v.id = cli.variant_id
         JOIN products p ON p.id = v.product_id
         WHERE cli.cart_id = ?`,
        )
        .all(cartId) as CartLineRow[];
    },
    variantExists(variantId) {
      return (
        db.prepare('SELECT 1 FROM product_variants WHERE id = ? AND active = 1').get(variantId) !==
        undefined
      );
    },
    lineQuantity(cartId, variantId, configKey = '') {
      return (
        (
          db
            .prepare(
              'SELECT quantity FROM cart_line_items WHERE cart_id = ? AND variant_id = ? AND config_key = ?',
            )
            .get(cartId, variantId, configKey) as { quantity: number } | undefined
        )?.quantity ?? 0
      );
    },
    addLine(cartId, variantId, configKey = '') {
      db.prepare(
        `INSERT INTO cart_line_items (cart_id, variant_id, config_key, quantity, created_at, updated_at)
         VALUES (?, ?, ?, 1, datetime('now'), datetime('now'))
         ON CONFLICT(cart_id, variant_id, config_key) DO UPDATE SET
           quantity = quantity + 1,
           updated_at = datetime('now')`,
      ).run(cartId, variantId, configKey);
    },
    addLineQuantity(cartId, variantId, quantity, configKey = '') {
      db.prepare(
        `INSERT INTO cart_line_items (cart_id, variant_id, config_key, quantity, created_at, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
         ON CONFLICT(cart_id, variant_id, config_key) DO UPDATE SET
           quantity = quantity + excluded.quantity,
           updated_at = datetime('now')`,
      ).run(cartId, variantId, configKey, quantity);
    },
    addConfiguredLineQuantity(cartId, variantId, configKey, customBlendJson, quantity) {
      db.prepare(
        `INSERT INTO cart_line_items
           (cart_id, variant_id, config_key, custom_blend_json, quantity, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
         ON CONFLICT(cart_id, variant_id, config_key) DO UPDATE SET
           quantity = quantity + excluded.quantity,
           custom_blend_json = excluded.custom_blend_json,
           updated_at = datetime('now')`,
      ).run(cartId, variantId, configKey, customBlendJson, quantity);
    },
    replaceConfiguredLine(cartId, variantId, previousConfigKey, configKey, customBlendJson) {
      const existing = db
        .prepare(
          `SELECT quantity FROM cart_line_items
           WHERE cart_id = ? AND variant_id = ? AND config_key = ?`,
        )
        .get(cartId, variantId, previousConfigKey) as { quantity: number } | undefined;
      if (!existing) return false;
      if (previousConfigKey === configKey) {
        db.prepare(
          `UPDATE cart_line_items
           SET custom_blend_json = ?, updated_at = datetime('now')
           WHERE cart_id = ? AND variant_id = ? AND config_key = ?`,
        ).run(customBlendJson, cartId, variantId, configKey);
        return true;
      }
      db.prepare(
        `INSERT INTO cart_line_items
           (cart_id, variant_id, config_key, custom_blend_json, quantity, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
         ON CONFLICT(cart_id, variant_id, config_key) DO UPDATE SET
           quantity = quantity + excluded.quantity,
           custom_blend_json = excluded.custom_blend_json,
           updated_at = datetime('now')`,
      ).run(cartId, variantId, configKey, customBlendJson, existing.quantity);
      db.prepare(
        `DELETE FROM cart_line_items
         WHERE cart_id = ? AND variant_id = ? AND config_key = ?`,
      ).run(cartId, variantId, previousConfigKey);
      return true;
    },
    updateLine(cartId, variantId, quantity, configKey = '') {
      return (
        db
          .prepare(
            "UPDATE cart_line_items SET quantity = ?, updated_at = datetime('now') WHERE cart_id = ? AND variant_id = ? AND config_key = ?",
          )
          .run(quantity, cartId, variantId, configKey).changes > 0
      );
    },
    removeLine(cartId, variantId, configKey = '') {
      return (
        db
          .prepare(
            'DELETE FROM cart_line_items WHERE cart_id = ? AND variant_id = ? AND config_key = ?',
          )
          .run(cartId, variantId, configKey).changes > 0
      );
    },
    reserve(cartId, paymentIdempotencyKey, createdAt) {
      const result = db
        .prepare(
          `INSERT INTO cart_reservations (cart_id, payment_idempotency_key, created_at)
           VALUES (?, ?, ?)
           ON CONFLICT(cart_id) DO NOTHING`,
        )
        .run(cartId, paymentIdempotencyKey, createdAt);
      if (result.changes === 1) return true;
      return (
        db
          .prepare(
            'SELECT 1 FROM cart_reservations WHERE cart_id = ? AND payment_idempotency_key = ?',
          )
          .get(cartId, paymentIdempotencyKey) !== undefined
      );
    },
    releaseReservation(paymentIdempotencyKey) {
      return (
        db
          .prepare('DELETE FROM cart_reservations WHERE payment_idempotency_key = ?')
          .run(paymentIdempotencyKey).changes > 0
      );
    },
    isReserved(cartId, now) {
      return (
        db
          .prepare(
            `SELECT 1
             FROM cart_reservations cr
             LEFT JOIN payments p ON p.idempotency_key = cr.payment_idempotency_key
             WHERE cr.cart_id = ?
               AND NOT (
                 p.status = 'prepared'
                 AND p.reservation_expires_at IS NOT NULL
                 AND p.reservation_expires_at <= ?
               )`,
          )
          .get(cartId, now ?? new Date().toISOString()) !== undefined
      );
    },
    touch(cartId) {
      db.prepare("UPDATE carts SET updated_at = datetime('now') WHERE id = ?").run(cartId);
    },
    remove(cartId) {
      db.prepare('DELETE FROM carts WHERE id = ?').run(cartId);
    },
    findDefaultVariantId(productId) {
      const row = db
        .prepare(
          `SELECT v.id FROM products p
           INNER JOIN product_variants v ON v.id = p.default_variant_id
           WHERE p.id = ? AND v.active = 1`,
        )
        .get(productId) as { id: number } | undefined;
      return row?.id;
    },
    countActiveVariants(productId) {
      const row = db
        .prepare(
          'SELECT COUNT(*) AS count FROM product_variants WHERE product_id = ? AND active = 1',
        )
        .get(productId) as { count: number };
      return row.count;
    },
    getVariant(variantId) {
      return db.prepare('SELECT * FROM product_variants WHERE id = ?').get(variantId) as
        VariantRow | undefined;
    },
  };
}
