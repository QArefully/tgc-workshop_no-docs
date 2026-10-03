import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { closeDatabase, openDatabase } from '../../db/index.js';
import { createUnitOfWork } from '../../db/unitOfWork.js';
import { createAuditRepository } from '../audit/auditRepository.js';
import { createAuditWriter } from '../audit/auditService.js';
import { createSessionRepository } from './sessionRepository.js';
import { createUserAdminRepository } from './userAdminRepository.js';
import { createUserAdminService, UserAdminServiceError } from './userAdminService.js';

function fixture(t: test.TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'shop-user-admin-'));
  const db = openDatabase({ path: join(directory, 'shop.db') });
  t.after(() => {
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  });
  const insertUser = db.prepare(
    `INSERT INTO users (email, display_name, password_hash, password_salt, role, created_at)
     VALUES (?, ?, 'hash', '', ?, '2026-07-29T10:00:00.000Z')`,
  );
  const adminId = Number(
    insertUser.run('admin@example.test', 'Admin User', 'admin').lastInsertRowid,
  );
  const customerId = Number(
    insertUser.run('customer@example.test', 'Customer User', 'customer').lastInsertRowid,
  );
  const audit = createAuditWriter({
    repository: createAuditRepository(db),
    clock: { now: () => new Date('2026-07-29T10:00:00.000Z') },
  });
  return {
    db,
    adminId,
    customerId,
    service: createUserAdminService({
      repository: createUserAdminRepository(db),
      sessions: createSessionRepository(db),
      unitOfWork: createUnitOfWork(db),
      audit,
      clock: { now: () => new Date('2026-07-29T11:00:00.000Z') },
    }),
    context: { actor: { type: 'user' as const, userId: adminId }, requestId: 'user-admin-test' },
  };
}

void test('user admin lists, searches, updates display names and roles, and audits once per mutation', (t) => {
  const { db, adminId, customerId, service, context } = fixture(t);
  assert.deepEqual(
    service.list({ search: 'customer' }).map((user) => user.id),
    [customerId],
  );
  assert.equal(service.get(customerId).displayName, 'Customer User');
  assert.equal(
    service.updateDisplayName(customerId, '  Updated Customer  ', context).displayName,
    'Updated Customer',
  );
  assert.equal(service.setRole(customerId, 'admin', context).role, 'admin');
  assert.equal(service.setRole(customerId, 'customer', context).role, 'customer');
  assert.deepEqual(db.prepare('SELECT action, entity_id FROM audit_events ORDER BY id').all(), [
    { action: 'user.display_name_updated', entity_id: String(customerId) },
    { action: 'user.role_changed', entity_id: String(customerId) },
    { action: 'user.role_changed', entity_id: String(customerId) },
  ]);
  assert.equal(service.get(adminId).role, 'admin');
});

void test('suspension atomically records state, removes sessions, then reactivation clears state', (t) => {
  const { db, adminId, customerId, service, context } = fixture(t);
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(
    'session-one',
    customerId,
    '2026-08-01T00:00:00.000Z',
  );
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(
    'session-two',
    customerId,
    '2026-08-02T00:00:00.000Z',
  );
  const suspended = service.suspend(customerId, '  Contract breach  ', adminId, context);
  assert.equal(suspended.suspensionReason, 'Contract breach');
  assert.equal(suspended.suspendedByUserId, adminId);
  assert.equal(suspended.suspendedAt, '2026-07-29T11:00:00.000Z');
  assert.equal(
    (
      db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?').get(customerId) as {
        count: number;
      }
    ).count,
    0,
  );
  const reactivated = service.reactivate(customerId, adminId, context);
  assert.deepEqual(
    [reactivated.suspendedAt, reactivated.suspensionReason, reactivated.suspendedByUserId],
    [null, null, null],
  );
  assert.deepEqual(
    db
      .prepare('SELECT action FROM audit_events WHERE entity_id = ? ORDER BY id')
      .all(String(customerId)),
    [{ action: 'user.suspended' }, { action: 'user.reactivated' }],
  );
});

void test('suspension rolls back account state and audit when session invalidation fails', (t) => {
  const { db, adminId, customerId, service, context } = fixture(t);
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(
    'rollback-session',
    customerId,
    '2026-08-01T00:00:00.000Z',
  );
  db.exec(
    `CREATE TRIGGER abort_user_admin_session_delete BEFORE DELETE ON sessions
     WHEN OLD.user_id = ${customerId}
     BEGIN SELECT RAISE(ABORT, 'session delete failed'); END`,
  );
  assert.throws(
    () => service.suspend(customerId, 'Contract breach', adminId, context),
    /session delete failed/,
  );
  assert.deepEqual(
    db
      .prepare(
        'SELECT suspended_at, suspension_reason, suspended_by_user_id FROM users WHERE id = ?',
      )
      .get(customerId),
    { suspended_at: null, suspension_reason: null, suspended_by_user_id: null },
  );
  assert.equal(
    (
      db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?').get(customerId) as {
        count: number;
      }
    ).count,
    1,
  );
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS count FROM audit_events').get() as { count: number }).count,
    0,
  );
});

void test('last active admin cannot be demoted or suspended', (t) => {
  const { db, adminId, service, context } = fixture(t);
  assert.throws(
    () => service.setRole(adminId, 'customer', context),
    (error: unknown) => {
      assert.ok(error instanceof UserAdminServiceError);
      assert.equal(error.code, 'LAST_ADMIN');
      return true;
    },
  );
  assert.throws(
    () => service.suspend(adminId, 'Required for administration', adminId, context),
    /active admin/,
  );
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS count FROM audit_events').get() as { count: number }).count,
    0,
  );
});
