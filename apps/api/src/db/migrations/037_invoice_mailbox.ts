import type { Migration } from '../migrate.js';

type MigrationDb = Parameters<Migration['up']>[0];

const MAILBOX_COLUMNS = [
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
] as const;
const REQUIRED_MAILBOX_COLUMNS = MAILBOX_COLUMNS.slice(1, 6);
const MAILBOX_ORDER_INDEX = 'dev_mailbox_order_id_idx';
const MAILBOX_INVOICE_INDEX = 'dev_mailbox_invoice_id_idx';

type TableInfoRow = {
  name: string;
  notnull: number;
  pk: number;
};

type ForeignKeyRow = {
  table: string;
  from: string;
  to: string;
  on_delete: string;
};

type IndexListRow = {
  name: string;
  unique: number;
  origin: string;
  partial: number;
};

type IndexInfoRow = {
  name: string | null;
};

type SchemaObject = {
  name: string;
  sql: string;
};

function hasTable(db: MigrationDb, table: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table),
  );
}

function hasIndexNamed(db: MigrationDb, index: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?").get(index),
  );
}

function tableInfo(db: MigrationDb): TableInfoRow[] {
  return db.prepare('PRAGMA table_info(dev_mailbox)').all() as TableInfoRow[];
}

function columnNames(db: MigrationDb): string[] {
  return tableInfo(db).map((column) => column.name);
}

function tableSql(db: MigrationDb): string | undefined {
  return (
    (
      db
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'dev_mailbox'")
        .get() as { sql: string | null } | undefined
    )?.sql ?? undefined
  );
}

function hasExpectedColumns(db: MigrationDb): boolean {
  const columns = tableInfo(db);
  if (columns.length !== MAILBOX_COLUMNS.length) return false;
  if (!columns.every((column, index) => column.name === MAILBOX_COLUMNS[index])) return false;

  const id = columns[0];
  if (!id || id.pk !== 1 || id.notnull !== 0) return false;
  const required = new Set<string>(REQUIRED_MAILBOX_COLUMNS);
  if (columns.some((column) => required.has(column.name) && column.notnull !== 1)) return false;
  return columns
    .filter((column) => !required.has(column.name))
    .every((column) => column.notnull === 0 && column.pk === 0);
}

function hasExpectedForeignKeys(db: MigrationDb): boolean {
  const keys = db.pragma('foreign_key_list(dev_mailbox)') as ForeignKeyRow[];
  const hasOrderForeignKey = keys.some(
    (key) =>
      key.table === 'orders' &&
      key.from === 'order_id' &&
      key.to === 'id' &&
      key.on_delete.toUpperCase() === 'SET NULL',
  );
  const hasInvoiceForeignKey = keys.some(
    (key) =>
      key.table === 'invoices' &&
      key.from === 'invoice_id' &&
      key.to === 'id' &&
      key.on_delete.toUpperCase() === 'RESTRICT',
  );
  return keys.length === 2 && hasOrderForeignKey && hasInvoiceForeignKey;
}

function hasExpectedIndex(db: MigrationDb, indexName: string, columnName: string): boolean {
  const schema = db
    .prepare("SELECT tbl_name FROM sqlite_master WHERE type = 'index' AND name = ?")
    .get(indexName) as { tbl_name: string } | undefined;
  if (!schema || schema.tbl_name !== 'dev_mailbox') return false;

  const index = (db.pragma('index_list(dev_mailbox)') as IndexListRow[]).find(
    (candidate) => candidate.name === indexName,
  );
  if (!index || index.unique !== 0 || index.origin !== 'c' || index.partial !== 0) return false;

  const columns = db.pragma(`index_info(${indexName})`) as IndexInfoRow[];
  return columns.length === 1 && columns[0]?.name === columnName;
}

function hasExpectedDescriptorCheck(db: MigrationDb): boolean {
  const sql = tableSql(db);
  if (!sql) return false;
  const normalized = sql.replace(/\s+/g, ' ').toLowerCase();

  // The completion marker must include the invoice branch and the old metadata branches. This
  // prevents a partial ALTER TABLE (column/FK/index only) from being treated as a finished rebuild.
  return (
    normalized.includes("kind = 'invoice_issued'") &&
    normalized.includes('invoice_id is not null') &&
    normalized.includes('invoice_id is null') &&
    normalized.includes('order_id is null') &&
    normalized.includes('template_key is null') &&
    normalized.includes('template_params_json is null') &&
    normalized.includes('template_country is null')
  );
}

