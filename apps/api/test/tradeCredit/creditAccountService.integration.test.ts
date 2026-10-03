import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { closeDatabase, openDatabase } from '../../src/db/index.js';
import { createUnitOfWork } from '../../src/db/unitOfWork.js';
import { createCompanyMembershipRepository } from '../../src/features/companyAccounts/companyMembershipRepository.js';
import {
  CreditAccountError,
  createCreditAccountService,
  type CreditAccountAuditInput,
} from '../../src/features/tradeCredit/creditAccountService.js';
import { createCreditAccountRepository } from '../../src/features/tradeCredit/creditAccountRepository.js';
import { createCreditHoldRepository } from '../../src/features/tradeCredit/creditHoldRepository.js';

const NOW = '2026-09-03T09:00:00.000Z';
const ADMIN_ID = 8101;
const BUYER_ID = 8102;
const APPROVER_ID = 8103;
const COMPANY_ID = 8101;

function setup(t: test.TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'shop-credit-account-'));
  const db = openDatabase({ path: join(directory, 'shop.db') });
  db.exec(`
    INSERT INTO users (id, email, display_name, password_hash, password_salt, role, country)
    VALUES (${ADMIN_ID}, 'credit-admin@example.test', 'Credit Admin', 'hash', 'salt', 'admin', 'UK');
    INSERT INTO users (id, email, display_name, password_hash, password_salt, role, country)
    VALUES (${BUYER_ID}, 'credit-buyer@example.test', 'Credit Buyer', 'hash', 'salt', 'customer', 'UK');
    INSERT INTO users (id, email, display_name, password_hash, password_salt, role, country)
    VALUES (${APPROVER_ID}, 'credit-approver@example.test', 'Credit Approver', 'hash', 'salt', 'customer', 'UK');
    INSERT INTO company_accounts
      (id, name, created_by_user_id, active, country, credit_limit_cents, credit_terms_days,
       credit_state, credit_version, created_at, updated_at)
    VALUES (${COMPANY_ID}, 'Credit Materials Ltd', ${ADMIN_ID}, 1, 'UK', 10000, 30,
            'suspended', 0, '${NOW}', '${NOW}');
    INSERT INTO company_memberships (id, company_id, user_id, role, active, created_at)
    VALUES (8101, ${COMPANY_ID}, ${BUYER_ID}, 'buyer', 1, '${NOW}');
    INSERT INTO company_memberships (id, company_id, user_id, role, active, created_at)
    VALUES (8102, ${COMPANY_ID}, ${APPROVER_ID}, 'approver', 1, '${NOW}');
  `);
  const clock = { now: () => new Date(NOW) };
  const audits: CreditAccountAuditInput[] = [];
  const accounts = createCreditAccountRepository(db);
  const holds = createCreditHoldRepository(db);
  const addPayment = (key: string, amount: number) => {
    db.prepare(
      `INSERT INTO payments
        (idempotency_key, request_fingerprint, status, amount_cents, card_last4, card_brand,
         payment_method, company_id, user_id, created_at, updated_at)
       VALUES (?, ?, 'authorized_pending_finalize', ?, NULL, NULL, 'trade_credit', ?, ?, ?, ?)`,
    ).run(key, `${key}-fingerprint`, amount, COMPANY_ID, BUYER_ID, NOW, NOW);
  };
  const service = createCreditAccountService({
    accounts,
    holds,
    memberships: createCompanyMembershipRepository(db),
    unitOfWork: createUnitOfWork(db),
    clock,
    audit: { append: (input) => audits.push(input) },
  });
  t.after(() => {
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  });
  return { db, service, accounts, holds, audits, clock, addPayment };
}

const adminContext = {
  actor: { type: 'user' as const, userId: ADMIN_ID },
  requestId: 'credit-account-request',
  standingCountry: 'UK' as const,
};

