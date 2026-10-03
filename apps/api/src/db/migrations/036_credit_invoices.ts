import type { Migration } from '../migrate.js';

type MigrationDb = Parameters<Migration['up']>[0];

const MAX_SAFE_INTEGER = 9_007_199_254_740_991;
const INVOICE_SEQUENCE_MAX = 999_999;
const TRADE_CREDIT_TERM_DAYS = 30;
const TRADE_CREDIT_TERM_MILLISECONDS = TRADE_CREDIT_TERM_DAYS * 24 * 60 * 60 * 1_000;

const COUNTRY_VALUES = "'UK', 'US', 'CN', 'PL', 'ES', 'DE', 'FR'";
const UTC_INSTANT_PATTERN =
  "'[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'";

const HOLD_COLUMNS = [
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
] as const;

type SchemaObject = { name: string; sql: string };
type ForeignKeyRow = { table: string; from: string; to: string };

function hasTable(db: MigrationDb, table: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table),
  );
}

function hasColumn(db: MigrationDb, table: string, column: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some(
    (existing) => existing.name === column,
  );
}

function countRows(db: MigrationDb, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}

function preserveSequence(db: MigrationDb, table: string, sequence: number | undefined): void {
  if (sequence === undefined) return;

  db.prepare(
    `INSERT INTO sqlite_sequence (name, seq)
     SELECT ?, ?
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
      `Foreign key violations after migration 036 ${step}: ${JSON.stringify(violations)}`,
    );
  }
}

function hasInvoiceForeignKey(db: MigrationDb): boolean {
  if (
    !hasTable(db, 'credit_exposure_holds') ||
    !hasColumn(db, 'credit_exposure_holds', 'invoice_id')
  ) {
    return false;
  }
  return (db.pragma('foreign_key_list(credit_exposure_holds)') as ForeignKeyRow[]).some(
    (foreignKey) =>
      foreignKey.table === 'invoices' && foreignKey.from === 'invoice_id' && foreignKey.to === 'id',
  );
}

function utcInstantCheck(column: string): string {
  return `(
    typeof(${column}) = 'text'
    AND length(${column}) = 24
    AND ${column} GLOB ${UTC_INSTANT_PATTERN}
    AND strftime('%Y-%m-%dT%H:%M:%fZ', ${column}) = ${column}
  )`;
}

function utcInstantMilliseconds(column: string): string {
  return `(
    CAST(strftime('%s', ${column}) AS INTEGER) * 1000
    + CAST(substr(${column}, 21, 3) AS INTEGER)
  )`;
}

function createInvoiceSequences(db: MigrationDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS invoice_sequences (
      year INTEGER PRIMARY KEY CHECK (
        typeof(year) = 'integer' AND year BETWEEN 1000 AND 9999
      ),
      next_number INTEGER NOT NULL DEFAULT 1 CHECK (
        typeof(next_number) = 'integer' AND next_number BETWEEN 1 AND ${INVOICE_SEQUENCE_MAX}
      )
    );
  `);
}

