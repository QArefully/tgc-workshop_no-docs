import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import fastifyCookie from '@fastify/cookie';
import Fastify from 'fastify';
import { openDatabase } from '../../src/db/index.js';
import { createUnitOfWork } from '../../src/db/unitOfWork.js';
import { createAccountDeletionRepository } from '../../src/features/accountDeletion/deletionRepository.js';
import { createAccountDeletionService } from '../../src/features/accountDeletion/deletionService.js';
import { createAuditRepository } from '../../src/features/audit/auditRepository.js';
import { createAuditWriter } from '../../src/features/audit/auditService.js';
import { createAuthService } from '../../src/features/auth/authService.js';
import { createSessionRepository } from '../../src/features/auth/sessionRepository.js';
import { createSessionService } from '../../src/features/auth/sessionService.js';
import { createUserRepository } from '../../src/features/auth/userRepository.js';
import { createMailboxRepository } from '../../src/features/mailbox/mailboxRepository.js';
import { createInvoiceRepository } from '../../src/features/invoices/invoiceRepository.js';
import { createPasswordResetRepository } from '../../src/features/passwordReset/passwordResetRepository.js';
import { createPasswordResetService } from '../../src/features/passwordReset/passwordResetService.js';
import { createCompanyMembershipRepository } from '../../src/features/companyAccounts/companyMembershipRepository.js';
import { createCreditAccountRepository } from '../../src/features/tradeCredit/creditAccountRepository.js';
import { createCreditAccountService } from '../../src/features/tradeCredit/creditAccountService.js';
import { createCreditHoldRepository } from '../../src/features/tradeCredit/creditHoldRepository.js';
import { createBillingEntityRepository } from '../../src/features/tradeAccount/billingEntityRepository.js';
import { createDeliverySiteRepository } from '../../src/features/tradeAccount/deliverySiteRepository.js';
import { authPlugin } from '../../src/plugins/auth.js';
import accountDeletionRoutes from '../../src/routes/accountDeletion.js';
import { hashPassword } from '../../src/utils/passwords.js';
import { openSeededDatabase } from '../support/seededDatabase.js';

const now = '2026-07-29T12:00:00.000Z';
const clock = { now: () => new Date(now) };

async function createFixture(t: test.TestContext) {
  const database = openSeededDatabase();
  const db = database.db;
  const unitOfWork = createUnitOfWork(db);
  const audit = createAuditWriter({ repository: createAuditRepository(db), clock });
  const users = createUserRepository(db);
  const mailbox = createMailboxRepository(db);
  const sessions = createSessionService({
    sessions: createSessionRepository(db),
    clock,
    unitOfWork,
    audit,
  });
  const accountDeletion = createAccountDeletionService({
    users,
    repository: createAccountDeletionRepository(db),
    unitOfWork,
    audit,
    clock,
  });
  const auth = createAuthService({ users, clock, unitOfWork, audit });
  const passwordReset = createPasswordResetService({
    repository: createPasswordResetRepository(db),
    mailbox,
    clock,
    baseUrl: 'https://web.example.test',
    tokenSource: () => 'deletion-reset-token',
    unitOfWork,
    audit,
  });
  const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
  await app.register(fastifyCookie);
  authPlugin(sessions)(app, {}, () => undefined);
  await app.register(accountDeletionRoutes, { services: { sessions, accountDeletion } });
  t.after(async () => {
    await app.close();
    await database.cleanup();
  });
  return { app, db, sessions, auth, passwordReset, audit };
}

async function insertUser(db: ReturnType<typeof openDatabase>, email: string, displayName: string) {
  const passwordHash = await hashPassword('current-password-123');
  return Number(
    (
      db
        .prepare(
          `INSERT INTO users (email, display_name, password_hash, password_salt, role, created_at)
           VALUES (?, ?, ?, '', 'customer', ?) RETURNING id`,
        )
        .get(email, displayName, passwordHash, now) as { id: number }
    ).id,
  );
}

