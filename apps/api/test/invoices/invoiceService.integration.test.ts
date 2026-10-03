import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import Database from 'better-sqlite3';
import type { Country } from '@shop/contracts/country';
import { migrateDatabase } from '../../src/db/index.js';
import { migrations } from '../../src/db/migrations/index.js';
import { createUnitOfWork } from '../../src/db/unitOfWork.js';
import { createAuditRepository } from '../../src/features/audit/auditRepository.js';
import { createAuditWriter } from '../../src/features/audit/auditService.js';
import { createInvoiceRepository } from '../../src/features/invoices/invoiceRepository.js';
import { createInvoiceService } from '../../src/features/invoices/invoiceService.js';
import { InvoiceDomainError } from '../../src/features/invoices/invoiceErrors.js';

const issuedAt = '2026-09-01T09:00:00.000Z';
const dueAt = '2026-10-01T09:00:00.000Z';
const billingEntity = {
  legalName: 'Invoice Materials Ltd',
  registrationNumber: null,
  vatNumber: null,
  address: { line1: '1 Invoice Lane', city: 'London', postcode: 'EC1A 1BB', countryCode: 'GB' },
} as const;
const paymentKey = '123e4567-e89b-42d3-a456-426614174000';

function lifecycleContext(requestId: string, standingCountry: Country = 'UK') {
  return {
    actor: { type: 'user' as const, userId: 9101 },
    requestId,
    standingCountry,
  };
}

function createFixture(databasePath = ':memory:') {
  const db = new Database(databasePath);
  if (databasePath !== ':memory:') db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrateDatabase(db, migrations);
  db.exec(`
    INSERT INTO users (id, email, display_name, password_hash, password_salt, role, country)
    VALUES (9101, 'invoice-buyer@example.test', 'Invoice Buyer', 'hash', 'salt', 'customer', 'UK');
    INSERT INTO company_accounts
      (id, name, created_by_user_id, active, approval_threshold_cents, created_at, updated_at, country)
    VALUES (9101, 'Invoice Materials Ltd', 9101, 1, 0, '${issuedAt}', '${issuedAt}', 'UK');
    INSERT INTO orders
      (id, customer_name, customer_email, shipping_address, subtotal_cents, discount_cents,
       total_cents, created_at, user_id, lifecycle_status, version, country, payment_method,
       company_id, net_cents, vat_rate_basis_points, vat_cents, gross_cents,
       billing_entity_json, purchase_order_reference)
    VALUES (9101, 'Invoice Buyer', 'invoice-buyer@example.test', '1 Invoice Lane', 10000, 0,
            12000, '${issuedAt}', 9101, 'processing', 0, 'UK', 'trade_credit', 9101,
            10000, 2000, 2000, 12000, '${JSON.stringify(billingEntity)}', 'PO-9101');
    INSERT INTO order_line_items
      (id, order_id, product_id, product_name, product_price_cents, quantity, line_total_cents)
    VALUES (9101, 9101, 1, 'Material sacks', 10000, 1, 10000);
    INSERT INTO payments
      (id, order_id, idempotency_key, request_fingerprint, status, amount_cents,
       card_last4, card_brand, created_at, payment_method, company_id, user_id)
    VALUES (9101, 9101, '${paymentKey}', 'invoice-fingerprint', 'authorized_pending_finalize',
            12000, NULL, NULL, '${issuedAt}', 'trade_credit', 9101, 9101);
    INSERT INTO credit_exposure_holds
      (id, company_id, payment_idempotency_key, amount_cents, status,
       authorized_at, created_at, updated_at)
    VALUES (9101, 9101, '${paymentKey}', 12000, 'authorized', '${issuedAt}', '${issuedAt}', '${issuedAt}');
  `);
  let current = new Date('2026-09-02T09:00:00.000Z');
  const repository = createInvoiceRepository(db);
  const audit = createAuditWriter({
    repository: createAuditRepository(db),
    clock: { now: () => current },
  });
  const service = createInvoiceService({
    repository,
    unitOfWork: createUnitOfWork(db),
    clock: { now: () => current },
    audit,
  });
  return {
    db,
    repository,
    service,
    audit,
    setNow: (value: string) => (current = new Date(value)),
  };
}

