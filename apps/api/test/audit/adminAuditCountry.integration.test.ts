import assert from 'node:assert/strict';
import test from 'node:test';
import { createSeededAppFixture } from '../support/seededDatabase.js';

function sessionCookie(response: {
  headers: Record<string, string | string[] | undefined>;
}): string {
  const header = response.headers['set-cookie'];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) throw new Error('Expected session cookie');
  return value.split(';', 1)[0]!;
}

const promoFields = {
  discountPercent: 10,
  minItemCount: 0,
  kind: 'percent' as const,
  amountCents: 1,
  minSubtotalCents: 0,
  categoryScope: null,
  startAt: null,
  endAt: null,
  maxRedemptions: 100,
  perUserLimit: null,
};

void test('admin audit metadata records the standing country, not account country', async (t) => {
  const fixture = await createSeededAppFixture(t);
  const { app } = fixture;

  const login = await app.inject({
    method: 'POST',
    url: '/login',
    payload: { email: 'admin@example.com', password: 'Password123!', country: 'UK' },
  });
  assert.equal(login.statusCode, 200, login.body);
  const cookie = sessionCookie(login);
  const headers = (country: 'UK' | 'DE') => ({
    cookie,
    'x-shop-country': country,
  });

  const created = await app.inject({
    method: 'POST',
    url: '/api/admin/promos',
    headers: headers('UK'),
    payload: { code: 'AUDITCOUNTRY', ...promoFields },
  });
  assert.equal(created.statusCode, 201, created.body);

  const updated = await app.inject({
    method: 'PUT',
    url: '/api/admin/promos/AUDITCOUNTRY',
    headers: headers('DE'),
    payload: { ...promoFields, endAt: '2026-12-31T00:00:00.000Z' },
  });
  assert.equal(updated.statusCode, 200, updated.body);

  const audit = await app.inject({
    method: 'GET',
    url: '/api/admin/audit-events?action=promo.created&pageSize=100',
    headers: headers('UK'),
  });
  assert.equal(audit.statusCode, 200, audit.body);
  const createdEvents = audit.json<{
    items: Array<{ metadata: Record<string, string | number> }>;
  }>().items;
  assert.ok(createdEvents.some((event) => event.metadata.country === 'UK'));

  const updatedAudit = await app.inject({
    method: 'GET',
    url: '/api/admin/audit-events?action=promo.updated&pageSize=100',
    headers: headers('UK'),
  });
  assert.equal(updatedAudit.statusCode, 200, updatedAudit.body);
  const updatedEvents = updatedAudit.json<{
    items: Array<{ metadata: Record<string, string | number> }>;
  }>().items;
  assert.ok(updatedEvents.some((event) => event.metadata.country === 'DE'));
});
