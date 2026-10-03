import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { closeDatabase, openDatabase } from '../../src/db/index.js';
import { createUnitOfWork } from '../../src/db/unitOfWork.js';
import { createCreditHoldRepository } from '../../src/features/tradeCredit/creditHoldRepository.js';

const COMPANY_ID = 8201;
const USER_ID = 8201;
const NOW = '2026-09-03T09:00:00.000Z';

const CONTENTION_WORKER_SOURCE = `
  const { parentPort, workerData } = require('node:worker_threads');
  const { pathToFileURL } = require('node:url');
  const { register } = require('tsx/esm/api');
  register();

  (async () => {
    try {
      const moduleUrl = (modulePath) => pathToFileURL(modulePath).href;
      const { openDatabase, closeDatabase } = await import(moduleUrl(workerData.dbModule));
      const { createUnitOfWork } = await import(moduleUrl(workerData.uowModule));
      const { createCreditHoldRepository } = await import(moduleUrl(workerData.holdModule));
      const db = openDatabase({ path: workerData.databasePath });
      const holds = createCreditHoldRepository(db);
      const uow = createUnitOfWork(db);
      const barrier = new Int32Array(workerData.barrier);
      Atomics.add(barrier, 0, 1);
      Atomics.notify(barrier, 0, 1);
      parentPort.postMessage({ ready: true });
      while (Atomics.load(barrier, 0) < 2) {
        const ready = Atomics.load(barrier, 0);
        Atomics.wait(barrier, 0, ready);
      }
      Atomics.wait(barrier, 1, 0);
      const hold = uow.run(() => holds.acquire({
        companyId: workerData.companyId,
        paymentIdempotencyKey: workerData.paymentIdempotencyKey,
        amountCents: workerData.amountCents,
        expiresAt: workerData.expiresAt,
        createdAt: workerData.createdAt,
      }));
      parentPort.postMessage({
        ok: hold !== null,
        holdId: hold?.id ?? null,
        amountCents: hold?.amount_cents ?? null,
      });
      closeDatabase(db);
    } catch (error) {
      parentPort.postMessage({ error: error instanceof Error ? error.message : String(error) });
    }
  })();
`;

function setup(t: test.TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'shop-credit-hold-'));
  const databasePath = join(directory, 'shop.db');
  const db = openDatabase({ path: databasePath });
  const siblingDatabases: Array<ReturnType<typeof openDatabase>> = [];
  db.exec(`
    INSERT INTO users (id, email, display_name, password_hash, password_salt, role, country)
    VALUES (${USER_ID}, 'hold-buyer@example.test', 'Hold Buyer', 'hash', 'salt', 'customer', 'UK');
    INSERT INTO company_accounts
      (id, name, created_by_user_id, active, country, credit_limit_cents, credit_terms_days,
       credit_state, credit_version, created_at, updated_at)
    VALUES (${COMPANY_ID}, 'Hold Materials Ltd', ${USER_ID}, 1, 'UK', 30000, 30, 'active', 0,
            '${NOW}', '${NOW}');
  `);
  const holds = createCreditHoldRepository(db);
  const uow = createUnitOfWork(db);
  t.after(() => {
    for (const sibling of siblingDatabases) closeDatabase(sibling);
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  });
  const openSibling = () => {
    const sibling = openDatabase({ path: databasePath });
    siblingDatabases.push(sibling);
    return sibling;
  };
  const addPayment = (key: string, amount: number, orderId: number | null = null) => {
    db.prepare(
      `INSERT INTO payments
        (idempotency_key, request_fingerprint, status, amount_cents, card_last4, card_brand,
         payment_method, company_id, user_id, created_at, updated_at)
       VALUES (?, ?, 'authorized_pending_finalize', ?, NULL, NULL, 'trade_credit', ?, ?, ?, ?)`,
    ).run(key, `${key}-fingerprint`, amount, COMPANY_ID, USER_ID, NOW, NOW);
    if (orderId !== null)
      db.prepare('UPDATE payments SET order_id = ? WHERE idempotency_key = ?').run(orderId, key);
  };
  return { db, holds, uow, addPayment, directory, databasePath, openSibling };
}

