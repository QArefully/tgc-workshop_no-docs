import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { closeDatabase, migrateDatabase } from '../../src/db/index.js';
import { migrations } from '../../src/db/migrations/index.js';

const pre036Migrations = migrations.filter((migration) => migration.version < '036');

const invoiceDocument = {
  version: 1,
  id: '3601',
  invoiceNumber: 'QME-2026-000001',
  orderId: '3601',
  companyId: '3601',
  userId: '3601',
  country: 'UK',
  paymentMethod: 'trade_credit',
  currency: 'GBP',
  terms: 'net_30',
  billingEntity: {
    legalName: 'Invoice Schema Materials Ltd',
    registrationNumber: null,
    vatNumber: null,
    address: {
      line1: 'Invoice Schema Lane',
      city: 'Leeds',
      postcode: 'LS1 1AA',
      countryCode: 'GB',
    },
  },
  purchaseOrderReference: 'PO-3601',
  paymentIdempotencyKey: 'invoice-schema-payment-3601',
  lines: [
    {
      lineId: '1',
      description: 'Material sacks',
      quantity: 2,
      unitPriceCents: 5_000,
      netCents: 10_000,
    },
  ],
  netCents: 10_000,
  vatRateBasisPoints: 2_000,
  vatCents: 2_000,
  grossCents: 12_000,
  issuedAt: '2026-09-01T09:00:00.000Z',
  dueAt: '2026-10-01T09:00:00.000Z',
} as const;

function createFixture(db: Database.Database, includePaymentUserId = false): void {
  const paymentUserColumn = includePaymentUserId ? ', user_id' : '';
  const paymentUserValue = includePaymentUserId ? ', 3601' : '';
  db.exec(`
    INSERT INTO users
      (id, email, display_name, password_hash, password_salt, role, country)
    VALUES (3601, 'invoice-schema@example.test', 'Invoice Schema Buyer', 'hash', 'salt', 'customer', 'UK');

    INSERT INTO company_accounts
      (id, name, created_by_user_id, active, approval_threshold_cents, created_at, updated_at, country)
    VALUES (3601, 'Invoice Schema Materials Ltd', 3601, 1, 0,
            '2026-09-01T09:00:00.000Z', '2026-09-01T09:00:00.000Z', 'UK');

    INSERT INTO orders
      (id, customer_name, customer_email, shipping_address, subtotal_cents, discount_cents,
       total_cents, created_at, user_id, lifecycle_status, version, country, payment_method,
       company_id, net_cents, vat_rate_basis_points, vat_cents, gross_cents)
    VALUES (3601, 'Invoice Schema Buyer', 'invoice-schema@example.test', '3601 Invoice Lane',
            10000, 0, 12000, '2026-09-01T09:00:00.000Z', 3601, 'processing', 0, 'UK',
            'trade_credit', 3601, 10000, 2000, 2000, 12000);

    INSERT INTO payments
      (id, order_id, idempotency_key, request_fingerprint, status, amount_cents,
       card_last4, card_brand, created_at, payment_method, company_id${paymentUserColumn})
    VALUES (3601, 3601, 'invoice-schema-payment-3601', 'invoice-schema-fingerprint-3601',
            'authorized_pending_finalize', 12000, NULL, NULL, '2026-09-01T09:00:00.000Z',
            'trade_credit', 3601${paymentUserValue});

    INSERT INTO credit_exposure_holds
      (id, company_id, payment_idempotency_key, amount_cents, status, expires_at,
       invoice_id, authorized_at, committed_at, released_at, created_at, updated_at)
    VALUES (3601, 3601, 'invoice-schema-payment-3601', 12000, 'authorized', NULL,
            NULL, '2026-09-01T09:01:00.000Z', NULL, NULL,
            '2026-09-01T09:00:00.000Z', '2026-09-01T09:01:00.000Z');
  `);
}

