import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { closeDatabase, migrateDatabase } from '../../src/db/index.js';
import { migrations } from '../../src/db/migrations/index.js';

const pre037Migrations = migrations.filter((migration) => migration.version < '037');

function migrationVersions(db: Database.Database): string[] {
  return db
    .prepare('SELECT version FROM schema_migrations ORDER BY version')
    .all()
    .map((row) => (row as { version: string }).version);
}

function columnNames(db: Database.Database): string[] {
  return (db.prepare('PRAGMA table_info(dev_mailbox)').all() as { name: string }[]).map(
    (column) => column.name,
  );
}

function indexNames(db: Database.Database): string[] {
  return (db.pragma('index_list(dev_mailbox)') as { name: string }[])
    .map((index) => index.name)
    .sort();
}

function createLegacyMailboxFixture(db: Database.Database): void {
  db.prepare(
    `INSERT INTO orders
      (id, customer_name, customer_email, shipping_address, subtotal_cents, total_cents,
       lifecycle_status, version, country)
     VALUES (3701, 'Mailbox buyer', 'mailbox-order@example.test', '1 Mailbox Lane',
             12500, 12500, 'processing', 0, 'UK')`,
  ).run();
  db.exec(`
    INSERT INTO dev_mailbox
      (id, recipient, subject, body, kind, created_at)
    VALUES (37001, 'legacy@example.test', 'Legacy subject', 'Legacy body', 'notification',
            '2026-09-01T10:00:00.000Z');

    INSERT INTO dev_mailbox
      (id, recipient, subject, body, kind, created_at, template_key, template_params_json,
       template_country)
    VALUES (37002, 'template@example.test', 'Template subject', 'Template body', 'template',
            '2026-09-01T10:01:00.000Z', 'password_reset', '{"resetUrl":"https://example.test/reset"}',
            'UK');

    INSERT INTO dev_mailbox
      (id, recipient, subject, body, kind, created_at, order_id)
    VALUES (37003, 'receipt@example.test', 'Receipt subject', 'Receipt body', 'order_receipt',
            '2026-09-01T10:02:00.000Z', 3701);

    CREATE INDEX dev_mailbox_recipient_idx ON dev_mailbox(recipient, id);
    UPDATE sqlite_sequence SET seq = 37999 WHERE name = 'dev_mailbox';
  `);
}

function createInvoiceFixture(db: Database.Database): number {
  db.exec(`
    INSERT INTO users
      (id, email, display_name, password_hash, password_salt, role, country)
    VALUES (3702, 'invoice-mailbox@example.test', 'Invoice Mailbox Buyer', 'hash', 'salt',
            'customer', 'UK');

    INSERT INTO company_accounts
      (id, name, created_by_user_id, active, approval_threshold_cents, created_at, updated_at,
       country)
    VALUES (3702, 'Invoice Mailbox Materials Ltd', 3702, 1, 0,
            '2026-09-01T10:00:00.000Z', '2026-09-01T10:00:00.000Z', 'UK');

    INSERT INTO orders
      (id, customer_name, customer_email, shipping_address, subtotal_cents, discount_cents,
       total_cents, created_at, user_id, lifecycle_status, version, country, payment_method,
       company_id, net_cents, vat_rate_basis_points, vat_cents, gross_cents)
    VALUES (3702, 'Invoice Mailbox Buyer', 'invoice-mailbox@example.test', '2 Invoice Lane',
            10000, 0, 12000, '2026-09-01T10:00:00.000Z', 3702, 'processing', 0, 'UK',
            'trade_credit', 3702, 10000, 2000, 2000, 12000);

    INSERT INTO payments
      (id, order_id, idempotency_key, request_fingerprint, status, amount_cents,
       card_last4, card_brand, created_at, payment_method, company_id, user_id)
    VALUES (3702, 3702, 'invoice-mailbox-payment', 'invoice-mailbox-fingerprint',
            'authorized_pending_finalize', 12000, NULL, NULL, '2026-09-01T10:00:00.000Z',
            'trade_credit', 3702, 3702);
  `);

  const invoiceId = 3702;
  const invoiceNumber = 'QME-2026-000002';
  const issuedAt = '2026-09-01T10:00:00.000Z';
  const dueAt = '2026-10-01T10:00:00.000Z';
  const document = {
    version: 1,
    id: String(invoiceId),
    invoiceNumber,
    orderId: '3702',
    companyId: '3702',
    userId: '3702',
    country: 'UK',
    paymentMethod: 'trade_credit',
    currency: 'GBP',
    terms: 'net_30',
    billingEntity: {
      legalName: 'Invoice Mailbox Materials Ltd',
      registrationNumber: null,
      vatNumber: null,
      address: {
        line1: 'Invoice Mailbox Lane',
        city: 'Leeds',
        postcode: 'LS1 1AA',
        countryCode: 'GB',
      },
    },
    purchaseOrderReference: null,
    paymentIdempotencyKey: 'invoice-mailbox-payment',
    lines: [
      {
        lineId: '1',
        description: 'Material sacks',
        quantity: 2,
        unitPriceCents: 5000,
        netCents: 10000,
      },
    ],
    netCents: 10000,
    vatRateBasisPoints: 2000,
    vatCents: 2000,
    grossCents: 12000,
    issuedAt,
    dueAt,
  };

  db.prepare(
    `INSERT INTO invoices
      (id, version, invoice_number, order_id, payment_idempotency_key, company_id, user_id,
       country, currency, terms, terms_days, document_json, net_cents, vat_rate_basis_points,
       vat_cents, gross_cents, issued_at, due_at)
     VALUES (?, 1, ?, 3702, 'invoice-mailbox-payment', 3702, 3702, 'UK', 'GBP', 'net_30', 30,
             ?, 10000, 2000, 2000, 12000, ?, ?)`,
  ).run(invoiceId, invoiceNumber, JSON.stringify(document), issuedAt, dueAt);
  return invoiceId;
}

