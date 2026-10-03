import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { closeDatabase, migrateDatabase } from '../../src/db/index.js';
import { migrations } from '../../src/db/migrations/index.js';

const pre038Migrations = migrations.filter((migration) => migration.version < '038');

const paymentColumns = [
  'id',
  'order_id',
  'idempotency_key',
  'request_fingerprint',
  'status',
  'amount_cents',
  'card_last4',
  'card_brand',
  'failure_reason',
  'created_at',
  'response_json',
  'cart_id',
  'quote_json',
  'gateway_reference',
  'updated_at',
  'reservation_expires_at',
  'payment_method',
  'company_id',
  'user_id',
];

function columnNames(db: Database.Database): string[] {
  return (db.prepare('PRAGMA table_info(payments)').all() as { name: string }[]).map(
    (column) => column.name,
  );
}

function indexNames(db: Database.Database): string[] {
  return (db.pragma('index_list(payments)') as { name: string }[])
    .map((index) => index.name)
    .sort();
}

function createLegacyFixture(db: Database.Database): void {
  db.exec(`
    INSERT INTO users
      (id, email, display_name, password_hash, password_salt, role, country)
    VALUES
      (3801, 'payment-identity-a@example.test', 'Payment Identity A', 'hash', 'salt', 'customer', 'UK'),
      (3802, 'payment-identity-b@example.test', 'Payment Identity B', 'hash', 'salt', 'customer', 'UK');

    INSERT INTO company_accounts
      (id, name, created_by_user_id, active, approval_threshold_cents, created_at, updated_at, country)
    VALUES (3801, 'Payment Identity Materials Ltd', 3801, 1, 0,
            '2026-09-03T10:00:00.000Z', '2026-09-03T10:00:00.000Z', 'UK');

    INSERT INTO orders
      (id, customer_name, customer_email, shipping_address, subtotal_cents, discount_cents,
       total_cents, created_at, user_id, lifecycle_status, version, country, payment_method,
       company_id, net_cents, vat_rate_basis_points, vat_cents, gross_cents)
    VALUES (3801, 'Payment Identity A', 'payment-identity-a@example.test', '3801 Identity Lane',
            10000, 0, 12000, '2026-09-03T10:00:00.000Z', 3801, 'processing', 0, 'UK',
            'trade_credit', 3801, 10000, 2000, 2000, 12000);

    INSERT INTO payments
      (id, order_id, idempotency_key, request_fingerprint, status, amount_cents,
       card_last4, card_brand, created_at, payment_method, company_id)
    VALUES
      (3801, 3801, 'payment-identity-credit', 'payment-identity-credit-fingerprint',
       'authorized_pending_finalize', 12000, NULL, NULL, '2026-09-03T10:00:00.000Z',
       'trade_credit', 3801),
      (3802, NULL, 'payment-identity-card', 'payment-identity-card-fingerprint',
       'succeeded', 5000, '4242', 'Visa', '2026-09-03T10:01:00.000Z', 'card', NULL);

    CREATE INDEX payments_identity_fixture_idx ON payments(company_id, id);
    UPDATE sqlite_sequence SET seq = 3899 WHERE name = 'payments';
  `);
}

