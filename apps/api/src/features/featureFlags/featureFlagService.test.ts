import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { closeDatabase, openDatabase } from '../../db/index.js';
import { createUnitOfWork } from '../../db/unitOfWork.js';
import { createAuditRepository } from '../audit/auditRepository.js';
import { createAuditWriter } from '../audit/auditService.js';
import { createFeatureFlagRepository } from './featureFlagRepository.js';
import { createFeatureFlagResolver } from './featureFlagResolver.js';
import { createFeatureFlagService, FeatureFlagServiceError } from './featureFlagService.js';

function fixture(t: test.TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'shop-feature-flags-'));
  const db = openDatabase({ path: join(directory, 'shop.db') });
  t.after(() => {
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  });
  const actorId = Number(
    db
      .prepare(
        `INSERT INTO users (email, display_name, password_hash, password_salt, role, created_at)
         VALUES (?, ?, 'hash', '', 'admin', '2026-07-29T10:00:00.000Z')`,
      )
      .run('feature-flags@example.test', 'Feature Flags Admin').lastInsertRowid,
  );
  const repository = createFeatureFlagRepository(db);
  const resolver = createFeatureFlagResolver(repository);
  return {
    db,
    resolver,
    service: createFeatureFlagService({
      repository,
      resolver,
      unitOfWork: createUnitOfWork(db),
      audit: createAuditWriter({
        repository: createAuditRepository(db),
        clock: { now: () => new Date('2026-07-29T10:00:00.000Z') },
      }),
    }),
    context: { actor: { type: 'user' as const, userId: actorId }, requestId: 'feature-flags-test' },
  };
}

void test('feature flags create, list, update, delete, and audit exactly once per mutation', (t) => {
  const { db, service, context } = fixture(t);
  const created = service.create(
    { key: 'admin.example_flag', description: 'Admin fixture', enabled: false },
    context,
  );
  assert.deepEqual(
    { key: created.key, description: created.description, enabled: created.enabled },
    { key: 'admin.example_flag', description: 'Admin fixture', enabled: false },
  );
  assert.equal(created.updatedByUserId, context.actor.userId);
  assert.deepEqual(
    service.list().map((flag) => flag.key),
    ['admin.example_flag'],
  );

  const updated = service.update('admin.example_flag', { enabled: true }, context);
  assert.equal(updated.enabled, true);
  service.delete('admin.example_flag', context);
  assert.throws(
    () => service.get('admin.example_flag'),
    (error: unknown) => error instanceof FeatureFlagServiceError && error.code === 'NOT_FOUND',
  );
  assert.deepEqual(
    db
      .prepare(
        "SELECT action, entity_type, entity_id FROM audit_events WHERE entity_id = 'admin.example_flag' ORDER BY id",
      )
      .all(),
    [
      {
        action: 'feature_flag.created',
        entity_type: 'feature_flag',
        entity_id: 'admin.example_flag',
      },
      {
        action: 'feature_flag.updated',
        entity_type: 'feature_flag',
        entity_id: 'admin.example_flag',
      },
      {
        action: 'feature_flag.deleted',
        entity_type: 'feature_flag',
        entity_id: 'admin.example_flag',
      },
    ],
  );
});

void test('resolver caches false and is invalidated only after each committed write', (t) => {
  const { db, resolver, service, context } = fixture(t);
  assert.equal(resolver.isEnabled('admin.cached_flag'), false);
  service.create({ key: 'admin.cached_flag', description: '', enabled: true }, context);
  assert.equal(resolver.isEnabled('admin.cached_flag'), true);
  service.update('admin.cached_flag', { enabled: false }, context);
  assert.equal(resolver.isEnabled('admin.cached_flag'), false);
  service.delete('admin.cached_flag', context);
  assert.equal(resolver.isEnabled('admin.cached_flag'), false);

  service.create({ key: 'admin.cached_flag', description: '', enabled: true }, context);
  assert.equal(resolver.isEnabled('admin.cached_flag'), true);
  db.exec(`CREATE TRIGGER reject_feature_flag_update BEFORE UPDATE ON feature_flags
           BEGIN SELECT RAISE(ABORT, 'write rejected'); END`);
  assert.throws(
    () => service.update('admin.cached_flag', { enabled: true }, context),
    /write rejected/,
  );
  assert.equal(resolver.isEnabled('admin.cached_flag'), true);
});

void test('feature flag key and value validation rejects writes without audit rows', (t) => {
  const { db, service, context } = fixture(t);
  for (const input of [
    { key: 'a', description: '', enabled: false },
    { key: 'Admin.flag', description: '', enabled: false },
    { key: 'admin-flag', description: '', enabled: false },
    { key: 'admin.valid', description: '', enabled: 'true' as unknown as boolean },
  ]) {
    assert.throws(() => service.create(input, context), FeatureFlagServiceError);
  }
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS count FROM feature_flags').get() as { count: number }).count,
    0,
  );
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS count FROM audit_events').get() as { count: number }).count,
    0,
  );
});
