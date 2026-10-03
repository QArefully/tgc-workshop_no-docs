import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import { MarkAllReadResponse, Notification, NotificationPage } from '@shop/contracts/notifications';
import { buildApp } from '../../src/app.js';
import { createSeededFixture } from '../support/seededDatabase.js';

function cookie(response: { headers: Record<string, string | string[] | undefined> }): string {
  const value = response.headers['set-cookie'];
  const header = Array.isArray(value) ? value[0] : value;
  if (!header) throw new Error('Expected session cookie');
  return header.split(';', 1)[0]!;
}

async function signup(app: Awaited<ReturnType<typeof buildApp>>, email: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/signup',
    payload: { email, password: 'password-one', displayName: 'Buyer', country: 'UK' },
  });
  assert.equal(response.statusCode, 201, response.body);
  return cookie(response);
}

void test('notification routes enforce auth, ownership, pagination, and read-all counts', async (t) => {
  const { db, app } = await createSeededFixture(t);

  for (const request of [
    { method: 'GET' as const, url: '/api/notifications' },
    { method: 'POST' as const, url: '/api/notifications/1/read' },
    { method: 'POST' as const, url: '/api/notifications/read-all' },
  ])
    assert.equal((await app.inject(request)).statusCode, 401);

  const ownerCookie = await signup(app, 'notification-owner@example.test');
  const otherCookie = await signup(app, 'notification-other@example.test');
  const ownerId = Number(
    db.prepare('SELECT id FROM users WHERE email=?').pluck().get('notification-owner@example.test'),
  );
  const otherId = Number(
    db.prepare('SELECT id FROM users WHERE email=?').pluck().get('notification-other@example.test'),
  );
  const context = (userId: number) => ({
    actor: { type: 'user' as const, userId },
    requestId: 'test',
  });
  const first = app.context.services.notifications.notify({
    userId: ownerId,
    kind: 'order.placed',
    title: 'First',
    body: 'First notice',
    entityType: 'order',
    entityId: '101',
    context: context(ownerId),
  }).notification;
  app.context.services.notifications.notify({
    userId: ownerId,
    kind: 'order.shipped',
    title: 'Second',
    body: 'Second notice',
    entityType: 'order',
    entityId: '102',
    context: context(ownerId),
  });
  app.context.services.notifications.notify({
    userId: otherId,
    kind: 'order.placed',
    title: 'Other',
    body: 'Other notice',
    entityType: 'order',
    entityId: '103',
    context: context(otherId),
  });

  const page = await app.inject({
    method: 'GET',
    url: '/api/notifications?page=1&pageSize=1',
    headers: { cookie: ownerCookie },
  });
  assert.equal(page.statusCode, 200, page.body);
  const parsedPage = Value.Parse(NotificationPage, page.json());
  assert.equal(parsedPage.items.length, 1);
  assert.equal(parsedPage.unreadTotal, 2);
  assert.equal(
    (
      await app.inject({
        method: 'GET',
        url: '/api/notifications?pageSize=101',
        headers: { cookie: ownerCookie },
      })
    ).statusCode,
    400,
  );
  const forbidden = await app.inject({
    method: 'POST',
    url: `/api/notifications/${first.id}/read`,
    headers: { cookie: otherCookie },
  });
  assert.equal(forbidden.statusCode, 403);
  assert.equal(forbidden.json<{ code: string }>().code, 'FORBIDDEN');
  const missing = await app.inject({
    method: 'POST',
    url: '/api/notifications/999999/read',
    headers: { cookie: ownerCookie },
  });
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json<{ code: string }>().code, 'NOTIFICATION_NOT_FOUND');
  const read = await app.inject({
    method: 'POST',
    url: `/api/notifications/${first.id}/read`,
    headers: { cookie: ownerCookie },
  });
  assert.equal(read.statusCode, 200, read.body);
  Value.Parse(Notification, read.json());
  const allRead = await app.inject({
    method: 'POST',
    url: '/api/notifications/read-all',
    headers: { cookie: ownerCookie },
  });
  assert.equal(Value.Parse(MarkAllReadResponse, allRead.json()).affectedCount, 1);
});