void test('member read is membership-scoped and admin mutation replays by durable fingerprint', (t) => {
  const { db, service, audits } = setup(t);
  assert.equal(service.getMember(9999), null);
  assert.equal(
    service.getMember(BUYER_ID)?.state,
    'suspended',
    'suspended accounts are readable summaries',
  );

  db.prepare("UPDATE company_accounts SET credit_state = 'active' WHERE id = ?").run(COMPANY_ID);
  const member = service.getMemberSummary(BUYER_ID);
  assert.equal(member?.companyId, String(COMPANY_ID));
  assert.equal(member?.creditLimitCents, 10000);
  assert.equal(member?.termsDays, 30);
  assert.equal(member?.exposureCents, 0);
  assert.equal(member?.availableCreditCents, 10000);
  assert.equal(member?.id, undefined, 'member view never exposes an account id');

  const key = '11111111-1111-4111-8111-111111111111';
  const updated = service.updateLimit(
    COMPANY_ID,
    { expectedVersion: 0, idempotencyKey: key, creditLimitCents: 20000, reason: 'Reviewed' },
    adminContext,
    'UK',
  );
  assert.equal(updated.creditLimitCents, 20000);
  assert.equal(updated.version, 1);
  assert.equal(audits.length, 1);
  assert.equal(audits[0]?.action, 'company.credit_limit_changed');
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS count FROM company_credit_events').get() as { count: number })
      .count,
    1,
  );

  const replay = service.updateLimit(
    COMPANY_ID,
    { expectedVersion: 0, idempotencyKey: key, creditLimitCents: 20000, reason: 'Reviewed' },
    adminContext,
    'UK',
  );
  assert.equal(replay.version, 1);
  assert.equal(audits.length, 1, 'same-key replay does not append another audit/event');
  assert.throws(
    () =>
      service.updateLimit(
        COMPANY_ID,
        { expectedVersion: 0, idempotencyKey: key, creditLimitCents: 21000, reason: 'Reviewed' },
        adminContext,
        'UK',
      ),
    (error: unknown) =>
      error instanceof CreditAccountError && error.code === 'IDEMPOTENCY_CONFLICT',
  );
  assert.throws(
    () =>
      service.updateState(
        COMPANY_ID,
        {
          expectedVersion: 0,
          idempotencyKey: '22222222-2222-4222-8222-222222222222',
          state: 'on_hold',
        },
        adminContext,
        'UK',
      ),
    (error: unknown) => error instanceof CreditAccountError && error.code === 'STALE_VERSION',
  );
});

void test('admin list/detail enforce country scope and allowlisted query values', (t) => {
  const { db, service } = setup(t);
  db.prepare("UPDATE company_accounts SET credit_state = 'active' WHERE id = ?").run(COMPANY_ID);
  db.prepare(
    `INSERT INTO users (id, email, display_name, password_hash, password_salt, role, country)
     VALUES (8104, 'de-credit@example.test', 'DE Credit', 'hash', 'salt', 'customer', 'DE')`,
  ).run();
  db.prepare(
    `INSERT INTO company_accounts
      (id, name, created_by_user_id, active, country, credit_limit_cents, credit_terms_days,
       credit_state, credit_version, created_at, updated_at)
     VALUES (8104, 'DE Credit Materials', 8104, 1, 'DE', 5000, 30, 'active', 0, ?, ?)`,
  ).run(NOW, NOW);

  const uk = service.listAdmin({ search: 'Credit', order: 'companyName', direction: 'asc' }, 'UK');
  assert.equal(uk.total, 1);
  assert.equal(uk.items[0]?.companyName, 'Credit Materials Ltd');
  assert.equal(service.getAdminDetail(COMPANY_ID, 'UK').companyId, String(COMPANY_ID));
  assert.throws(
    () => service.getAdminDetail(8104, 'UK'),
    (error: unknown) =>
      error instanceof CreditAccountError && error.code === 'CREDIT_ACCOUNT_NOT_FOUND',
  );
  assert.throws(
    () => service.listAdmin({ order: 'drop table company_accounts' as never }),
    (error: unknown) => error instanceof CreditAccountError && error.code === 'INVALID_QUERY',
  );
});

void test('approvers and inactive memberships cannot acquire a credit hold', (t) => {
  const { db, service } = setup(t);
  db.prepare("UPDATE company_accounts SET credit_state = 'active' WHERE id = ?").run(COMPANY_ID);
  const input = {
    paymentIdempotencyKey: 'credit-approver-payment',
    amountCents: 1,
    expiresAt: '2026-09-03T10:00:00.000Z',
  };
  assert.deepEqual(service.tryAcquireHold(APPROVER_ID, input), {
    ok: false,
    code: 'MEMBERSHIP_ROLE_NOT_ELIGIBLE',
  });
  db.prepare('UPDATE company_memberships SET active = 0 WHERE user_id = ?').run(BUYER_ID);
  assert.deepEqual(service.tryAcquireHold(BUYER_ID, input), {
    ok: false,
    code: 'NO_ACTIVE_MEMBERSHIP',
  });
});

void test('admin credit mutation rolls back account and immutable event when audit fails', (t) => {
  const { db, accounts, holds, clock } = setup(t);
  db.prepare("UPDATE company_accounts SET credit_state = 'active' WHERE id = ?").run(COMPANY_ID);
  const failing = createCreditAccountService({
    accounts,
    holds,
    memberships: createCompanyMembershipRepository(db),
    unitOfWork: createUnitOfWork(db),
    clock,
    audit: {
      append: () => {
        throw new Error('audit unavailable');
      },
    },
  });
  assert.throws(
    () =>
      failing.updateLimit(
        COMPANY_ID,
        {
          expectedVersion: 0,
          idempotencyKey: '33333333-3333-4333-8333-333333333333',
          creditLimitCents: 20000,
        },
        adminContext,
        'UK',
      ),
    /audit unavailable/,
  );
  assert.deepEqual(
    db
      .prepare('SELECT credit_limit_cents, credit_version FROM company_accounts WHERE id = ?')
      .get(COMPANY_ID),
    { credit_limit_cents: 10000, credit_version: 0 },
  );
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS count FROM company_credit_events').get() as { count: number })
      .count,
    0,
  );
});

