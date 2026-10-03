import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { closeDatabase, openDatabase, resetDatabase } from '../../src/db/index.js';
import { createAuditRepository } from '../../src/features/audit/auditRepository.js';
import {
  createAuditReadService,
  createAuditWriter,
} from '../../src/features/audit/auditService.js';

function createAuditFixture(t: test.TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'shop-audit-'));
  const db = openDatabase({ path: join(directory, 'shop.db') });
  t.after(() => {
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  });
  const repository = createAuditRepository(db);
  const writer = createAuditWriter({
    repository,
    clock: { now: () => new Date('2026-02-03T04:05:06.000Z') },
  });
  return { db, repository, writer, read: createAuditReadService(repository) };
}

void test('audit events append, reject direct updates and deletes, and survive reset', (t) => {
  const { db, writer } = createAuditFixture(t);

  writer.append({
    action: 'cart.created',
    context: { actor: { type: 'anonymous', userId: null }, requestId: 'audit-immutable' },
    cartId: 'audit-cart',
  });

  assert.throws(
    () => db.prepare("UPDATE audit_events SET action = 'tampered'").run(),
    /audit_events are append-only/,
  );
  assert.throws(() => db.prepare('DELETE FROM audit_events').run(), /audit_events are append-only/);
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO audit_events
            (actor_type, actor_user_id, action, entity_type, entity_id, request_id, metadata_json, occurred_at)
           VALUES ('anonymous', NULL, 'cart.created', 'cart', 'missing-request', NULL, '{}', ?)`,
        )
        .run('2026-02-03T04:05:06.000Z'),
    /CHECK constraint failed/,
  );

  resetDatabase(db);
  assert.deepEqual(db.prepare('SELECT action, entity_id FROM audit_events').all(), [
    { action: 'cart.created', entity_id: 'audit-cart' },
  ]);
});

void test('audit repository applies shared filters, stable pagination, and count', (t) => {
  const { writer, read } = createAuditFixture(t);
  const anonymousContext = {
    actor: { type: 'anonymous' as const, userId: null },
    requestId: 'audit-filter-1',
  };
  writer.append({ action: 'cart.created', context: anonymousContext, cartId: 'cart-1' });
  writer.append({
    action: 'cart.product_added',
    context: anonymousContext,
    cartId: 'cart-1',
    productId: 10,
    quantity: 2,
  });
  writer.append({
    action: 'cart.created',
    context: {
      actor: { type: 'user', userId: 7 },
      requestId: 'audit-filter-2',
    },
    cartId: 'cart-2',
  });

  const firstPage = read.list({
    entityType: 'cart',
    occurredFrom: '2026-02-03',
    occurredTo: '2026-02-03',
    page: 1,
    pageSize: 2,
  });
  assert.equal(firstPage.total, 3);
  assert.deepEqual(
    firstPage.items.map((event) => event.id),
    ['3', '2'],
  );
  assert.deepEqual(firstPage.items[1]?.metadata, { productId: 10, quantity: 2 });

  const secondPage = read.list({ entityType: 'cart', page: 2, pageSize: 2 });
  assert.equal(secondPage.total, 3);
  assert.deepEqual(
    secondPage.items.map((event) => event.id),
    ['1'],
  );

  const filtered = read.list({
    action: 'cart.created',
    actorUserId: 7,
    requestId: 'audit-filter-2',
  });
  assert.equal(filtered.total, 1);
  assert.deepEqual(
    filtered.items.map((event) => event.entityId),
    ['cart-2'],
  );
});

void test('audit writer obtains persisted occurrence time from injected clock', (t) => {
  const { writer, read } = createAuditFixture(t);
  writer.append({
    action: 'auth.session_created',
    context: { actor: { type: 'user', userId: 9 }, requestId: 'audit-clock' },
    userId: 9,
    source: 'login',
  });

  assert.deepEqual(read.list({}).items[0], {
    id: '1',
    actorType: 'user',
    actorUserId: 9,
    action: 'auth.session_created',
    entityType: 'user',
    entityId: '9',
    requestId: 'audit-clock',
    metadata: { source: 'login' },
    occurredAt: '2026-02-03T04:05:06.000Z',
  });
});

void test('credit and invoice audit vocabulary is allowlisted and queryable', (t) => {
  const { writer, read } = createAuditFixture(t);
  const context = { actor: { type: 'user' as const, userId: 9 }, requestId: 'credit-audit' };
  writer.append({
    action: 'company.credit_limit_changed',
    context,
    companyId: 7,
    oldCreditLimitCents: 100_000,
    newCreditLimitCents: 125_000,
  });
  writer.append({
    action: 'company.credit_state_changed',
    context,
    companyId: 7,
    oldState: 'active',
    newState: 'on_hold',
    reason: 'Review required',
  });
  writer.append({
    action: 'invoice.issued',
    context,
    invoiceId: 101,
    orderId: 55,
    companyId: 7,
    grossCents: 12_000,
  });

  const creditEvents = read.list({ entityType: 'company', page: 1, pageSize: 10 });
  assert.equal(creditEvents.total, 2);
  assert.deepEqual(
    creditEvents.items.map((event) => event.action),
    ['company.credit_state_changed', 'company.credit_limit_changed'],
  );
  const invoiceEvents = read.list({ action: 'invoice.issued', entityType: 'invoice' });
  assert.equal(invoiceEvents.total, 1);
  assert.deepEqual(invoiceEvents.items[0]?.metadata, {
    orderId: 55,
    companyId: 7,
    grossCents: 12_000,
  });

  assert.throws(() =>
    writer.append({
      action: 'invoice.voided',
      context,
      invoiceId: 101,
      orderId: 55,
      companyId: 7,
      grossCents: 12_000,
      reason: '<unsafe>',
    }),
  );
});
