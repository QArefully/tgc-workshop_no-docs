import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import { AdminJobPage, AdminJobRetryBody } from '../src/jobs.js';
import type { AdminJobPage as RootAdminJobPage } from '@shop/contracts';
import type { AdminJobPage as SubpathAdminJobPage } from '@shop/contracts/jobs';

const page = {
  items: [
    {
      id: '1',
      kind: 'notification.deliver',
      dedupeKey: null,
      payload: { notificationId: '1' },
      status: 'pending',
      attempts: 0,
      maxAttempts: 5,
      runAt: '2026-08-01T12:00:00.000Z',
      leaseExpiresAt: null,
      lastError: null,
      createdAt: '2026-08-01T12:00:00.000Z',
      updatedAt: '2026-08-01T12:00:00.000Z',
    },
  ],
  total: 1,
  page: 1,
  pageSize: 25,
} satisfies RootAdminJobPage;

void test('job contracts validate pages, close request bodies, and preserve root/subpath identity', async () => {
  const root = await import('@shop/contracts');
  const subpath = await import('@shop/contracts/jobs');

  assert.strictEqual(root.AdminJobPage, subpath.AdminJobPage);
  const subpathPage: SubpathAdminJobPage = page;
  assert.equal(subpathPage.items.length, 1);
  assert.equal(Value.Check(AdminJobPage, page), true);
  assert.equal(
    Value.Check(AdminJobRetryBody, {
      idempotencyKey: '123e4567-e89b-42d3-a456-426614174000',
      unexpected: true,
    }),
    false,
  );
});