void test('migration 038 backfills payment buyers and preserves schema state', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'shop-payment-user-identity-'));
  const db = new Database(join(directory, 'shop.db'));
  db.pragma('foreign_keys = ON');
  t.after(() => {
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  });

  migrateDatabase(db, pre038Migrations);
  createLegacyFixture(db);

  const beforeRows = db
    .prepare(
      `SELECT id, order_id, idempotency_key, request_fingerprint, status, amount_cents,
              card_last4, card_brand, failure_reason, created_at, response_json, cart_id,
              quote_json, gateway_reference, updated_at, reservation_expires_at,
              payment_method, company_id
       FROM payments ORDER BY id`,
    )
    .all();
  const beforeSequence = db
    .prepare("SELECT seq FROM sqlite_sequence WHERE name = 'payments'")
    .pluck()
    .get();
  const beforeFixtureIndexSql = (
    db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'payments_identity_fixture_idx'",
      )
      .get() as { sql: string }
  ).sql;

  migrateDatabase(db);

  assert.equal(
    db.prepare('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1').pluck().get(),
    '038',
  );
  assert.deepEqual(columnNames(db), paymentColumns);
  assert.deepEqual(
    db
      .prepare(
        `SELECT id, order_id, idempotency_key, payment_method, company_id, user_id
         FROM payments ORDER BY id`,
      )
      .all(),
    [
      {
        id: 3801,
        order_id: 3801,
        idempotency_key: 'payment-identity-credit',
        payment_method: 'trade_credit',
        company_id: 3801,
        user_id: 3801,
      },
      {
        id: 3802,
        order_id: null,
        idempotency_key: 'payment-identity-card',
        payment_method: 'card',
        company_id: null,
        user_id: null,
      },
    ],
  );
  assert.deepEqual(
    db
      .prepare(
        `SELECT id, order_id, idempotency_key, request_fingerprint, status, amount_cents,
                card_last4, card_brand, failure_reason, created_at, response_json, cart_id,
                quote_json, gateway_reference, updated_at, reservation_expires_at,
                payment_method, company_id
         FROM payments ORDER BY id`,
      )
      .all(),
    beforeRows,
    'migration preserves every pre-existing payment fact',
  );
  assert.equal(
    db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'payments'").pluck().get(),
    beforeSequence,
  );
  assert.ok(indexNames(db).includes('payments_status_idx'));
  assert.ok(indexNames(db).includes('payments_order_id_status_idx'));
  assert.ok(indexNames(db).includes('payments_identity_fixture_idx'));
  assert.equal(
    (
      db
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'payments_identity_fixture_idx'",
        )
        .get() as { sql: string }
    ).sql,
    beforeFixtureIndexSql,
  );

  assert.deepEqual(
    (db.pragma('foreign_key_list(payments)') as Array<{ table: string; from: string; to: string }>)
      .map(({ table, from, to }) => ({ table, from, to }))
      .sort((left, right) =>
        `${left.table}:${left.from}`.localeCompare(`${right.table}:${right.from}`),
      ),
    [
      { table: 'company_accounts', from: 'company_id', to: 'id' },
      { table: 'orders', from: 'order_id', to: 'id' },
      { table: 'users', from: 'user_id', to: 'id' },
    ],
  );
  assert.deepEqual(db.pragma('foreign_key_check'), []);

  const insert = db.prepare(
    `INSERT INTO payments
      (idempotency_key, request_fingerprint, status, amount_cents, card_last4, card_brand,
       payment_method, company_id, user_id, created_at)
     VALUES (?, ?, 'prepared', ?, ?, ?, ?, ?, ?, '2026-09-03T10:02:00.000Z')`,
  );
  assert.throws(
    () =>
      insert.run(
        'payment-identity-bad-card-user',
        'bad-card-user',
        100,
        '4242',
        'Visa',
        'card',
        null,
        3801,
      ),
    /CHECK constraint failed/,
    'card rows cannot carry a buyer identity',
  );
  assert.throws(
    () =>
      insert.run(
        'payment-identity-bad-credit-null',
        'bad-credit-null',
        100,
        null,
        null,
        'trade_credit',
        3801,
        null,
      ),
    /CHECK constraint failed/,
    'credit rows require a buyer identity',
  );
  assert.throws(
    () =>
      insert.run(
        'payment-identity-bad-credit-zero',
        'bad-credit-zero',
        100,
        null,
        null,
        'trade_credit',
        3801,
        0,
      ),
    /CHECK constraint failed/,
    'credit identities must be positive',
  );
  assert.throws(
    () =>
      insert.run(
        'payment-identity-bad-credit-fk',
        'bad-credit-fk',
        100,
        null,
        null,
        'trade_credit',
        3801,
        999999,
      ),
    /FOREIGN KEY constraint failed/,
    'credit identities must reference an existing user',
  );

  const afterRows = db.prepare('SELECT * FROM payments ORDER BY id').all();
  const migration038 = migrations.find((migration) => migration.version === '038');
  assert.ok(migration038);
  migrateDatabase(db);
  migration038.up(db);
  assert.deepEqual(db.prepare('SELECT * FROM payments ORDER BY id').all(), afterRows);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
});

void test('fresh migration 038 exposes a nullable payment user foreign key', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  try {
    migrateDatabase(db);
    assert.equal(
      db
        .prepare('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1')
        .pluck()
        .get(),
      '038',
    );
    assert.equal(
      (
        db.prepare('PRAGMA table_info(payments)').all() as Array<{ name: string; notnull: number }>
      ).find((column) => column.name === 'user_id')?.notnull,
      0,
    );
    assert.deepEqual(db.pragma('foreign_key_check'), []);
  } finally {
    db.close();
  }
});
