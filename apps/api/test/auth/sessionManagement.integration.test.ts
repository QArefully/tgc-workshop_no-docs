import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import fastifyCookie from '@fastify/cookie';
import Fastify from 'fastify';
import { closeDatabase, openDatabase } from '../../src/db/index.js';
import { createUnitOfWork } from '../../src/db/unitOfWork.js';
import { createAuditRepository } from '../../src/features/audit/auditRepository.js';
import { createAuditWriter } from '../../src/features/audit/auditService.js';
import { createSessionRepository } from '../../src/features/auth/sessionRepository.js';
import { createSessionService, toSessionShortId } from '../../src/features/auth/sessionService.js';
import { authPlugin } from '../../src/plugins/auth.js';
import accountSessionRoutes from '../../src/routes/accountSessions.js';

function token(prefix: string): string {
  return `${prefix}${'0'.repeat(64 - prefix.length)}`;
}

function sessionCookie(value: string): string {
  return `sid=${value}`;
}

void test('account session management scopes sessions, audits revocation, and throttles last-seen', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'shop-session-management-'));
  const db = openDatabase({ path: join(directory, 'shop.db') });
  let now = new Date('2026-07-20T12:00:00.000Z');
  const clock = { now: () => now };
  const repository = createSessionRepository(db);
  const sessions = createSessionService({
    sessions: repository,
    clock,
    unitOfWork: createUnitOfWork(db),
    audit: createAuditWriter({ repository: createAuditRepository(db), clock }),
  });
  const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
  await app.register(fastifyCookie);
  authPlugin(sessions)(app, {}, () => undefined);
  await app.register(accountSessionRoutes, { services: { sessions } });
  t.after(async () => {
    await app.close();
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  });

  const insertUser = (email: string): number =>
    Number(
      (
        db
          .prepare(
            `INSERT INTO users (email, display_name, password_hash, password_salt, role)
             VALUES (?, ?, 'hash', 'salt', 'customer') RETURNING id`,
          )
          .get(email, email) as { id: number }
      ).id,
    );
  const callerId = insertUser('caller@example.test');
  const otherId = insertUser('other@example.test');
  const ownOlderToken = token('111111111111');
  const currentToken = token('222222222222');
  const foreignToken = token('333333333333');
  const expiry = '2026-07-27T12:00:00.000Z';
  repository.create({
    token: ownOlderToken,
    userId: callerId,
    createdAt: '2026-07-20T11:59:00.000Z',
    expiresAt: expiry,
    lastSeenAt: '2026-07-20T11:59:00.000Z',
    userAgent: 'Older Browser',
    ipAddressHash: 'old-ip-hash',
  });
  repository.create({
    token: currentToken,
    userId: callerId,
    createdAt: '2026-07-20T12:00:00.000Z',
    expiresAt: expiry,
    lastSeenAt: '2026-07-20T12:00:00.000Z',
    userAgent: null,
    ipAddressHash: null,
  });
  repository.create({
    token: foreignToken,
    userId: otherId,
    createdAt: '2026-07-20T12:01:00.000Z',
    expiresAt: expiry,
    lastSeenAt: '2026-07-20T12:01:00.000Z',
    userAgent: 'Foreign Browser',
    ipAddressHash: 'foreign-ip-hash',
  });

  const currentHeaders = { cookie: sessionCookie(currentToken) };
  const list = await app.inject({
    method: 'GET',
    url: '/api/account/sessions',
    headers: currentHeaders,
  });
  assert.equal(list.statusCode, 200);
  assert.deepEqual(JSON.parse(list.body), [
    {
      sessionId: toSessionShortId(currentToken),
      createdAt: '2026-07-20T12:00:00.000Z',
      expiresAt: expiry,
      lastSeenAt: '2026-07-20T12:00:00.000Z',
      userAgent: null,
      ipAddressHash: null,
      isCurrent: true,
    },
    {
      sessionId: toSessionShortId(ownOlderToken),
      createdAt: '2026-07-20T11:59:00.000Z',
      expiresAt: expiry,
      lastSeenAt: '2026-07-20T11:59:00.000Z',
      userAgent: 'Older Browser',
      ipAddressHash: 'old-ip-hash',
      isCurrent: false,
    },
  ]);

  const current = await app.inject({
    method: 'DELETE',
    url: `/api/account/sessions/${toSessionShortId(currentToken)}`,
    headers: currentHeaders,
  });
  assert.equal(current.statusCode, 400);
  assert.equal(current.json<{ code: string }>().code, 'CANNOT_REVOKE_CURRENT');

  const foreign = await app.inject({
    method: 'DELETE',
    url: `/api/account/sessions/${toSessionShortId(foreignToken)}`,
    headers: currentHeaders,
  });
  assert.equal(foreign.statusCode, 404);
  assert.equal(foreign.json<{ code: string }>().code, 'SESSION_NOT_FOUND');

  const revoked = await app.inject({
    method: 'DELETE',
    url: `/api/account/sessions/${toSessionShortId(ownOlderToken)}`,
    headers: currentHeaders,
  });
  assert.equal(revoked.statusCode, 200);
  assert.deepEqual(JSON.parse(revoked.body), { success: true });
  assert.equal(repository.findByShortId(toSessionShortId(ownOlderToken)), null);
  assert.deepEqual(
    db.prepare(`SELECT action FROM audit_events WHERE action = 'auth.session_revoked'`).all(),
    [{ action: 'auth.session_revoked' }],
  );

  now = new Date('2026-07-20T12:00:59.000Z');
  await app.inject({ method: 'GET', url: '/api/account/sessions', headers: currentHeaders });
  assert.equal(
    repository.findByShortId(toSessionShortId(currentToken))!.lastSeenAt,
    '2026-07-20T12:00:00.000Z',
  );

  now = new Date('2026-07-20T12:01:00.000Z');
  await app.inject({ method: 'GET', url: '/api/account/sessions', headers: currentHeaders });
  assert.equal(
    repository.findByShortId(toSessionShortId(currentToken))!.lastSeenAt,
    '2026-07-20T12:01:00.000Z',
  );
});
