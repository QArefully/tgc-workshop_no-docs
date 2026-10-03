import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { closeDatabase, openDatabase } from '../../db/index.js';
import { createUnitOfWork } from '../../db/unitOfWork.js';
import { createSessionRepository } from './sessionRepository.js';
import { createSessionService } from './sessionService.js';

void test('session creation and lookup reject suspended users', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'shop-session-suspension-'));
  const db = openDatabase({ path: join(directory, 'shop.db') });
  t.after(() => {
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  });

  const activeUser = db
    .prepare(
      `INSERT INTO users (email, display_name, password_hash, password_salt, role, created_at)
       VALUES (?, ?, ?, '', 'customer', ?)
       RETURNING id`,
    )
    .get('active@example.test', 'Active User', 'hash', '2026-07-29T10:00:00.000Z') as {
    id: number;
  };
  const suspendedUser = db
    .prepare(
      `INSERT INTO users
        (email, display_name, password_hash, password_salt, role, created_at, suspended_at)
       VALUES (?, ?, ?, '', 'customer', ?, ?)
       RETURNING id`,
    )
    .get(
      'suspended@example.test',
      'Suspended User',
      'hash',
      '2026-07-29T10:00:00.000Z',
      '2026-07-29T11:00:00.000Z',
    ) as { id: number };
  const repository = createSessionRepository(db);
  const auditActions: string[] = [];
  const sessions = createSessionService({
    sessions: repository,
    clock: { now: () => new Date('2026-07-29T12:00:00.000Z') },
    tokenSource: () => 'suspended-token',
    unitOfWork: createUnitOfWork(db),
    audit: { append: (event) => auditActions.push(event.action) },
  });

  assert.equal(
    sessions.create(suspendedUser.id, {
      context: { actor: { type: 'user', userId: suspendedUser.id }, requestId: 'request-1' },
      source: 'login',
    }),
    null,
  );
  assert.deepEqual(auditActions, []);
  assert.equal(
    (
      db
        .prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?')
        .get(suspendedUser.id) as {
        count: number;
      }
    ).count,
    0,
  );

  assert.equal(
    repository.create({
      token: 'active-token',
      userId: activeUser.id,
      createdAt: '2026-07-29T12:00:00.000Z',
      expiresAt: '2026-08-05T12:00:00.000Z',
      lastSeenAt: '2026-07-29T12:00:00.000Z',
      userAgent: null,
      ipAddressHash: null,
    }),
    true,
  );
  assert.equal(sessions.getUser('active-token')?.id, activeUser.id);
  db.prepare('UPDATE users SET suspended_at = ? WHERE id = ?').run(
    '2026-07-29T12:01:00.000Z',
    activeUser.id,
  );
  assert.equal(sessions.getUser('active-token'), null);
});
