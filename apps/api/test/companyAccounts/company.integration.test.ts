import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import fastifyCookie from '@fastify/cookie';
import Fastify from 'fastify';
import type {
  Company,
  CompanyAccountResponse,
  CompanyMembership,
  CompanyMembershipListResponse,
} from '@shop/contracts/company-accounts';
import { closeDatabase, openDatabase } from '../../src/db/index.js';
import { createUnitOfWork } from '../../src/db/unitOfWork.js';
import { createAuditRepository } from '../../src/features/audit/auditRepository.js';
import { createAuditWriter } from '../../src/features/audit/auditService.js';
import { createSessionRepository } from '../../src/features/auth/sessionRepository.js';
import { createSessionService } from '../../src/features/auth/sessionService.js';
import { createCompanyInviteRepository } from '../../src/features/companyAccounts/companyInviteRepository.js';
import { createCompanyMembershipRepository } from '../../src/features/companyAccounts/companyMembershipRepository.js';
import { createCompanyRepository } from '../../src/features/companyAccounts/companyRepository.js';
import { createCompanyService } from '../../src/features/companyAccounts/companyService.js';
import { createMailboxRepository } from '../../src/features/mailbox/mailboxRepository.js';
import { authPlugin } from '../../src/plugins/auth.js';
import companyRoutes from '../../src/routes/companyAccounts.js';

function setup(t: test.TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'shop-company-'));
  const db = openDatabase({ path: join(directory, 'shop.db') });
  const clock = { now: () => new Date('2026-07-29T12:00:00.000Z') };
  const sessions = createSessionService({ sessions: createSessionRepository(db), clock });
  const companyAccounts = createCompanyService({
    companies: createCompanyRepository(db),
    memberships: createCompanyMembershipRepository(db),
    invites: createCompanyInviteRepository(db),
    mailbox: createMailboxRepository(db),
    audit: createAuditWriter({ repository: createAuditRepository(db), clock }),
    unitOfWork: createUnitOfWork(db),
    clock,
    baseUrl: 'http://example.test/',
    tokenSource: () => 'test-invite-token',
  });
  const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
  void app.register(fastifyCookie);
  authPlugin(sessions)(app, {}, () => undefined);
  void app.register(companyRoutes, { services: { sessions, companyAccounts } });
  t.after(async () => {
    await app.close();
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  });
  const addUser = (email: string) =>
    Number(
      (
        db
          .prepare(
            `INSERT INTO users
    (email, display_name, password_hash, password_salt, role) VALUES (?, 'User', 'hash', 'salt', 'customer') RETURNING id`,
          )
          .get(email) as { id: number }
      ).id,
    );
  const headers = (userId: number) => ({ cookie: `sid=${sessions.create(userId).token}` });
  return { app, db, addUser, headers };
}

void test('company creation establishes the sole owner and owner-managed members/threshold', async (t) => {
  const { app, db, addUser, headers } = setup(t);
  const ownerId = addUser('owner@example.test');
  const memberId = addUser('member@example.test');
  assert.equal(
    (await app.inject({ method: 'POST', url: '/api/company', payload: { name: 'Acme Materials' } }))
      .statusCode,
    401,
  );
  const created = await app.inject({
    method: 'POST',
    url: '/api/company',
    headers: headers(ownerId),
    payload: { name: ' Acme Materials ' },
  });
  assert.equal(created.statusCode, 201);
  const company = created.json<NonNullable<CompanyAccountResponse>>();
  assert.equal(company.company.name, 'Acme Materials');
  assert.equal(company.membership.role, 'owner');
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/company',
        headers: headers(ownerId),
        payload: { name: 'Second Company' },
      })
    ).statusCode,
    409,
  );
  const membershipId = Number(
    (
      db
        .prepare(
          `INSERT INTO company_memberships
    (company_id, user_id, role, active, created_at) VALUES (?, ?, 'buyer', 1, ?) RETURNING id`,
        )
        .get(Number(company.company.id), memberId, '2026-07-29T12:00:00.000Z') as { id: number }
    ).id,
  );
  const members = await app.inject({
    method: 'GET',
    url: '/api/company/members',
    headers: headers(ownerId),
  });
  assert.equal(members.statusCode, 200);
  assert.equal(members.json<CompanyMembershipListResponse>().length, 2);
  const changed = await app.inject({
    method: 'PATCH',
    url: `/api/company/members/${membershipId}`,
    headers: headers(ownerId),
    payload: { role: 'approver' },
  });
  assert.equal(changed.statusCode, 200);
  assert.equal(changed.json<CompanyMembership>().role, 'approver');
  const threshold = await app.inject({
    method: 'PATCH',
    url: '/api/company/threshold',
    headers: headers(ownerId),
    payload: { approvalThresholdCents: 12500 },
  });
  assert.equal(threshold.statusCode, 200);
  assert.equal(threshold.json<Company>().approvalThresholdCents, 12500);
  const ownerMembershipId = Number(company.membership.id);
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: `/api/company/members/${ownerMembershipId}`,
        headers: headers(ownerId),
        payload: { role: 'buyer' },
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await app.inject({
        method: 'DELETE',
        url: `/api/company/members/${ownerMembershipId}`,
        headers: headers(ownerId),
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await app.inject({
        method: 'DELETE',
        url: `/api/company/members/${membershipId}`,
        headers: headers(ownerId),
      })
    ).statusCode,
    200,
  );
  assert.deepEqual(
    db.prepare('SELECT active FROM company_memberships WHERE id = ?').get(membershipId),
    { active: 0 },
  );
  assert.deepEqual(
    db.prepare("SELECT action FROM audit_events WHERE action LIKE 'company.%' ORDER BY id").all(),
    [
      { action: 'company.created' },
      { action: 'company.member_role_changed' },
      { action: 'company.threshold_changed' },
      { action: 'company.member_revoked' },
    ],
  );
});