interface RaceWorker {
  started: Int32Array;
  go: Int32Array;
  done: Promise<{
    ok: boolean;
    status?: string;
    settlementId?: string;
    code?: string;
    message?: string;
  }>;
}

function startRaceWorker(input: {
  databasePath: string;
  operation: 'settle' | 'void';
  request: Record<string, unknown>;
}): RaceWorker {
  const started = new Int32Array(new SharedArrayBuffer(4));
  const go = new Int32Array(new SharedArrayBuffer(4));
  const repositoryUrl = new URL('../../src/features/invoices/invoiceRepository.ts', import.meta.url)
    .href;
  const serviceUrl = new URL('../../src/features/invoices/invoiceService.ts', import.meta.url).href;
  const unitOfWorkUrl = new URL('../../src/db/unitOfWork.ts', import.meta.url).href;
  const auditRepositoryUrl = new URL('../../src/features/audit/auditRepository.ts', import.meta.url)
    .href;
  const auditServiceUrl = new URL('../../src/features/audit/auditService.ts', import.meta.url).href;
  const code = `
    import { parentPort, workerData } from 'node:worker_threads';
    import Database from 'better-sqlite3';
    import { tsImport } from 'tsx/esm/api';
    const started = new Int32Array(workerData.started);
    let ready = false;
    let db;
    try {
      const { createInvoiceRepository } = await tsImport(workerData.repositoryUrl, import.meta.url);
      const { createInvoiceService } = await tsImport(workerData.serviceUrl, import.meta.url);
      const { createUnitOfWork } = await tsImport(workerData.unitOfWorkUrl, import.meta.url);
      const { createAuditRepository } = await tsImport(workerData.auditRepositoryUrl, import.meta.url);
      const { createAuditWriter } = await tsImport(workerData.auditServiceUrl, import.meta.url);
      db = new Database(workerData.databasePath);
      db.pragma('journal_mode = WAL');
      db.pragma('foreign_keys = ON');
      const repository = createInvoiceRepository(db);
      const audit = createAuditWriter({
        repository: createAuditRepository(db),
        clock: { now: () => new Date('2026-09-02T09:00:00.000Z') },
      });
      const service = createInvoiceService({
        repository,
        unitOfWork: createUnitOfWork(db),
        clock: { now: () => new Date('2026-09-02T09:00:00.000Z') },
        audit,
      });
      Atomics.store(started, 0, 1);
      Atomics.notify(started, 0);
      ready = true;
      while (Atomics.load(new Int32Array(workerData.go), 0) === 0) {
        Atomics.wait(new Int32Array(workerData.go), 0, 0);
      }
      const invoice = service[workerData.operation](workerData.request);
      parentPort.postMessage({
        ok: true,
        status: invoice.status,
        settlementId: invoice.settlement?.id,
      });
    } catch (error) {
      if (!ready) {
        Atomics.store(started, 0, -1);
        Atomics.notify(started, 0);
      }
      parentPort.postMessage({
        ok: false,
        code: error && typeof error === 'object' && 'code' in error ? error.code : undefined,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      db?.close();
    }
  `;
  const worker = new Worker(code, {
    eval: true,
    type: 'module',
    execArgv: process.execArgv,
    workerData: {
      ...input,
      started: started.buffer,
      go: go.buffer,
      repositoryUrl,
      serviceUrl,
      unitOfWorkUrl,
      auditRepositoryUrl,
      auditServiceUrl,
    },
  });
  const done = new Promise<{
    ok: boolean;
    status?: string;
    settlementId?: string;
    code?: string;
    message?: string;
  }>((resolve, reject) => {
    worker.once(
      'message',
      (message: {
        ok: boolean;
        status?: string;
        settlementId?: string;
        code?: string;
        message?: string;
      }) => {
        resolve(message);
      },
    );
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code !== 0) reject(new Error(`invoice race worker exited with ${code}`));
    });
  });
  return { started, go, done };
}

