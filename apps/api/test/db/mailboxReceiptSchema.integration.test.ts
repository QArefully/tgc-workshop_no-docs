import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { closeDatabase, migrateDatabase } from '../../src/db/index.js';
import { migrations } from '../../src/db/migrations/index.js';

const pre034Migrations = migrations.filter((migration) => migration.version < '034');
const migrationsThrough034 = migrations.filter((migration) => migration.version <= '034');

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

void test('migration 034 adds structured mailbox storage without losing legacy messages', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'shop-mailbox-receipt-schema-'));
  const db = new Database(join(directory, 'shop.db'));
  db.pragma('foreign_keys = ON');
  t.after(() => {
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  });

  migrateDatabase(db, pre034Migrations);
  db.prepare(
    `INSERT INTO orders
      (id, customer_name, customer_email, shipping_address, subtotal_cents, total_cents,
       lifecycle_status, version, country)
     VALUES (3401, 'Mailbox buyer', 'mailbox-order@example.test', '1 Mailbox Lane',
             12500, 12500, 'processing', 0, 'UK')`,
  ).run();
  db.prepare(
    `INSERT INTO dev_mailbox (id, recipient, subject, body, kind, created_at)
     VALUES (3401, 'legacy@example.test', 'Legacy subject', 'Legacy body', 'plain',
             '2026-08-07T10:00:00.000Z')`,
  ).run();

  migrateDatabase(db, migrationsThrough034);

  assert.equal(migrationVersions(db).at(-1), '034');
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
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
      .get('dev_mailbox_order_id_idx'),
    { name: 'dev_mailbox_order_id_idx' },
  );
  assert.deepEqual(
    db
      .prepare(
        'SELECT id, recipient, subject, body, kind, created_at, order_id, template_key, template_params_json, template_country FROM dev_mailbox WHERE id = 3401',
      )
      .get(),
    {
      id: 3401,
      recipient: 'legacy@example.test',
      subject: 'Legacy subject',
      body: 'Legacy body',
      kind: 'plain',
      created_at: '2026-08-07T10:00:00.000Z',
      order_id: null,
      template_key: null,
      template_params_json: null,
      template_country: null,
    },
  );

  db.prepare(
    `INSERT INTO dev_mailbox
      (recipient, subject, body, kind, created_at, template_key, template_params_json,
       template_country)
     VALUES ('template@example.test', 'Template', 'Template body', 'template',
             '2026-08-07T10:01:00.000Z', 'password_reset', '{"token":"abc"}', 'DE')`,
  ).run();
  db.prepare(
    `INSERT INTO dev_mailbox
      (recipient, subject, body, kind, created_at, order_id)
     VALUES ('receipt@example.test', 'Receipt', 'Receipt body', 'order_receipt',
             '2026-08-07T10:02:00.000Z', 3401)`,
  ).run();

  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO dev_mailbox
            (recipient, subject, body, kind, template_key, template_params_json, template_country)
           VALUES ('partial@example.test', 'Partial', 'Partial body', 'template',
                   'password_reset', NULL, 'DE')`,
        )
        .run(),
    /CHECK constraint failed/,
  );
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO dev_mailbox
            (recipient, subject, body, kind, order_id, template_key, template_params_json,
             template_country)
           VALUES ('mixed@example.test', 'Mixed', 'Mixed body', 'receipt', 3401,
                   'password_reset', '{"token":"abc"}', 'DE')`,
        )
        .run(),
    /CHECK constraint failed/,
  );
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO dev_mailbox
            (recipient, subject, body, kind, template_key, template_params_json, template_country)
           VALUES ('invalid-json@example.test', 'Invalid JSON', 'Invalid JSON body', 'template',
                   'password_reset', '{not-json}', 'DE')`,
        )
        .run(),
    /CHECK constraint failed|malformed JSON/,
  );
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO dev_mailbox
            (recipient, subject, body, kind, order_id)
           VALUES ('orphan@example.test', 'Orphan', 'Orphan body', 'order_receipt', 999999)`,
        )
        .run(),
    /FOREIGN KEY constraint failed/,
  );

  db.prepare('DELETE FROM orders WHERE id = 3401').run();
  assert.deepEqual(
    db
      .prepare(
        'SELECT order_id, template_key, template_params_json, template_country FROM dev_mailbox WHERE kind = ?',
      )
      .get('order_receipt'),
    { order_id: null, template_key: null, template_params_json: null, template_country: null },
  );

  const beforeRerun = db
    .prepare(
      'SELECT id, recipient, subject, body, kind, created_at, order_id, template_key, template_params_json, template_country FROM dev_mailbox ORDER BY id',
    )
    .all();
  migrateDatabase(db, migrationsThrough034);
  assert.deepEqual(
    db
      .prepare(
        'SELECT id, recipient, subject, body, kind, created_at, order_id, template_key, template_params_json, template_country FROM dev_mailbox ORDER BY id',
      )
      .all(),
    beforeRerun,
  );
  assert.equal((db.pragma('foreign_key_check') as unknown[]).length, 0);
});

void test('migration 034 rejects a same-name index collision instead of recording an incomplete schema', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'shop-mailbox-receipt-index-collision-'));
  const db = new Database(join(directory, 'shop.db'));
  db.pragma('foreign_keys = ON');
  t.after(() => {
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  });

  migrateDatabase(db, pre034Migrations);
  db.prepare(
    `INSERT INTO dev_mailbox (recipient, subject, body, kind, created_at)
     VALUES ('legacy@example.test', 'Legacy subject', 'Legacy body', 'plain',
             '2026-08-07T10:00:00.000Z')`,
  ).run();
  db.exec('CREATE INDEX dev_mailbox_order_id_idx ON dev_mailbox(id)');

  assert.throws(
    () => migrateDatabase(db, migrationsThrough034),
    /Migration 034 found incompatible index dev_mailbox_order_id_idx/,
  );
  assert.equal(migrationVersions(db).at(-1), '033');
  assert.deepEqual(columnNames(db), ['id', 'recipient', 'subject', 'body', 'kind', 'created_at']);
  assert.deepEqual(
    (db.pragma('index_info(dev_mailbox_order_id_idx)') as { name: string }[]).map(
      (column) => column.name,
    ),
    ['id'],
  );

  db.exec('DROP INDEX dev_mailbox_order_id_idx');
  migrateDatabase(db, migrationsThrough034);

  assert.equal(migrationVersions(db).at(-1), '034');
  assert.deepEqual(
    (db.pragma('index_info(dev_mailbox_order_id_idx)') as { name: string }[]).map(
      (column) => column.name,
    ),
    ['order_id'],
  );
  assert.deepEqual(
    db.prepare('SELECT recipient, subject, body, kind, created_at FROM dev_mailbox').get(),
    {
      recipient: 'legacy@example.test',
      subject: 'Legacy subject',
      body: 'Legacy body',
      kind: 'plain',
      created_at: '2026-08-07T10:00:00.000Z',
    },
  );
  assert.equal((db.pragma('foreign_key_check') as unknown[]).length, 0);
});
