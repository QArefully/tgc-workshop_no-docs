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
import { createSessionService } from '../../src/features/auth/sessionService.js';
import { createPreferencesRepository } from '../../src/features/preferences/preferencesRepository.js';
import { createPreferencesService } from '../../src/features/preferences/preferencesService.js';
import { authPlugin } from '../../src/plugins/auth.js';
import accountPreferencesRoutes from '../../src/routes/accountPreferences.js';

void test('account preferences return defaults, upsert atomically, audit, and reject unknown fields', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'shop-preferences-'));
  const db = openDatabase({ path: join(directory, 'shop.db') });
  const clock = { now: () => new Date('2026-07-29T12:00:00.000Z') };
  const sessions = createSessionService({
    sessions: createSessionRepository(db),
    clock,
  });
  const preferences = createPreferencesService({
    repository: createPreferencesRepository(db),
    unitOfWork: createUnitOfWork(db),
    audit: createAuditWriter({ repository: createAuditRepository(db), clock }),
    clock,
  });
  const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
  await app.register(fastifyCookie);
  authPlugin(sessions)(app, {}, () => undefined);
  await app.register(accountPreferencesRoutes, { services: { sessions, preferences } });
  t.after(async () => {
    await app.close();
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  });

  const userId = Number(
    (
      db
        .prepare(
          `INSERT INTO users (email, display_name, password_hash, password_salt, role)
           VALUES ('preferences@example.test', 'Preferences User', 'hash', 'salt', 'customer')
           RETURNING id`,
        )
        .get() as { id: number }
    ).id,
  );
  const session = sessions.create(userId);
  const headers = { cookie: `sid=${session.token}` };

  const unauthenticatedGet = await app.inject({ method: 'GET', url: '/api/account/preferences' });
  assert.equal(unauthenticatedGet.statusCode, 401);
  const unauthenticatedPatch = await app.inject({
    method: 'PATCH',
    url: '/api/account/preferences',
    payload: { marketingEmail: true },
  });
  assert.equal(unauthenticatedPatch.statusCode, 401);

  const defaults = await app.inject({
    method: 'GET',
    url: '/api/account/preferences',
    headers,
  });
  assert.equal(defaults.statusCode, 200);
  assert.deepEqual(JSON.parse(defaults.body), {
    orderUpdatesEmail: true,
    marketingEmail: false,
    approvalRequestEmail: true,
  });
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM user_preferences').get().total, 0);

  const updated = await app.inject({
    method: 'PATCH',
    url: '/api/account/preferences',
    headers,
    payload: { marketingEmail: true, approvalRequestEmail: false },
  });
  assert.equal(updated.statusCode, 200);
  assert.deepEqual(JSON.parse(updated.body), {
    orderUpdatesEmail: true,
    marketingEmail: true,
    approvalRequestEmail: false,
  });

  const reloaded = await app.inject({
    method: 'GET',
    url: '/api/account/preferences',
    headers,
  });
  assert.equal(reloaded.statusCode, 200);
  assert.deepEqual(JSON.parse(reloaded.body), JSON.parse(updated.body));
  assert.deepEqual(
    db
      .prepare(
        `SELECT action, actor_user_id, entity_type, entity_id
         FROM audit_events WHERE action = 'auth.preferences_updated'`,
      )
      .all(),
    [
      {
        action: 'auth.preferences_updated',
        actor_user_id: userId,
        entity_type: 'user',
        entity_id: String(userId),
      },
    ],
  );

  const invalid = await app.inject({
    method: 'PATCH',
    url: '/api/account/preferences',
    headers,
    payload: { marketingEmail: false, unexpected: true },
  });
  assert.equal(invalid.statusCode, 400);
  assert.equal(
    (
      db
        .prepare(
          `SELECT COUNT(*) AS total FROM audit_events WHERE action = 'auth.preferences_updated'`,
        )
        .get() as {
        total: number;
      }
    ).total,
    1,
  );
});