function issueInput() {
  return {
    orderId: 9101,
    paymentIdempotencyKey: paymentKey,
    issuedAt,
    companyId: 9101,
    userId: 9101,
    country: 'UK' as const,
    billingEntity,
    purchaseOrderReference: 'PO-9101',
    lines: [
      {
        lineId: '9101',
        description: 'Material sacks',
        productId: '1',
        quantity: 1,
        unitPriceCents: 10000,
        netCents: 10000,
      },
    ],
    netCents: 10000,
    vatRateBasisPoints: 2000,
    vatCents: 2000,
    grossCents: 12000,
  };
}

void test('issues immutable V1 invoice, commits its hold, and replays settlement', () => {
  const fixture = createFixture();
  try {
    const invoice = fixture.service.issue(issueInput());
    assert.match(invoice.invoiceNumber, /^QME-2026-000001$/);
    assert.equal(invoice.status, 'open');
    assert.equal(invoice.lifecycleVersion, 0);
    assert.deepEqual(
      fixture.db
        .prepare('SELECT status, invoice_id FROM credit_exposure_holds WHERE id = 9101')
        .get(),
      { status: 'committed', invoice_id: Number(invoice.id) },
    );
    const settlementInput = {
      invoiceId: Number(invoice.id),
      expectedVersion: 0,
      idempotencyKey: '223e4567-e89b-42d3-a456-426614174000',
      context: lifecycleContext('invoice-settlement-request'),
      standingCountry: 'UK' as const,
    };
    const settled = fixture.service.settle(settlementInput);
    assert.equal(settled.status, 'paid');
    assert.equal(settled.settlement?.amountCents, 12000);
    assert.equal(
      fixture.service.settle(settlementInput).settlement?.id,
      settled.settlement?.id,
      'same settlement key replays the immutable event',
    );
    assert.deepEqual(
      fixture.db.prepare('SELECT status FROM credit_exposure_holds WHERE id = 9101').get(),
      { status: 'released' },
    );
  } finally {
    fixture.db.close();
  }
});

void test('buyer reads are owner-scoped and overdue is derived without mutating state', () => {
  const fixture = createFixture();
  try {
    const invoice = fixture.service.issue(issueInput());
    assert.equal(fixture.service.getOwned(Number(invoice.id), 9101).status, 'open');
    assert.throws(
      () => fixture.service.getOwned(Number(invoice.id), 9999),
      (error: unknown) => error instanceof InvoiceDomainError && error.code === 'INVOICE_NOT_FOUND',
    );
    fixture.setNow(dueAt);
    assert.equal(fixture.service.getOwned(Number(invoice.id), 9101).status, 'overdue');
    assert.equal(
      fixture.db
        .prepare('SELECT status FROM invoice_states WHERE invoice_id = ?')
        .pluck()
        .get(Number(invoice.id)),
      'open',
    );
  } finally {
    fixture.db.close();
  }
});

void test('paid invoices cannot be voided and amount input is rejected', () => {
  const fixture = createFixture();
  try {
    const invoice = fixture.service.issue(issueInput());
    fixture.service.settle({
      invoiceId: Number(invoice.id),
      expectedVersion: 0,
      idempotencyKey: '323e4567-e89b-42d3-a456-426614174000',
      context: lifecycleContext('paid-invoice-settlement-request'),
      standingCountry: 'UK',
    });
    assert.throws(
      () =>
        fixture.service.void({
          invoiceId: Number(invoice.id),
          expectedVersion: 1,
          idempotencyKey: '423e4567-e89b-42d3-a456-426614174000',
          reason: 'Cancellation',
          context: lifecycleContext('paid-invoice-void-request'),
          standingCountry: 'UK',
        }),
      (error: unknown) =>
        error instanceof InvoiceDomainError && error.code === 'INVOICE_ALREADY_PAID',
    );
    assert.throws(
      () =>
        fixture.service.settle({
          invoiceId: Number(invoice.id),
          expectedVersion: 1,
          idempotencyKey: '523e4567-e89b-42d3-a456-426614174000',
          amountCents: 1,
          context: lifecycleContext('invalid-invoice-settlement-request'),
          standingCountry: 'UK',
        }),
      (error: unknown) =>
        error instanceof InvoiceDomainError && error.code === 'INVOICE_SETTLEMENT_INVALID',
    );
  } finally {
    fixture.db.close();
  }
});