void test('exposure aggregates only outstanding invoices and live prepared/authorized holds', (t) => {
  const { db, holds, uow, addPayment } = setup(t);
  const invoiceKey = 'credit-invoice-exposure';
  const holdKey = 'credit-held-exposure';
  const document = {
    version: 1,
    id: '8201',
    invoiceNumber: 'QME-2026-000821',
    orderId: '8201',
    companyId: String(COMPANY_ID),
    userId: String(USER_ID),
    country: 'UK',
    paymentMethod: 'trade_credit',
    currency: 'GBP',
    terms: 'net_30',
    billingEntity: {
      legalName: 'Hold Materials Ltd',
      registrationNumber: null,
      vatNumber: null,
      address: { line1: 'Hold Lane', city: 'Leeds', postcode: 'LS1 1AA', countryCode: 'GB' },
    },
    purchaseOrderReference: null,
    paymentIdempotencyKey: invoiceKey,
    lines: [
      { lineId: '1', description: 'Sacks', quantity: 1, unitPriceCents: 10000, netCents: 10000 },
    ],
    netCents: 10000,
    vatRateBasisPoints: 2000,
    vatCents: 2000,
    grossCents: 12000,
    issuedAt: NOW,
    dueAt: '2026-10-03T09:00:00.000Z',
  };
  db.exec(`
    INSERT INTO orders
      (id, customer_name, customer_email, shipping_address, subtotal_cents, discount_cents,
       total_cents, created_at, user_id, lifecycle_status, version, country, payment_method,
       company_id, net_cents, vat_rate_basis_points, vat_cents, gross_cents)
    VALUES (8201, 'Hold Buyer', 'hold-buyer@example.test', 'Hold Lane', 10000, 0, 12000,
            '${NOW}', ${USER_ID}, 'processing', 0, 'UK', 'trade_credit', ${COMPANY_ID},
            10000, 2000, 2000, 12000);
  `);
  addPayment(invoiceKey, 12000, 8201);
  db.prepare(
    `INSERT INTO invoices
      (id, version, invoice_number, order_id, payment_idempotency_key, company_id, user_id,
       country, currency, terms, terms_days, document_json, net_cents, vat_rate_basis_points,
       vat_cents, gross_cents, issued_at, due_at)
     VALUES (8201, 1, ?, 8201, ?, ?, ?, 'UK', 'GBP', 'net_30', 30, ?, 10000, 2000, 2000,
             12000, ?, '2026-10-03T09:00:00.000Z')`,
  ).run(document.invoiceNumber, invoiceKey, COMPANY_ID, USER_ID, JSON.stringify(document), NOW);
  db.prepare(
    `INSERT INTO invoice_states (invoice_id, status, version, settled_at, updated_at)
     VALUES (8201, 'open', 0, NULL, ?)`,
  ).run(NOW);

  addPayment(holdKey, 5000);
  uow.run(() => {
    const hold = holds.acquire({
      companyId: COMPANY_ID,
      paymentIdempotencyKey: holdKey,
      amountCents: 5000,
      expiresAt: '2026-09-03T10:00:00.000Z',
      createdAt: NOW,
    });
    assert.equal(hold?.status, 'prepared');
  });
  const exposure = holds.exposure(COMPANY_ID, NOW);
  assert.equal(exposure.outstandingInvoiceCents, 12000);
  assert.equal(exposure.preparedHoldCents, 5000);
  assert.equal(exposure.authorizedHoldCents, 0);
  assert.equal(exposure.heldCents, 5000);
  assert.equal(exposure.exposureCents, 17000);
  assert.equal(exposure.availableCreditCents, 13000);
  db.prepare(
    "UPDATE invoice_states SET status = 'paid', settled_at = ?, updated_at = ? WHERE invoice_id = 8201",
  ).run(NOW, NOW);
  assert.equal(holds.exposure(COMPANY_ID, NOW).outstandingInvoiceCents, 0);
});

