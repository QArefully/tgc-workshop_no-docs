import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import {
  AdminJob,
  AdminJobDetail,
  AdminJobDrainResponse,
  AdminJobPage,
} from '@shop/contracts/jobs';
import { buildApp } from '../src/app.js';
import { createSeededAppFixture } from './support/seededDatabase.js';

function cookie(response: { headers: Record<string, string | string[] | undefined> }): string {
  const header = response.headers['set-cookie'];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) throw new Error('Expected session cookie');
  return value.split(';', 1)[0]!;
}

async function login(app: Awaited<ReturnType<typeof buildApp>>, email: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/login',
    payload: { email, password: 'Password123!', country: 'UK' },
  });
  assert.equal(response.statusCode, 200, response.body);
  return cookie(response);
}

void test('admin job routes enforce role, paginate, retry idempotently, and drain synchronously', async (t) => {
  const now = new Date('2026-08-02T10:00:00.000Z');
  const database = await createSeededAppFixture({
    testContext: t,
    app: { clock: { now: () => now } },
  });
  const db = database.db;
  const app = database.app;
  const customer = await login(app, 'alice@example.com');
  const admin = await login(app, 'admin@example.com');
  db.prepare("UPDATE jobs SET run_at='2099-01-01T00:00:00.000Z' WHERE status='pending'").run();
  const job = app.context.services.jobs.enqueue({
    kind: 'webhook.process',
    dedupeKey: 'admin-async-dead-job',
    payload: { webhookId: 999999 },
  }).job;
  db.prepare(
    "UPDATE jobs SET status='dead', attempts=max_attempts, last_error='test failure' WHERE id=?",
  ).run(job.id);

  for (const request of [
    { method: 'GET' as const, url: '/api/admin/jobs' },
    { method: 'GET' as const, url: `/api/admin/jobs/${job.id}` },
    {
      method: 'POST' as const,
      url: `/api/admin/jobs/${job.id}/retry`,
      payload: { idempotencyKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    },
    { method: 'POST' as const, url: '/api/admin/jobs/run' },
  ]) {
    assert.equal((await app.inject(request)).statusCode, 401);
    assert.equal((await app.inject({ ...request, headers: { cookie: customer } })).statusCode, 403);
  }

  const page = await app.inject({
    method: 'GET',
    url: '/api/admin/jobs?status=dead&kind=webhook.process&page=1&pageSize=1',
    headers: { cookie: admin },
  });
  assert.equal(page.statusCode, 200, page.body);
  assert.equal(Value.Parse(AdminJobPage, page.json()).items[0]!.id, String(job.id));
  const detail = await app.inject({
    method: 'GET',
    url: `/api/admin/jobs/${job.id}`,
    headers: { cookie: admin },
  });
  assert.equal(detail.statusCode, 200, detail.body);
  assert.equal(Value.Parse(AdminJobDetail, detail.json()).lastError, 'test failure');

  const retryRequest = {
    method: 'POST' as const,
    url: `/api/admin/jobs/${job.id}/retry`,
    headers: { cookie: admin },
    payload: { idempotencyKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
  };
  const retried = await app.inject(retryRequest);
  assert.equal(retried.statusCode, 200, retried.body);
  assert.equal(Value.Parse(AdminJob, retried.json()).status, 'pending');
  const replay = await app.inject(retryRequest);
  assert.equal(replay.statusCode, 200, replay.body);
  assert.equal(Value.Parse(AdminJob, replay.json()).status, 'pending');
  assert.equal(
    Number(
      db
        .prepare(
          "SELECT COUNT(*) FROM audit_events WHERE action='job.retried_by_admin' AND entity_id=?",
        )
        .pluck()
        .get(String(job.id)),
    ),
    1,
  );

  const drained = await app.inject({
    method: 'POST',
    url: '/api/admin/jobs/run',
    headers: { cookie: admin },
  });
  assert.equal(drained.statusCode, 200, drained.body);
  assert.deepEqual(Value.Parse(AdminJobDrainResponse, drained.json()), {
    processedCount: 1,
    succeededCount: 1,
    failedCount: 0,
  });
  const empty = await app.inject({
    method: 'POST',
    url: '/api/admin/jobs/run',
    headers: { cookie: admin },
  });
  assert.deepEqual(Value.Parse(AdminJobDrainResponse, empty.json()), {
    processedCount: 0,
    succeededCount: 0,
    failedCount: 0,
  });
});