void test('voids an open invoice, releases its hold once, and replays by key', () => {
  const fixture = createFixture();
  try {
    const invoice = fixture.service.issue(issueInput());
    const voidInput = {
      invoiceId: Number(invoice.id),
      expectedVersion: 0,
      idempotencyKey: '623e4567-e89b-42d3-a456-426614174000',
      reason: 'Order cancelled before dispatch',
      context: lifecycleContext('invoice-void-request'),
      standingCountry: 'UK' as const,
    };
    const voided = fixture.service.void(voidInput);
    assert.equal(voided.status, 'voided');
    assert.equal(voided.lifecycleVersion, 1);
    assert.equal(fixture.service.void(voidInput).lifecycle?.version, 1);
    assert.deepEqual(
      fixture.db.prepare('SELECT status FROM credit_exposure_holds WHERE id = 9101').get(),
      { status: 'released' },
    );
    assert.deepEqual(
      fixture.db
        .prepare(
          'SELECT event_type, idempotency_key FROM invoice_events WHERE invoice_id = ? ORDER BY id',
        )
        .all(Number(invoice.id)),
      [
        { event_type: 'issued', idempotency_key: null },
        { event_type: 'voided', idempotency_key: voidInput.idempotencyKey },
      ],
    );
  } finally {
    fixture.db.close();
  }
});

void test('settle and void reject foreign standing countries without replay or audit leakage', () => {
  const settleFixture = createFixture();
  try {
    const invoice = settleFixture.service.issue(issueInput());
    const settlementKey = '723e4567-e89b-42d3-a456-426614174099';
    assert.throws(
      () =>
        settleFixture.service.settle({
          invoiceId: Number(invoice.id),
          expectedVersion: 0,
          idempotencyKey: settlementKey,
          context: lifecycleContext('foreign-settlement-request', 'DE'),
          standingCountry: 'DE',
        }),
      (error: unknown) => error instanceof InvoiceDomainError && error.code === 'INVOICE_NOT_FOUND',
    );
    assert.equal(settleFixture.service.get(Number(invoice.id)).status, 'open');
    assert.equal(
      (
        settleFixture.db
          .prepare(
            "SELECT COUNT(*) AS count FROM invoice_events WHERE event_type = 'settled' OR idempotency_key = ?",
          )
          .get(settlementKey) as { count: number }
      ).count,
      0,
    );
    assert.equal(
      (
        settleFixture.db
          .prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action = 'invoice.settled'")
          .get() as { count: number }
      ).count,
      0,
    );

    const settled = settleFixture.service.settle({
      invoiceId: Number(invoice.id),
      expectedVersion: 0,
      idempotencyKey: settlementKey,
      context: lifecycleContext('same-key-settlement-request', 'UK'),
      standingCountry: 'UK',
    });
    assert.equal(settled.status, 'paid');
    assert.equal(
      (
        settleFixture.db
          .prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action = 'invoice.settled'")
          .get() as { count: number }
      ).count,
      1,
    );
    assert.throws(
      () =>
        settleFixture.service.settle({
          invoiceId: Number(invoice.id),
          expectedVersion: 0,
          idempotencyKey: settlementKey,
          context: lifecycleContext('foreign-settlement-replay-request', 'DE'),
          standingCountry: 'DE',
        }),
      (error: unknown) => error instanceof InvoiceDomainError && error.code === 'INVOICE_NOT_FOUND',
    );
    assert.equal(
      (
        settleFixture.db
          .prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action = 'invoice.settled'")
          .get() as { count: number }
      ).count,
      1,
    );
  } finally {
    settleFixture.db.close();
  }

  const voidFixture = createFixture();
  try {
    const invoice = voidFixture.service.issue(issueInput());
    const voidKey = '823e4567-e89b-42d3-a456-426614174099';
    const voidRequest = {
      invoiceId: Number(invoice.id),
      expectedVersion: 0,
      idempotencyKey: voidKey,
      reason: 'Foreign replay check',
      context: lifecycleContext('same-key-void-request', 'UK'),
      standingCountry: 'UK' as const,
    };
    assert.throws(
      () =>
        voidFixture.service.void({
          ...voidRequest,
          context: lifecycleContext('foreign-void-request', 'DE'),
          standingCountry: 'DE',
        }),
      (error: unknown) => error instanceof InvoiceDomainError && error.code === 'INVOICE_NOT_FOUND',
    );
    assert.equal(voidFixture.service.get(Number(invoice.id)).status, 'open');
    assert.deepEqual(
      voidFixture.db
        .prepare(
          `SELECT status FROM credit_exposure_holds
           WHERE payment_idempotency_key = ?`,
        )
        .get(paymentKey),
      { status: 'committed' },
    );
    assert.equal(voidFixture.service.void(voidRequest).status, 'voided');
    assert.throws(
      () =>
        voidFixture.service.void({
          ...voidRequest,
          context: lifecycleContext('foreign-void-replay-request', 'DE'),
          standingCountry: 'DE',
        }),
      (error: unknown) => error instanceof InvoiceDomainError && error.code === 'INVOICE_NOT_FOUND',
    );
    assert.equal(
      (
        voidFixture.db
          .prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action = 'invoice.voided'")
          .get() as { count: number }
      ).count,
      1,
    );
    assert.equal(voidFixture.service.get(Number(invoice.id)).status, 'voided');
  } finally {
    voidFixture.db.close();
  }
});