void test('prepared expiry and lifecycle transitions are CAS-safe and idempotent', (t) => {
  const { holds, uow, addPayment, db } = setup(t);
  const preparedKey = 'credit-prepared-expiry';
  const authorisedKey = 'credit-authorised-lifecycle';
  const committedKey = 'credit-committed-lifecycle';
  const committedInvoiceId = 8299;
  db.prepare(
    `INSERT INTO orders
      (id, customer_name, customer_email, shipping_address, subtotal_cents, discount_cents,
       total_cents, created_at, user_id, lifecycle_status, version, country, payment_method,
       company_id, net_cents, vat_rate_basis_points, vat_cents, gross_cents)
     VALUES (?, 'Hold Buyer', 'hold-buyer@example.test', 'Hold Lane', 5000, 0, 5000,
             ?, ?, 'processing', 0, 'UK', 'trade_credit', ?, 5000, 0, 0, 5000)`,
  ).run(committedInvoiceId, NOW, USER_ID, COMPANY_ID);
  addPayment(preparedKey, 5000);
  addPayment(authorisedKey, 5000);
  addPayment(committedKey, 5000, committedInvoiceId);
  const committedDocument = {
    version: 1,
    id: String(committedInvoiceId),
    invoiceNumber: 'QME-2026-000899',
    orderId: String(committedInvoiceId),
    companyId: String(COMPANY_ID),
    userId: String(USER_ID),
    country: 'UK',
    paymentMethod: 'trade_credit',
    currency: 'GBP',
    terms: 'net_30',
    billingEntity: {
      legalName: 'Hold Materials Ltd',
      registrationNumber: null,
      vatNumber: null,
      address: { line1: 'Hold Lane', city: 'Leeds', postcode: 'LS1 1AA', countryCode: 'GB' },
    },
    purchaseOrderReference: null,
    paymentIdempotencyKey: committedKey,
    lines: [
      { lineId: '1', description: 'Sacks', quantity: 1, unitPriceCents: 5000, netCents: 5000 },
    ],
    netCents: 5000,
    vatRateBasisPoints: 0,
    vatCents: 0,
    grossCents: 5000,
    issuedAt: NOW,
    dueAt: '2026-10-03T09:00:00.000Z',
  };
  db.prepare(
    `INSERT INTO invoices
      (id, version, invoice_number, order_id, payment_idempotency_key, company_id, user_id,
       country, currency, terms, terms_days, document_json, net_cents, vat_rate_basis_points,
       vat_cents, gross_cents, issued_at, due_at)
     VALUES (?, 1, ?, ?, ?, ?, ?, 'UK', 'GBP', 'net_30', 30, ?, 5000, 0, 0, 5000, ?, ?)`,
  ).run(
    committedInvoiceId,
    committedDocument.invoiceNumber,
    committedInvoiceId,
    committedKey,
    COMPANY_ID,
    USER_ID,
    JSON.stringify(committedDocument),
    NOW,
    committedDocument.dueAt,
  );
  db.prepare(
    `INSERT INTO invoice_states (invoice_id, status, version, settled_at, updated_at)
     VALUES (?, 'open', 0, NULL, ?)`,
  ).run(committedInvoiceId, NOW);
  uow.run(() => {
    assert.ok(
      holds.acquire({
        companyId: COMPANY_ID,
        paymentIdempotencyKey: preparedKey,
        amountCents: 5000,
        expiresAt: '2026-09-03T10:00:00.000Z',
        createdAt: NOW,
      }),
    );
    assert.ok(
      holds.acquire({
        companyId: COMPANY_ID,
        paymentIdempotencyKey: authorisedKey,
        amountCents: 5000,
        expiresAt: '2026-09-04T10:00:00.000Z',
        createdAt: NOW,
      }),
    );
    assert.ok(
      holds.acquire({
        companyId: COMPANY_ID,
        paymentIdempotencyKey: committedKey,
        amountCents: 5000,
        expiresAt: '2026-09-04T10:00:00.000Z',
        createdAt: NOW,
      }),
    );
  });
  assert.deepEqual(holds.expirePrepared('2026-09-03T11:00:00.000Z'), [preparedKey]);
  assert.equal(holds.findByKey(preparedKey)?.status, 'released');
  assert.equal(holds.authorize(preparedKey, NOW), null, 'expired prepared hold cannot authorize');

  const authorized = holds.authorize(authorisedKey, NOW);
  assert.equal(authorized?.status, 'authorized');
  assert.equal(authorized?.expires_at, null);
  assert.equal(holds.authorize(authorisedKey, NOW)?.status, 'authorized');
  assert.equal(holds.release(authorisedKey, NOW)?.status, 'released');
  assert.equal(holds.release(authorisedKey, NOW)?.status, 'released');

  assert.equal(holds.authorize(committedKey, NOW)?.status, 'authorized');
  assert.throws(
    () => holds.commit(committedKey, NOW, 0),
    /invoiceId must be a positive safe integer/,
    'a committed hold must always carry a positive invoice link',
  );
  assert.equal(
    holds.commit(committedKey, NOW, committedInvoiceId + 1),
    null,
    'an unrelated invoice cannot be linked to a hold',
  );
  assert.equal(holds.findByKey(committedKey)?.status, 'authorized');
  assert.equal(holds.commit(committedKey, NOW, committedInvoiceId)?.status, 'committed');
  assert.equal(holds.commit(committedKey, NOW, committedInvoiceId)?.status, 'committed');
  assert.equal(holds.release(committedKey, NOW), null, 'committed hold is terminal');
  assert.equal(
    (
      db
        .prepare("SELECT COUNT(*) AS count FROM credit_exposure_holds WHERE status = 'released'")
        .get() as { count: number }
    ).count,
    2,
  );

  db.prepare('UPDATE company_accounts SET credit_limit_cents = ? WHERE id = ?').run(
    5000,
    COMPANY_ID,
  );
  const capacityKey = 'credit-committed-capacity';
  addPayment(capacityKey, 1);
  assert.equal(
    uow.run(() =>
      holds.acquire({
        companyId: COMPANY_ID,
        paymentIdempotencyKey: capacityKey,
        amountCents: 1,
        expiresAt: '2026-09-04T10:00:00.000Z',
        createdAt: NOW,
      }),
    ),
    null,
    'the linked committed invoice continues to protect the company capacity',
  );
  const exposure = holds.exposure(COMPANY_ID, NOW);
  assert.equal(exposure.outstandingInvoiceCents, 5000);
  assert.equal(exposure.availableCreditCents, 0);
});