function insertInvoice(
  db: Database.Database,
  values: {
    id: number;
    invoiceNumber: string;
    orderId: number;
    paymentKey: string;
    companyId?: number;
    userId?: number;
    country?: string;
    netCents?: number;
    vatRateBasisPoints?: number;
    vatCents?: number;
    grossCents?: number;
    issuedAt?: string;
    dueAt?: string;
    document?: Record<string, unknown>;
  },
): void {
  const companyId = values.companyId ?? 3601;
  const userId = values.userId ?? 3601;
  const country = values.country ?? 'UK';
  const netCents = values.netCents ?? 10_000;
  const vatRateBasisPoints = values.vatRateBasisPoints ?? 2_000;
  const vatCents = values.vatCents ?? 2_000;
  const grossCents = values.grossCents ?? 12_000;
  const document = values.document ?? {
    ...invoiceDocument,
    id: String(values.id),
    invoiceNumber: values.invoiceNumber,
    orderId: String(values.orderId),
    companyId: String(companyId),
    userId: String(userId),
    country,
    paymentIdempotencyKey: values.paymentKey,
    netCents,
    vatRateBasisPoints,
    vatCents,
    grossCents,
    issuedAt: values.issuedAt ?? invoiceDocument.issuedAt,
    dueAt: values.dueAt ?? invoiceDocument.dueAt,
  };
  db.prepare(
    `INSERT INTO invoices
      (id, version, invoice_number, order_id, payment_idempotency_key, company_id, user_id,
       country, currency, terms, terms_days, document_json, net_cents, vat_rate_basis_points,
       vat_cents, gross_cents, issued_at, due_at)
     VALUES (?, 1, ?, ?, ?, ?, ?, ?, 'GBP', 'net_30', 30, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    values.id,
    values.invoiceNumber,
    values.orderId,
    values.paymentKey,
    companyId,
    userId,
    country,
    JSON.stringify(document),
    netCents,
    vatRateBasisPoints,
    vatCents,
    grossCents,
    values.issuedAt ?? invoiceDocument.issuedAt,
    values.dueAt ?? invoiceDocument.dueAt,
  );
}

void test('migration 036 creates strict invoice documents, lifecycle projections/events, and hold FK', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  try {
    migrateDatabase(db, pre036Migrations);
    createFixture(db);

    const beforeHolds = db.prepare('SELECT * FROM credit_exposure_holds ORDER BY id').all();
    migrateDatabase(db);

    assert.equal(
      db
        .prepare('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1')
        .pluck()
        .get(),
      '038',
    );
    assert.deepEqual(
      db.prepare('SELECT * FROM credit_exposure_holds ORDER BY id').all(),
      beforeHolds,
      'hold rows survive the FK rebuild byte-for-byte',
    );
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    assert.deepEqual(
      db
        .prepare<[], { table: string; from: string; to: string }>(
          'PRAGMA foreign_key_list(credit_exposure_holds)',
        )
        .all()
        .map(({ table, from, to }) => ({ table, from, to })),
      [
        { table: 'invoices', from: 'invoice_id', to: 'id' },
        { table: 'payments', from: 'payment_idempotency_key', to: 'idempotency_key' },
        { table: 'company_accounts', from: 'company_id', to: 'id' },
      ],
    );

    db.prepare(`INSERT INTO invoice_sequences (year, next_number) VALUES (2026, 1)`).run();
    assert.throws(
      () => db.prepare('INSERT INTO invoice_sequences (year, next_number) VALUES (2026, 2)').run(),
      /UNIQUE constraint failed/,
    );
    assert.throws(
      () => db.prepare('INSERT INTO invoice_sequences (year, next_number) VALUES (999, 1)').run(),
      /CHECK constraint failed/,
    );
    const rollbackAllocation = db.transaction(() => {
      db.prepare(
        'UPDATE invoice_sequences SET next_number = next_number + 1 WHERE year = 2026',
      ).run();
      throw new Error('rollback allocated number');
    });
    assert.throws(rollbackAllocation, /rollback allocated number/);
    assert.equal(
      db.prepare('SELECT next_number FROM invoice_sequences WHERE year = 2026').pluck().get(),
      1,
    );

    insertInvoice(db, {
      id: 3601,
      invoiceNumber: invoiceDocument.invoiceNumber,
      orderId: 3601,
      paymentKey: invoiceDocument.paymentIdempotencyKey,
    });
    db.prepare('UPDATE credit_exposure_holds SET invoice_id = 3601 WHERE id = 3601').run();

    assert.deepEqual(
      db
        .prepare('SELECT status, version, settled_at FROM invoice_states WHERE invoice_id = 3601')
        .get(),
      undefined,
    );
    db.prepare(
      `INSERT INTO invoice_states (invoice_id, status, version, settled_at, updated_at)
       VALUES (3601, 'open', 0, NULL, '2026-09-01T09:00:00.000Z')`,
    ).run();
    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO invoice_states (invoice_id, status, version, settled_at, updated_at)
           VALUES (3601, 'paid', 0, NULL, '2026-09-01T09:00:00.000Z')`,
          )
          .run(),
      /CHECK constraint failed/,
    );
    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO invoice_states (invoice_id, status, version, settled_at, updated_at)
           VALUES (9999, 'open', 0, NULL, '2026-09-01T09:00:00.000Z')`,
          )
          .run(),
      /FOREIGN KEY constraint failed/,
    );
    assert.throws(
      () => db.prepare("UPDATE invoice_states SET status = 'paid' WHERE invoice_id = 3601").run(),
      /CHECK constraint failed/,
    );

    db.prepare(
      `INSERT INTO invoice_events (invoice_id, event_type, occurred_at)
       VALUES (3601, 'issued', '2026-09-01T09:00:00.000Z')`,
    ).run();
    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO invoice_events (invoice_id, event_type, occurred_at)
           VALUES (3601, 'issued', '2026-09-01T09:00:00.000Z')`,
          )
          .run(),
      /UNIQUE constraint failed/,
    );
    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO invoice_events
            (invoice_id, event_type, occurred_at, idempotency_key, request_fingerprint)
           VALUES (3601, 'settled', '2026-09-01T09:00:00.000Z', 'event-key', NULL)`,
          )
          .run(),
      /CHECK constraint failed/,
    );
    db.prepare(
      `INSERT INTO invoice_events
        (invoice_id, event_type, occurred_at, idempotency_key, request_fingerprint, actor_user_id)
       VALUES (3601, 'settled', '2026-09-20T09:00:00.000Z', 'event-key', 'event-fingerprint', 3601)`,
    ).run();
    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO invoice_events
            (invoice_id, event_type, occurred_at, idempotency_key, request_fingerprint)
           VALUES (3601, 'voided', '2026-09-20T09:00:00.000Z', 'event-key', 'other-fingerprint')`,
          )
          .run(),
      /UNIQUE constraint failed/,
    );
    assert.throws(
      () => db.prepare("UPDATE invoice_events SET event_type = 'voided' WHERE id = 1").run(),
      /immutable/,
    );
    assert.throws(() => db.prepare('DELETE FROM invoice_events WHERE id = 1').run(), /immutable/);

    assert.throws(
      () => db.prepare('UPDATE invoices SET gross_cents = 1 WHERE id = 3601').run(),
      /immutable/,
    );
    assert.throws(() => db.prepare('DELETE FROM invoices WHERE id = 3601').run(), /immutable/);
    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO credit_exposure_holds
            (company_id, payment_idempotency_key, amount_cents, status, created_at, updated_at, invoice_id)
           VALUES (3601, 'invoice-schema-payment-3601', 1, 'authorized',
                   '2026-09-01T09:00:00.000Z', '2026-09-01T09:00:00.000Z', 9999)`,
          )
          .run(),
      /UNIQUE constraint failed|FOREIGN KEY constraint failed|invoice link mismatch/,
    );

    const beforeRerun = {
      invoices: db.prepare('SELECT * FROM invoices ORDER BY id').all(),
      states: db.prepare('SELECT * FROM invoice_states ORDER BY invoice_id').all(),
      events: db.prepare('SELECT * FROM invoice_events ORDER BY id').all(),
      holds: db.prepare('SELECT * FROM credit_exposure_holds ORDER BY id').all(),
    };
    migrateDatabase(db);
    const migration036 = migrations.find((migration) => migration.version === '036')!;
    migration036.up(db);
    assert.deepEqual(db.prepare('SELECT * FROM invoices ORDER BY id').all(), beforeRerun.invoices);
    assert.deepEqual(
      db.prepare('SELECT * FROM invoice_states ORDER BY invoice_id').all(),
      beforeRerun.states,
    );
    assert.deepEqual(
      db.prepare('SELECT * FROM invoice_events ORDER BY id').all(),
      beforeRerun.events,
    );
    assert.deepEqual(
      db.prepare('SELECT * FROM credit_exposure_holds ORDER BY id').all(),
      beforeRerun.holds,
    );
    assert.deepEqual(db.pragma('foreign_key_check'), []);
  } finally {
    closeDatabase(db);
  }
});

void test('invoice document checks reject malformed V1 facts and duplicate identity keys', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  try {
    migrateDatabase(db);
    createFixture(db, true);
    db.exec(`
      INSERT INTO users
        (id, email, display_name, password_hash, password_salt, role, country)
      VALUES (3602, 'invoice-schema-second@example.test', 'Invoice Schema Second Buyer',
              'hash', 'salt', 'customer', 'US');
      INSERT INTO company_accounts
        (id, name, created_by_user_id, active, approval_threshold_cents, created_at, updated_at,
         country)
      VALUES (3602, 'Invoice Schema Second Materials Ltd', 3601, 1, 0,
              '2026-09-01T09:00:00.000Z', '2026-09-01T09:00:00.000Z', 'US');
    `);
    insertInvoice(db, {
      id: 3601,
      invoiceNumber: invoiceDocument.invoiceNumber,
      orderId: 3601,
      paymentKey: invoiceDocument.paymentIdempotencyKey,
    });

    const addOrderPayment = (id: number, key: string, amountCents = 12_000): void => {
      db.prepare(
        `INSERT INTO orders
          (id, customer_name, customer_email, shipping_address, subtotal_cents, total_cents,
           created_at, user_id, lifecycle_status, version, country, payment_method, company_id,
           net_cents, vat_rate_basis_points, vat_cents, gross_cents)
         VALUES (?, 'Another Buyer', ?, 'Another Lane', 10000, 12000,
                 '2026-09-01T09:00:00.000Z', 3601, 'processing', 0, 'UK', 'trade_credit', 3601,
                 10000, 2000, 2000, 12000)`,
      ).run(id, `${key}@example.test`);
      db.prepare(
        `INSERT INTO payments
          (id, order_id, idempotency_key, request_fingerprint, status, amount_cents,
           card_last4, card_brand, created_at, payment_method, company_id, user_id)
          VALUES (?, ?, ?, ?, 'authorized_pending_finalize', ?, NULL, NULL,
                  '2026-09-01T09:00:00.000Z', 'trade_credit', 3601, 3601)`,
      ).run(id, id, key, `${key}-fingerprint`, amountCents);
    };
    addOrderPayment(3602, 'invoice-schema-payment-3602');
    addOrderPayment(3603, 'invoice-schema-payment-3603');
    addOrderPayment(3604, 'invoice-schema-payment-3604');
    addOrderPayment(3610, 'invoice-schema-payment-3610');
    addOrderPayment(3611, 'invoice-schema-payment-3611', 11_999);
    addOrderPayment(3612, 'invoice-schema-payment-3612');
    addOrderPayment(3613, 'invoice-schema-payment-3613');
    addOrderPayment(3614, 'invoice-schema-payment-3614');
    addOrderPayment(3615, 'invoice-schema-payment-3615');
    addOrderPayment(3616, 'invoice-schema-payment-3616');

    // A coherent order/payment snapshot is accepted, while each cross-record mismatch is rejected
    // before the invoice can become an immutable historical fact.
    insertInvoice(db, {
      id: 3610,
      invoiceNumber: 'QME-2026-000010',
      orderId: 3610,
      paymentKey: 'invoice-schema-payment-3610',
    });
    assert.throws(
      () =>
        insertInvoice(db, {
          id: 3611,
          invoiceNumber: 'QME-2026-000011',
          orderId: 3610,
          paymentKey: 'invoice-schema-payment-3602',
        }),
      /invoice facts do not match payment/,
    );
    assert.throws(
      () =>
        insertInvoice(db, {
          id: 3612,
          invoiceNumber: 'QME-2026-000012',
          orderId: 3611,
          paymentKey: 'invoice-schema-payment-3611',
        }),
      /invoice facts do not match payment/,
    );
    assert.throws(
      () =>
        insertInvoice(db, {
          id: 3613,
          invoiceNumber: 'QME-2026-000013',
          orderId: 3612,
          paymentKey: 'invoice-schema-payment-3612',
          companyId: 3602,
        }),
      /invoice facts do not match order/,
    );
    assert.throws(
      () =>
        insertInvoice(db, {
          id: 3614,
          invoiceNumber: 'QME-2026-000014',
          orderId: 3613,
          paymentKey: 'invoice-schema-payment-3613',
          userId: 3602,
        }),
      /invoice facts do not match order/,
    );
    assert.throws(
      () =>
        insertInvoice(db, {
          id: 3615,
          invoiceNumber: 'QME-2026-000015',
          orderId: 3614,
          paymentKey: 'invoice-schema-payment-3614',
          country: 'US',
        }),
      /invoice facts do not match order/,
    );
    assert.throws(
      () =>
        insertInvoice(db, {
          id: 3616,
          invoiceNumber: 'QME-2026-000016',
          orderId: 3615,
          paymentKey: 'invoice-schema-payment-3615',
          netCents: 9_999,
          grossCents: 11_999,
          document: {
            ...invoiceDocument,
            id: '3616',
            invoiceNumber: 'QME-2026-000016',
            orderId: '3615',
            paymentIdempotencyKey: 'invoice-schema-payment-3615',
            lines: [{ ...invoiceDocument.lines[0], unitPriceCents: 9_999, netCents: 9_999 }],
            netCents: 9_999,
            grossCents: 11_999,
          },
        }),
      /invoice facts do not match order/,
    );

    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO credit_exposure_holds
              (company_id, payment_idempotency_key, amount_cents, status, created_at, updated_at,
               invoice_id)
             VALUES (3601, 'invoice-schema-payment-3610', 12000, 'authorized',
                     '2026-09-01T09:00:00.000Z', '2026-09-01T09:00:00.000Z', 3601)`,
          )
          .run(),
      /invoice link mismatch/,
    );

    assert.throws(
      () =>
        insertInvoice(db, {
          id: 3602,
          invoiceNumber: 'QME-2026-000002',
          orderId: 3601,
          paymentKey: 'invoice-schema-payment-3602',
        }),
      /UNIQUE constraint failed|invoice facts do not match (order|payment)/,
    );
    assert.throws(
      () =>
        insertInvoice(db, {
          id: 3603,
          invoiceNumber: 'QME-2026-000003',
          orderId: 3602,
          paymentKey: invoiceDocument.paymentIdempotencyKey,
        }),
      /UNIQUE constraint failed|invoice facts do not match (order|payment)/,
    );
    assert.throws(
      () =>
        insertInvoice(db, {
          id: 3604,
          invoiceNumber: invoiceDocument.invoiceNumber,
          orderId: 3603,
          paymentKey: 'invoice-schema-payment-3604',
        }),
      /UNIQUE constraint failed|invoice facts do not match (order|payment)/,
    );

    const malformed = [
      {
        ...invoiceDocument,
        id: '3605',
        invoiceNumber: 'QME-2026-000005',
        orderId: '3602',
        paymentIdempotencyKey: 'invoice-schema-payment-3602',
        netCents: 9999,
      },
      {
        ...invoiceDocument,
        id: '3606',
        invoiceNumber: 'QME-2026-000006',
        orderId: '3603',
        paymentIdempotencyKey: 'invoice-schema-payment-3603',
        dueAt: '2026-10-02T09:00:00.000Z',
      },
      {
        ...invoiceDocument,
        id: '3607',
        invoiceNumber: 'QME-2026-000007',
        orderId: '3604',
        paymentIdempotencyKey: 'invoice-schema-payment-3604',
        lines: [{ ...invoiceDocument.lines[0], netCents: 9999 }],
      },
    ];
    for (const [index, document] of malformed.entries()) {
      assert.throws(
        () =>
          insertInvoice(db, {
            id: 3605 + index,
            invoiceNumber: document.invoiceNumber,
            orderId: Number(document.orderId),
            paymentKey: document.paymentIdempotencyKey,
            document,
          }),
        /CHECK constraint failed|malformed|invoice document/,
      );
    }

    const nestedMalformed = [
      {
        ...invoiceDocument,
        id: '3620',
        invoiceNumber: 'QME-2026-000020',
        orderId: '3602',
        paymentIdempotencyKey: 'invoice-schema-payment-3602',
        billingEntity: { ...invoiceDocument.billingEntity, unexpected: true },
      },
      {
        ...invoiceDocument,
        id: '3621',
        invoiceNumber: 'QME-2026-000021',
        orderId: '3602',
        paymentIdempotencyKey: 'invoice-schema-payment-3602',
        billingEntity: {
          ...invoiceDocument.billingEntity,
          address: { ...invoiceDocument.billingEntity.address, unexpected: true },
        },
      },
      {
        ...invoiceDocument,
        id: '3622',
        invoiceNumber: 'QME-2026-000022',
        orderId: '3602',
        paymentIdempotencyKey: 'invoice-schema-payment-3602',
        lines: [{ ...invoiceDocument.lines[0], unexpected: true }],
      },
      {
        ...invoiceDocument,
        id: '3623',
        invoiceNumber: 'QME-2026-000023',
        orderId: '3602',
        paymentIdempotencyKey: 'invoice-schema-payment-3602',
        lines: [{ ...invoiceDocument.lines[0], lineId: '0' }],
      },
      {
        ...invoiceDocument,
        id: '3624',
        invoiceNumber: 'QME-2026-000024',
        orderId: '3602',
        paymentIdempotencyKey: 'invoice-schema-payment-3602',
        lines: [{ ...invoiceDocument.lines[0], productId: '0' }],
      },
      {
        ...invoiceDocument,
        id: '3625',
        invoiceNumber: 'QME-2026-000025',
        orderId: '3602',
        paymentIdempotencyKey: 'invoice-schema-payment-3602',
        lines: [{ ...invoiceDocument.lines[0], variantId: 'not-a-decimal-id' }],
      },
      {
        ...invoiceDocument,
        id: '3626',
        invoiceNumber: 'QME-2026-000026',
        orderId: '3602',
        paymentIdempotencyKey: 'invoice-schema-payment-3602',
        billingEntity: {
          ...invoiceDocument.billingEntity,
          address: {
            city: invoiceDocument.billingEntity.address.city,
            postcode: invoiceDocument.billingEntity.address.postcode,
            countryCode: invoiceDocument.billingEntity.address.countryCode,
          },
        },
      },
      {
        ...invoiceDocument,
        id: '3627',
        invoiceNumber: 'QME-2026-000027',
        orderId: '3602',
        paymentIdempotencyKey: 'invoice-schema-payment-3602',
        lines: [
          {
            ...invoiceDocument.lines[0],
            lineId: '1',
            quantity: 1,
            unitPriceCents: 4_000,
            netCents: 4_000,
          },
          {
            ...invoiceDocument.lines[0],
            lineId: '2',
            quantity: 1,
            unitPriceCents: 5_000,
            netCents: 5_000,
          },
        ],
      },
    ];
    for (const [index, document] of nestedMalformed.entries()) {
      assert.throws(
        () =>
          insertInvoice(db, {
            id: 3620 + index,
            invoiceNumber: document.invoiceNumber,
            orderId: Number(document.orderId),
            paymentKey: document.paymentIdempotencyKey,
            document,
          }),
        /invoice document/,
      );
    }
  } finally {
    closeDatabase(db);
  }
});