function insertInvoiceMailboxRow(
  db: Database.Database,
  values: {
    kind?: string;
    invoiceId?: number | null;
    orderId?: number | null;
    templateKey?: string;
  },
): void {
  db.prepare(
    `INSERT INTO dev_mailbox
      (recipient, subject, body, kind, created_at, order_id, template_key, invoice_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'descriptor@example.test',
    'Invoice descriptor',
    'Render from the invoice document',
    values.kind ?? 'invoice_issued',
    '2026-09-01T10:05:00.000Z',
    values.orderId ?? null,
    values.templateKey ?? null,
    values.invoiceId ?? null,
  );
}

void test('migration 037 preserves mailbox rows, sequence, and indexes while adding invoice descriptors', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'shop-invoice-mailbox-schema-'));
  const db = new Database(join(directory, 'shop.db'));
  db.pragma('foreign_keys = ON');
  t.after(() => {
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  });

  migrateDatabase(db, pre037Migrations);
  createLegacyMailboxFixture(db);

  const beforeRows = db
    .prepare(
      `SELECT id, recipient, subject, body, kind, created_at, order_id, template_key,
              template_params_json, template_country
       FROM dev_mailbox ORDER BY id`,
    )
    .all();
  const beforeSequence = (
    db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'dev_mailbox'").get() as {
      seq: number;
    }
  ).seq;
  const beforeCustomIndexSql = (
    db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'dev_mailbox_recipient_idx'",
      )
      .get() as { sql: string }
  ).sql;

  migrateDatabase(db);

  assert.equal(migrationVersions(db).at(-1), '038');
  assert.deepEqual(columnNames(db), [
    'id',
    'recipient',
    'subject',
    'body',
    'kind',
    'created_at',
    'order_id',
    'template_key',
    'template_params_json',
    'template_country',
    'invoice_id',
  ]);
  assert.deepEqual(
    (
      db.pragma('foreign_key_list(dev_mailbox)') as Array<{
        table: string;
        from: string;
        to: string;
        on_delete: string;
      }>
    )
      .map(({ table, from, to, on_delete }) => ({ table, from, to, on_delete }))
      .sort((left, right) => left.table.localeCompare(right.table)),
    [
      { table: 'invoices', from: 'invoice_id', to: 'id', on_delete: 'RESTRICT' },
      { table: 'orders', from: 'order_id', to: 'id', on_delete: 'SET NULL' },
    ],
  );
  assert.deepEqual(indexNames(db), [
    'dev_mailbox_invoice_id_idx',
    'dev_mailbox_order_id_idx',
    'dev_mailbox_recipient_idx',
  ]);
  assert.equal(
    (
      db
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'dev_mailbox_recipient_idx'",
        )
        .get() as { sql: string }
    ).sql,
    beforeCustomIndexSql,
  );
  assert.deepEqual(
    db
      .prepare(
        `SELECT id, recipient, subject, body, kind, created_at, order_id, template_key,
                template_params_json, template_country
         FROM dev_mailbox ORDER BY id`,
      )
      .all(),
    beforeRows,
  );
  assert.equal(
    db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'dev_mailbox'").pluck().get(),
    beforeSequence,
  );

  const invoiceId = createInvoiceFixture(db);
  insertInvoiceMailboxRow(db, { invoiceId });
  assert.deepEqual(
    db
      .prepare(
        `SELECT kind, invoice_id, order_id, template_key, template_params_json, template_country
         FROM dev_mailbox WHERE kind = 'invoice_issued'`,
      )
      .get(),
    {
      kind: 'invoice_issued',
      invoice_id: invoiceId,
      order_id: null,
      template_key: null,
      template_params_json: null,
      template_country: null,
    },
  );
  assert.equal((db.pragma('foreign_key_check') as unknown[]).length, 0);

  const beforeRerun = db.prepare('SELECT * FROM dev_mailbox ORDER BY id').all();
  const migration037 = migrations.find((migration) => migration.version === '037')!;
  migrateDatabase(db);
  migration037.up(db);
  assert.deepEqual(db.prepare('SELECT * FROM dev_mailbox ORDER BY id').all(), beforeRerun);
  assert.deepEqual(indexNames(db), [
    'dev_mailbox_invoice_id_idx',
    'dev_mailbox_order_id_idx',
    'dev_mailbox_recipient_idx',
  ]);
  assert.equal((db.pragma('foreign_key_check') as unknown[]).length, 0);
});

void test('migration 037 rejects mixed or missing invoice metadata and orphan invoice IDs', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'shop-invoice-mailbox-checks-'));
  const db = new Database(join(directory, 'shop.db'));
  db.pragma('foreign_keys = ON');
  t.after(() => {
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  });

  migrateDatabase(db);
  const invoiceId = createInvoiceFixture(db);

  assert.throws(
    () => insertInvoiceMailboxRow(db, {}),
    /CHECK constraint failed/,
    'invoice_issued rows require invoice_id',
  );
  assert.throws(
    () => insertInvoiceMailboxRow(db, { invoiceId, orderId: 3702 }),
    /CHECK constraint failed/,
    'invoice descriptors cannot carry order metadata',
  );
  assert.throws(
    () => insertInvoiceMailboxRow(db, { invoiceId, templateKey: 'password_reset' }),
    /CHECK constraint failed/,
    'invoice descriptors cannot carry template metadata',
  );
  assert.throws(
    () => insertInvoiceMailboxRow(db, { kind: 'notification', invoiceId }),
    /CHECK constraint failed/,
    'invoice_id is reserved for invoice_issued rows',
  );
  assert.throws(
    () => insertInvoiceMailboxRow(db, { invoiceId: 999999 }),
    /FOREIGN KEY constraint failed/,
    'invoice_id must reference an existing invoice',
  );
  assert.throws(
    () => insertInvoiceMailboxRow(db, { invoiceId: 0 }),
    /CHECK constraint failed/,
    'invoice_id must be positive',
  );

  insertInvoiceMailboxRow(db, { invoiceId });
  assert.throws(() => db.prepare('DELETE FROM invoices WHERE id = ?').run(invoiceId));
  assert.equal((db.pragma('foreign_key_check') as unknown[]).length, 0);
});

void test('migration 037 rejects a wrong-shape same-name index before rebuilding mailbox', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'shop-invoice-mailbox-index-collision-'));
  const db = new Database(join(directory, 'shop.db'));
  db.pragma('foreign_keys = ON');
  t.after(() => {
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  });

  migrateDatabase(db, pre037Migrations);
  db.exec(
    'DROP INDEX dev_mailbox_order_id_idx; CREATE INDEX dev_mailbox_invoice_id_idx ON dev_mailbox(id);',
  );

  assert.throws(
    () => migrateDatabase(db),
    /Migration 037 found incompatible index dev_mailbox_invoice_id_idx/,
  );
  assert.equal(migrationVersions(db).at(-1), '036');
  assert.deepEqual(columnNames(db), [
    'id',
    'recipient',
    'subject',
    'body',
    'kind',
    'created_at',
    'order_id',
    'template_key',
    'template_params_json',
    'template_country',
  ]);
  assert.deepEqual(
    (db.pragma('index_info(dev_mailbox_invoice_id_idx)') as { name: string }[]).map(
      (column) => column.name,
    ),
    ['id'],
  );

  db.exec('DROP INDEX dev_mailbox_invoice_id_idx;');
  migrateDatabase(db);
  assert.equal(migrationVersions(db).at(-1), '038');
  assert.deepEqual(
    (db.pragma('index_info(dev_mailbox_invoice_id_idx)') as { name: string }[]).map(
      (column) => column.name,
    ),
    ['invoice_id'],
  );
  assert.equal((db.pragma('foreign_key_check') as unknown[]).length, 0);
});