void test('conditional acquisition admits only the remaining capacity and same key never duplicates', (t) => {
  const { holds, uow, addPayment, db } = setup(t);
  db.prepare('UPDATE company_accounts SET credit_limit_cents = 10000 WHERE id = ?').run(COMPANY_ID);
  const first = 'credit-capacity-first';
  const second = 'credit-capacity-second';
  addPayment(first, 6000);
  addPayment(second, 5000);
  const acquired = uow.run(() =>
    holds.acquire({
      companyId: COMPANY_ID,
      paymentIdempotencyKey: first,
      amountCents: 6000,
      expiresAt: '2026-09-03T10:00:00.000Z',
      createdAt: NOW,
    }),
  );
  assert.equal(acquired?.amount_cents, 6000);
  assert.equal(
    uow.run(
      () =>
        holds.acquire({
          companyId: COMPANY_ID,
          paymentIdempotencyKey: first,
          amountCents: 6000,
          expiresAt: '2026-09-03T10:00:00.000Z',
          createdAt: NOW,
        })?.id,
    ),
    acquired?.id,
  );
  assert.equal(
    uow.run(() =>
      holds.acquire({
        companyId: COMPANY_ID,
        paymentIdempotencyKey: second,
        amountCents: 5000,
        expiresAt: '2026-09-03T10:00:00.000Z',
        createdAt: NOW,
      }),
    ),
    null,
  );
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS count FROM credit_exposure_holds').get() as { count: number })
      .count,
    1,
  );
});

