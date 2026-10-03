import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  closeDatabase,
  migrateDatabase,
  openDatabase,
  resetDatabase,
  seedDatabase,
} from '../../src/db/index.js';
import { seedTradeCredit } from '../../src/db/tradeCreditSeed.js';
import { createInvoiceRepository } from '../../src/features/invoices/invoiceRepository.js';
import { DEMO_TRADE_CREDIT_SCENARIO_KEYS } from '../../src/db/tradeCreditSeed.js';

function openFixture(prefix: string) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  const db = openDatabase({ path: join(directory, 'shop.db') });
  return {
    db,
    close: () => {
      closeDatabase(db);
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

function tradeCreditSnapshot(db: ReturnType<typeof openDatabase>): unknown[] {
  return db
    .prepare(
      `SELECT orders.demo_seed_key AS key, orders.id AS order_id,
              payments.id AS payment_id, payments.idempotency_key,
              invoices.id AS invoice_id, invoices.invoice_number,
              invoice_states.status, invoice_states.version AS state_version,
              GROUP_CONCAT(invoice_events.event_type, ',') AS events,
              credit_exposure_holds.status AS hold_status,
              dev_mailbox.id AS mailbox_id
       FROM orders
       JOIN payments ON payments.order_id = orders.id
       JOIN invoices ON invoices.order_id = orders.id
       JOIN invoice_states ON invoice_states.invoice_id = invoices.id
       JOIN credit_exposure_holds
         ON credit_exposure_holds.payment_idempotency_key = payments.idempotency_key
       LEFT JOIN invoice_events ON invoice_events.invoice_id = invoices.id
       LEFT JOIN dev_mailbox ON dev_mailbox.invoice_id = invoices.id
       WHERE orders.demo_seed_key IN (?, ?)
       GROUP BY orders.demo_seed_key, orders.id, payments.id, payments.idempotency_key,
                invoices.id, invoices.invoice_number, invoice_states.status,
                invoice_states.version, credit_exposure_holds.status, dev_mailbox.id
       ORDER BY orders.demo_seed_key`,
    )
    .all(...DEMO_TRADE_CREDIT_SCENARIO_KEYS);
}

void test('trade-credit seed is stable, idempotent, and preserves local rows', () => {
  const fixture = openFixture('shop-credit-seed-');
  const { db } = fixture;
  try {
    seedDatabase(db);
    const first = tradeCreditSnapshot(db);
    assert.equal(first.length, 2);
    assert.deepEqual(
      first.map((row) => (row as { key: string }).key),
      [...DEMO_TRADE_CREDIT_SCENARIO_KEYS],
    );
    assert.deepEqual(
      first.map((row) => (row as { status: string }).status),
      ['open', 'paid'],
    );
    assert.deepEqual(
      first.map((row) => (row as { events: string }).events),
      ['issued', 'issued,settled'],
    );
    assert.deepEqual(
      db
        .prepare(
          `SELECT orders.demo_seed_key AS key,
                  company_accounts.created_at AS company_created_at,
                  policy.occurred_at AS policy_activated_at,
                  orders.created_at AS order_created_at,
                  orders.lifecycle_status AS order_status,
                  orders.version AS order_version,
                  invoices.issued_at,
                  invoice_states.settled_at,
                  credit_exposure_holds.status AS hold_status,
                  credit_exposure_holds.committed_at,
                  credit_exposure_holds.released_at,
                  credit_exposure_holds.updated_at AS hold_updated_at
           FROM orders
           JOIN invoices ON invoices.order_id = orders.id
           JOIN invoice_states ON invoice_states.invoice_id = invoices.id
           JOIN credit_exposure_holds
             ON credit_exposure_holds.invoice_id = invoices.id
           JOIN company_accounts ON company_accounts.id = invoices.company_id
           JOIN company_credit_events policy
             ON policy.company_id = company_accounts.id
            AND policy.idempotency_key = 'seed-acme-credit-policy-v1'
           WHERE orders.demo_seed_key IN (?, ?)
           ORDER BY orders.demo_seed_key`,
        )
        .all(...DEMO_TRADE_CREDIT_SCENARIO_KEYS),
      [
        {
          key: 'acme-credit-open',
          company_created_at: '2026-07-29T09:00:00.000Z',
          policy_activated_at: '2026-08-01T09:00:00.000Z',
          order_created_at: '2026-08-20T09:00:00.000Z',
          order_status: 'processing',
          order_version: 0,
          issued_at: '2026-08-20T09:00:00.000Z',
          settled_at: null,
          hold_status: 'committed',
          committed_at: '2026-08-20T09:00:00.000Z',
          released_at: null,
          hold_updated_at: '2026-08-20T09:00:00.000Z',
        },
        {
          key: 'acme-credit-paid',
          company_created_at: '2026-07-29T09:00:00.000Z',
          policy_activated_at: '2026-08-01T09:00:00.000Z',
          order_created_at: '2026-08-03T09:00:00.000Z',
          order_status: 'processing',
          order_version: 0,
          issued_at: '2026-08-04T09:00:00.000Z',
          settled_at: '2026-08-05T09:00:00.000Z',
          hold_status: 'released',
          committed_at: '2026-08-04T09:00:00.000Z',
          released_at: '2026-08-05T09:00:00.000Z',
          hold_updated_at: '2026-08-05T09:00:00.000Z',
        },
      ],
    );
    assert.deepEqual(db.prepare('SELECT year, next_number FROM invoice_sequences').all(), [
      { year: 2026, next_number: 703 },
    ]);
    // A replay repairs a stale sequence high-water mark from an older local database without
    // using the display number as the seed identity or creating duplicate invoices.
    db.prepare('UPDATE invoice_sequences SET next_number = 1 WHERE year = 2026').run();
    seedDatabase(db);
    assert.deepEqual(tradeCreditSnapshot(db), first);
    assert.deepEqual(db.prepare('SELECT year, next_number FROM invoice_sequences').all(), [
      { year: 2026, next_number: 703 },
    ]);
    const openInvoiceId = Number(
      db
        .prepare("SELECT invoice_id FROM invoice_states WHERE status = 'open' LIMIT 1")
        .pluck()
        .get(),
    );
    const openInvoice = createInvoiceRepository(db).findAdminById(
      openInvoiceId,
      'UK',
      '2026-09-03T09:00:00.000Z',
    );
    assert.equal(openInvoice?.status, 'open');
    assert.equal(openInvoice?.events?.[0]?.idempotencyKey, '00000000-0000-4000-8000-000000000701');

    const localUser = Number(
      db
        .prepare("SELECT id FROM users WHERE email = 'alice@example.com' AND country = 'UK'")
        .pluck()
        .get(),
    );
    db.prepare(
      `INSERT INTO orders
         (customer_name, customer_email, shipping_address, subtotal_cents, discount_cents,
          total_cents, created_at, user_id, demo_seed_key)
       VALUES ('Local Buyer', 'alice@example.com', 'Local address', 100, 0, 100,
               '2026-08-02T09:00:00.000Z', ?, 'local-credit-order')`,
    ).run(localUser);
    const localOrderId = Number(db.prepare('SELECT last_insert_rowid() AS id').pluck().get());

    seedDatabase(db);
    assert.deepEqual(tradeCreditSnapshot(db), first);
    assert.equal(
      db
        .prepare("SELECT COUNT(*) AS count FROM orders WHERE demo_seed_key = 'local-credit-order'")
        .get().count,
      1,
    );
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM company_credit_events').get().count, 1);
    assert.equal(
      db
        .prepare('SELECT credit_limit_cents FROM company_accounts WHERE name = ?')
        .pluck()
        .get('Acme Materials Ltd'),
      500_000,
    );
    assert.ok(localOrderId > 0);
  } finally {
    fixture.close();
  }
});

void test('trade-credit seed skips an occupied preferred invoice number', () => {
  const fixture = openFixture('shop-credit-invoice-collision-');
  const { db } = fixture;
  try {
    // Build the canonical users/catalog/company without the credit scenarios so this test can
    // install a non-seed invoice at the preferred number first.
    db.exec(`
      CREATE TRIGGER block_credit_seed_memberships
      BEFORE INSERT ON company_memberships
      BEGIN SELECT RAISE(IGNORE); END;
    `);
    seedDatabase(db);
    db.exec('DROP TRIGGER block_credit_seed_memberships');

    const companyId = Number(
      db.prepare("SELECT id FROM company_accounts WHERE name = 'Acme Materials Ltd'").pluck().get(),
    );
    const buyerId = Number(
      db
        .prepare("SELECT id FROM users WHERE email = 'buyer@example.com' AND country = 'UK'")
        .pluck()
        .get(),
    );
    const ownerId = Number(
      db
        .prepare("SELECT id FROM users WHERE email = 'acme@example.com' AND country = 'UK'")
        .pluck()
        .get(),
    );
    const approverId = Number(
      db
        .prepare("SELECT id FROM users WHERE email = 'approver@example.com' AND country = 'UK'")
        .pluck()
        .get(),
    );
    const insertMembership = db.prepare(
      `INSERT INTO company_memberships (company_id, user_id, role, active, created_at)
       VALUES (?, ?, ?, 1, '2026-08-01T09:00:00.000Z')`,
    );
    insertMembership.run(companyId, ownerId, 'owner');
    insertMembership.run(companyId, buyerId, 'buyer');
    insertMembership.run(companyId, approverId, 'approver');

    const product = db
      .prepare(
        `SELECT p.id AS product_id, p.name AS product_name, p.consumption_classification,
                v.id AS variant_id, v.sku, v.label, v.weight_grams, v.price_cents,
                v.delivery_class
         FROM products p
         JOIN product_variants v ON v.product_id = p.id
         WHERE v.sku = 'BKP-0001-001'`,
      )
      .get() as {
      product_id: number;
      product_name: string;
      consumption_classification: string;
      variant_id: number;
      sku: string;
      label: string;
      weight_grams: number;
      price_cents: number;
      delivery_class: string;
    };
    const quantity = 2;
    const netCents = product.price_cents * quantity;
    const vatCents = Math.floor((netCents * 2_000 + 5_000) / 10_000);
    const grossCents = netCents + vatCents;
    const issuedAt = '2026-08-02T09:00:00.000Z';
    const localPaymentKey = 'local-trade-credit-invoice';
    const billing = {
      legalName: 'Local Materials Ltd',
      registrationNumber: null,
      vatNumber: null,
      address: {
        line1: '2 Local Way',
        city: 'Demo City',
        postcode: 'DC1 1AA',
        countryCode: 'UK',
      },
    };
    const address = {
      line1: '2 Local Way',
      city: 'Demo City',
      postcode: 'DC1 1AA',
      countryCode: 'UK',
    };
    const orderResult = db
      .prepare(
        `INSERT INTO orders
           (customer_name, customer_email, shipping_address, promo_code_applied, subtotal_cents,
            discount_cents, total_cents, created_at, user_id, lifecycle_status, version,
            demo_seed_key, delivery_mode, delivery_charge_cents, delivery_weight_grams,
            delivery_address_json, billing_entity_json, delivery_slot_date, delivery_slot_window,
            purchase_order_reference, country, payment_method, company_id, net_cents,
            vat_rate_basis_points, vat_cents, gross_cents)
         VALUES (?, ?, ?, NULL, ?, 0, ?, ?, ?, 'processing', 0, ?, ?, 0, ?, ?, ?, ?, 'am', ?, ?,
                 'trade_credit', ?, ?, ?, ?, ?)`,
      )
      .run(
        'Local Invoice Buyer',
        'buyer@example.com',
        JSON.stringify(address),
        netCents,
        grossCents,
        issuedAt,
        buyerId,
        'local-credit-invoice',
        product.delivery_class,
        product.weight_grams * quantity,
        JSON.stringify(address),
        JSON.stringify(billing),
        '2026-08-03',
        'LOCAL-CREDIT-PO',
        'UK',
        companyId,
        netCents,
        2_000,
        vatCents,
        grossCents,
      );
    const orderId = Number(orderResult.lastInsertRowid);
    const lineResult = db
      .prepare(
        `INSERT INTO order_line_items
           (order_id, product_id, product_name, product_price_cents, quantity, line_total_cents,
            discountable_total_cents, blending_fee_cents, variant_id, sku, variant_label,
            weight_grams, consumption_classification, delivery_class)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        orderId,
        product.product_id,
        product.product_name,
        product.price_cents,
        quantity,
        netCents,
        netCents,
        product.variant_id,
        product.sku,
        product.label,
        product.weight_grams,
        product.consumption_classification,
        product.delivery_class,
      );
    const lineId = Number(lineResult.lastInsertRowid);
    db.prepare(
      `INSERT INTO payments
         (order_id, idempotency_key, request_fingerprint, status, amount_cents, card_last4,
          card_brand, failure_reason, created_at, response_json, payment_method, company_id, user_id)
       VALUES (?, ?, 'local-trade-credit-invoice-fingerprint', 'succeeded', ?, NULL, NULL, NULL,
               ?, ?, 'trade_credit', ?, ?)`,
    ).run(
      orderId,
      localPaymentKey,
      grossCents,
      issuedAt,
      JSON.stringify({ paymentMethod: 'trade_credit', status: 'succeeded' }),
      companyId,
      buyerId,
    );
    const localInvoiceId = Number(
      db.prepare('SELECT COALESCE(MAX(id), 0) + 1 FROM invoices').pluck().get(),
    );
    const localInvoiceNumber = 'QME-2026-000701';
    const localDocument = {
      version: 1,
      id: String(localInvoiceId),
      invoiceNumber: localInvoiceNumber,
      orderId: String(orderId),
      companyId: String(companyId),
      userId: String(buyerId),
      country: 'UK',
      paymentMethod: 'trade_credit',
      currency: 'GBP',
      terms: 'net_30',
      termsDays: 30,
      billingEntity: billing,
      purchaseOrderReference: 'LOCAL-CREDIT-PO',
      paymentIdempotencyKey: localPaymentKey,
      lines: [
        {
          lineId: String(lineId),
          description: product.product_name,
          productId: String(product.product_id),
          variantId: String(product.variant_id),
          sku: product.sku,
          quantity,
          unitPriceCents: product.price_cents,
          netCents,
        },
      ],
      netCents,
      vatRateBasisPoints: 2_000,
      vatCents,
      grossCents,
      issuedAt,
      dueAt: '2026-09-01T09:00:00.000Z',
    };
    db.prepare(
      `INSERT INTO invoices
         (id, version, invoice_number, order_id, payment_idempotency_key, company_id, user_id,
          country, currency, terms, terms_days, document_json, net_cents,
          vat_rate_basis_points, vat_cents, gross_cents, issued_at, due_at)
       VALUES (?, 1, ?, ?, ?, ?, ?, 'UK', 'GBP', 'net_30', 30, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      localInvoiceId,
      localInvoiceNumber,
      orderId,
      localPaymentKey,
      companyId,
      buyerId,
      JSON.stringify(localDocument),
      netCents,
      2_000,
      vatCents,
      grossCents,
      issuedAt,
      '2026-09-01T09:00:00.000Z',
    );

    seedTradeCredit(db);
    assert.deepEqual(
      db
        .prepare(
          `SELECT demo_seed_key AS key, invoice_number
           FROM orders JOIN invoices ON invoices.order_id = orders.id
           WHERE demo_seed_key IN (?, ?)
           ORDER BY demo_seed_key`,
        )
        .all(...DEMO_TRADE_CREDIT_SCENARIO_KEYS),
      [
        { key: 'acme-credit-open', invoice_number: 'QME-2026-000702' },
        { key: 'acme-credit-paid', invoice_number: 'QME-2026-000703' },
      ],
    );
    assert.deepEqual(
      db.prepare('SELECT invoice_number FROM invoices WHERE id = ?').get(localInvoiceId),
      { invoice_number: localInvoiceNumber },
    );
    assert.deepEqual(db.prepare('SELECT year, next_number FROM invoice_sequences').all(), [
      { year: 2026, next_number: 704 },
    ]);

    seedTradeCredit(db);
    assert.deepEqual(
      db
        .prepare(
          `SELECT demo_seed_key AS key, invoice_number
           FROM orders JOIN invoices ON invoices.order_id = orders.id
           WHERE demo_seed_key IN (?, ?)
           ORDER BY demo_seed_key`,
        )
        .all(...DEMO_TRADE_CREDIT_SCENARIO_KEYS),
      [
        { key: 'acme-credit-open', invoice_number: 'QME-2026-000702' },
        { key: 'acme-credit-paid', invoice_number: 'QME-2026-000703' },
      ],
    );
    assert.equal(createInvoiceRepository(db).allocateNumber(2026), 'QME-2026-000704');
  } finally {
    fixture.close();
  }
});

void test('seed never resurrects a tombstoned Acme membership', () => {
  const fixture = openFixture('shop-credit-tombstone-');
  const { db } = fixture;
  try {
    seedDatabase(db);
    const buyerId = Number(
      db
        .prepare("SELECT id FROM users WHERE email = 'buyer@example.com' AND country = 'UK'")
        .pluck()
        .get(),
    );
    const companyId = Number(
      db.prepare("SELECT id FROM company_accounts WHERE name = 'Acme Materials Ltd'").pluck().get(),
    );
    db.prepare("UPDATE users SET email = 'deleted-buyer@tombstone.local' WHERE id = ?").run(
      buyerId,
    );
    db.prepare(
      'UPDATE company_memberships SET active = 0 WHERE company_id = ? AND user_id = ?',
    ).run(companyId, buyerId);

    seedDatabase(db);
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM users WHERE email = 'buyer@example.com'").get()
        .count,
      0,
    );
    assert.equal(
      db
        .prepare('SELECT active FROM company_memberships WHERE company_id = ? AND user_id = ?')
        .pluck()
        .get(companyId, buyerId),
      0,
    );
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM invoices').get().count, 2);
  } finally {
    fixture.close();
  }
});

void test('reset clears credit, invoice, mailbox, and admin-refund rows then restores triggers', () => {
  const fixture = openFixture('shop-credit-reset-');
  const { db } = fixture;
  try {
    seedDatabase(db);
    const payment = db
      .prepare(
        "SELECT id, order_id FROM payments WHERE payment_method = 'card' ORDER BY id LIMIT 1",
      )
      .get() as { id: number; order_id: number };
    const adminId = Number(
      db
        .prepare("SELECT id FROM users WHERE email = 'admin@example.com' AND country = 'UK'")
        .pluck()
        .get(),
    );
    db.prepare(
      `INSERT INTO admin_refunds
         (payment_id, order_id, actor_user_id, amount_cents, reason, idempotency_key,
          processor, simulated_reference, created_at)
       VALUES (?, ?, ?, 1, 'reset fixture', 'reset-admin-refund', 'simulated',
               'sim-reset-admin-refund', '2026-08-02T09:00:00.000Z')`,
    ).run(payment.id, payment.order_id, adminId);

    resetDatabase(db);
    for (const table of [
      'admin_refunds',
      'company_credit_events',
      'credit_exposure_holds',
      'invoices',
      'invoice_states',
      'invoice_events',
      'invoice_sequences',
      'dev_mailbox',
    ]) {
      assert.equal(
        db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
        0,
        `${table} should be empty after reset`,
      );
    }
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    migrateDatabase(db);
    assert.deepEqual(db.pragma('foreign_key_check'), []);

    const triggerNames = db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'trigger'
           AND name IN ('admin_refunds_no_update', 'admin_refunds_no_delete',
                        'company_credit_events_no_update', 'company_credit_events_no_delete',
                        'invoices_no_update', 'invoices_no_delete',
                        'invoice_events_no_update', 'invoice_events_no_delete')
         ORDER BY name`,
      )
      .all()
      .map((row) => (row as { name: string }).name);
    assert.deepEqual(triggerNames, [
      'admin_refunds_no_delete',
      'admin_refunds_no_update',
      'company_credit_events_no_delete',
      'company_credit_events_no_update',
      'invoice_events_no_delete',
      'invoice_events_no_update',
      'invoices_no_delete',
      'invoices_no_update',
    ]);
    seedDatabase(db);
    const seededInvoiceId = Number(
      db.prepare('SELECT id FROM invoices ORDER BY id LIMIT 1').pluck().get(),
    );
    assert.throws(
      () => db.prepare('DELETE FROM invoices WHERE id = ?').run(seededInvoiceId),
      /immutable/,
    );
  } finally {
    fixture.close();
  }
});