function hasCompletedSchema(db: MigrationDb): boolean {
  return (
    hasExpectedColumns(db) &&
    hasExpectedForeignKeys(db) &&
    hasExpectedIndex(db, MAILBOX_ORDER_INDEX, 'order_id') &&
    hasExpectedIndex(db, MAILBOX_INVOICE_INDEX, 'invoice_id') &&
    hasExpectedDescriptorCheck(db)
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

function preserveSequence(db: MigrationDb, sequence: number | undefined): void {
  if (sequence === undefined) return;

  const current = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'dev_mailbox'").get() as
    { seq: number } | undefined;
  if (current) {
    db.prepare("UPDATE sqlite_sequence SET seq = MAX(seq, ?) WHERE name = 'dev_mailbox'").run(
      sequence,
    );
  } else {
    db.prepare("INSERT INTO sqlite_sequence (name, seq) VALUES ('dev_mailbox', ?)").run(sequence);
  }
}

function assertIndexCollisions(db: MigrationDb): void {
  for (const [indexName, columnName] of [
    [MAILBOX_ORDER_INDEX, 'order_id'],
    [MAILBOX_INVOICE_INDEX, 'invoice_id'],
  ] as const) {
    if (hasIndexNamed(db, indexName) && !hasExpectedIndex(db, indexName, columnName)) {
      throw new Error(
        `Migration 037 found incompatible index ${indexName}; refusing to treat the index name as a completion marker`,
      );
    }
  }
}

function assertForeignKeysClean(db: MigrationDb): void {
  const violations = db.pragma('foreign_key_check') as unknown[];
  if (violations.length > 0) {
    throw new Error(`Foreign key violations after migration 037: ${JSON.stringify(violations)}`);
  }
}

/** Adds the invoice-only mailbox descriptor while preserving all historical mailbox records. */
export const invoiceMailboxMigration: Migration = {
  version: '037',
  name: 'invoice issued mailbox descriptor',
  up(db) {
    if (!hasTable(db, 'dev_mailbox')) {
      throw new Error('Migration 037 requires the dev_mailbox table from migration 001');
    }
    if (!hasTable(db, 'invoices')) {
      throw new Error('Migration 037 requires the invoices table from migration 036');
    }

    // The complete schema is the idempotency marker. A name-only marker is unsafe because an
    // index with the expected name may point at another column or another table.
    if (hasCompletedSchema(db)) {
      assertForeignKeysClean(db);
      return;
    }

    // Refuse same-name collisions before any table work. This keeps an accidental index shape from
    // being silently replaced while allowing a valid pre-existing order index to be replayed.
    assertIndexCollisions(db);

    const existingColumns = columnNames(db);
    const supportedColumns = new Set<string>(MAILBOX_COLUMNS);
    const unknownColumns = existingColumns.filter((column) => !supportedColumns.has(column));
    if (unknownColumns.length > 0) {
      throw new Error(
        `Migration 037 cannot rebuild dev_mailbox with unknown columns: ${unknownColumns.join(', ')}`,
      );
    }
    const missingColumns = REQUIRED_MAILBOX_COLUMNS.filter(
      (column) => !existingColumns.includes(column),
    );
    if (missingColumns.length > 0) {
      throw new Error(
        `Migration 037 cannot rebuild dev_mailbox with missing columns: ${missingColumns.join(', ')}`,
      );
    }

    const existingCount = (
      db.prepare('SELECT COUNT(*) AS count FROM dev_mailbox').get() as { count: number }
    ).count;
    const sequence = (
      db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'dev_mailbox'").get() as
        { seq: number } | undefined
    )?.seq;
    const indexes = explicitSchemaObjects(db, 'index', 'dev_mailbox');
    const triggers = explicitSchemaObjects(db, 'trigger', 'dev_mailbox');

    // SQLite cannot add a table-level CHECK or alter a foreign-key target in place. Build the new
    // table first, copy every source column, then swap it in one migration transaction. Invoice
    // descriptors persist only invoice_id; legacy/template/order metadata is mutually exclusive.
    db.exec(`
      DROP TABLE IF EXISTS dev_mailbox_new;
      CREATE TABLE dev_mailbox_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recipient TEXT NOT NULL,
        subject TEXT NOT NULL,
        body TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'plain',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
        template_key TEXT CHECK (template_key IS NULL OR length(template_key) > 0),
        template_params_json TEXT CHECK (
          template_params_json IS NULL
          OR (json_valid(template_params_json) AND json_type(template_params_json) = 'object')
        ),
        template_country TEXT CHECK (
          template_country IS NULL OR template_country IN ('UK', 'US', 'CN', 'PL', 'ES', 'DE', 'FR')
        ),
        invoice_id INTEGER REFERENCES invoices(id) ON DELETE RESTRICT CHECK (
          invoice_id IS NULL
          OR (typeof(invoice_id) = 'integer' AND invoice_id > 0)
        ),
        CHECK (
          (invoice_id IS NULL
            AND kind <> 'invoice_issued'
            AND order_id IS NULL
            AND template_key IS NULL
            AND template_params_json IS NULL
            AND template_country IS NULL)
          OR
          (invoice_id IS NULL
            AND kind <> 'invoice_issued'
            AND order_id IS NULL
            AND template_key IS NOT NULL
            AND template_params_json IS NOT NULL
            AND template_country IS NOT NULL)
          OR
          (invoice_id IS NULL
            AND kind <> 'invoice_issued'
            AND order_id IS NOT NULL
            AND template_key IS NULL
            AND template_params_json IS NULL
            AND template_country IS NULL)
          OR
          (kind = 'invoice_issued'
            AND invoice_id IS NOT NULL
            AND order_id IS NULL
            AND template_key IS NULL
            AND template_params_json IS NULL
            AND template_country IS NULL)
        )
      );
    `);

    const columnList = existingColumns.join(', ');
    db.exec(`
      INSERT INTO dev_mailbox_new (${columnList})
      SELECT ${columnList} FROM dev_mailbox ORDER BY id;
    `);

    const copiedCount = (
      db.prepare('SELECT COUNT(*) AS count FROM dev_mailbox_new').get() as { count: number }
    ).count;
    if (copiedCount !== existingCount) {
      throw new Error(
        `dev_mailbox rebuild count mismatch: ${existingCount} existing vs ${copiedCount} copied`,
      );
    }

    const comparableColumns = existingColumns.filter((column) => column !== 'id');
    const mismatchPredicate = comparableColumns
      .map((column) => `old.${column} IS NOT copy.${column}`)
      .join('\n             OR ');
    const mismatch = db
      .prepare(
        `SELECT old.id
           FROM dev_mailbox old
           LEFT JOIN dev_mailbox_new copy ON copy.id = old.id
          WHERE copy.id IS NULL
             OR old.id IS NOT copy.id
             OR ${mismatchPredicate}
          LIMIT 1`,
      )
      .get() as { id: number } | undefined;
    if (mismatch) {
      throw new Error(`dev_mailbox rebuild value mismatch at row ${mismatch.id}`);
    }

    db.exec('DROP TABLE dev_mailbox; ALTER TABLE dev_mailbox_new RENAME TO dev_mailbox;');
    preserveSequence(db, sequence);

    const existingIndexNames = new Set(indexes.map((index) => index.name));
    for (const index of indexes) db.exec(index.sql);
    if (!existingIndexNames.has(MAILBOX_ORDER_INDEX)) {
      db.exec(`CREATE INDEX ${MAILBOX_ORDER_INDEX} ON dev_mailbox(order_id);`);
    }
    if (!existingIndexNames.has(MAILBOX_INVOICE_INDEX)) {
      db.exec(`CREATE INDEX ${MAILBOX_INVOICE_INDEX} ON dev_mailbox(invoice_id);`);
    }
    for (const trigger of triggers) db.exec(trigger.sql);

    assertForeignKeysClean(db);
  },
};