void test('account deletion redacts live account data while preserving commerce history and purging sessions', async (t) => {
  const { app, db, sessions, auth, passwordReset, audit } = await createFixture(t);
  const unitOfWork = createUnitOfWork(db);
  const userId = await insertUser(db, 'delete-me@example.test', 'Delete Me');
  const foreignUserId = await insertUser(db, 'foreign-cart@example.test', 'Foreign Cart');
  const variantId = Number(
    (db.prepare('SELECT id FROM product_variants ORDER BY id LIMIT 1').get() as { id: number }).id,
  );
  const ownedCartId = 'delete-owner-cart';
  const foreignCartId = 'delete-foreign-cart';
  const ownedConfigKey = 'a'.repeat(64);
  const foreignConfigKey = 'b'.repeat(64);
  db.prepare('INSERT INTO carts (id) VALUES (?), (?)').run(ownedCartId, foreignCartId);
  audit.append({
    action: 'cart.created',
    cartId: ownedCartId,
    context: { actor: { type: 'user', userId }, requestId: 'owned-cart-create' },
  });
  audit.append({
    action: 'cart.created',
    cartId: foreignCartId,
    context: { actor: { type: 'user', userId: foreignUserId }, requestId: 'foreign-cart-create' },
  });
  db.prepare(
    `INSERT INTO cart_line_items
       (cart_id, variant_id, config_key, custom_blend_json, quantity, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?), (?, ?, '', NULL, 1, ?, ?), (?, ?, ?, ?, 1, ?, ?)`,
  ).run(
    ownedCartId,
    variantId,
    ownedConfigKey,
    JSON.stringify({ configKey: ownedConfigKey }),
    now,
    now,
    ownedCartId,
    variantId,
    now,
    now,
    foreignCartId,
    variantId,
    foreignConfigKey,
    JSON.stringify({ configKey: foreignConfigKey }),
    now,
    now,
  );
  db.prepare(
    `INSERT INTO user_preferences (user_id, order_updates_email, marketing_email, approval_request_email, updated_at)
     VALUES (?, 0, 1, 0, ?)`,
  ).run(userId, now);
  const savedListId = Number(
    db
      .prepare(
        `INSERT INTO saved_lists (user_id, name, is_default, created_at, updated_at)
         VALUES (?, 'Deletion list', 0, ?, ?)`,
      )
      .run(userId, now, now).lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO saved_list_items (saved_list_id, variant_id, quantity, created_at, updated_at)
     VALUES (?, ?, 1, ?, ?)`,
  ).run(savedListId, variantId, now, now);
  createDeliverySiteRepository(db).insert({
    user_id: userId,
    label: 'Deletion Yard',
    contact_name: 'Delete Me',
    contact_phone: null,
    address_line1: '1 Removal Road',
    address_line2: null,
    address_city: 'Leeds',
    address_region: null,
    address_postcode: 'LS1 1AA',
    address_country_code: 'GB',
    is_default: true,
    now,
  });
  createBillingEntityRepository(db).insert({
    user_id: userId,
    legal_name: 'Deletion Materials Ltd',
    registration_number: null,
    vat_number: null,
    address_line1: '1 Removal Road',
    address_line2: null,
    address_city: 'Leeds',
    address_region: null,
    address_postcode: 'LS1 1AA',
    address_country_code: 'GB',
    is_default: true,
    now,
  });
  const orderId = Number(
    (
      db
        .prepare(
          `INSERT INTO orders
            (customer_name, customer_email, shipping_address, subtotal_cents, total_cents, user_id, created_at)
           VALUES ('Delete Me', 'delete-me@example.test', '1 Removal Road', 1000, 1000, ?, ?)
           RETURNING id`,
        )
        .get(userId, now) as { id: number }
    ).id,
  );
  const paymentId = Number(
    (
      db
        .prepare(
          `INSERT INTO payments
            (order_id, idempotency_key, request_fingerprint, status, amount_cents, card_last4, card_brand, created_at)
           VALUES (?, 'deletion-payment', 'deletion-fingerprint', 'succeeded', 1000, '4242', 'visa', ?)
           RETURNING id`,
        )
        .get(orderId, now) as { id: number }
    ).id,
  );
  const returnId = Number(
    (
      db
        .prepare(
          `INSERT INTO return_requests (order_id, user_id, status, reason, requested_at)
           VALUES (?, ?, 'requested', 'other', ?) RETURNING id`,
        )
        .get(orderId, userId, now) as { id: number }
    ).id,
  );
  const companyId = Number(
    (
      db
        .prepare(
          `INSERT INTO company_accounts (name, created_by_user_id, active, created_at, updated_at)
           VALUES ('Sole Delete Co', ?, 1, ?, ?) RETURNING id`,
        )
        .get(userId, now, now) as { id: number }
    ).id,
  );
  db.prepare(
    `INSERT INTO company_memberships (company_id, user_id, role, active, created_at)
     VALUES (?, ?, 'owner', 1, ?)`,
  ).run(companyId, userId, now);
  db.prepare(
    `UPDATE company_accounts
     SET credit_limit_cents = 10000, credit_state = 'active', credit_version = 1
     WHERE id = ?`,
  ).run(companyId);
  db.prepare(
    `INSERT INTO company_credit_events
       (company_id, event_type, credit_limit_cents, credit_terms_days, credit_state,
        credit_version, amount_cents, reason, idempotency_key, request_fingerprint, occurred_at)
     VALUES (?, 'limit_changed', 10000, 30, 'active', 1, NULL, 'Initial limit', ?, ?, ?)`,
  ).run(
    companyId,
    '423e4567-e89b-42d3-a456-426614174000',
    'deletion-credit-event-fingerprint',
    now,
  );
  const creditOrderId = Number(
    (db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS next FROM orders').get() as { next: number })
      .next,
  );
  const creditPaymentKey = '523e4567-e89b-42d3-a456-426614174000';
  const billingSnapshot = {
    legalName: 'Deletion Materials Ltd',
    registrationNumber: null,
    vatNumber: null,
    address: { line1: '1 Removal Road', city: 'Leeds', postcode: 'LS1 1AA', countryCode: 'GB' },
  };
  db.prepare(
    `INSERT INTO orders
       (id, customer_name, customer_email, shipping_address, subtotal_cents, discount_cents,
        total_cents, created_at, user_id, lifecycle_status, version, country, payment_method,
        company_id, net_cents, vat_rate_basis_points, vat_cents, gross_cents,
        billing_entity_json, purchase_order_reference)
     VALUES (?, 'Delete Me', 'delete-me@example.test', '1 Removal Road', 1000, 0, 1200, ?, ?,
             'processing', 0, 'UK', 'trade_credit', ?, 1000, 2000, 200, 1200, ?, 'PO-DELETE')`,
  ).run(creditOrderId, now, userId, companyId, JSON.stringify(billingSnapshot));
  db.prepare(
    `INSERT INTO order_line_items
       (order_id, product_id, product_name, product_price_cents, quantity, line_total_cents,
        discountable_total_cents, blending_fee_cents)
     VALUES (?, 1, 'Deletion Material', 1000, 1, 1000, 1000, 0)`,
  ).run(creditOrderId);
  db.prepare(
    `INSERT INTO payments
       (order_id, idempotency_key, request_fingerprint, status, amount_cents,
        card_last4, card_brand, created_at, payment_method, company_id, user_id)
     VALUES (?, ?, 'deletion-payment-fingerprint', 'succeeded', 1200, NULL, NULL, ?,
             'trade_credit', ?, ?)`,
  ).run(creditOrderId, creditPaymentKey, now, companyId, userId);
  const creditInvoiceId = Number(
    (db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS next FROM invoices').get() as { next: number })
      .next,
  );
  const invoiceNumber = 'QME-2026-001101';
  const invoiceIssuedAt = '2026-07-29T10:00:00.000Z';
  const invoiceSettledAt = '2026-07-29T11:00:00.000Z';
  const invoiceDueAt = '2026-08-28T10:00:00.000Z';
  const invoiceDocument = {
    version: 1,
    id: String(creditInvoiceId),
    invoiceNumber,
    orderId: String(creditOrderId),
    companyId: String(companyId),
    userId: String(userId),
    country: 'UK' as const,
    paymentMethod: 'trade_credit' as const,
    currency: 'GBP' as const,
    terms: 'net_30' as const,
    billingEntity: billingSnapshot,
    purchaseOrderReference: 'PO-DELETE',
    paymentIdempotencyKey: creditPaymentKey,
    lines: [
      {
        lineId: String(creditOrderId),
        description: 'Deletion Material',
        productId: '1',
        quantity: 1,
        unitPriceCents: 1000,
        netCents: 1000,
      },
    ],
    netCents: 1000,
    vatRateBasisPoints: 2000,
    vatCents: 200,
    grossCents: 1200,
    issuedAt: invoiceIssuedAt,
    dueAt: invoiceDueAt,
  };
  db.prepare(
    `INSERT INTO invoices
       (id, version, invoice_number, order_id, payment_idempotency_key, company_id, user_id,
        country, currency, terms, terms_days, document_json, net_cents,
        vat_rate_basis_points, vat_cents, gross_cents, issued_at, due_at)
     VALUES (?, 1, ?, ?, ?, ?, ?, 'UK', 'GBP', 'net_30', 30, ?, 1000, 2000, 200, 1200, ?, ?)`,
  ).run(
    creditInvoiceId,
    invoiceNumber,
    creditOrderId,
    creditPaymentKey,
    companyId,
    userId,
    JSON.stringify(invoiceDocument),
    invoiceIssuedAt,
    invoiceDueAt,
  );
  db.prepare(
    `INSERT INTO invoice_states (invoice_id, status, version, settled_at, updated_at)
     VALUES (?, 'paid', 1, ?, ?)`,
  ).run(creditInvoiceId, invoiceSettledAt, invoiceSettledAt);
  db.prepare(
    `INSERT INTO invoice_events
       (invoice_id, event_type, occurred_at, idempotency_key, request_fingerprint, actor_user_id)
     VALUES (?, 'issued', ?, NULL, NULL, ?)`,
  ).run(creditInvoiceId, invoiceIssuedAt, userId);
  db.prepare(
    `INSERT INTO invoice_events
       (invoice_id, event_type, occurred_at, idempotency_key, request_fingerprint, actor_user_id)
     VALUES (?, 'settled', ?, ?, 'deletion-settlement-fingerprint', ?)`,
  ).run(creditInvoiceId, invoiceSettledAt, '623e4567-e89b-42d3-a456-426614174000', userId);
  const holdId = Number(
    (
      db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS next FROM credit_exposure_holds').get() as {
        next: number;
      }
    ).next,
  );
  db.prepare(
    `INSERT INTO credit_exposure_holds
       (id, company_id, payment_idempotency_key, amount_cents, status, invoice_id,
        committed_at, released_at, created_at, updated_at)
     VALUES (?, ?, ?, 1200, 'released', ?, ?, ?, ?, ?)`,
  ).run(holdId, companyId, creditPaymentKey, creditInvoiceId, invoiceIssuedAt, now, now, now);
  const invoiceRepository = createInvoiceRepository(db);
  const creditAccounts = createCreditAccountService({
    accounts: createCreditAccountRepository(db),
    holds: createCreditHoldRepository(db),
    memberships: createCompanyMembershipRepository(db),
    unitOfWork,
    clock,
    audit,
  });
  assert.ok(creditAccounts.getMemberSummary(userId));
  assert.equal(invoiceRepository.findOwnedById(creditInvoiceId, userId, now)?.status, 'paid');
  const preservedCompanyAttribution = db
    .prepare(
      `SELECT id, name, created_by_user_id, country, credit_limit_cents, credit_state, credit_version
       FROM company_accounts WHERE id = ?`,
    )
    .get(companyId);
  const preservedOrderAttribution = db
    .prepare(
      `SELECT id, user_id, company_id, payment_method, country, net_cents, vat_cents, gross_cents
       FROM orders WHERE id = ?`,
    )
    .get(creditOrderId);
  const preservedPaymentAttribution = db
    .prepare(
      `SELECT id, order_id, idempotency_key, request_fingerprint, payment_method, company_id, user_id
       FROM payments WHERE idempotency_key = ?`,
    )
    .get(creditPaymentKey);
  const preservedInvoiceAttribution = db
    .prepare(
      `SELECT id, invoice_number, order_id, payment_idempotency_key, company_id, user_id,
              country, gross_cents FROM invoices WHERE id = ?`,
    )
    .get(creditInvoiceId);
  const preservedInvoiceState = db
    .prepare(
      'SELECT invoice_id, status, version, settled_at FROM invoice_states WHERE invoice_id = ?',
    )
    .get(creditInvoiceId);
  const preservedInvoiceEvents = db
    .prepare(
      `SELECT invoice_id, event_type, occurred_at, idempotency_key, request_fingerprint, actor_user_id
       FROM invoice_events WHERE invoice_id = ? ORDER BY id`,
    )
    .all(creditInvoiceId);
  const preservedCreditEvents = db
    .prepare(
      `SELECT company_id, event_type, credit_limit_cents, credit_state, credit_version,
              idempotency_key, request_fingerprint FROM company_credit_events WHERE company_id = ?`,
    )
    .all(companyId);
  const preservedHoldAttribution = db
    .prepare(
      `SELECT id, company_id, payment_idempotency_key, amount_cents, status, invoice_id,
              committed_at, released_at FROM credit_exposure_holds WHERE id = ?`,
    )
    .get(holdId);
  const current = sessions.create(userId);
  const other = sessions.create(userId);
  // Identity is (email, country) since migration 032; `insertUser` takes the 'UK' column default.
  passwordReset.request('delete-me@example.test', 'UK');
  assert.equal(
    (
      db
        .prepare('SELECT COUNT(*) AS total FROM password_reset_tokens WHERE user_id = ?')
        .get(userId) as {
        total: number;
      }
    ).total,
    1,
  );

  const response = await app.inject({
    method: 'POST',
    url: '/api/account/delete',
    headers: { cookie: `sid=${current.token}` },
    payload: { currentPassword: 'current-password-123' },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { success: true });
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/account/delete',
        headers: { cookie: `sid=${other.token}` },
        payload: { currentPassword: 'current-password-123' },
      })
    ).statusCode,
    401,
  );
  assert.deepEqual(
    db
      .prepare('SELECT email, display_name, password_hash, password_salt FROM users WHERE id = ?')
      .get(userId),
    {
      email: `deleted-${userId}@tombstone.local`,
      display_name: 'Deleted User',
      password_hash: '',
      password_salt: '',
    },
  );
  assert.equal(
    (
      db.prepare('SELECT COUNT(*) AS total FROM sessions WHERE user_id = ?').get(userId) as {
        total: number;
      }
    ).total,
    0,
  );
  assert.equal(
    (
      db
        .prepare('SELECT COUNT(*) AS total FROM password_reset_tokens WHERE user_id = ?')
        .get(userId) as {
        total: number;
      }
    ).total,
    0,
  );
  assert.equal(
    (await auth.login({ email: 'delete-me@example.test', password: 'current-password-123' })).ok,
    false,
  );
  const mailboxBefore = (
    db.prepare('SELECT COUNT(*) AS total FROM dev_mailbox').get() as { total: number }
  ).total;
  passwordReset.request('delete-me@example.test', 'UK');
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS total FROM dev_mailbox').get() as { total: number }).total,
    mailboxBefore,
  );
  db.prepare(
    `INSERT INTO password_reset_tokens (user_id, token_digest, expires_at, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(
    userId,
    createHash('sha256').update('stale-deletion-token').digest('hex'),
    '2026-07-29T13:00:00.000Z',
    now,
  );
  assert.equal(
    await passwordReset.reset({
      token: 'stale-deletion-token',
      newPassword: 'replacement-password-123',
    }),
    'INVALID_TOKEN',
  );
  assert.deepEqual(
    db.prepare('SELECT password_hash, password_salt FROM users WHERE id = ?').get(userId),
    { password_hash: '', password_salt: '' },
  );
  assert.equal(
    (
      db
        .prepare('SELECT COUNT(*) AS total FROM user_preferences WHERE user_id = ?')
        .get(userId) as { total: number }
    ).total,
    0,
  );
  assert.equal(
    (
      db.prepare('SELECT COUNT(*) AS total FROM saved_lists WHERE user_id = ?').get(userId) as {
        total: number;
      }
    ).total,
    0,
  );
  assert.equal(
    (
      db
        .prepare(
          `SELECT COUNT(*) AS total FROM saved_list_items item
           JOIN saved_lists list ON list.id = item.saved_list_id
           WHERE list.user_id = ?`,
        )
        .get(userId) as { total: number }
    ).total,
    0,
  );
  assert.deepEqual(
    db.prepare('SELECT active, is_default FROM delivery_sites WHERE user_id = ?').all(userId),
    [{ active: 0, is_default: 0 }],
  );
  assert.equal(
    (
      db
        .prepare(
          'SELECT COUNT(*) AS total FROM cart_line_items WHERE cart_id = ? AND custom_blend_json IS NOT NULL',
        )
        .get(ownedCartId) as { total: number }
    ).total,
    0,
  );
  assert.equal(
    (
      db
        .prepare('SELECT COUNT(*) AS total FROM cart_line_items WHERE cart_id = ?')
        .get(ownedCartId) as {
        total: number;
      }
    ).total,
    1,
  );
  assert.equal(
    (
      db
        .prepare(
          'SELECT COUNT(*) AS total FROM cart_line_items WHERE cart_id = ? AND custom_blend_json IS NOT NULL',
        )
        .get(foreignCartId) as { total: number }
    ).total,
    1,
  );
  assert.deepEqual(
    db.prepare('SELECT active, is_default FROM billing_entities WHERE user_id = ?').all(userId),
    [{ active: 0, is_default: 0 }],
  );
  assert.deepEqual(db.prepare('SELECT active FROM company_accounts WHERE id = ?').get(companyId), {
    active: 0,
  });
  assert.deepEqual(
    db.prepare('SELECT active FROM company_memberships WHERE user_id = ?').get(userId),
    { active: 0 },
  );
  assert.equal(creditAccounts.getMemberSummary(userId), null);
  assert.equal(
    invoiceRepository.findOwnedById(creditInvoiceId, userId, now)?.status,
    'paid',
    'immutable invoice remains available to internal history readers',
  );
  assert.deepEqual(
    db
      .prepare(
        `SELECT id, name, created_by_user_id, country, credit_limit_cents, credit_state, credit_version
         FROM company_accounts WHERE id = ?`,
      )
      .get(companyId),
    preservedCompanyAttribution,
  );
  assert.deepEqual(
    db
      .prepare(
        `SELECT id, user_id, company_id, payment_method, country, net_cents, vat_cents, gross_cents
         FROM orders WHERE id = ?`,
      )
      .get(creditOrderId),
    preservedOrderAttribution,
  );
  assert.deepEqual(
    db
      .prepare(
        `SELECT id, order_id, idempotency_key, request_fingerprint, payment_method, company_id, user_id
         FROM payments WHERE idempotency_key = ?`,
      )
      .get(creditPaymentKey),
    preservedPaymentAttribution,
  );
  assert.deepEqual(
    db
      .prepare(
        `SELECT id, invoice_number, order_id, payment_idempotency_key, company_id, user_id,
                country, gross_cents FROM invoices WHERE id = ?`,
      )
      .get(creditInvoiceId),
    preservedInvoiceAttribution,
  );
  assert.deepEqual(
    db
      .prepare(
        'SELECT invoice_id, status, version, settled_at FROM invoice_states WHERE invoice_id = ?',
      )
      .get(creditInvoiceId),
    preservedInvoiceState,
  );
  assert.deepEqual(
    db
      .prepare(
        `SELECT invoice_id, event_type, occurred_at, idempotency_key, request_fingerprint, actor_user_id
         FROM invoice_events WHERE invoice_id = ? ORDER BY id`,
      )
      .all(creditInvoiceId),
    preservedInvoiceEvents,
  );
  assert.deepEqual(
    db
      .prepare(
        `SELECT company_id, event_type, credit_limit_cents, credit_state, credit_version,
                idempotency_key, request_fingerprint FROM company_credit_events WHERE company_id = ?`,
      )
      .all(companyId),
    preservedCreditEvents,
  );
  assert.deepEqual(
    db
      .prepare(
        `SELECT id, company_id, payment_idempotency_key, amount_cents, status, invoice_id,
                committed_at, released_at FROM credit_exposure_holds WHERE id = ?`,
      )
      .get(holdId),
    preservedHoldAttribution,
  );
  assert.deepEqual(db.prepare('SELECT id, user_id FROM orders WHERE id = ?').get(orderId), {
    id: orderId,
    user_id: userId,
  });
  assert.deepEqual(db.prepare('SELECT id, order_id FROM payments WHERE id = ?').get(paymentId), {
    id: paymentId,
    order_id: orderId,
  });
  assert.deepEqual(
    db.prepare('SELECT id, user_id, order_id FROM return_requests WHERE id = ?').get(returnId),
    { id: returnId, user_id: userId, order_id: orderId },
  );
  assert.deepEqual(
    db
      .prepare(
        'SELECT action, actor_user_id, entity_type, entity_id FROM audit_events WHERE action = ?',
      )
      .all('auth.account_deleted'),
    [
      {
        action: 'auth.account_deleted',
        actor_user_id: userId,
        entity_type: 'user',
        entity_id: String(userId),
      },
    ],
  );
  assert.deepEqual(
    db
      .prepare(
        'SELECT user_id, requested_at, completed_at, tombstone_email, tombstone_display_name FROM account_deletion_events',
      )
      .all(),
    [
      {
        user_id: userId,
        requested_at: now,
        completed_at: now,
        tombstone_email: `deleted-${userId}@tombstone.local`,
        tombstone_display_name: 'Deleted User',
      },
    ],
  );
});

void test('account deletion rejects a wrong password without mutation', async (t) => {
  const { app, db, sessions } = await createFixture(t);
  const userId = await insertUser(db, 'wrong-password@example.test', 'Wrong Password');
  const session = sessions.create(userId);
  const response = await app.inject({
    method: 'POST',
    url: '/api/account/delete',
    headers: { cookie: `sid=${session.token}` },
    payload: { currentPassword: 'not-the-current-password' },
  });
  assert.equal(response.statusCode, 400);
  assert.deepEqual(db.prepare('SELECT email, display_name FROM users WHERE id = ?').get(userId), {
    email: 'wrong-password@example.test',
    display_name: 'Wrong Password',
  });
  assert.equal(
    (
      db.prepare('SELECT COUNT(*) AS total FROM sessions WHERE user_id = ?').get(userId) as {
        total: number;
      }
    ).total,
    1,
  );
});

void test('account deletion blocks an owner while another active company member remains', async (t) => {
  const { app, db, sessions } = await createFixture(t);
  const ownerId = await insertUser(db, 'owner-delete@example.test', 'Owner Delete');
  const memberId = await insertUser(db, 'member-delete@example.test', 'Member Delete');
  const companyId = Number(
    (
      db
        .prepare(
          `INSERT INTO company_accounts (name, created_by_user_id, active, created_at, updated_at)
           VALUES ('Blocked Owner Co', ?, 1, ?, ?) RETURNING id`,
        )
        .get(ownerId, now, now) as { id: number }
    ).id,
  );
  db.prepare(
    `INSERT INTO company_memberships (company_id, user_id, role, active, created_at)
     VALUES (?, ?, 'owner', 1, ?), (?, ?, 'buyer', 1, ?)`,
  ).run(companyId, ownerId, now, companyId, memberId, now);
  const ownerSession = sessions.create(ownerId);
  const response = await app.inject({
    method: 'POST',
    url: '/api/account/delete',
    headers: { cookie: `sid=${ownerSession.token}` },
    payload: { currentPassword: 'current-password-123' },
  });
  assert.equal(response.statusCode, 409);
  assert.deepEqual(db.prepare('SELECT email, display_name FROM users WHERE id = ?').get(ownerId), {
    email: 'owner-delete@example.test',
    display_name: 'Owner Delete',
  });
  assert.deepEqual(db.prepare('SELECT active FROM company_accounts WHERE id = ?').get(companyId), {
    active: 1,
  });
  assert.equal(
    (
      db.prepare('SELECT COUNT(*) AS total FROM sessions WHERE user_id = ?').get(ownerId) as {
        total: number;
      }
    ).total,
    1,
  );
});
