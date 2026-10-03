import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import fastifyCookie from '@fastify/cookie';
import Fastify from 'fastify';
import { closeDatabase, openDatabase } from '../../src/db/index.js';
import { createAuditRepository } from '../../src/features/audit/auditRepository.js';
import {
  createAuditReadService,
  createAuditWriter,
} from '../../src/features/audit/auditService.js';
import { createSessionRepository } from '../../src/features/auth/sessionRepository.js';
import { createSessionService } from '../../src/features/auth/sessionService.js';
import { authPlugin } from '../../src/plugins/auth.js';
import { countryContextPlugin } from '../../src/plugins/countryContext.js';
import auditRoutes from '../../src/routes/audit.js';

function hasAuditItem(value: unknown): value is { id: string } {
  if (typeof value !== 'object' || value === null) return false;
  return typeof (value as Record<string, unknown>).id === 'string';
}

function hasAuditItems(value: unknown): value is { items: Array<{ id: string }> } {
  if (typeof value !== 'object' || value === null) return false;
  const items = (value as Record<string, unknown>).items;
  return Array.isArray(items) && items.every(hasAuditItem);
}

void test('admin audit endpoint is read-only, filtered, paginated, and access-controlled', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'shop-audit-route-'));
  const db = openDatabase({ path: join(directory, 'shop.db') });
  const sessions = createSessionService({
    sessions: createSessionRepository(db),
    clock: { now: () => new Date('2026-04-01T12:00:00.000Z') },
    tokenSource: (() => {
      let sequence = 0;
      return () => `session-${++sequence}`;
    })(),
  });
  const repository = createAuditRepository(db);
  const writer = createAuditWriter({
    repository,
    clock: { now: () => new Date('2026-04-01T12:00:00.000Z') },
  });
  db.prepare(
    `INSERT INTO users (email, display_name, password_hash, password_salt, role)
     VALUES (?, ?, ?, ?, ?)`,
  ).run('customer@example.test', 'Customer', 'hash', 'salt', 'customer');
  const customerId = Number(
    (
      db.prepare('SELECT id FROM users WHERE email = ?').get('customer@example.test') as {
        id: number;
      }
    ).id,
  );
  db.prepare(
    `INSERT INTO users (email, display_name, password_hash, password_salt, role)
     VALUES (?, ?, ?, ?, ?)`,
  ).run('admin@example.test', 'Admin', 'hash', 'salt', 'admin');
  const adminId = Number(
    (db.prepare('SELECT id FROM users WHERE email = ?').get('admin@example.test') as { id: number })
      .id,
  );
  const customerToken = sessions.create(customerId).token;
  const adminToken = sessions.create(adminId).token;

  writer.append({
    action: 'cart.created',
    context: { actor: { type: 'anonymous', userId: null }, requestId: 'audit-route-1' },
    cartId: 'cart-one',
  });
  writer.append({
    action: 'cart.product_added',
    context: { actor: { type: 'user', userId: customerId }, requestId: 'audit-route-2' },
    cartId: 'cart-two',
    productId: 12,
    quantity: 3,
  });
  writer.append({
    action: 'cart.created',
    context: { actor: { type: 'user', userId: adminId }, requestId: 'audit-route-3' },
    cartId: 'cart-three',
  });

  const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
  await app.register(fastifyCookie);
  authPlugin(sessions)(app, {}, () => undefined);
  countryContextPlugin(sessions)(app, {}, () => undefined);
  await app.register(auditRoutes, {
    services: { sessions, audit: createAuditReadService(repository) },
  });
  t.after(async () => {
    await app.close();
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  });

  const asAdmin = (url: string, method: 'GET' | 'POST' = 'GET', country?: 'DE' | 'UK') =>
    app.inject({
      method,
      url,
      cookies: { sid: adminToken },
      ...(country === undefined ? {} : { headers: { 'x-shop-country': country } }),
    });

  assert.equal((await app.inject('/api/admin/audit-events')).statusCode, 401);
  assert.equal(
    (await app.inject({ url: '/api/admin/audit-events', cookies: { sid: customerToken } }))
      .statusCode,
    403,
  );

  const pageOne = await asAdmin('/api/admin/audit-events?page=1&pageSize=2');
  assert.equal(pageOne.statusCode, 200);
  assert.deepEqual(JSON.parse(pageOne.body), {
    items: [
      {
        id: '3',
        actorType: 'user',
        actorUserId: String(adminId),
        action: 'cart.created',
        entityType: 'cart',
        entityId: 'cart-three',
        requestId: 'audit-route-3',
        metadata: {},
        occurredAt: '2026-04-01T12:00:00.000Z',
      },
      {
        id: '2',
        actorType: 'user',
        actorUserId: String(customerId),
        action: 'cart.product_added',
        entityType: 'cart',
        entityId: 'cart-two',
        requestId: 'audit-route-2',
        metadata: { productId: 12, quantity: 3 },
        occurredAt: '2026-04-01T12:00:00.000Z',
      },
    ],
    total: 3,
    page: 1,
    pageSize: 2,
  });

  const filtered = await asAdmin(
    `/api/admin/audit-events?action=cart.product_added&actorUserId=${customerId}&occurredFrom=2026-04-01&occurredTo=2026-04-01`,
  );
  assert.equal(filtered.statusCode, 200);
  const filteredBody: unknown = JSON.parse(filtered.body);
  assert.ok(hasAuditItems(filteredBody));
  assert.deepEqual(
    filteredBody.items.map((event) => event.id),
    ['2'],
  );

  const invalidService = await asAdmin(
    '/api/admin/audit-events?occurredFrom=2026-04-02&occurredTo=2026-04-01',
    'GET',
    'DE',
  );
  assert.equal(invalidService.statusCode, 400);
  const invalidServiceBody = invalidService.json<{
    error: string;
    code: string;
    meta?: unknown;
    details?: unknown;
  }>();
  assert.deepEqual(invalidServiceBody, {
    error: 'Die Anfrage konnte nicht verarbeitet werden. Bitte versuchen Sie es erneut.',
    code: 'INVALID_QUERY',
  });
  assert.equal('meta' in invalidServiceBody, false);
  assert.equal('details' in invalidServiceBody, false);
  assert.equal(invalidServiceBody.error.includes('occurred'), false);

  const invalidValidation = await asAdmin('/api/admin/audit-events?page=0', 'GET', 'DE');
  assert.equal(invalidValidation.statusCode, 400);
  const invalidValidationBody = invalidValidation.json<{
    error: string;
    code: string;
    meta?: unknown;
    details?: unknown;
  }>();
  assert.deepEqual(invalidValidationBody, {
    error: 'Die Anfrage ist ungültig.',
    code: 'REQUEST_INVALID',
  });
  assert.equal('meta' in invalidValidationBody, false);
  assert.equal('details' in invalidValidationBody, false);
  assert.equal(JSON.stringify(invalidValidationBody).includes('page'), false);
  assert.equal((await asAdmin('/api/admin/audit-events', 'POST')).statusCode, 404);
});