function createInvoices(db: MigrationDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version INTEGER NOT NULL DEFAULT 1 CHECK (
        typeof(version) = 'integer' AND version = 1
      ),
      invoice_number TEXT NOT NULL UNIQUE CHECK (
        typeof(invoice_number) = 'text'
        AND length(invoice_number) = 15
        AND invoice_number GLOB 'QME-[0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]'
        AND substr(invoice_number, 5, 4) = substr(issued_at, 1, 4)
      ),
      order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id),
      payment_idempotency_key TEXT NOT NULL UNIQUE REFERENCES payments(idempotency_key),
      company_id INTEGER NOT NULL REFERENCES company_accounts(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      country TEXT NOT NULL CHECK (country IN (${COUNTRY_VALUES})),
      currency TEXT NOT NULL DEFAULT 'GBP' CHECK (currency = 'GBP'),
      terms TEXT NOT NULL DEFAULT 'net_30' CHECK (terms = 'net_30'),
      terms_days INTEGER NOT NULL DEFAULT ${TRADE_CREDIT_TERM_DAYS} CHECK (
        typeof(terms_days) = 'integer' AND terms_days = ${TRADE_CREDIT_TERM_DAYS}
      ),
      document_json TEXT NOT NULL CHECK (
        json_valid(document_json)
        AND json_type(document_json) = 'object'
        AND json_type(document_json, '$.version') = 'integer'
        AND json_extract(document_json, '$.version') = version
        AND json_type(document_json, '$.id') = 'text'
        AND json_extract(document_json, '$.id') = CAST(id AS TEXT)
        AND json_type(document_json, '$.invoiceNumber') = 'text'
        AND json_extract(document_json, '$.invoiceNumber') = invoice_number
        AND json_type(document_json, '$.orderId') = 'text'
        AND json_extract(document_json, '$.orderId') = CAST(order_id AS TEXT)
        AND json_type(document_json, '$.companyId') = 'text'
        AND json_extract(document_json, '$.companyId') = CAST(company_id AS TEXT)
        AND json_type(document_json, '$.userId') = 'text'
        AND json_extract(document_json, '$.userId') = CAST(user_id AS TEXT)
        AND json_type(document_json, '$.country') = 'text'
        AND json_extract(document_json, '$.country') = country
        AND json_extract(document_json, '$.paymentMethod') = 'trade_credit'
        AND json_extract(document_json, '$.currency') = currency
        AND (
          (json_type(document_json, '$.terms') = 'text'
            AND json_extract(document_json, '$.terms') = terms)
          OR (json_type(document_json, '$.terms') = 'integer'
            AND json_extract(document_json, '$.terms') = ${TRADE_CREDIT_TERM_DAYS})
          OR (json_type(document_json, '$.terms') IS NULL
            AND json_type(document_json, '$.termsDays') = 'integer'
            AND json_extract(document_json, '$.termsDays') = terms_days)
        )
        AND (
          json_type(document_json, '$.termsDays') IS NULL
          OR (json_type(document_json, '$.termsDays') = 'integer'
            AND json_extract(document_json, '$.termsDays') = terms_days)
        )
        AND json_type(document_json, '$.billingEntity') = 'object'
        AND (
          json_type(document_json, '$.purchaseOrderReference') = 'null'
          OR (
            json_type(document_json, '$.purchaseOrderReference') = 'text'
            AND length(json_extract(document_json, '$.purchaseOrderReference')) BETWEEN 1 AND 64
            AND json_extract(document_json, '$.purchaseOrderReference') NOT GLOB '*[<>]*'
          )
        )
        AND json_type(document_json, '$.lines') = 'array'
        AND json_array_length(document_json, '$.lines') BETWEEN 1 AND 1000
        AND (
          json_type(document_json, '$.paymentIdempotencyKey') IS NULL
          OR (
            json_type(document_json, '$.paymentIdempotencyKey') = 'text'
            AND json_extract(document_json, '$.paymentIdempotencyKey') = payment_idempotency_key
          )
        )
        AND json_type(document_json, '$.netCents') = 'integer'
        AND json_extract(document_json, '$.netCents') = net_cents
        AND json_type(document_json, '$.vatRateBasisPoints') = 'integer'
        AND json_extract(document_json, '$.vatRateBasisPoints') = vat_rate_basis_points
        AND json_type(document_json, '$.vatCents') = 'integer'
        AND json_extract(document_json, '$.vatCents') = vat_cents
        AND json_type(document_json, '$.grossCents') = 'integer'
        AND json_extract(document_json, '$.grossCents') = gross_cents
        AND json_type(document_json, '$.issuedAt') = 'text'
        AND json_extract(document_json, '$.issuedAt') = issued_at
        AND json_type(document_json, '$.dueAt') = 'text'
        AND json_extract(document_json, '$.dueAt') = due_at
      ),
      net_cents INTEGER NOT NULL CHECK (
        typeof(net_cents) = 'integer' AND net_cents BETWEEN 0 AND ${MAX_SAFE_INTEGER}
      ),
      vat_rate_basis_points INTEGER NOT NULL CHECK (
        typeof(vat_rate_basis_points) = 'integer'
        AND vat_rate_basis_points BETWEEN 0 AND 10000
      ),
      vat_cents INTEGER NOT NULL CHECK (
        typeof(vat_cents) = 'integer' AND vat_cents BETWEEN 0 AND ${MAX_SAFE_INTEGER}
      ),
      gross_cents INTEGER NOT NULL CHECK (
        typeof(gross_cents) = 'integer' AND gross_cents BETWEEN 0 AND ${MAX_SAFE_INTEGER}
      ),
      issued_at TEXT NOT NULL CHECK ${utcInstantCheck('issued_at')},
      due_at TEXT NOT NULL CHECK (
        ${utcInstantCheck('due_at')}
        AND ${utcInstantMilliseconds('due_at')} =
          ${utcInstantMilliseconds('issued_at')} + ${TRADE_CREDIT_TERM_MILLISECONDS}
      ),
      CHECK (
        vat_rate_basis_points = 0
        OR net_cents <= CAST(${MAX_SAFE_INTEGER} / vat_rate_basis_points AS INTEGER)
      ),
      CHECK (
        net_cents = 0
        OR vat_rate_basis_points = 0
        OR net_cents * vat_rate_basis_points <= ${MAX_SAFE_INTEGER} - 5000
      ),
      CHECK (
        vat_cents = (net_cents * vat_rate_basis_points + 5000) / 10000
      ),
      CHECK (net_cents <= ${MAX_SAFE_INTEGER} - vat_cents),
      CHECK (gross_cents = net_cents + vat_cents)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS invoices_order_id_idx
      ON invoices(order_id);
    CREATE UNIQUE INDEX IF NOT EXISTS invoices_payment_idempotency_key_idx
      ON invoices(payment_idempotency_key);
    CREATE INDEX IF NOT EXISTS invoices_company_issued_at_id_idx
      ON invoices(company_id, issued_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS invoices_issued_at_id_idx
      ON invoices(issued_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS invoices_due_at_id_idx
      ON invoices(due_at ASC, id ASC);

    CREATE TRIGGER IF NOT EXISTS invoices_no_update
    BEFORE UPDATE ON invoices
    BEGIN
      SELECT RAISE(ABORT, 'invoices are immutable');
    END;

    CREATE TRIGGER IF NOT EXISTS invoices_no_delete
    BEFORE DELETE ON invoices
    BEGIN
      SELECT RAISE(ABORT, 'invoices are immutable');
    END;

    CREATE TRIGGER IF NOT EXISTS invoices_require_trade_credit_payment
    BEFORE INSERT ON invoices
    WHEN NOT EXISTS (
      SELECT 1 FROM payments
      WHERE payments.idempotency_key = NEW.payment_idempotency_key
        AND payments.payment_method = 'trade_credit'
    )
    BEGIN
      SELECT RAISE(ABORT, 'invoices require a trade-credit payment');
    END;

    CREATE TRIGGER IF NOT EXISTS invoices_validate_document_lines
    BEFORE INSERT ON invoices
    WHEN json_valid(NEW.document_json)
    BEGIN
      SELECT RAISE(ABORT, 'invoice document has unknown fields')
      WHERE EXISTS (
        SELECT 1 FROM json_each(NEW.document_json)
        WHERE key NOT IN (
          'version', 'id', 'invoiceNumber', 'orderId', 'companyId', 'userId', 'country',
          'paymentMethod', 'currency', 'terms', 'termsDays', 'billingEntity',
          'purchaseOrderReference', 'paymentIdempotencyKey', 'lines', 'netCents',
          'vatRateBasisPoints', 'vatCents', 'grossCents', 'issuedAt', 'dueAt'
        )
      );

      SELECT RAISE(ABORT, 'invoice document has malformed lines')
      WHERE EXISTS (
        SELECT 1
        FROM json_each(NEW.document_json, '$.lines') AS line
        WHERE json_type(line.value) <> 'object'
          OR COALESCE(json_type(line.value, '$.lineId'), '') <> 'text'
          OR COALESCE(json_type(line.value, '$.description'), '') <> 'text'
          OR length(COALESCE(json_extract(line.value, '$.description'), '')) NOT BETWEEN 1 AND 240
          OR trim(COALESCE(json_extract(line.value, '$.description'), '')) = ''
          OR COALESCE(json_extract(line.value, '$.description'), '') GLOB '*[<>]*'
          OR COALESCE(json_type(line.value, '$.quantity'), '') <> 'integer'
          OR json_extract(line.value, '$.quantity') < 1
          OR json_extract(line.value, '$.quantity') > ${MAX_SAFE_INTEGER}
          OR COALESCE(json_type(line.value, '$.unitPriceCents'), '') <> 'integer'
          OR json_extract(line.value, '$.unitPriceCents') < 0
          OR json_extract(line.value, '$.unitPriceCents') > ${MAX_SAFE_INTEGER}
          OR COALESCE(json_type(line.value, '$.netCents'), '') <> 'integer'
          OR json_extract(line.value, '$.netCents') < 0
          OR json_extract(line.value, '$.netCents') > ${MAX_SAFE_INTEGER}
          OR json_extract(line.value, '$.unitPriceCents') >
            CAST(${MAX_SAFE_INTEGER} / json_extract(line.value, '$.quantity') AS INTEGER)
          OR json_extract(line.value, '$.unitPriceCents') * json_extract(line.value, '$.quantity')
            <> json_extract(line.value, '$.netCents')
          OR (
            json_type(line.value, '$.productId') IS NOT NULL
            AND json_type(line.value, '$.productId') <> 'text'
          )
          OR (
            json_type(line.value, '$.variantId') IS NOT NULL
            AND json_type(line.value, '$.variantId') <> 'text'
          )
          OR (
            json_type(line.value, '$.sku') IS NOT NULL
            AND (
              json_type(line.value, '$.sku') <> 'text'
              OR length(json_extract(line.value, '$.sku')) NOT BETWEEN 1 AND 64
              OR json_extract(line.value, '$.sku') GLOB '*[<>]*'
            )
          )
      );
    END;

    /*
     * document_json is an immutable wire document, so its nested objects need the same closed
     * shape as InvoiceDocumentV1.  SQLite CHECK expressions cannot contain subqueries; keep the
     * per-line and nested-object checks in a trigger and fail before the row reaches the table
     * constraints.  The original line trigger above is retained for databases that already ran an
     * earlier copy of this migration; this trigger supplies the stricter V1 boundary.
     */
    CREATE TRIGGER IF NOT EXISTS invoices_validate_document_v1
    BEFORE INSERT ON invoices
    WHEN json_valid(NEW.document_json)
    BEGIN
      SELECT RAISE(ABORT, 'invoice document has duplicate fields')
      WHERE EXISTS (
        SELECT key FROM json_each(NEW.document_json) GROUP BY key HAVING COUNT(*) > 1
      )
      OR EXISTS (
        SELECT key
        FROM json_each(NEW.document_json, '$.billingEntity')
        GROUP BY key
        HAVING COUNT(*) > 1
      )
      OR EXISTS (
        SELECT key
        FROM json_each(NEW.document_json, '$.billingEntity.address')
        GROUP BY key
        HAVING COUNT(*) > 1
      )
      OR EXISTS (
        SELECT 1
        FROM json_each(NEW.document_json, '$.lines') AS line
        WHERE EXISTS (
          SELECT key FROM json_each(line.value) GROUP BY key HAVING COUNT(*) > 1
        )
      );

      SELECT RAISE(ABORT, 'invoice document has unknown fields')
      WHERE EXISTS (
        SELECT 1
        FROM json_each(NEW.document_json)
        WHERE key NOT IN (
          'version', 'id', 'invoiceNumber', 'orderId', 'companyId', 'userId', 'country',
          'paymentMethod', 'currency', 'terms', 'termsDays', 'billingEntity',
          'purchaseOrderReference', 'paymentIdempotencyKey', 'lines', 'netCents',
          'vatRateBasisPoints', 'vatCents', 'grossCents', 'issuedAt', 'dueAt'
        )
      )
      OR EXISTS (
        SELECT 1
        FROM json_each(NEW.document_json, '$.billingEntity')
        WHERE key NOT IN ('legalName', 'registrationNumber', 'vatNumber', 'address')
      )
      OR EXISTS (
        SELECT 1
        FROM json_each(NEW.document_json, '$.billingEntity.address')
        WHERE key NOT IN ('line1', 'line2', 'city', 'region', 'postcode', 'countryCode')
      )
      OR EXISTS (
        SELECT 1
        FROM json_each(NEW.document_json, '$.lines') AS line
        WHERE EXISTS (
          SELECT 1
          FROM json_each(line.value)
          WHERE key NOT IN (
            'lineId', 'description', 'productId', 'variantId', 'sku', 'quantity',
            'unitPriceCents', 'netCents'
          )
        )
      );

      SELECT RAISE(ABORT, 'invoice document has malformed V1 facts')
      WHERE COALESCE(json_type(NEW.document_json, '$.version'), '') <> 'integer'
        OR json_extract(NEW.document_json, '$.version') IS NOT 1
        OR COALESCE(json_type(NEW.document_json, '$.id'), '') <> 'text'
        OR json_extract(NEW.document_json, '$.id') NOT GLOB '[1-9]*'
        OR json_extract(NEW.document_json, '$.id') GLOB '*[^0-9]*'
        OR json_extract(NEW.document_json, '$.id') IS NOT CAST(NEW.id AS TEXT)
        OR COALESCE(json_type(NEW.document_json, '$.invoiceNumber'), '') <> 'text'
        OR length(json_extract(NEW.document_json, '$.invoiceNumber')) <> 15
        OR json_extract(NEW.document_json, '$.invoiceNumber') NOT GLOB
          'QME-[0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]'
        OR json_extract(NEW.document_json, '$.invoiceNumber') IS NOT NEW.invoice_number
        OR COALESCE(json_type(NEW.document_json, '$.orderId'), '') <> 'text'
        OR json_extract(NEW.document_json, '$.orderId') NOT GLOB '[1-9]*'
        OR json_extract(NEW.document_json, '$.orderId') GLOB '*[^0-9]*'
        OR json_extract(NEW.document_json, '$.orderId') IS NOT CAST(NEW.order_id AS TEXT)
        OR COALESCE(json_type(NEW.document_json, '$.companyId'), '') <> 'text'
        OR json_extract(NEW.document_json, '$.companyId') NOT GLOB '[1-9]*'
        OR json_extract(NEW.document_json, '$.companyId') GLOB '*[^0-9]*'
        OR json_extract(NEW.document_json, '$.companyId') IS NOT CAST(NEW.company_id AS TEXT)
        OR COALESCE(json_type(NEW.document_json, '$.userId'), '') <> 'text'
        OR json_extract(NEW.document_json, '$.userId') NOT GLOB '[1-9]*'
        OR json_extract(NEW.document_json, '$.userId') GLOB '*[^0-9]*'
        OR json_extract(NEW.document_json, '$.userId') IS NOT CAST(NEW.user_id AS TEXT)
        OR COALESCE(json_type(NEW.document_json, '$.country'), '') <> 'text'
        OR json_extract(NEW.document_json, '$.country') NOT IN (${COUNTRY_VALUES})
        OR json_extract(NEW.document_json, '$.country') IS NOT NEW.country
        OR COALESCE(json_type(NEW.document_json, '$.paymentMethod'), '') <> 'text'
        OR json_extract(NEW.document_json, '$.paymentMethod') IS NOT 'trade_credit'
        OR COALESCE(json_type(NEW.document_json, '$.currency'), '') <> 'text'
        OR json_extract(NEW.document_json, '$.currency') IS NOT 'GBP'
        OR NOT (
          (
            json_type(NEW.document_json, '$.terms') = 'text'
            AND json_extract(NEW.document_json, '$.terms') IS 'net_30'
          )
          OR (
            json_type(NEW.document_json, '$.terms') = 'integer'
            AND json_extract(NEW.document_json, '$.terms') IS 30
          )
          OR (
            json_type(NEW.document_json, '$.terms') IS NULL
            AND json_type(NEW.document_json, '$.termsDays') = 'integer'
            AND json_extract(NEW.document_json, '$.termsDays') IS 30
          )
        )
        OR (
          json_type(NEW.document_json, '$.termsDays') IS NOT NULL
          AND (
            json_type(NEW.document_json, '$.termsDays') <> 'integer'
            OR json_extract(NEW.document_json, '$.termsDays') IS NOT 30
          )
        )
        OR COALESCE(json_type(NEW.document_json, '$.billingEntity'), '') <> 'object'
        OR COALESCE(json_type(NEW.document_json, '$.billingEntity.legalName'), '') <> 'text'
        OR length(json_extract(NEW.document_json, '$.billingEntity.legalName')) NOT BETWEEN 1 AND 120
        OR trim(json_extract(NEW.document_json, '$.billingEntity.legalName')) = ''
        OR json_extract(NEW.document_json, '$.billingEntity.legalName') GLOB '*[<>]*'
        OR json_type(NEW.document_json, '$.billingEntity.registrationNumber') IS NULL
        OR json_type(NEW.document_json, '$.billingEntity.registrationNumber') NOT IN ('null', 'text')
        OR (
          json_type(NEW.document_json, '$.billingEntity.registrationNumber') = 'text'
          AND (
            length(json_extract(NEW.document_json, '$.billingEntity.registrationNumber')) NOT BETWEEN 1 AND 40
            OR trim(json_extract(NEW.document_json, '$.billingEntity.registrationNumber')) = ''
            OR json_extract(NEW.document_json, '$.billingEntity.registrationNumber') GLOB '*[<>]*'
          )
        )
        OR json_type(NEW.document_json, '$.billingEntity.vatNumber') IS NULL
        OR json_type(NEW.document_json, '$.billingEntity.vatNumber') NOT IN ('null', 'text')
        OR (
          json_type(NEW.document_json, '$.billingEntity.vatNumber') = 'text'
          AND (
            length(json_extract(NEW.document_json, '$.billingEntity.vatNumber')) NOT BETWEEN 1 AND 40
            OR trim(json_extract(NEW.document_json, '$.billingEntity.vatNumber')) = ''
            OR json_extract(NEW.document_json, '$.billingEntity.vatNumber') GLOB '*[<>]*'
          )
        )
        OR COALESCE(json_type(NEW.document_json, '$.billingEntity.address'), '') <> 'object'
        OR COALESCE(json_type(NEW.document_json, '$.billingEntity.address.line1'), '') <> 'text'
        OR length(json_extract(NEW.document_json, '$.billingEntity.address.line1')) NOT BETWEEN 1 AND 120
        OR trim(json_extract(NEW.document_json, '$.billingEntity.address.line1')) = ''
        OR json_extract(NEW.document_json, '$.billingEntity.address.line1') GLOB '*[<>]*'
        OR (
          json_type(NEW.document_json, '$.billingEntity.address.line2') IS NOT NULL
          AND (
            json_type(NEW.document_json, '$.billingEntity.address.line2') <> 'text'
            OR length(json_extract(NEW.document_json, '$.billingEntity.address.line2')) NOT BETWEEN 1 AND 120
            OR trim(json_extract(NEW.document_json, '$.billingEntity.address.line2')) = ''
            OR json_extract(NEW.document_json, '$.billingEntity.address.line2') GLOB '*[<>]*'
          )
        )
        OR COALESCE(json_type(NEW.document_json, '$.billingEntity.address.city'), '') <> 'text'
        OR length(json_extract(NEW.document_json, '$.billingEntity.address.city')) NOT BETWEEN 1 AND 80
        OR trim(json_extract(NEW.document_json, '$.billingEntity.address.city')) = ''
        OR json_extract(NEW.document_json, '$.billingEntity.address.city') GLOB '*[<>]*'
        OR (
          json_type(NEW.document_json, '$.billingEntity.address.region') IS NOT NULL
          AND (
            json_type(NEW.document_json, '$.billingEntity.address.region') <> 'text'
            OR length(json_extract(NEW.document_json, '$.billingEntity.address.region')) NOT BETWEEN 1 AND 80
            OR trim(json_extract(NEW.document_json, '$.billingEntity.address.region')) = ''
            OR json_extract(NEW.document_json, '$.billingEntity.address.region') GLOB '*[<>]*'
          )
        )
        OR COALESCE(json_type(NEW.document_json, '$.billingEntity.address.postcode'), '') <> 'text'
        OR length(json_extract(NEW.document_json, '$.billingEntity.address.postcode')) NOT BETWEEN 1 AND 16
        OR json_extract(NEW.document_json, '$.billingEntity.address.postcode') NOT GLOB '[A-Za-z0-9]*'
        OR json_extract(NEW.document_json, '$.billingEntity.address.postcode') GLOB '*[^A-Za-z0-9 -]*'
        OR COALESCE(json_type(NEW.document_json, '$.billingEntity.address.countryCode'), '') <> 'text'
        OR json_extract(NEW.document_json, '$.billingEntity.address.countryCode') NOT GLOB '[A-Z][A-Z]'
        OR (
          json_type(NEW.document_json, '$.purchaseOrderReference') IS NULL
          OR json_type(NEW.document_json, '$.purchaseOrderReference') NOT IN ('null', 'text')
          OR (
            json_type(NEW.document_json, '$.purchaseOrderReference') = 'text'
            AND (
              length(json_extract(NEW.document_json, '$.purchaseOrderReference')) NOT BETWEEN 1 AND 64
              OR json_extract(NEW.document_json, '$.purchaseOrderReference') GLOB '*[<>]*'
            )
          )
        )
        OR (
          json_type(NEW.document_json, '$.paymentIdempotencyKey') IS NOT NULL
          AND (
            json_type(NEW.document_json, '$.paymentIdempotencyKey') <> 'text'
            OR json_extract(NEW.document_json, '$.paymentIdempotencyKey') IS NOT NEW.payment_idempotency_key
          )
        )
        OR COALESCE(json_type(NEW.document_json, '$.lines'), '') <> 'array'
        OR json_array_length(NEW.document_json, '$.lines') NOT BETWEEN 1 AND 1000
        OR COALESCE(json_type(NEW.document_json, '$.netCents'), '') <> 'integer'
        OR json_extract(NEW.document_json, '$.netCents') IS NOT NEW.net_cents
        OR COALESCE(json_type(NEW.document_json, '$.vatRateBasisPoints'), '') <> 'integer'
        OR json_extract(NEW.document_json, '$.vatRateBasisPoints') IS NOT NEW.vat_rate_basis_points
        OR COALESCE(json_type(NEW.document_json, '$.vatCents'), '') <> 'integer'
        OR json_extract(NEW.document_json, '$.vatCents') IS NOT NEW.vat_cents
        OR COALESCE(json_type(NEW.document_json, '$.grossCents'), '') <> 'integer'
        OR json_extract(NEW.document_json, '$.grossCents') IS NOT NEW.gross_cents
        OR COALESCE(json_type(NEW.document_json, '$.issuedAt'), '') <> 'text'
        OR json_extract(NEW.document_json, '$.issuedAt') IS NOT NEW.issued_at
        OR COALESCE(json_type(NEW.document_json, '$.dueAt'), '') <> 'text'
        OR json_extract(NEW.document_json, '$.dueAt') IS NOT NEW.due_at;

      SELECT RAISE(ABORT, 'invoice document has malformed lines')
      WHERE EXISTS (
        SELECT 1
        FROM json_each(NEW.document_json, '$.lines') AS line
        WHERE json_type(line.value) <> 'object'
          OR COALESCE(json_type(line.value, '$.lineId'), '') <> 'text'
          OR json_extract(line.value, '$.lineId') NOT GLOB '[1-9]*'
          OR json_extract(line.value, '$.lineId') GLOB '*[^0-9]*'
          OR COALESCE(json_type(line.value, '$.description'), '') <> 'text'
          OR length(json_extract(line.value, '$.description')) NOT BETWEEN 1 AND 240
          OR trim(json_extract(line.value, '$.description')) = ''
          OR json_extract(line.value, '$.description') GLOB '*[<>]*'
          OR COALESCE(json_type(line.value, '$.quantity'), '') <> 'integer'
          OR json_extract(line.value, '$.quantity') < 1
          OR json_extract(line.value, '$.quantity') > ${MAX_SAFE_INTEGER}
          OR COALESCE(json_type(line.value, '$.unitPriceCents'), '') <> 'integer'
          OR json_extract(line.value, '$.unitPriceCents') < 0
          OR json_extract(line.value, '$.unitPriceCents') > ${MAX_SAFE_INTEGER}
          OR COALESCE(json_type(line.value, '$.netCents'), '') <> 'integer'
          OR json_extract(line.value, '$.netCents') < 0
          OR json_extract(line.value, '$.netCents') > ${MAX_SAFE_INTEGER}
          OR json_extract(line.value, '$.unitPriceCents') >
            CAST(${MAX_SAFE_INTEGER} / json_extract(line.value, '$.quantity') AS INTEGER)
          OR json_extract(line.value, '$.unitPriceCents') * json_extract(line.value, '$.quantity')
            IS NOT json_extract(line.value, '$.netCents')
          OR (
            json_type(line.value, '$.productId') IS NOT NULL
            AND (
              json_type(line.value, '$.productId') <> 'text'
              OR json_extract(line.value, '$.productId') NOT GLOB '[1-9]*'
              OR json_extract(line.value, '$.productId') GLOB '*[^0-9]*'
            )
          )
          OR (
            json_type(line.value, '$.variantId') IS NOT NULL
            AND (
              json_type(line.value, '$.variantId') <> 'text'
              OR json_extract(line.value, '$.variantId') NOT GLOB '[1-9]*'
              OR json_extract(line.value, '$.variantId') GLOB '*[^0-9]*'
            )
          )
          OR (
            json_type(line.value, '$.sku') IS NOT NULL
            AND (
              json_type(line.value, '$.sku') <> 'text'
              OR length(json_extract(line.value, '$.sku')) NOT BETWEEN 1 AND 64
              OR json_extract(line.value, '$.sku') GLOB '*[<>]*'
            )
          )
        );

      SELECT RAISE(ABORT, 'invoice document line net total mismatch')
      WHERE (
        SELECT COALESCE(SUM(CAST(json_extract(line.value, '$.netCents') AS INTEGER)), 0)
        FROM json_each(NEW.document_json, '$.lines') AS line
      ) IS NOT NEW.net_cents;
    END;
  `);
}

function createInvoiceStates(db: MigrationDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS invoice_states (
      invoice_id INTEGER PRIMARY KEY REFERENCES invoices(id),
      status TEXT NOT NULL DEFAULT 'open' CHECK (
        status IN ('open', 'overdue', 'paid', 'voided')
      ),
      version INTEGER NOT NULL DEFAULT 0 CHECK (
        typeof(version) = 'integer' AND version BETWEEN 0 AND ${MAX_SAFE_INTEGER}
      ),
      settled_at TEXT,
      updated_at TEXT NOT NULL CHECK ${utcInstantCheck('updated_at')},
      CHECK (
        (status = 'paid' AND settled_at IS NOT NULL AND ${utcInstantCheck('settled_at')})
        OR
        (status IN ('open', 'overdue', 'voided') AND settled_at IS NULL)
      )
    );

    CREATE INDEX IF NOT EXISTS invoice_states_status_updated_at_id_idx
      ON invoice_states(status, updated_at DESC, invoice_id DESC);
  `);
}

function createInvoiceEvents(db: MigrationDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS invoice_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL REFERENCES invoices(id),
      event_type TEXT NOT NULL CHECK (event_type IN ('issued', 'settled', 'voided')),
      occurred_at TEXT NOT NULL CHECK ${utcInstantCheck('occurred_at')},
      idempotency_key TEXT UNIQUE CHECK (
        idempotency_key IS NULL OR length(idempotency_key) BETWEEN 1 AND 255
      ),
      request_fingerprint TEXT UNIQUE CHECK (
        request_fingerprint IS NULL OR length(request_fingerprint) BETWEEN 1 AND 255
      ),
      actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      UNIQUE (invoice_id, event_type),
      CHECK (
        (idempotency_key IS NULL AND request_fingerprint IS NULL)
        OR (idempotency_key IS NOT NULL AND request_fingerprint IS NOT NULL)
      )
    );

    CREATE INDEX IF NOT EXISTS invoice_events_invoice_occurred_at_id_idx
      ON invoice_events(invoice_id, occurred_at ASC, id ASC);
    CREATE INDEX IF NOT EXISTS invoice_events_idempotency_key_idx
      ON invoice_events(idempotency_key);
    CREATE INDEX IF NOT EXISTS invoice_events_request_fingerprint_idx
      ON invoice_events(request_fingerprint);

    CREATE TRIGGER IF NOT EXISTS invoice_events_no_update
    BEFORE UPDATE ON invoice_events
    BEGIN
      SELECT RAISE(ABORT, 'invoice_events are immutable');
    END;

    CREATE TRIGGER IF NOT EXISTS invoice_events_no_delete
    BEFORE DELETE ON invoice_events
    BEGIN
      SELECT RAISE(ABORT, 'invoice_events are immutable');
    END;
  `);
}

function rebuildCreditExposureHolds(db: MigrationDb): void {
  if (!hasTable(db, 'credit_exposure_holds')) {
    db.exec(`
      CREATE TABLE credit_exposure_holds (
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
        invoice_id INTEGER REFERENCES invoices(id),
        authorized_at TEXT,
        committed_at TEXT,
        released_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  } else if (!hasInvoiceForeignKey(db)) {
    const existingColumns = (
      db.prepare('PRAGMA table_info(credit_exposure_holds)').all() as {
        name: string;
      }[]
    ).map((column) => column.name);
    const unknownColumns = existingColumns.filter(
      (column) => !(HOLD_COLUMNS as readonly string[]).includes(column),
    );
    if (unknownColumns.length > 0) {
      throw new Error(
        `Migration 036 cannot rebuild credit_exposure_holds with unknown columns: ${unknownColumns.join(', ')}`,
      );
    }
    const missingColumns = HOLD_COLUMNS.filter((column) => !existingColumns.includes(column));
    if (missingColumns.length > 0) {
      throw new Error(
        `Migration 036 cannot rebuild credit_exposure_holds with missing columns: ${missingColumns.join(', ')}`,
      );
    }

    const existingCount = countRows(db, 'credit_exposure_holds');
    const sequence = (
      db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'credit_exposure_holds'").get() as
        { seq: number } | undefined
    )?.seq;
    const indexes = explicitSchemaObjects(db, 'index', 'credit_exposure_holds');

    db.exec(`
      DROP TABLE IF EXISTS credit_exposure_holds_new;
      CREATE TABLE credit_exposure_holds_new (
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
        invoice_id INTEGER REFERENCES invoices(id),
        authorized_at TEXT,
        committed_at TEXT,
        released_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      INSERT INTO credit_exposure_holds_new
        (${HOLD_COLUMNS.join(', ')})
      SELECT ${HOLD_COLUMNS.join(', ')}
        FROM credit_exposure_holds
       ORDER BY id;
    `);

    const copiedCount = countRows(db, 'credit_exposure_holds_new');
    if (copiedCount !== existingCount) {
      throw new Error(
        `credit_exposure_holds rebuild count mismatch: ${existingCount} existing vs ${copiedCount} copied`,
      );
    }

    const mismatch = db
      .prepare(
        `SELECT old.id
           FROM credit_exposure_holds old
           LEFT JOIN credit_exposure_holds_new copy ON copy.id = old.id
          WHERE copy.id IS NULL
             OR old.company_id IS NOT copy.company_id
             OR old.payment_idempotency_key IS NOT copy.payment_idempotency_key
             OR old.amount_cents IS NOT copy.amount_cents
             OR old.status IS NOT copy.status
             OR old.expires_at IS NOT copy.expires_at
             OR old.invoice_id IS NOT copy.invoice_id
             OR old.authorized_at IS NOT copy.authorized_at
             OR old.committed_at IS NOT copy.committed_at
             OR old.released_at IS NOT copy.released_at
             OR old.created_at IS NOT copy.created_at
             OR old.updated_at IS NOT copy.updated_at
          LIMIT 1`,
      )
      .get() as { id: number } | undefined;
    if (mismatch) {
      throw new Error(`credit_exposure_holds rebuild value mismatch at row ${mismatch.id}`);
    }

    db.exec('DROP TABLE credit_exposure_holds');
    db.exec('ALTER TABLE credit_exposure_holds_new RENAME TO credit_exposure_holds');
    preserveSequence(db, 'credit_exposure_holds', sequence);
    for (const index of indexes) db.exec(index.sql);
  }

  db.exec(`
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

function createInvoiceLinkTriggers(db: MigrationDb): void {
  db.exec(`
    /* Invoice facts are snapshots of one trade-credit order and its payment intent. */
    CREATE TRIGGER IF NOT EXISTS invoices_validate_cross_record_links
    BEFORE INSERT ON invoices
    BEGIN
      SELECT RAISE(ABORT, 'invoice facts do not match order')
      WHERE NOT EXISTS (
        SELECT 1
        FROM orders
        WHERE orders.id = NEW.order_id
          AND orders.payment_method = 'trade_credit'
          AND orders.company_id = NEW.company_id
          AND orders.user_id = NEW.user_id
          AND orders.country = NEW.country
          AND orders.net_cents = NEW.net_cents
          AND orders.vat_rate_basis_points = NEW.vat_rate_basis_points
          AND orders.vat_cents = NEW.vat_cents
          AND orders.gross_cents = NEW.gross_cents
      );

      SELECT RAISE(ABORT, 'invoice facts do not match payment')
      WHERE NOT EXISTS (
        SELECT 1
        FROM payments
        WHERE payments.idempotency_key = NEW.payment_idempotency_key
          AND payments.order_id = NEW.order_id
          AND payments.payment_method = 'trade_credit'
          AND payments.company_id = NEW.company_id
          AND payments.amount_cents = NEW.gross_cents
      );
    END;

    /* A hold may be prepared before its invoice exists, but an invoice reference is immutable
       identity linkage: all three denormalised facts must point at the same invoice. */
    CREATE TRIGGER IF NOT EXISTS credit_exposure_holds_validate_invoice_insert
    BEFORE INSERT ON credit_exposure_holds
    WHEN NEW.invoice_id IS NOT NULL
    BEGIN
      SELECT RAISE(ABORT, 'credit exposure hold invoice link mismatch')
      WHERE NOT EXISTS (
        SELECT 1
        FROM invoices
        WHERE invoices.id = NEW.invoice_id
          AND invoices.payment_idempotency_key = NEW.payment_idempotency_key
          AND invoices.company_id = NEW.company_id
          AND invoices.gross_cents = NEW.amount_cents
      );
    END;

    CREATE TRIGGER IF NOT EXISTS credit_exposure_holds_validate_invoice_update
    BEFORE UPDATE OF invoice_id, payment_idempotency_key, company_id, amount_cents
      ON credit_exposure_holds
    WHEN NEW.invoice_id IS NOT NULL
    BEGIN
      SELECT RAISE(ABORT, 'credit exposure hold invoice link mismatch')
      WHERE NOT EXISTS (
        SELECT 1
        FROM invoices
        WHERE invoices.id = NEW.invoice_id
          AND invoices.payment_idempotency_key = NEW.payment_idempotency_key
          AND invoices.company_id = NEW.company_id
          AND invoices.gross_cents = NEW.amount_cents
      );
    END;
  `);
}

/** Adds immutable trade-credit invoices and links exposure holds to invoice identity. */
export const creditInvoicesMigration: Migration = {
  version: '036',
  name: 'credit invoices',
  up(db) {
    for (const table of ['orders', 'payments', 'users', 'company_accounts']) {
      if (!hasTable(db, table)) {
        throw new Error(`Migration 036 requires the ${table} table from earlier migrations`);
      }
    }

    // The migration runner owns FK suspension for this transaction. Rebuilding the 035 hold table
    // here therefore never toggles `foreign_keys` and still receives a whole-database FK check.
    createInvoiceSequences(db);
    createInvoices(db);
    createInvoiceStates(db);
    createInvoiceEvents(db);
    rebuildCreditExposureHolds(db);
    createInvoiceLinkTriggers(db);
    assertForeignKeysClean(db, 'credit invoice schema');
  },
};