void test('rolls back lifecycle state and exposure when its audit append fails', () => {
  const fixture = createFixture();
  try {
    const invoice = fixture.service.issue(issueInput());
    const service = createInvoiceService({
      repository: fixture.repository,
      unitOfWork: createUnitOfWork(fixture.db),
      clock: { now: () => new Date('2026-09-02T09:00:00.000Z') },
      audit: {
        append: () => {
          throw new Error('audit append failed');
        },
      },
    });
    assert.throws(
      () =>
        service.settle({
          invoiceId: Number(invoice.id),
          expectedVersion: 0,
          idempotencyKey: '923e4567-e89b-42d3-a456-426614174099',
          context: lifecycleContext('failed-audit-settlement-request'),
          standingCountry: 'UK',
        }),
      /audit append failed/,
    );
    assert.equal(fixture.service.get(Number(invoice.id)).status, 'open');
    assert.equal(
      (
        fixture.db
          .prepare(
            "SELECT COUNT(*) AS count FROM invoice_events WHERE invoice_id = ? AND event_type = 'settled'",
          )
          .get(Number(invoice.id)) as { count: number }
      ).count,
      0,
    );
    assert.equal(
      (
        fixture.db
          .prepare(
            `SELECT status FROM credit_exposure_holds
             WHERE payment_idempotency_key = ?`,
          )
          .get(paymentKey) as { status: string }
      ).status,
      'committed',
    );
    assert.equal(
      (
        fixture.db
          .prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action = 'invoice.settled'")
          .get() as { count: number }
      ).count,
      0,
    );
  } finally {
    fixture.db.close();
  }
});

