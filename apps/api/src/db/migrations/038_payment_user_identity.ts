import type { Migration } from '../migrate.js';

type MigrationDb = Parameters<Migration['up']>[0];

const PAYMENT_COLUMNS = [
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
] as const;

const PAYMENT_COLUMNS_BEFORE_USER = PAYMENT_COLUMNS.slice(0, -1);

type SchemaObject = {
  name: string;
  sql: string;
};

type TableInfoRow = {
  name: string;
  pk: number;
};

type ForeignKeyRow = {
  table: string;
  from: string;
  to: string;
};

function hasTable(db: MigrationDb, table: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table),
  );
}

function tableInfo(db: MigrationDb): TableInfoRow[] {
  return db.prepare('PRAGMA table_info(payments)').all() as TableInfoRow[];
}

function tableSql(db: MigrationDb): string | undefined {
  return (
    (
      db
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'payments'")
        .get() as { sql: string | null } | undefined
    )?.sql ?? undefined
  );
}

function hasUserForeignKey(db: MigrationDb): boolean {
  return (db.pragma('foreign_key_list(payments)') as ForeignKeyRow[]).some(
    (key) => key.table === 'users' && key.from === 'user_id' && key.to === 'id',
  );
}

function hasCompletedSchema(db: MigrationDb): boolean {
  const columns = tableInfo(db).map((column) => column.name);
  if (
    columns.length !== PAYMENT_COLUMNS.length ||
    columns.some((column, index) => column !== PAYMENT_COLUMNS[index])
  ) {
    return false;
  }
  const sql = tableSql(db)?.replace(/\s+/g, ' ').toLowerCase();
  if (!sql || !hasUserForeignKey(db)) return false;

  return (
    sql.includes("payment_method = 'card'") &&
    sql.includes("payment_method = 'trade_credit'") &&
    sql.includes('user_id is null') &&
    sql.includes('user_id is not null') &&
    sql.includes('references users(id)')
  );
}

function countRows(db: MigrationDb, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}

function preserveSequence(db: MigrationDb, sequence: number | undefined): void {
  if (sequence === undefined) return;
  db.prepare(
    `INSERT INTO sqlite_sequence (name, seq) SELECT ?, ?
     WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = ?)`,
  ).run('payments', sequence, 'payments');
  db.prepare('UPDATE sqlite_sequence SET seq = ? WHERE name = ? AND seq < ?').run(
    sequence,
    'payments',
    sequence,
  );
}

function explicitSchemaObjects(db: MigrationDb, type: 'index' | 'trigger'): SchemaObject[] {
  return db
    .prepare(
      `SELECT name, sql FROM sqlite_master
       WHERE type = ? AND tbl_name = 'payments' AND sql IS NOT NULL
       ORDER BY name`,
    )
    .all(type) as SchemaObject[];
}