void test('overlapping database connections admit exactly one final-capacity winner', async (t) => {
  const { db, holds, addPayment, databasePath } = setup(t);
  db.prepare('UPDATE company_accounts SET credit_limit_cents = 10000 WHERE id = ?').run(COMPANY_ID);
  const firstKey = 'credit-two-connection-first';
  const secondKey = 'credit-two-connection-second';
  addPayment(firstKey, 6000);
  addPayment(secondKey, 5000);

  const barrier = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2);
  const workerModules = {
    dbModule: fileURLToPath(new URL('../../src/db/index.ts', import.meta.url)),
    uowModule: fileURLToPath(new URL('../../src/db/unitOfWork.ts', import.meta.url)),
    holdModule: fileURLToPath(
      new URL('../../src/features/tradeCredit/creditHoldRepository.ts', import.meta.url),
    ),
  };
  const workers = [
    new Worker(CONTENTION_WORKER_SOURCE, {
      eval: true,
      workerData: {
        ...workerModules,
        barrier,
        databasePath,
        companyId: COMPANY_ID,
        paymentIdempotencyKey: firstKey,
        amountCents: 6000,
        expiresAt: '2026-09-03T10:00:00.000Z',
        createdAt: NOW,
      },
    }),
    new Worker(CONTENTION_WORKER_SOURCE, {
      eval: true,
      workerData: {
        ...workerModules,
        barrier,
        databasePath,
        companyId: COMPANY_ID,
        paymentIdempotencyKey: secondKey,
        amountCents: 5000,
        expiresAt: '2026-09-03T10:00:00.000Z',
        createdAt: NOW,
      },
    }),
  ];
  const results = workers.map(
    (worker) =>
      new Promise<{
        ok: boolean;
        holdId: number | null;
        amountCents: number | null;
        error?: string;
      }>((resolve, reject) => {
        let settled = false;
        const finish = (callback: () => void) => {
          if (settled) return;
          settled = true;
          callback();
        };
        worker.on('message', (message: unknown) => {
          if (
            message !== null &&
            typeof message === 'object' &&
            (message as { ready?: unknown }).ready === true
          )
            return;
          finish(() => {
            if (
              message === null ||
              typeof message !== 'object' ||
              typeof (message as { ok?: unknown }).ok !== 'boolean'
            ) {
              reject(
                new Error(
                  `contention worker returned an invalid result: ${JSON.stringify(message)}`,
                ),
              );
              return;
            }
            resolve(
              message as {
                ok: boolean;
                holdId: number | null;
                amountCents: number | null;
                error?: string;
              },
            );
          });
        });
        worker.once('error', (error: Error) => finish(() => reject(error)));
        worker.once('exit', (code) =>
          finish(() =>
            reject(new Error(`contention worker exited before reporting result (${code})`)),
          ),
        );
      }),
  );
  const readyPromises = workers.map(
    (worker) =>
      new Promise<void>((resolve, reject) => {
        const onMessage = (message: unknown) => {
          if (
            message !== null &&
            typeof message === 'object' &&
            (message as { ready?: unknown }).ready === true
          ) {
            worker.off('message', onMessage);
            resolve();
            return;
          }
          if (
            message !== null &&
            typeof message === 'object' &&
            typeof (message as { error?: unknown }).error === 'string'
          ) {
            worker.off('message', onMessage);
            reject(new Error((message as { error: string }).error));
          }
        };
        worker.on('message', onMessage);
        worker.once('error', reject);
        worker.once('exit', (code) => {
          if (code !== 0) reject(new Error(`contention worker exited during setup (${code})`));
        });
      }),
  );

  let readinessTimeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const sharedState = new Int32Array(barrier);
    await Promise.race([
      Promise.all(readyPromises),
      new Promise<never>((_, reject) => {
        readinessTimeout = setTimeout(
          () => reject(new Error('contention workers did not reach the start barrier')),
          5_000,
        );
        readinessTimeout.unref();
      }),
    ]);
    if (readinessTimeout !== undefined) clearTimeout(readinessTimeout);
    Atomics.store(sharedState, 1, 1);
    Atomics.notify(sharedState, 1, workers.length);
    const completed = await Promise.all(results);
    assert.equal(
      completed.filter((result) => result.ok).length,
      1,
      'exactly one overlapping connection wins the final available capacity',
    );
    assert.equal(
      completed.filter((result) => !result.ok).length,
      1,
      'the losing connection is rejected after the winner commits',
    );
    assert.equal(
      (
        db
          .prepare('SELECT COUNT(*) AS count FROM credit_exposure_holds WHERE company_id = ?')
          .get(COMPANY_ID) as { count: number }
      ).count,
      1,
    );
    const winner = completed.find((result) => result.ok);
    assert.ok(winner?.holdId, 'the winning connection returns its durable hold');
    assert.equal(holds.exposure(COMPANY_ID, NOW).heldCents, winner?.amountCents);
  } finally {
    if (readinessTimeout !== undefined) clearTimeout(readinessTimeout);
    await Promise.allSettled(workers.map((worker) => worker.terminate()));
  }
});
