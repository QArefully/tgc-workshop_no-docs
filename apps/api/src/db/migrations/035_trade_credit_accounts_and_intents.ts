import type { Migration } from '../migrate.js';

type MigrationDb = Parameters<Migration['up']>[0];

const MAX_SAFE_INTEGER = 9_007_199_254_740_991;

type SchemaObject = {
  name: string;
  sql: string;
};

function hasTable(db: MigrationDb, table: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table),
  );
}

function hasColumn(db: MigrationDb, table: string, column: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return columns.some((existing) => existing.name === column);
}

function addColumnIfMissing(
  db: MigrationDb,
  table: string,
  column: string,
  definition: string,
): void {
  if (!hasColumn(db, table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function countRows(db: MigrationDb, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}

function preserveSequence(db: MigrationDb, table: string, sequence: number | undefined): void {
  if (sequence === undefined) return;
  db.prepare(
    `INSERT INTO sqlite_sequence (name, seq) SELECT ?, ?
     WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = ?)`,
  ).run(table, sequence, table);
  db.prepare('UPDATE sqlite_sequence SET seq = ? WHERE name = ? AND seq < ?').run(
    sequence,
    table,
    sequence,
  );
}

function explicitSchemaObjects(
  db: MigrationDb,
  type: 'index' | 'trigger',
  table: string,
): SchemaObject[] {
  return db
    .prepare(
      `SELECT name, sql FROM sqlite_master
       WHERE type = ? AND tbl_name = ? AND sql IS NOT NULL
       ORDER BY name`,
    )
    .all(type, table) as SchemaObject[];
}

function assertForeignKeysClean(db: MigrationDb, step: string): void {
  const violations = db.pragma('foreign_key_check') as unknown[];
  if (violations.length > 0) {
    throw new Error(
      `Foreign key violations after migration 035 ${step}: ${JSON.stringify(violations)}`,
    );
  }
}

function addCompanyCreditColumns(db: MigrationDb): void {
  if (!hasTable(db, 'company_accounts')) {
    throw new Error('Migration 035 requires company_accounts from migration 026');
  }

  addColumnIfMissing(
    db,
    'company_accounts',
    'credit_limit_cents',
    `INTEGER NOT NULL DEFAULT 0 CHECK (
      typeof(credit_limit_cents) = 'integer'
      AND credit_limit_cents BETWEEN 0 AND ${MAX_SAFE_INTEGER}
    )`,
  );
  addColumnIfMissing(
    db,
    'company_accounts',
    'credit_terms_days',
    `INTEGER NOT NULL DEFAULT 30 CHECK (
      typeof(credit_terms_days) = 'integer' AND credit_terms_days = 30
    )`,
  );
  addColumnIfMissing(
    db,
    'company_accounts',
    'credit_state',
    `TEXT NOT NULL DEFAULT 'suspended' CHECK (
      credit_state IN ('active', 'on_hold', 'suspended')
    )`,
  );
  addColumnIfMissing(
    db,
    'company_accounts',
    'credit_version',
    `INTEGER NOT NULL DEFAULT 0 CHECK (
      typeof(credit_version) = 'integer'
      AND credit_version BETWEEN 0 AND ${MAX_SAFE_INTEGER}
    )`,
  );
}

function createCompanyCreditEvents(db: MigrationDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS company_credit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL REFERENCES company_accounts(id),
      event_type TEXT NOT NULL CHECK (length(event_type) BETWEEN 1 AND 100),
      credit_limit_cents INTEGER NOT NULL DEFAULT 0 CHECK (
        typeof(credit_limit_cents) = 'integer'
        AND credit_limit_cents BETWEEN 0 AND ${MAX_SAFE_INTEGER}
      ),
      credit_terms_days INTEGER NOT NULL DEFAULT 30 CHECK (
        typeof(credit_terms_days) = 'integer' AND credit_terms_days = 30
      ),
      credit_state TEXT NOT NULL DEFAULT 'suspended' CHECK (
        credit_state IN ('active', 'on_hold', 'suspended')
      ),
      credit_version INTEGER NOT NULL DEFAULT 0 CHECK (
        typeof(credit_version) = 'integer'
        AND credit_version BETWEEN 0 AND ${MAX_SAFE_INTEGER}
      ),
      amount_cents INTEGER CHECK (
        amount_cents IS NULL
        OR (
          typeof(amount_cents) = 'integer'
          AND amount_cents BETWEEN 0 AND ${MAX_SAFE_INTEGER}
        )
      ),
      reason TEXT CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 500),
      idempotency_key TEXT NOT NULL UNIQUE,
      request_fingerprint TEXT NOT NULL CHECK (length(request_fingerprint) BETWEEN 1 AND 255),
      occurred_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS company_credit_events_company_occurred_at_id_idx
      ON company_credit_events(company_id, occurred_at, id);
    CREATE INDEX IF NOT EXISTS company_credit_events_idempotency_key_idx
      ON company_credit_events(idempotency_key);

    CREATE TRIGGER IF NOT EXISTS company_credit_events_no_update
    BEFORE UPDATE ON company_credit_events
    BEGIN
      SELECT RAISE(ABORT, 'company_credit_events are immutable');
    END;

    CREATE TRIGGER IF NOT EXISTS company_credit_events_no_delete
    BEFORE DELETE ON company_credit_events
    BEGIN
      SELECT RAISE(ABORT, 'company_credit_events are immutable');
    END;
  `);
}

function rebuildPayments(db: MigrationDb): void {
  if (hasColumn(db, 'payments', 'payment_method')) return;

  const existingCount = countRows(db, 'payments');
  const sequence = (
    db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'payments'").get() as
      { seq: number } | undefined
  )?.seq;
  const indexes = explicitSchemaObjects(db, 'index', 'payments');
  const triggers = explicitSchemaObjects(db, 'trigger', 'payments');

  // Create/drop/rename keeps child tables' REFERENCES payments clauses pointing at the final
  // table. Renaming the old table first would rewrite every child FK to a temporary name.
  db.exec(`
    DROP TABLE IF EXISTS payments_new;
    CREATE TABLE payments_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER,
      idempotency_key TEXT NOT NULL UNIQUE,
      request_fingerprint TEXT NOT NULL,
      status TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      card_last4 TEXT,
      card_brand TEXT,
      failure_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      response_json TEXT,
      cart_id TEXT,
      quote_json TEXT,
      gateway_reference TEXT,
      updated_at TEXT,
      reservation_expires_at TEXT,
      payment_method TEXT NOT NULL DEFAULT 'card' CHECK (
        payment_method IN ('card', 'trade_credit')
      ),
      company_id INTEGER REFERENCES company_accounts(id),
      FOREIGN KEY (order_id) REFERENCES orders(id),
      CHECK (
        (payment_method = 'card'
          AND card_last4 IS NOT NULL
          AND card_brand IS NOT NULL
          AND company_id IS NULL)
        OR
        (payment_method = 'trade_credit'
          AND card_last4 IS NULL
          AND card_brand IS NULL
          AND company_id IS NOT NULL)
      )
    );

    INSERT INTO payments_new
      (id, order_id, idempotency_key, request_fingerprint, status, amount_cents,
       card_last4, card_brand, failure_reason, created_at, response_json, cart_id, quote_json,
       gateway_reference, updated_at, reservation_expires_at, payment_method, company_id)
    SELECT id, order_id, idempotency_key, request_fingerprint, status, amount_cents,
           card_last4, card_brand, failure_reason, created_at, response_json, cart_id, quote_json,
           gateway_reference, updated_at, reservation_expires_at, 'card', NULL
      FROM payments
     ORDER BY id;
  `);

  const copiedCount = countRows(db, 'payments_new');
  if (copiedCount !== existingCount) {
    throw new Error(
      `payments rebuild count mismatch: ${existingCount} existing vs ${copiedCount} copied`,
    );
  }

  const mismatch = db
    .prepare(
      `SELECT old.id
       FROM payments old
       LEFT JOIN payments_new copy ON copy.id = old.id
       WHERE copy.id IS NULL
          OR old.order_id IS NOT copy.order_id
          OR old.idempotency_key IS NOT copy.idempotency_key
          OR old.request_fingerprint IS NOT copy.request_fingerprint
          OR old.status IS NOT copy.status
          OR old.amount_cents IS NOT copy.amount_cents
          OR old.card_last4 IS NOT copy.card_last4
          OR old.card_brand IS NOT copy.card_brand
          OR old.failure_reason IS NOT copy.failure_reason
          OR old.created_at IS NOT copy.created_at
          OR old.response_json IS NOT copy.response_json
          OR old.cart_id IS NOT copy.cart_id
          OR old.quote_json IS NOT copy.quote_json
          OR old.gateway_reference IS NOT copy.gateway_reference
          OR old.updated_at IS NOT copy.updated_at
          OR old.reservation_expires_at IS NOT copy.reservation_expires_at
       LIMIT 1`,
    )
    .get() as { id: number } | undefined;
  if (mismatch) {
    throw new Error(`payments rebuild value mismatch at row ${mismatch.id}`);
  }

  db.exec('DROP TABLE payments');
  db.exec('ALTER TABLE payments_new RENAME TO payments');
  preserveSequence(db, 'payments', sequence);
  for (const index of indexes) db.exec(index.sql);
  for (const trigger of triggers) db.exec(trigger.sql);
  assertForeignKeysClean(db, 'payments rebuild');
}

function rebuildOrders(db: MigrationDb): void {
  if (hasColumn(db, 'orders', 'payment_method')) return;

  const existingCount = countRows(db, 'orders');
  const sequence = (
    db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'orders'").get() as
      { seq: number } | undefined
  )?.seq;
  const indexes = explicitSchemaObjects(db, 'index', 'orders');
  const triggers = explicitSchemaObjects(db, 'trigger', 'orders');

  // Orders are a referenced parent too. As with payments, create/drop/rename avoids rewriting
  // child FKs while the runner's transaction has enforcement suspended.
  db.exec(`
    DROP TABLE IF EXISTS orders_new;
    CREATE TABLE orders_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name TEXT NOT NULL,
      customer_email TEXT NOT NULL,
      shipping_address TEXT NOT NULL,
      promo_code_applied TEXT,
      subtotal_cents INTEGER NOT NULL,
      discount_cents INTEGER NOT NULL DEFAULT 0,
      total_cents INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      user_id INTEGER,
      lifecycle_status TEXT NOT NULL DEFAULT 'processing' CHECK (lifecycle_status IN (
        'processing', 'packed', 'shipped', 'delivered', 'delivery_failed', 'cancelled'
      )),
      version INTEGER NOT NULL DEFAULT 0 CHECK (typeof(version) = 'integer' AND version >= 0),
      cancelled_at TEXT,
      demo_seed_key TEXT,
      delivery_mode TEXT DEFAULT 'parcel',
      delivery_charge_cents INTEGER DEFAULT 0,
      delivery_weight_grams INTEGER DEFAULT 0,
      delivery_site_id INTEGER REFERENCES delivery_sites(id),
      delivery_address_json TEXT CHECK (
        delivery_address_json IS NULL
        OR (json_valid(delivery_address_json) AND json_type(delivery_address_json) = 'object')
      ),
      billing_entity_json TEXT CHECK (
        billing_entity_json IS NULL
        OR (json_valid(billing_entity_json) AND json_type(billing_entity_json) = 'object')
      ),
      delivery_slot_date TEXT CHECK (
        delivery_slot_date IS NULL
        OR delivery_slot_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      ),
      delivery_slot_window TEXT CHECK (
        delivery_slot_window IS NULL OR delivery_slot_window IN ('am', 'pm')
      ),
      purchase_order_reference TEXT CHECK (
        purchase_order_reference IS NULL
        OR length(purchase_order_reference) BETWEEN 1 AND 64
      ),
      promo_category_scope TEXT CHECK (
        promo_category_scope IS NULL OR promo_category_scope IN (
          'Sports Nutrition',
          'Baking & Pantry',
          'Drinks',
          'Household & Cleaning',
          'Garden & Outdoors',
          'Trade & Creative Materials'
        )
      ),
      discount_base_cents INTEGER CHECK (
        discount_base_cents IS NULL OR discount_base_cents >= 0
      ),
      country TEXT NOT NULL DEFAULT 'UK' CHECK (
        country IN ('UK', 'US', 'CN', 'PL', 'ES', 'DE', 'FR')
      ),
      payment_method TEXT NOT NULL DEFAULT 'card' CHECK (
        payment_method IN ('card', 'trade_credit')
      ),
      company_id INTEGER REFERENCES company_accounts(id),
      net_cents INTEGER CHECK (
        net_cents IS NULL
        OR (typeof(net_cents) = 'integer' AND net_cents BETWEEN 0 AND ${MAX_SAFE_INTEGER})
      ),
      vat_rate_basis_points INTEGER CHECK (
        vat_rate_basis_points IS NULL
        OR (typeof(vat_rate_basis_points) = 'integer' AND vat_rate_basis_points BETWEEN 0 AND 10000)
      ),
      vat_cents INTEGER CHECK (
        vat_cents IS NULL
        OR (typeof(vat_cents) = 'integer' AND vat_cents BETWEEN 0 AND ${MAX_SAFE_INTEGER})
      ),
      gross_cents INTEGER CHECK (
        gross_cents IS NULL
        OR (typeof(gross_cents) = 'integer' AND gross_cents BETWEEN 0 AND ${MAX_SAFE_INTEGER})
      ),
      CHECK (
        (
          payment_method = 'card'
          AND company_id IS NULL
          AND net_cents IS NULL
          AND vat_rate_basis_points IS NULL
          AND vat_cents IS NULL
          AND gross_cents IS NULL
        )
        OR
        (
          payment_method = 'card'
          AND company_id IS NULL
          AND net_cents IS NOT NULL
          AND vat_rate_basis_points = 0
          AND vat_cents = 0
          AND gross_cents = total_cents
          AND net_cents = gross_cents
        )
        OR
        (
          payment_method = 'trade_credit'
          AND company_id IS NOT NULL
          AND net_cents IS NOT NULL
          AND vat_rate_basis_points IS NOT NULL
          AND vat_cents IS NOT NULL
          AND gross_cents IS NOT NULL
          AND (
            vat_rate_basis_points = 0
            OR net_cents <= ${MAX_SAFE_INTEGER} / vat_rate_basis_points
          )
          AND vat_cents = (net_cents * vat_rate_basis_points + 5000) / 10000
          AND net_cents <= ${MAX_SAFE_INTEGER} - vat_cents
          AND gross_cents = net_cents + vat_cents
          AND gross_cents = total_cents
        )
      )
    );

    INSERT INTO orders_new
      (id, customer_name, customer_email, shipping_address, promo_code_applied, subtotal_cents,
       discount_cents, total_cents, created_at, user_id, lifecycle_status, version, cancelled_at,
       demo_seed_key, delivery_mode, delivery_charge_cents, delivery_weight_grams, delivery_site_id,
       delivery_address_json, billing_entity_json, delivery_slot_date, delivery_slot_window,
       purchase_order_reference, promo_category_scope, discount_base_cents, country,
       payment_method, company_id, net_cents, vat_rate_basis_points, vat_cents, gross_cents)
    SELECT id, customer_name, customer_email, shipping_address, promo_code_applied, subtotal_cents,
           discount_cents, total_cents, created_at, user_id, lifecycle_status, version, cancelled_at,
           demo_seed_key, delivery_mode, delivery_charge_cents, delivery_weight_grams, delivery_site_id,
           delivery_address_json, billing_entity_json, delivery_slot_date, delivery_slot_window,
           purchase_order_reference, promo_category_scope, discount_base_cents, country,
           'card', NULL, total_cents, 0, 0, total_cents
      FROM orders
     ORDER BY id;
  `);

  const copiedCount = countRows(db, 'orders_new');
  if (copiedCount !== existingCount) {
    throw new Error(
      `orders rebuild count mismatch: ${existingCount} existing vs ${copiedCount} copied`,
    );
  }

  const mismatch = db
    .prepare(
      `SELECT old.id
       FROM orders old
       LEFT JOIN orders_new copy ON copy.id = old.id
       WHERE copy.id IS NULL
          OR old.customer_name IS NOT copy.customer_name
          OR old.customer_email IS NOT copy.customer_email
          OR old.shipping_address IS NOT copy.shipping_address
          OR old.promo_code_applied IS NOT copy.promo_code_applied
          OR old.subtotal_cents IS NOT copy.subtotal_cents
          OR old.discount_cents IS NOT copy.discount_cents
          OR old.total_cents IS NOT copy.total_cents
          OR old.created_at IS NOT copy.created_at
          OR old.user_id IS NOT copy.user_id
          OR old.lifecycle_status IS NOT copy.lifecycle_status
          OR old.version IS NOT copy.version
          OR old.cancelled_at IS NOT copy.cancelled_at
          OR old.demo_seed_key IS NOT copy.demo_seed_key
          OR old.delivery_mode IS NOT copy.delivery_mode
          OR old.delivery_charge_cents IS NOT copy.delivery_charge_cents
          OR old.delivery_weight_grams IS NOT copy.delivery_weight_grams
          OR old.delivery_site_id IS NOT copy.delivery_site_id
          OR old.delivery_address_json IS NOT copy.delivery_address_json
          OR old.billing_entity_json IS NOT copy.billing_entity_json
          OR old.delivery_slot_date IS NOT copy.delivery_slot_date
          OR old.delivery_slot_window IS NOT copy.delivery_slot_window
          OR old.purchase_order_reference IS NOT copy.purchase_order_reference
          OR old.promo_category_scope IS NOT copy.promo_category_scope
          OR old.discount_base_cents IS NOT copy.discount_base_cents
          OR old.country IS NOT copy.country
       LIMIT 1`,
    )
    .get() as { id: number } | undefined;
  if (mismatch) {
    throw new Error(`orders rebuild value mismatch at row ${mismatch.id}`);
  }

  db.exec('DROP TABLE orders');
  db.exec('ALTER TABLE orders_new RENAME TO orders');
  preserveSequence(db, 'orders', sequence);
  for (const index of indexes) db.exec(index.sql);
  for (const trigger of triggers) db.exec(trigger.sql);
  assertForeignKeysClean(db, 'orders rebuild');
}

function createCreditExposureHolds(db: MigrationDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS credit_exposure_holds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL REFERENCES company_accounts(id),
      payment_idempotency_key TEXT NOT NULL UNIQUE REFERENCES payments(idempotency_key),
      amount_cents INTEGER NOT NULL CHECK (
        typeof(amount_cents) = 'integer'
        AND amount_cents BETWEEN 0 AND ${MAX_SAFE_INTEGER}
      ),
      status TEXT NOT NULL DEFAULT 'prepared' CHECK (
        status IN ('prepared', 'authorized', 'committed', 'released')
      ),
      expires_at TEXT,
      invoice_id INTEGER,
      authorized_at TEXT,
      committed_at TEXT,
      released_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS credit_exposure_holds_company_status_idx
      ON credit_exposure_holds(company_id, status);
    CREATE INDEX IF NOT EXISTS credit_exposure_holds_status_expires_at_idx
      ON credit_exposure_holds(status, expires_at);
    CREATE INDEX IF NOT EXISTS credit_exposure_holds_payment_idx
      ON credit_exposure_holds(payment_idempotency_key);
    CREATE INDEX IF NOT EXISTS credit_exposure_holds_invoice_idx
      ON credit_exposure_holds(invoice_id);
  `);
}

/** Adds company credit authority and method-aware payment/order persistence for expansion 2. */
export const tradeCreditAccountsAndIntentsMigration: Migration = {
  version: '035',
  name: 'trade credit accounts and payment intents',
  up(db) {
    // The runner owns FK suspension for this transaction and validates the whole database before
    // commit. Never toggle foreign_keys here: payments and orders are both referenced parents.
    addCompanyCreditColumns(db);
    createCompanyCreditEvents(db);
    rebuildPayments(db);
    rebuildOrders(db);
    createCreditExposureHolds(db);
    assertForeignKeysClean(db, 'trade credit schema');
  },
};
