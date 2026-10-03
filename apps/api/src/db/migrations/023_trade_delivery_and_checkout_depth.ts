import type { Migration } from '../migrate.js';

type MigrationDb = Parameters<Migration['up']>[0];

function hasColumn(db: MigrationDb, table: string, column: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return columns.some((existing) => existing.name === column);
}

function addOrderColumnIfMissing(db: MigrationDb, column: string, definition: string): void {
  if (!hasColumn(db, 'orders', column)) {
    db.exec(`ALTER TABLE orders ADD COLUMN ${column} ${definition}`);
  }
}

function assertForeignKeysClean(db: MigrationDb, step: string): void {
  const violations = db.pragma('foreign_key_check') as unknown[];
  if (violations.length > 0) {
    throw new Error(
      `Foreign key violations after migration 023 ${step}: ${JSON.stringify(violations)}`,
    );
  }
}

/**
 * Structured postal address columns shared by both trade-account record types. Kept identical in
 * both tables so one row <-> `PostalAddress` mapper serves delivery sites and billing entities.
 *
 * `address_country_code` is stored upper case ISO-3166-1 alpha-2; the CHECK is the persistence-level
 * guard behind the domain normaliser, so a bypassing writer cannot land mixed-case codes that would
 * make address comparison and idempotency fingerprints non-deterministic.
 */
const ADDRESS_COLUMNS = `
  address_line1 TEXT NOT NULL CHECK (length(address_line1) BETWEEN 1 AND 120),
  address_line2 TEXT CHECK (address_line2 IS NULL OR length(address_line2) BETWEEN 1 AND 120),
  address_city TEXT NOT NULL CHECK (length(address_city) BETWEEN 1 AND 80),
  address_region TEXT CHECK (address_region IS NULL OR length(address_region) BETWEEN 1 AND 80),
  address_postcode TEXT NOT NULL CHECK (length(address_postcode) BETWEEN 1 AND 20),
  address_country_code TEXT NOT NULL CHECK (
    length(address_country_code) = 2
    AND address_country_code = upper(address_country_code)
    AND address_country_code NOT GLOB '*[^A-Z]*'
  )`;

/**
 * Adds the B2B checkout-depth schema: saved trade delivery sites, billing entities, and the order
 * snapshot columns for destination, booked delivery slot, and buyer purchase-order reference.
 *
 * `orders` is extended with `ALTER TABLE ADD COLUMN` only — never rebuilt. Shipment, allocation,
 * stock-movement, return, and refund rows all reference `orders(id)`, and the stock-movement table
 * carries ABORT triggers, so a rebuild would be both destructive and unnecessary for purely
 * additive nullable columns. Pre-existing orders keep NULL in all six.
 *
 * Delivery sites and billing entities are retired (`active = 0`), never deleted, once an order
 * snapshots them (migration `020` precedent). Every uniqueness rule therefore keys on `active = 1`
 * and lives in a partial unique index rather than a table-level UNIQUE constraint: a retired row
 * must never block a live one. A table-level `UNIQUE(user_id, label)` would let a site retired
 * precisely because an order snapshotted it — and so undeletable — permanently squat its own label,
 * turning a legitimate re-add into an opaque `SQLITE_CONSTRAINT_UNIQUE` failure. The same holds for
 * billing entity legal names and for the one-default-per-user rule.
 */
export const tradeDeliveryAndCheckoutDepthMigration: Migration = {
  version: '023',
  name: 'trade delivery and checkout depth',
  up(db) {
    // The runner owns FK suspension for this transaction and runs `PRAGMA foreign_key_check` before
    // committing. Do not toggle `foreign_keys` here.
    db.exec(`
      CREATE TABLE IF NOT EXISTS delivery_sites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
        contact_name TEXT NOT NULL CHECK (length(contact_name) BETWEEN 1 AND 120),
        contact_phone TEXT CHECK (contact_phone IS NULL OR length(contact_phone) BETWEEN 1 AND 40),
        ${ADDRESS_COLUMNS},
        is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE UNIQUE INDEX IF NOT EXISTS delivery_sites_user_label_active_idx
        ON delivery_sites(user_id, label) WHERE active = 1;

      CREATE UNIQUE INDEX IF NOT EXISTS delivery_sites_user_default_idx
        ON delivery_sites(user_id) WHERE is_default = 1 AND active = 1;

      CREATE INDEX IF NOT EXISTS delivery_sites_user_active_idx
        ON delivery_sites(user_id, active);

      CREATE TABLE IF NOT EXISTS billing_entities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        legal_name TEXT NOT NULL CHECK (length(legal_name) BETWEEN 1 AND 160),
        registration_number TEXT CHECK (
          registration_number IS NULL OR length(registration_number) BETWEEN 1 AND 40
        ),
        vat_number TEXT CHECK (vat_number IS NULL OR length(vat_number) BETWEEN 1 AND 40),
        ${ADDRESS_COLUMNS},
        is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE UNIQUE INDEX IF NOT EXISTS billing_entities_user_legal_name_active_idx
        ON billing_entities(user_id, legal_name) WHERE active = 1;

      CREATE UNIQUE INDEX IF NOT EXISTS billing_entities_user_default_idx
        ON billing_entities(user_id) WHERE is_default = 1 AND active = 1;

      CREATE INDEX IF NOT EXISTS billing_entities_user_active_idx
        ON billing_entities(user_id, active);
    `);
    assertForeignKeysClean(db, 'trade account tables');

    // A retired site stays referenced by historic orders, so the reference is deliberately not
    // ON DELETE CASCADE: a delivery site is never deleted while an order points at it.
    addOrderColumnIfMissing(db, 'delivery_site_id', 'INTEGER REFERENCES delivery_sites(id)');
    addOrderColumnIfMissing(
      db,
      'delivery_address_json',
      `TEXT CHECK (
        delivery_address_json IS NULL
        OR (json_valid(delivery_address_json) AND json_type(delivery_address_json) = 'object')
      )`,
    );
    addOrderColumnIfMissing(
      db,
      'billing_entity_json',
      `TEXT CHECK (
        billing_entity_json IS NULL
        OR (json_valid(billing_entity_json) AND json_type(billing_entity_json) = 'object')
      )`,
    );
    addOrderColumnIfMissing(
      db,
      'delivery_slot_date',
      `TEXT CHECK (
        delivery_slot_date IS NULL
        OR delivery_slot_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      )`,
    );
    addOrderColumnIfMissing(
      db,
      'delivery_slot_window',
      "TEXT CHECK (delivery_slot_window IS NULL OR delivery_slot_window IN ('am', 'pm'))",
    );
    addOrderColumnIfMissing(
      db,
      'purchase_order_reference',
      `TEXT CHECK (
        purchase_order_reference IS NULL
        OR length(purchase_order_reference) BETWEEN 1 AND 64
      )`,
    );

    db.exec(`
      CREATE INDEX IF NOT EXISTS orders_purchase_order_reference_idx
        ON orders(purchase_order_reference) WHERE purchase_order_reference IS NOT NULL;
    `);
    assertForeignKeysClean(db, 'orders checkout depth columns');
  },
};