void test('lifecycle CAS gives one settlement winner for stale concurrent callers', () => {
  const fixture = createFixture();
  try {
    const invoice = fixture.service.issue(issueInput());
    fixture.service.settle({
      invoiceId: Number(invoice.id),
      expectedVersion: 0,
      idempotencyKey: '723e4567-e89b-42d3-a456-426614174000',
      context: lifecycleContext('cas-winning-settlement-request'),
      standingCountry: 'UK',
    });
    assert.throws(
      () =>
        fixture.service.settle({
          invoiceId: Number(invoice.id),
          expectedVersion: 0,
          idempotencyKey: '823e4567-e89b-42d3-a456-426614174000',
          context: lifecycleContext('cas-losing-settlement-request'),
          standingCountry: 'UK',
        }),
      (error: unknown) =>
        error instanceof InvoiceDomainError && error.code === 'INVOICE_SETTLEMENT_CONFLICT',
    );
    assert.equal(
      fixture.db
        .prepare("SELECT COUNT(*) AS count FROM invoice_events WHERE event_type = 'settled'")
        .pluck()
        .get(),
      1,
    );
  } finally {
    fixture.db.close();
  }
});

void test('rolls back a number allocation when invoice linkage fails', () => {
  const fixture = createFixture();
  try {
    fixture.db
      .prepare('UPDATE credit_exposure_holds SET amount_cents = 11999 WHERE id = 9101')
      .run();
    assert.throws(() => fixture.service.issue(issueInput()), /hold does not match invoice facts/);
    assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM invoices').pluck().get(), 0);
    fixture.db
      .prepare('UPDATE credit_exposure_holds SET amount_cents = 12000 WHERE id = 9101')
      .run();
    const invoice = fixture.service.issue(issueInput());
    assert.equal(invoice.invoiceNumber, 'QME-2026-000001');
  } finally {
    fixture.db.close();
  }
});

void test('rejects caller invoice lines that disagree with the persisted order snapshot', () => {
  const fixture = createFixture();
  try {
    const input = issueInput();
    input.lines[0]!.description = 'Caller-controlled replacement';
    assert.throws(
      () => fixture.service.issue(input),
      (error: unknown) =>
        error instanceof InvoiceDomainError && error.code === 'INVOICE_TOTAL_MISMATCH',
    );
    assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM invoices').pluck().get(), 0);
    assert.equal(
      fixture.db.prepare('SELECT COUNT(*) AS count FROM invoice_sequences').pluck().get(),
      0,
    );
  } finally {
    fixture.db.close();
  }
});

void test('requires authorized payment and hold state before issuing an invoice', () => {
  for (const setup of [
    (db: Database.Database) => db.prepare('UPDATE payments SET status = ?').run('prepared'),
    (db: Database.Database) =>
      db.prepare('UPDATE credit_exposure_holds SET status = ?').run('prepared'),
    (db: Database.Database) =>
      db.prepare('UPDATE credit_exposure_holds SET status = ?').run('released'),
    (db: Database.Database) => db.prepare('DELETE FROM credit_exposure_holds').run(),
  ]) {
    const fixture = createFixture();
    try {
      setup(fixture.db);
      assert.throws(() => fixture.service.issue(issueInput()));
      assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM invoices').pluck().get(), 0);
      assert.equal(
        fixture.db.prepare('SELECT COUNT(*) AS count FROM invoice_sequences').pluck().get(),
        0,
      );
    } finally {
      fixture.db.close();
    }
  }
});

void test('allows an exact committed hold replay but rejects a different invoice link', () => {
  const fixture = createFixture();
  try {
    const invoice = fixture.service.issue(issueInput());
    assert.equal(
      fixture.repository.commitExposureHold({
        invoiceId: Number(invoice.id),
        paymentIdempotencyKey: paymentKey,
        companyId: 9101,
        grossCents: 12000,
        committedAt: issuedAt,
      }),
      true,
    );
    assert.throws(
      () =>
        fixture.repository.commitExposureHold({
          invoiceId: Number(invoice.id) + 1,
          paymentIdempotencyKey: paymentKey,
          companyId: 9101,
          grossCents: 12000,
          committedAt: issuedAt,
        }),
      /does not match/,
    );
  } finally {
    fixture.db.close();
  }
});

