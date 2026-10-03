import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { closeDatabase, migrateDatabase } from '../../src/db/index.js';
import { migrations } from '../../src/db/migrations/index.js';

const pre035Migrations = migrations.filter((migration) => migration.version < '035');

function columnNames(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
    (column) => column.name,
  );
}

function indexNames(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA index_list(${table})`).all() as { name: string }[]).map(
    (index) => index.name,
  );
}

function tableSql(db: Database.Database, table: string): string {
  return (
    db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as {
      sql: string;
    }
  ).sql;
}

function createFixture(db: Database.Database): void {
  db.exec(`
    INSERT INTO users
      (id, email, display_name, password_hash, password_salt, role, country)
    VALUES (3501, 'credit-schema@example.test', 'Credit Schema Buyer', 'hash', 'salt', 'customer', 'UK');

    INSERT INTO company_accounts
      (id, name, created_by_user_id, active, approval_threshold_cents, created_at, updated_at, country)
    VALUES (3501, 'Credit Schema Materials Ltd', 3501, 1, 0,
            '2026-09-01T09:00:00.000Z', '2026-09-01T09:00:00.000Z', 'UK');

    INSERT INTO orders
      (id, customer_name, customer_email, shipping_address, subtotal_cents, discount_cents,
       total_cents, created_at, user_id, lifecycle_status, version, country)
    VALUES (3501, 'Credit Schema Buyer', 'credit-schema@example.test', '3501 Test Lane',
            12000, 1000, 11000, '2026-09-01T09:00:00.000Z', 3501, 'processing', 0, 'UK');

    INSERT INTO carts (id, country) VALUES ('credit-schema-cart', 'UK');

    INSERT INTO payments
      (id, order_id, idempotency_key, request_fingerprint, status, amount_cents,
       card_last4, card_brand, failure_reason, created_at, response_json, cart_id, quote_json,
       gateway_reference, updated_at, reservation_expires_at)
    VALUES (3501, 3501, 'credit-schema-payment', 'credit-schema-fingerprint', 'succeeded', 11000,
            '4242', 'Visa', NULL, '2026-09-01T09:00:00.000Z', '{"success":true}',
            'credit-schema-cart', '{"version":9}', 'gateway-3501',
            '2026-09-01T09:00:01.000Z', NULL);

    INSERT INTO cart_reservations
      (cart_id, payment_idempotency_key, created_at)
    VALUES ('credit-schema-cart', 'credit-schema-payment', '2026-09-01T09:00:00.000Z');
  `);
}

void test('migration 035 preserves legacy payment/order facts and adds strict credit schema', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'shop-credit-schema-'));
  const db = new Database(join(directory, 'shop.db'));
  db.pragma('foreign_keys = ON');
  t.after(() => {
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  });

  migrateDatabase(db, pre035Migrations);
  createFixture(db);

  const legacyPayment = db
    .prepare(
      `SELECT id, order_id, idempotency_key, request_fingerprint, status, amount_cents,
              card_last4, card_brand, failure_reason, created_at, response_json, cart_id,
              quote_json, gateway_reference, updated_at, reservation_expires_at
       FROM payments WHERE idempotency_key = 'credit-schema-payment'`,
    )
    .get();
  const legacyOrder = db
    .prepare(
      `SELECT id, customer_name, customer_email, shipping_address, promo_code_applied,
              subtotal_cents, discount_cents, total_cents, created_at, user_id, lifecycle_status,
              version, cancelled_at, demo_seed_key, delivery_mode, delivery_charge_cents,
              delivery_weight_grams, delivery_site_id, delivery_address_json, billing_entity_json,
              delivery_slot_date, delivery_slot_window, purchase_order_reference,
              promo_category_scope, discount_base_cents, country
       FROM orders WHERE id = 3501`,
    )
    .get();
  const paymentSequence = (
    db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'payments'").get() as
      { seq: number } | undefined
  )?.seq;
  const orderSequence = (
    db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'orders'").get() as
      { seq: number } | undefined
  )?.seq;

  migrateDatabase(db);

  assert.equal(
    db.prepare('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1').pluck().get(),
    '038',
  );
  assert.deepEqual(
    db
      .prepare(
        `SELECT credit_limit_cents, credit_terms_days, credit_state, credit_version
         FROM company_accounts WHERE id = 3501`,
      )
      .get(),
    { credit_limit_cents: 0, credit_terms_days: 30, credit_state: 'suspended', credit_version: 0 },
  );

  for (const [column, value] of [
    ['credit_limit_cents', -1],
    ['credit_terms_days', 31],
    ['credit_state', 'on-hold'],
    ['credit_version', -1],
  ] as const) {
    assert.throws(
      () => db.prepare(`UPDATE company_accounts SET ${column} = ? WHERE id = 3501`).run(value),
      /CHECK constraint failed/,
      `${column} must be constrained`,
    );
  }

  assert.deepEqual(
    db
      .prepare(
        `SELECT id, order_id, idempotency_key, request_fingerprint, status, amount_cents,
                card_last4, card_brand, failure_reason, created_at, response_json, cart_id,
                quote_json, gateway_reference, updated_at, reservation_expires_at,
                payment_method, company_id
         FROM payments WHERE idempotency_key = 'credit-schema-payment'`,
      )
      .get(),
    { ...legacyPayment, payment_method: 'card', company_id: null },
  );
  assert.ok(columnNames(db, 'payments').includes('payment_method'));
  assert.ok(columnNames(db, 'payments').includes('company_id'));
  assert.deepEqual(db.pragma('foreign_key_list(cart_reservations)'), [
    {
      id: 0,
      seq: 0,
      table: 'payments',
      from: 'payment_idempotency_key',
      to: 'idempotency_key',
      on_update: 'NO ACTION',
      on_delete: 'NO ACTION',
      match: 'NONE',
    },
    {
      id: 1,
      seq: 0,
      table: 'carts',
      from: 'cart_id',
      to: 'id',
      on_update: 'NO ACTION',
      on_delete: 'CASCADE',
      match: 'NONE',
    },
  ]);
  assert.ok(indexNames(db, 'payments').includes('payments_status_idx'));
  assert.ok(indexNames(db, 'payments').includes('payments_order_id_status_idx'));
  assert.equal(
    db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'payments'").pluck().get(),
    paymentSequence,
  );

  assert.deepEqual(
    db
      .prepare(
        `SELECT id, customer_name, customer_email, shipping_address, promo_code_applied,
                subtotal_cents, discount_cents, total_cents, created_at, user_id, lifecycle_status,
                version, cancelled_at, demo_seed_key, delivery_mode, delivery_charge_cents,
                delivery_weight_grams, delivery_site_id, delivery_address_json, billing_entity_json,
                delivery_slot_date, delivery_slot_window, purchase_order_reference,
                promo_category_scope, discount_base_cents, country, payment_method, company_id,
                net_cents, vat_rate_basis_points, vat_cents, gross_cents
         FROM orders WHERE id = 3501`,
      )
      .get(),
    {
      ...legacyOrder,
      payment_method: 'card',
      company_id: null,
      net_cents: 11000,
      vat_rate_basis_points: 0,
      vat_cents: 0,
      gross_cents: 11000,
    },
  );
  assert.equal(
    db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'orders'").pluck().get(),
    orderSequence,
  );
  for (const index of [
    'idx_orders_admin',
    'orders_purchase_order_reference_idx',
    'orders_user_created_at_id_idx',
    'orders_demo_seed_key_idx',
    'orders_user_id_id_idx',
  ]) {
    assert.ok(indexNames(db, 'orders').includes(index), `${index} must survive order rebuild`);
  }

  for (const column of [
    'payment_method',
    'company_id',
    'net_cents',
    'vat_rate_basis_points',
    'vat_cents',
    'gross_cents',
  ]) {
    assert.ok(columnNames(db, 'orders').includes(column), `orders.${column}`);
  }

  db.prepare(
    `INSERT INTO payments
      (idempotency_key, request_fingerprint, status, amount_cents, card_last4, card_brand,
       payment_method, company_id, user_id, created_at)
     VALUES ('credit-schema-trade-payment', 'credit-trade-fingerprint', 'authorized_pending_finalize',
             12000, NULL, NULL, 'trade_credit', 3501, 3501, '2026-09-01T09:01:00.000Z')`,
  ).run();
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO payments
            (idempotency_key, request_fingerprint, status, amount_cents, card_last4, card_brand,
             payment_method, company_id, user_id)
           VALUES ('credit-schema-bad-payment', 'bad-payment-fingerprint', 'prepared', 12000,
                  '4242', NULL, 'trade_credit', 3501, 3501)`,
        )
        .run(),
    /CHECK constraint failed/,
  );
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO payments
            (idempotency_key, request_fingerprint, status, amount_cents, card_last4, card_brand,
             payment_method, company_id)
           VALUES ('credit-schema-bad-card', 'bad-card-fingerprint', 'prepared', 12000,
                   NULL, NULL, 'card', NULL)`,
        )
        .run(),
    /CHECK constraint failed/,
  );

  db.prepare(
    `INSERT INTO orders
      (id, customer_name, customer_email, shipping_address, subtotal_cents, total_cents,
       created_at, user_id, lifecycle_status, version, country, payment_method, company_id,
       net_cents, vat_rate_basis_points, vat_cents, gross_cents)
     VALUES (3502, 'Credit Order', 'credit-order@example.test', '3502 Test Lane', 10000, 12000,
             '2026-09-01T09:02:00.000Z', 3501, 'processing', 0, 'UK', 'trade_credit', 3501,
             10000, 2000, 2000, 12000)`,
  ).run();
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO orders
            (id, customer_name, customer_email, shipping_address, subtotal_cents, total_cents,
             payment_method, company_id, net_cents, vat_rate_basis_points, vat_cents, gross_cents)
           VALUES (3503, 'Bad Order', 'bad-order@example.test', '3503 Test Lane', 10000, 12000,
                   'trade_credit', NULL, 10000, 2000, 2000, 12000)`,
        )
        .run(),
    /CHECK constraint failed/,
  );
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO orders
            (id, customer_name, customer_email, shipping_address, subtotal_cents, total_cents,
             payment_method, company_id, net_cents, vat_rate_basis_points, vat_cents, gross_cents)
           VALUES (3504, 'Bad VAT', 'bad-vat@example.test', '3504 Test Lane', 10000, 12000,
                   'trade_credit', 3501, 10000, 2000, 2001, 12001)`,
        )
        .run(),
    /CHECK constraint failed/,
  );

  assert.deepEqual(columnNames(db, 'company_credit_events'), [
    'id',
    'company_id',
    'event_type',
    'credit_limit_cents',
    'credit_terms_days',
    'credit_state',
    'credit_version',
    'amount_cents',
    'reason',
    'idempotency_key',
    'request_fingerprint',
    'occurred_at',
  ]);
  db.prepare(
    `INSERT INTO company_credit_events
      (company_id, event_type, credit_limit_cents, credit_terms_days, credit_state,
       credit_version, amount_cents, reason, idempotency_key, request_fingerprint, occurred_at)
     VALUES (3501, 'state_changed', 50000, 30, 'active', 1, NULL, 'Approved',
             'credit-event-1', 'credit-event-fingerprint-1', '2026-09-01T09:03:00.000Z')`,
  ).run();
  assert.throws(
    () =>
      db
        .prepare(
          `UPDATE company_credit_events SET credit_state = 'on_hold' WHERE idempotency_key = 'credit-event-1'`,
        )
        .run(),
    /immutable/,
  );
  assert.throws(
    () =>
      db
        .prepare("DELETE FROM company_credit_events WHERE idempotency_key = 'credit-event-1'")
        .run(),
    /immutable/,
  );
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO company_credit_events
            (company_id, event_type, idempotency_key, request_fingerprint, occurred_at)
           VALUES (3501, 'state_changed', 'credit-event-1', 'credit-event-fingerprint-2',
                   '2026-09-01T09:04:00.000Z')`,
        )
        .run(),
    /UNIQUE constraint failed/,
  );

  assert.deepEqual(columnNames(db, 'credit_exposure_holds'), [
    'id',
    'company_id',
    'payment_idempotency_key',
    'amount_cents',
    'status',
    'expires_at',
    'invoice_id',
    'authorized_at',
    'committed_at',
    'released_at',
    'created_at',
    'updated_at',
  ]);
  for (const status of ['prepared', 'authorized', 'committed', 'released'] as const) {
    const paymentKey = `credit-schema-${status}-payment`;
    db.prepare(
      `INSERT INTO payments
        (idempotency_key, request_fingerprint, status, amount_cents, card_last4, card_brand,
         payment_method, company_id, user_id, created_at)
       VALUES (?, ?, 'authorized_pending_finalize', 100, NULL, NULL, 'trade_credit', 3501, 3501, ?)`,
    ).run(paymentKey, `${paymentKey}-fingerprint`, '2026-09-01T09:05:00.000Z');
    db.prepare(
      `INSERT INTO credit_exposure_holds
        (company_id, payment_idempotency_key, amount_cents, status, expires_at,
         authorized_at, committed_at, released_at, created_at, updated_at)
       VALUES (?, ?, 100, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      3501,
      paymentKey,
      status,
      status === 'prepared' ? '2026-09-01T10:00:00.000Z' : null,
      status === 'authorized' || status === 'committed' ? '2026-09-01T09:06:00.000Z' : null,
      status === 'committed' ? '2026-09-01T09:07:00.000Z' : null,
      status === 'released' ? '2026-09-01T09:08:00.000Z' : null,
      '2026-09-01T09:05:00.000Z',
      '2026-09-01T09:05:00.000Z',
    );
  }
  assert.ok(
    indexNames(db, 'credit_exposure_holds').includes('credit_exposure_holds_company_status_idx'),
  );
  assert.ok(
    indexNames(db, 'credit_exposure_holds').includes('credit_exposure_holds_status_expires_at_idx'),
  );
  assert.ok(indexNames(db, 'credit_exposure_holds').includes('credit_exposure_holds_payment_idx'));
  assert.ok(indexNames(db, 'credit_exposure_holds').includes('credit_exposure_holds_invoice_idx'));
  assert.equal((db.pragma('foreign_key_check') as unknown[]).length, 0);

  const beforeRerun = {
    events: db.prepare('SELECT * FROM company_credit_events ORDER BY id').all(),
    holds: db.prepare('SELECT * FROM credit_exposure_holds ORDER BY id').all(),
    payment: db.prepare('SELECT * FROM payments WHERE id = 3501').get(),
    order: db.prepare('SELECT * FROM orders WHERE id = 3501').get(),
  };
  migrateDatabase(db);
  assert.deepEqual(
    db.prepare('SELECT * FROM company_credit_events ORDER BY id').all(),
    beforeRerun.events,
  );
  assert.deepEqual(
    db.prepare('SELECT * FROM credit_exposure_holds ORDER BY id').all(),
    beforeRerun.holds,
  );
  assert.deepEqual(db.prepare('SELECT * FROM payments WHERE id = 3501').get(), beforeRerun.payment);
  assert.deepEqual(db.prepare('SELECT * FROM orders WHERE id = 3501').get(), beforeRerun.order);
  assert.equal((db.pragma('foreign_key_check') as unknown[]).length, 0);

  const paymentsSql = tableSql(db, 'payments');
  assert.match(paymentsSql, /payment_method IN \('card', 'trade_credit'\)/);
  assert.match(paymentsSql, /card_last4 IS NULL/);
});
