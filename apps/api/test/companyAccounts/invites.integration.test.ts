import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import fastifyCookie from '@fastify/cookie';
import Fastify from 'fastify';
import type { CompanyAccountResponse, CompanyInvite } from '@shop/contracts/company-accounts';
import type { Country } from '@shop/contracts/country';
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

void test('invites are mailed, accepted once, scoped to owners, and do not disclose foreign ids', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'shop-company-invite-'));
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
    tokenSource: () => 'invite-token',
  });
  const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
  await app.register(fastifyCookie);
  authPlugin(sessions)(app, {}, () => undefined);
  await app.register(companyRoutes, { services: { sessions, companyAccounts } });
  t.after(async () => {
    await app.close();
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  });
  const addUser = (email: string, country: Country = 'UK') =>
    Number(
      (
        db
          .prepare(
            "INSERT INTO users (email, display_name, password_hash, password_salt, role, country) VALUES (?, 'User', 'hash', 'salt', 'customer', ?) RETURNING id",
          )
          .get(email, country) as { id: number }
      ).id,
    );
  const ownerId = addUser('owner@example.test');
  const buyerId = addUser('buyer@example.test');
  const otherOwnerId = addUser('other-owner@example.test');
  const inviteeId = addUser('invitee@example.test');
  const foreignInviteeId = addUser('foreign-invitee@example.test', 'DE');
  const outsiderId = addUser('outsider@example.test');
  const headers = (id: number) => ({ cookie: `sid=${sessions.create(id).token}` });
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/company',
        headers: headers(ownerId),
        payload: { name: 'Acme' },
      })
    ).statusCode,
    201,
  );
  const companyId = Number(
    (db.prepare('SELECT id FROM company_accounts WHERE name = ?').get('Acme') as { id: number }).id,
  );
  db.prepare(
    `INSERT INTO company_memberships
      (company_id, user_id, role, active, created_at) VALUES (?, ?, 'buyer', 1, ?)`,
  ).run(companyId, buyerId, '2026-07-29T12:00:00.000Z');
  const invited = await app.inject({
    method: 'POST',
    url: '/api/company/invites',
    headers: headers(ownerId),
    payload: { email: 'INVITEE@example.test', role: 'buyer' },
  });
  assert.equal(invited.statusCode, 201);
  const invite = invited.json<CompanyInvite>();
  assert.equal(invite.email, 'invitee@example.test');
  assert.equal(
    (await app.inject({ method: 'GET', url: '/api/company/invites', headers: headers(buyerId) }))
      .statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/company',
        headers: headers(otherOwnerId),
        payload: { name: 'Other Company' },
      })
    ).statusCode,
    201,
  );
  assert.match(
    (
      db.prepare("SELECT body FROM dev_mailbox WHERE template_key = 'company_invite'").get() as {
        body: string;
      }
    ).body,
    /token=invite-token/,
  );
  assert.equal(
    (
      await app.inject({
        method: 'DELETE',
        url: `/api/company/invites/${invite.id}`,
        headers: headers(otherOwnerId),
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await app.inject({
        method: 'DELETE',
        url: `/api/company/invites/${invite.id}`,
        headers: headers(outsiderId),
      })
    ).statusCode,
    404,
  );
  const foreignAcceptance = await app.inject({
    method: 'POST',
    url: '/api/company/invites/accept',
    headers: headers(foreignInviteeId),
    payload: { token: 'invite-token' },
  });
  assert.equal(foreignAcceptance.statusCode, 404);
  assert.equal(foreignAcceptance.json<{ code: string }>().code, 'INVITE_NOT_FOUND');
  assert.deepEqual(
    db.prepare('SELECT status FROM company_invites WHERE id = ?').get(Number(invite.id)),
    { status: 'pending' },
  );
  assert.deepEqual(
    db
      .prepare('SELECT COUNT(*) AS count FROM company_memberships WHERE user_id = ? AND active = 1')
      .get(foreignInviteeId),
    { count: 0 },
  );
  const accepted = await app.inject({
    method: 'POST',
    url: '/api/company/invites/accept',
    headers: headers(inviteeId),
    payload: { token: 'invite-token' },
  });
  assert.equal(accepted.statusCode, 200);
  assert.equal(accepted.json<NonNullable<CompanyAccountResponse>>().membership.role, 'buyer');
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/company/invites/accept',
        headers: headers(inviteeId),
        payload: { token: 'invite-token' },
      })
    ).statusCode,
    400,
  );
  assert.deepEqual(
    db.prepare('SELECT status FROM company_invites WHERE id = ?').get(Number(invite.id)),
    { status: 'accepted' },
  );
  assert.deepEqual(
    db.prepare("SELECT action FROM audit_events WHERE action LIKE 'company.%' ORDER BY id").all(),
    [
      { action: 'company.created' },
      { action: 'company.member_invited' },
      { action: 'company.created' },
      { action: 'company.member_joined' },
    ],
  );
});
