/* eslint-disable @typescript-eslint/require-await */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { migrateDatabase } from '../../src/db/migrate.js';
import { createUnitOfWork } from '../../src/db/unitOfWork.js';
import { createAuditRepository } from '../../src/features/audit/auditRepository.js';
import { createAuditWriter } from '../../src/features/audit/auditService.js';
import { JobHandlerRegistry } from '../../src/features/jobs/jobHandlerRegistry.js';
import { createJobRepository } from '../../src/features/jobs/jobRepository.js';
import { JobService } from '../../src/features/jobs/jobService.js';

function createFixture(options: { failJobHandlers?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'shop-jobs-'));
  const db = new Database(join(dir, 'shop.db'));
  migrateDatabase(db);
  let now = new Date('2026-08-01T00:00:00.000Z');
  const repository = createJobRepository(db);
  const registry = new JobHandlerRegistry();
  const clock = { now: () => now };
  const service = new JobService({
    repository,
    registry,
    unitOfWork: createUnitOfWork(db),
    clock,
    audit: createAuditWriter({ repository: createAuditRepository(db), clock }),
    faults: {
      isEnabled: (key) => key === 'async.job_handler_failure' && !!options.failJobHandlers,
    },
  });
  return {
    db,
    repository,
    registry,
    service,
    now: () => now,
    setNow(value: string) {
      now = new Date(value);
    },
    close() {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

void test('jobs dedupe, execute, and retain immutable attempt ledger', async () => {
  const fixture = createFixture();
  try {
    fixture.registry.register('notification.deliver', () => ({ ok: true }));
    const first = fixture.service.enqueue({
      kind: 'notification.deliver',
      dedupeKey: 'one',
      payload: {},
    });
    const replay = fixture.service.enqueue({
      kind: 'notification.deliver',
      dedupeKey: 'one',
      payload: { ignored: true },
    });
    assert.equal(replay.created, false);
    assert.equal(replay.job.id, first.job.id);
    assert.deepEqual(await fixture.service.runDue(fixture.now()), {
      processedCount: 1,
      succeededCount: 1,
      failedCount: 0,
    });
    assert.equal(fixture.repository.get(first.job.id)?.status, 'succeeded');
    assert.equal(fixture.repository.listAttempts(first.job.id).length, 1);
    assert.throws(() =>
      fixture.db
        .prepare('UPDATE job_attempts SET error = ? WHERE job_id = ?')
        .run('changed', first.job.id),
    );
    assert.throws(() =>
      fixture.db.prepare('DELETE FROM job_attempts WHERE job_id = ?').run(first.job.id),
    );
  } finally {
    fixture.close();
  }
});

void test('job handler fault switch follows normal failure and retry paths', async () => {
  const disabled = createFixture();
  const enabled = createFixture({ failJobHandlers: true });
  try {
    let disabledCalls = 0;
    let enabledCalls = 0;
    disabled.registry.register('notification.deliver', () => {
      disabledCalls++;
      return { ok: true };
    });
    enabled.registry.register('notification.deliver', () => {
      enabledCalls++;
      return { ok: true };
    });
    const disabledJob = disabled.service.enqueue({ kind: 'notification.deliver', payload: {} });
    const enabledJob = enabled.service.enqueue({
      kind: 'notification.deliver',
      payload: {},
      maxAttempts: 1,
    });

    assert.deepEqual(await disabled.service.runDue(disabled.now()), {
      processedCount: 1,
      succeededCount: 1,
      failedCount: 0,
    });
    assert.equal(disabledCalls, 1);
    assert.equal(disabled.repository.get(disabledJob.job.id)?.status, 'succeeded');

    assert.deepEqual(await enabled.service.runDue(enabled.now()), {
      processedCount: 1,
      succeededCount: 0,
      failedCount: 1,
    });
    assert.equal(enabledCalls, 0);
    assert.deepEqual(
      {
        status: enabled.repository.get(enabledJob.job.id)?.status,
        error: enabled.repository.get(enabledJob.job.id)?.lastError,
      },
      { status: 'dead', error: 'Simulated job handler failure' },
    );
  } finally {
    disabled.close();
    enabled.close();
  }
});

void test('admin jobs filter, page, expose attempts, and retry idempotently with audit', async () => {
  const fixture = createFixture();
  try {
    const first = fixture.service.enqueue({
      kind: 'notification.deliver',
      payload: { sequence: 1 },
    });
    const second = fixture.service.enqueue({ kind: 'webhook.process', payload: { sequence: 2 } });
    const third = fixture.service.enqueue({
      kind: 'notification.deliver',
      payload: { sequence: 3 },
    });
    fixture.db.prepare("UPDATE jobs SET status='dead' WHERE id=?").run(first.job.id);

    assert.deepEqual(fixture.service.list({ kind: 'notification.deliver', page: 1, pageSize: 1 }), {
      items: [
        {
          ...fixture.repository.get(third.job.id),
          id: String(third.job.id),
        },
      ],
      total: 2,
      page: 1,
      pageSize: 1,
    });
    assert.throws(() => fixture.service.list({ status: 'unknown' as never }));
    assert.throws(() => fixture.service.list({ page: 0 }));

    const detail = fixture.service.get(first.job.id);
    assert.equal(detail?.attemptsLedger.length, 0);
    assert.deepEqual(fixture.service.listAttempts(999_999), undefined);

    const key = '6b1b21b1-15c3-48ce-9b38-4fb0c13eb68f';
    const retried = fixture.service.retry(first.job.id, { idempotencyKey: key });
    assert.equal(retried.status, 'requeued');
    assert.equal(fixture.repository.get(first.job.id)?.status, 'pending');
    assert.deepEqual(
      fixture.service.retry(first.job.id, { idempotencyKey: key }).status,
      'already_retried',
    );
    assert.equal(
      fixture.db
        .prepare(
          "SELECT COUNT(*) AS count FROM audit_events WHERE action='job.retried_by_admin' AND request_id=?",
        )
        .get(key).count,
      1,
    );
    assert.equal(
      fixture.service.retry(second.job.id, { idempotencyKey: key }).status,
      'idempotency_conflict',
    );
  } finally {
    fixture.close();
  }
});

void test('excludes future jobs, retries with backoff, then dead-letters deterministically', async () => {
  const fixture = createFixture();
  try {
    fixture.registry.register('notification.deliver', () => ({
      ok: false,
      error: 'mailbox unavailable',
    }));
    const future = fixture.service.enqueue({
      kind: 'notification.deliver',
      payload: {},
      runAt: '2026-08-01T00:01:00.000Z',
    });
    assert.deepEqual(await fixture.service.runDue(fixture.now()), {
      processedCount: 0,
      succeededCount: 0,
      failedCount: 0,
    });
    assert.equal(fixture.repository.get(future.job.id)?.status, 'pending');

    const retrying = fixture.service.enqueue({
      kind: 'notification.deliver',
      payload: {},
      maxAttempts: 2,
    });
    assert.deepEqual(await fixture.service.runDue(fixture.now()), {
      processedCount: 1,
      succeededCount: 0,
      failedCount: 1,
    });
    assert.deepEqual(
      {
        status: fixture.repository.get(retrying.job.id)?.status,
        runAt: fixture.repository.get(retrying.job.id)?.runAt,
      },
      { status: 'pending', runAt: '2026-08-01T00:00:01.000Z' },
    );
    fixture.setNow('2026-08-01T00:00:01.000Z');
    assert.deepEqual(await fixture.service.runDue(fixture.now()), {
      processedCount: 1,
      succeededCount: 0,
      failedCount: 1,
    });
    assert.equal(fixture.repository.get(retrying.job.id)?.status, 'dead');
    assert.deepEqual(
      fixture.repository.listAttempts(retrying.job.id).map((attempt) => attempt.outcome),
      ['failed', 'failed'],
    );
  } finally {
    fixture.close();
  }
});

void test('records abandoned stale leases and fails unknown job kinds', async () => {
  const fixture = createFixture();
  try {
    fixture.registry.register('notification.deliver', () => ({ ok: true }));
    const stale = fixture.service.enqueue({ kind: 'notification.deliver', payload: {} });
    fixture.repository.claimDue(fixture.now().toISOString(), '2026-08-01T00:00:30.000Z');
    fixture.setNow('2026-08-01T00:00:31.000Z');
    assert.deepEqual(await fixture.service.runDue(fixture.now()), {
      processedCount: 1,
      succeededCount: 1,
      failedCount: 0,
    });
    assert.deepEqual(
      fixture.repository.listAttempts(stale.job.id).map((attempt) => attempt.outcome),
      ['abandoned', 'succeeded'],
    );

    fixture.db
      .prepare(
        "INSERT INTO jobs (kind, payload_json, status, max_attempts, run_at, created_at, updated_at) VALUES ('unknown.kind', '{}', 'pending', 1, ?, ?, ?)",
      )
      .run(fixture.now().toISOString(), fixture.now().toISOString(), fixture.now().toISOString());
    assert.deepEqual(await fixture.service.runDue(fixture.now()), {
      processedCount: 1,
      succeededCount: 0,
      failedCount: 1,
    });
    const unknown = fixture.db
      .prepare("SELECT status, last_error FROM jobs WHERE kind = 'unknown.kind'")
      .get();
    assert.deepEqual(unknown, { status: 'dead', last_error: 'Unknown job kind: unknown.kind' });
  } finally {
    fixture.close();
  }
});

void test('interval ticks share one drain while a handler is still running', async () => {
  const fixture = createFixture();
  let release: (() => void) | undefined;
  let scheduledService: JobService | undefined;
  try {
    let calls = 0;
    fixture.registry.register('notification.deliver', async () => {
      calls += 1;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { ok: true };
    });
    fixture.service.enqueue({ kind: 'notification.deliver', payload: {} });
    scheduledService = new JobService({
      repository: fixture.repository,
      registry: fixture.registry,
      unitOfWork: createUnitOfWork(fixture.db),
      clock: { now: fixture.now },
      intervalMs: 1,
    });
    scheduledService.start();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(calls, 1);
    release?.();
    await new Promise((resolve) => setTimeout(resolve, 10));
  } finally {
    scheduledService?.stop();
    release?.();
    fixture.close();
  }
});
