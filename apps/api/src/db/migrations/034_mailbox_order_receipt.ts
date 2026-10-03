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
] as const;
const MAILBOX_ORDER_INDEX = 'dev_mailbox_order_id_idx';

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

function hasExpectedColumns(db: MigrationDb): boolean {
  const columns = tableInfo(db);
  if (columns.length !== MAILBOX_COLUMNS.length) return false;
  if (!columns.every((column, index) => column.name === MAILBOX_COLUMNS[index])) return false;

  const id = columns[0];
  if (!id) return false;
  if (id.pk !== 1 || id.notnull !== 0) return false;
  const required = new Set(['recipient', 'subject', 'body', 'kind', 'created_at']);
  if (columns.some((column) => required.has(column.name) && column.notnull !== 1)) return false;
  return columns
    .filter((column) =>
      ['order_id', 'template_key', 'template_params_json', 'template_country'].includes(
        column.name,
      ),
    )
    .every((column) => column.notnull === 0 && column.pk === 0);
}

function hasExpectedForeignKey(db: MigrationDb): boolean {
  const keys = db.pragma('foreign_key_list(dev_mailbox)') as ForeignKeyRow[];
  return (
    keys.length === 1 &&
    keys[0]?.table === 'orders' &&
    keys[0].from === 'order_id' &&
    keys[0].to === 'id' &&
    keys[0].on_delete.toUpperCase() === 'SET NULL'
  );
}

function hasExpectedIndex(db: MigrationDb): boolean {
  const index = (db.pragma('index_list(dev_mailbox)') as IndexListRow[]).find(
    (candidate) => candidate.name === MAILBOX_ORDER_INDEX,
  );
  if (!index || index.unique !== 0 || index.origin !== 'c' || index.partial !== 0) return false;

  const columns = db.pragma(`index_info(${MAILBOX_ORDER_INDEX})`) as IndexInfoRow[];
  return columns.length === 1 && columns[0]?.name === 'order_id';
}

function hasCompletedSchema(db: MigrationDb): boolean {
  return hasExpectedColumns(db) && hasExpectedForeignKey(db) && hasExpectedIndex(db);
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

function assertForeignKeysClean(db: MigrationDb): void {
  const violations = db.pragma('foreign_key_check') as unknown[];
  if (violations.length > 0) {
    throw new Error(`Foreign key violations after migration 034: ${JSON.stringify(violations)}`);
  }
}

/** Adds typed mailbox descriptors and an order relationship for structured receipts. */
export const mailboxOrderReceiptMigration: Migration = {
  version: '034',
  name: 'mailbox order receipt',
  up(db) {
    if (!hasTable(db, 'dev_mailbox')) {
      throw new Error('Migration 034 requires the dev_mailbox table from migration 001');
    }

    // The schema itself is the completion marker. Index names are not sufficient: a pre-existing
    // index with the expected name can point at a different column or table.
    if (hasCompletedSchema(db)) {
      assertForeignKeysClean(db);
      return;
    }

    // A same-name index that does not match the expected table/column shape is ambiguous. Refuse
    // to rebuild in that state so the migration cannot silently record an incomplete schema.
    if (hasIndexNamed(db, MAILBOX_ORDER_INDEX)) {
      throw new Error(
        `Migration 034 found incompatible index ${MAILBOX_ORDER_INDEX}; refusing to treat the index name as a completion marker`,
      );
    }

    const existingColumns = columnNames(db);
    const supportedColumns = new Set<string>(MAILBOX_COLUMNS);
    const unknownColumns = existingColumns.filter((column) => !supportedColumns.has(column));
    if (unknownColumns.length > 0) {
      throw new Error(
        `Migration 034 cannot rebuild dev_mailbox with unknown columns: ${unknownColumns.join(', ')}`,
      );
    }

    const sequence = (
      db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'dev_mailbox'").get() as
        { seq: number } | undefined
    )?.seq;

    // SQLite cannot add a table-level CHECK constraint with ALTER TABLE. Rebuild the small mailbox
    // table atomically so existing plain messages remain intact while the three row states become
    // mutually exclusive: legacy (no metadata), typed template (all template metadata), or receipt
    // (order relationship only).
    db.exec(`
      ALTER TABLE dev_mailbox RENAME TO dev_mailbox_legacy;

      CREATE TABLE dev_mailbox (
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
        CHECK (
          (order_id IS NULL
            AND template_key IS NULL
            AND template_params_json IS NULL
            AND template_country IS NULL)
          OR
          (order_id IS NULL
            AND template_key IS NOT NULL
            AND template_params_json IS NOT NULL
            AND template_country IS NOT NULL)
          OR
          (order_id IS NOT NULL
            AND template_key IS NULL
            AND template_params_json IS NULL
            AND template_country IS NULL)
        )
      );
    `);

    const copiedColumns = MAILBOX_COLUMNS.filter((column) => existingColumns.includes(column));
    const columnList = copiedColumns.join(', ');
    db.exec(`
      INSERT INTO dev_mailbox (${columnList})
      SELECT ${columnList} FROM dev_mailbox_legacy;
      DROP TABLE dev_mailbox_legacy;
    `);

    preserveSequence(db, sequence);

    db.exec(`
      CREATE INDEX IF NOT EXISTS ${MAILBOX_ORDER_INDEX}
        ON dev_mailbox(order_id);
    `);

    assertForeignKeysClean(db);
  },
};