void test('same-value mutations reject before writes and preserve the current state reason', (t) => {
  const { db, service, audits } = setup(t);
  const stateKey = '44444444-4444-4444-8444-444444444444';
  const limitKey = '55555555-5555-4555-8555-555555555555';
  const noOpLimitKey = '66666666-6666-4666-8666-666666666666';
  const noOpStateKey = '77777777-7777-4777-8777-777777777777';

  const held = service.updateState(
    COMPANY_ID,
    { expectedVersion: 0, idempotencyKey: stateKey, state: 'on_hold', reason: 'Past due' },
    adminContext,
    'UK',
  );
  assert.equal(held.state, 'on_hold');
  assert.equal(held.holdReason, 'Past due');

  const limited = service.updateLimit(
    COMPANY_ID,
    { expectedVersion: 1, idempotencyKey: limitKey, creditLimitCents: 12000 },
    adminContext,
    'UK',
  );
  assert.equal(limited.version, 2);
  assert.equal(limited.holdReason, 'Past due', 'limit events do not erase state reason');

  const before = {
    account: db
      .prepare(
        'SELECT credit_limit_cents, credit_state, credit_version FROM company_accounts WHERE id = ?',
      )
      .get(COMPANY_ID),
    events: (
      db.prepare('SELECT COUNT(*) AS count FROM company_credit_events').get() as { count: number }
    ).count,
    audits: audits.length,
  };
  assert.throws(
    () =>
      service.updateLimit(
        COMPANY_ID,
        { expectedVersion: 2, idempotencyKey: noOpLimitKey, creditLimitCents: 12000 },
        adminContext,
        'UK',
      ),
    (error: unknown) => error instanceof CreditAccountError && error.code === 'INVALID_INPUT',
  );
  assert.throws(
    () =>
      service.updateState(
        COMPANY_ID,
        { expectedVersion: 2, idempotencyKey: noOpStateKey, state: 'on_hold', reason: 'Past due' },
        adminContext,
        'UK',
      ),
    (error: unknown) => error instanceof CreditAccountError && error.code === 'INVALID_INPUT',
  );
  assert.deepEqual(
    {
      account: db
        .prepare(
          'SELECT credit_limit_cents, credit_state, credit_version FROM company_accounts WHERE id = ?',
        )
        .get(COMPANY_ID),
      events: (
        db.prepare('SELECT COUNT(*) AS count FROM company_credit_events').get() as { count: number }
      ).count,
      audits: audits.length,
    },
    before,
    'no-op commands leave the account, event ledger, and audit ledger unchanged',
  );
});

void test('expired and released hold keys cannot be replayed as acquisitions', (t) => {
  const { db, service, holds, clock, addPayment } = setup(t);
  db.prepare("UPDATE company_accounts SET credit_state = 'active' WHERE id = ?").run(COMPANY_ID);
  const expiredKey = 'credit-expired-replay';
  const releasedKey = 'credit-released-replay';
  addPayment(expiredKey, 100);
  addPayment(releasedKey, 100);
  const input = (paymentIdempotencyKey: string) => ({
    paymentIdempotencyKey,
    amountCents: 100,
    createdAt: NOW,
    expiresAt: '2026-09-03T10:00:00.000Z',
  });

  assert.equal(service.tryAcquireHold(BUYER_ID, input(expiredKey)).ok, true);
  assert.equal(service.tryAcquireHold(BUYER_ID, input(releasedKey)).ok, true);
  clock.now = () => new Date('2026-09-03T11:00:00.000Z');

  assert.throws(
    () => service.tryAcquireHold(BUYER_ID, input(expiredKey)),
    (error: unknown) =>
      error instanceof CreditAccountError && error.code === 'IDEMPOTENCY_CONFLICT',
  );
  assert.equal(holds.findByKey(expiredKey)?.status, 'released');

  assert.equal(service.releaseHold(releasedKey, '2026-09-03T11:00:00.000Z').status, 'released');
  assert.throws(
    () => service.tryAcquireHold(BUYER_ID, input(releasedKey)),
    (error: unknown) =>
      error instanceof CreditAccountError && error.code === 'IDEMPOTENCY_CONFLICT',
  );
  assert.equal(
    (
      db
        .prepare('SELECT COUNT(*) AS count FROM credit_exposure_holds WHERE company_id = ?')
        .get(COMPANY_ID) as { count: number }
    ).count,
    2,
  );
});