function paymentDependentTriggers(db: MigrationDb): SchemaObject[] {
  return (
    db
      .prepare(
        `SELECT name, sql FROM sqlite_master
       WHERE type = 'trigger' AND sql IS NOT NULL`,
      )
      .all() as SchemaObject[]
  ).filter((trigger) => /\bpayments\b/i.test(trigger.sql));
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function assertForeignKeysClean(db: MigrationDb, step: string): void {
  const violations = db.pragma('foreign_key_check') as unknown[];
  if (violations.length > 0) {
    throw new Error(
      `Foreign key violations after migration 038 ${step}: ${JSON.stringify(violations)}`,
    );
  }
}

function buyerIdentityExpression(hasStoredUserId: boolean, alias: string): string {
  const candidates = [
    ...(hasStoredUserId ? [`${alias}.user_id`] : []),
    'linked_order.user_id',
    'linked_invoice.user_id',
  ];
  return `COALESCE(${candidates.join(', ')})`;
}

function validateLegacyCreditBuyerIdentity(
  db: MigrationDb,
  hasStoredUserId: boolean,
  hasInvoices: boolean,
): void {
  const invoiceJoin = hasInvoices
    ? 'LEFT JOIN invoices linked_invoice ON linked_invoice.payment_idempotency_key = payment.idempotency_key'
    : 'LEFT JOIN (SELECT NULL AS user_id, NULL AS payment_idempotency_key) linked_invoice ON 1 = 0';
  const identity = buyerIdentityExpression(hasStoredUserId, 'payment');
  const invalid = db
    .prepare(
      `SELECT payment.id
         FROM payments payment
         LEFT JOIN orders linked_order ON linked_order.id = payment.order_id
         ${invoiceJoin}
         LEFT JOIN users buyer ON buyer.id = ${identity}
        WHERE payment.payment_method = 'trade_credit'
          AND (
            ${identity} IS NULL
            OR typeof(${identity}) <> 'integer'
            OR ${identity} <= 0
            OR buyer.id IS NULL
          )
        ORDER BY payment.id
        LIMIT 1`,
    )
    .get() as { id: number } | undefined;
  if (invalid) {
    throw new Error(
      `Migration 038 cannot bind trade-credit payment ${invalid.id} to an existing buyer`,
    );
  }
}

function rebuildPayments(db: MigrationDb): void {
  const existingColumns = tableInfo(db).map((column) => column.name);
  const supportedColumns = new Set<string>(PAYMENT_COLUMNS);
  const unknownColumns = existingColumns.filter((column) => !supportedColumns.has(column));
  if (unknownColumns.length > 0) {
    throw new Error(
      `Migration 038 cannot rebuild payments with unknown columns: ${unknownColumns.join(', ')}`,
    );
  }
  const missingColumns = PAYMENT_COLUMNS_BEFORE_USER.filter(
    (column) => !existingColumns.includes(column),
  );
  if (missingColumns.length > 0) {
    throw new Error(
      `Migration 038 cannot rebuild payments with missing columns: ${missingColumns.join(', ')}`,
    );
  }

  const hasStoredUserId = existingColumns.includes('user_id');
  const hasInvoices = hasTable(db, 'invoices');
  validateLegacyCreditBuyerIdentity(db, hasStoredUserId, hasInvoices);

  const existingCount = countRows(db, 'payments');
  const sequence = (
    db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'payments'").get() as
      { seq: number } | undefined
  )?.seq;
  const indexes = explicitSchemaObjects(db, 'index');
  // Triggers on invoices and credit holds query payments. SQLite rejects dropping a table while
  // one of those trigger programs still references it, so suspend and restore every dependent
  // trigger around the parent-table swap, not only triggers attached directly to payments.
  const triggers = paymentDependentTriggers(db);
  const identity = buyerIdentityExpression(hasStoredUserId, 'payment');

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
      user_id INTEGER REFERENCES users(id),
      FOREIGN KEY (order_id) REFERENCES orders(id),
      CHECK (
        (payment_method = 'card'
          AND card_last4 IS NOT NULL
          AND card_brand IS NOT NULL
          AND company_id IS NULL
          AND user_id IS NULL)
        OR
        (payment_method = 'trade_credit'
          AND card_last4 IS NULL
          AND card_brand IS NULL
          AND company_id IS NOT NULL
          AND typeof(user_id) = 'integer'
          AND user_id > 0)
      )
    );

    INSERT INTO payments_new
      (id, order_id, idempotency_key, request_fingerprint, status, amount_cents,
       card_last4, card_brand, failure_reason, created_at, response_json, cart_id, quote_json,
       gateway_reference, updated_at, reservation_expires_at, payment_method, company_id, user_id)
    SELECT payment.id, payment.order_id, payment.idempotency_key, payment.request_fingerprint,
           payment.status, payment.amount_cents, payment.card_last4, payment.card_brand,
           payment.failure_reason, payment.created_at, payment.response_json, payment.cart_id,
           payment.quote_json, payment.gateway_reference, payment.updated_at,
           payment.reservation_expires_at, payment.payment_method, payment.company_id,
           CASE WHEN payment.payment_method = 'trade_credit' THEN ${identity} ELSE NULL END
      FROM payments payment
      LEFT JOIN orders linked_order ON linked_order.id = payment.order_id
      ${
        hasInvoices
          ? 'LEFT JOIN invoices linked_invoice ON linked_invoice.payment_idempotency_key = payment.idempotency_key'
          : 'LEFT JOIN (SELECT NULL AS user_id, NULL AS payment_idempotency_key) linked_invoice ON 1 = 0'
      }
     ORDER BY payment.id;
  `);

  const copiedCount = countRows(db, 'payments_new');
  if (copiedCount !== existingCount) {
    throw new Error(
      `payments rebuild count mismatch: ${existingCount} existing vs ${copiedCount} copied`,
    );
  }

  const mismatch = db
    .prepare(
      `SELECT payment.id
         FROM payments payment
         LEFT JOIN payments_new copy ON copy.id = payment.id
         LEFT JOIN orders linked_order ON linked_order.id = payment.order_id
         ${
           hasInvoices
             ? 'LEFT JOIN invoices linked_invoice ON linked_invoice.payment_idempotency_key = payment.idempotency_key'
             : 'LEFT JOIN (SELECT NULL AS user_id, NULL AS payment_idempotency_key) linked_invoice ON 1 = 0'
         }
        WHERE copy.id IS NULL
           OR payment.order_id IS NOT copy.order_id
           OR payment.idempotency_key IS NOT copy.idempotency_key
           OR payment.request_fingerprint IS NOT copy.request_fingerprint
           OR payment.status IS NOT copy.status
           OR payment.amount_cents IS NOT copy.amount_cents
           OR payment.card_last4 IS NOT copy.card_last4
           OR payment.card_brand IS NOT copy.card_brand
           OR payment.failure_reason IS NOT copy.failure_reason
           OR payment.created_at IS NOT copy.created_at
           OR payment.response_json IS NOT copy.response_json
           OR payment.cart_id IS NOT copy.cart_id
           OR payment.quote_json IS NOT copy.quote_json
           OR payment.gateway_reference IS NOT copy.gateway_reference
           OR payment.updated_at IS NOT copy.updated_at
           OR payment.reservation_expires_at IS NOT copy.reservation_expires_at
           OR payment.payment_method IS NOT copy.payment_method
           OR payment.company_id IS NOT copy.company_id
           OR copy.user_id IS NOT (
             CASE WHEN payment.payment_method = 'trade_credit' THEN ${identity} ELSE NULL END
           )
        LIMIT 1`,
    )
    .get() as { id: number } | undefined;
  if (mismatch) {
    throw new Error(`payments rebuild value mismatch at row ${mismatch.id}`);
  }

  for (const trigger of triggers) db.exec(`DROP TRIGGER ${quoteIdentifier(trigger.name)};`);
  db.exec('DROP TABLE payments; ALTER TABLE payments_new RENAME TO payments;');
  preserveSequence(db, sequence);
  for (const index of indexes) db.exec(index.sql);
  for (const trigger of triggers) db.exec(trigger.sql);
  assertForeignKeysClean(db, 'payments rebuild');
}

/** Persists the authenticated buyer identity on trade-credit payment reservations. */
export const paymentUserIdentityMigration: Migration = {
  version: '038',
  name: 'payment buyer identity',
  up(db) {
    if (!hasTable(db, 'payments')) {
      throw new Error('Migration 038 requires the payments table from migration 001');
    }
    if (!hasTable(db, 'users')) {
      throw new Error('Migration 038 requires the users table from migration 001');
    }
    if (hasCompletedSchema(db)) {
      assertForeignKeysClean(db, 'payment buyer identity schema');
      return;
    }
    rebuildPayments(db);
  },
};