void test('settle wins a two-connection settle-versus-void race', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'shop-invoice-settle-void-'));
  const databasePath = join(directory, 'shop.db');
  const fixture = createFixture(databasePath);
  try {
    const invoice = fixture.service.issue(issueInput());
    const worker = startRaceWorker({
      databasePath,
      operation: 'void',
      request: {
        invoiceId: Number(invoice.id),
        expectedVersion: 0,
        idempotencyKey: '923e4567-e89b-42d3-a456-426614174000',
        reason: 'Concurrent cancellation',
        context: lifecycleContext('concurrent-void-request'),
        standingCountry: 'UK' as const,
      },
    });
    const lockedRepository = {
      ...fixture.repository,
      lockLifecycle(invoiceId: number) {
        fixture.repository.lockLifecycle?.(invoiceId);
        while (Atomics.load(worker.started, 0) === 0) Atomics.wait(worker.started, 0, 0, 10);
        if (Atomics.load(worker.started, 0) === 1) {
          Atomics.store(worker.go, 0, 1);
          Atomics.notify(worker.go, 0);
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
        }
      },
    };
    const service = createInvoiceService({
      repository: lockedRepository,
      unitOfWork: createUnitOfWork(fixture.db),
      clock: { now: () => new Date('2026-09-02T09:00:00.000Z') },
      audit: fixture.audit,
    });
    const settled = service.settle({
      invoiceId: Number(invoice.id),
      expectedVersion: 0,
      idempotencyKey: 'a23e4567-e89b-42d3-a456-426614174000',
      context: lifecycleContext('concurrent-settlement-request'),
      standingCountry: 'UK',
    });
    const raced = await worker.done;
    assert.equal(Atomics.load(worker.started, 0), 1, raced.message);
    assert.equal(settled.status, 'paid');
    assert.equal(raced.ok, false);
    assert.equal(raced.code, 'INVOICE_SETTLEMENT_CONFLICT');
    assert.equal(
      fixture.db
        .prepare("SELECT COUNT(*) AS count FROM invoice_events WHERE event_type = 'settled'")
        .pluck()
        .get(),
      1,
    );
    assert.equal(
      fixture.db
        .prepare("SELECT COUNT(*) AS count FROM invoice_events WHERE event_type = 'voided'")
        .pluck()
        .get(),
      0,
    );
  } finally {
    fixture.db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test('same-key settlement replay waits for the first connection and returns its event', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'shop-invoice-same-key-'));
  const databasePath = join(directory, 'shop.db');
  const fixture = createFixture(databasePath);
  try {
    const invoice = fixture.service.issue(issueInput());
    const settlementRequest = {
      invoiceId: Number(invoice.id),
      expectedVersion: 0,
      idempotencyKey: 'b23e4567-e89b-42d3-a456-426614174000',
      context: lifecycleContext('replay-settlement-request'),
      standingCountry: 'UK' as const,
    };
    const worker = startRaceWorker({
      databasePath,
      operation: 'settle',
      request: settlementRequest,
    });
    const lockedRepository = {
      ...fixture.repository,
      lockLifecycle(invoiceId: number) {
        fixture.repository.lockLifecycle?.(invoiceId);
        while (Atomics.load(worker.started, 0) === 0) Atomics.wait(worker.started, 0, 0, 10);
        if (Atomics.load(worker.started, 0) === 1) {
          Atomics.store(worker.go, 0, 1);
          Atomics.notify(worker.go, 0);
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
        }
      },
    };
    const service = createInvoiceService({
      repository: lockedRepository,
      unitOfWork: createUnitOfWork(fixture.db),
      clock: { now: () => new Date('2026-09-02T09:00:00.000Z') },
      audit: fixture.audit,
    });
    const settled = service.settle(settlementRequest);
    const replayed = await worker.done;
    assert.equal(Atomics.load(worker.started, 0), 1, replayed.message);
    assert.equal(settled.status, 'paid');
    assert.equal(replayed.ok, true);
    assert.equal(replayed.status, 'paid');
    assert.equal(replayed.settlementId, settled.settlement?.id);
    assert.equal(
      fixture.db
        .prepare("SELECT COUNT(*) AS count FROM invoice_events WHERE event_type = 'settled'")
        .pluck()
        .get(),
      1,
    );
  } finally {
    fixture.db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
