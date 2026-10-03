import assert from 'node:assert/strict';
import test from 'node:test';
import { NotificationPage, NotificationListQuery } from '../src/notifications.js';
import { Value } from '@sinclair/typebox/value';
import type { NotificationPage as RootNotificationPage } from '@shop/contracts';
import type { NotificationPage as SubpathNotificationPage } from '@shop/contracts/notifications';

const page = {
  items: [
    {
      id: '1',
      kind: 'standing_order.run_completed',
      title: 'Standing order completed',
      body: 'Your standing order has completed.',
      entityType: 'standing_order',
      entityId: '2',
      createdAt: '2026-08-01T12:00:00.000Z',
      readAt: null,
    },
  ],
  total: 1,
  unreadTotal: 1,
  page: 1,
  pageSize: 25,
} satisfies RootNotificationPage;

void test('notification contracts validate pages, close queries, and preserve root/subpath identity', async () => {
  const root = await import('@shop/contracts');
  const subpath = await import('@shop/contracts/notifications');

  assert.strictEqual(root.NotificationPage, subpath.NotificationPage);
  const subpathPage: SubpathNotificationPage = page;
  assert.equal(subpathPage.items[0]?.kind, 'standing_order.run_completed');
  assert.equal(Value.Check(NotificationPage, page), true);
  assert.equal(
    Value.Check(NotificationListQuery, { page: 1, pageSize: 25, unexpected: true }),
    false,
  );
});
