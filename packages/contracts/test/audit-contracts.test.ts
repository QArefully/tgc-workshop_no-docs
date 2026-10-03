import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import { AuditEvent, AuditEventListResponse, AuditEventQuery } from '../src/audit.js';

void test('audit query contract bounds exact filters and pagination', () => {
  assert.equal(
    Value.Check(AuditEventQuery, {
      action: 'cart.product_added',
      entityType: 'cart',
      entityId: 'cart-123',
      actorUserId: 2,
      requestId: 'request-123',
      occurredFrom: '2026-04-01',
      occurredTo: '2026-04-30',
      page: 1,
      pageSize: 100,
    }),
    true,
  );
  assert.equal(Value.Check(AuditEventQuery, { page: 0 }), false);
  assert.equal(Value.Check(AuditEventQuery, { pageSize: 101 }), false);
  assert.equal(Value.Check(AuditEventQuery, { actorUserId: 1.5 }), false);
  assert.equal(Value.Check(AuditEventQuery, { occurredFrom: '2026/04/01' }), false);
});

void test('audit event response preserves sanitized parsed metadata only', () => {
  const event = {
    id: '7',
    actorType: 'user',
    actorUserId: '2',
    action: 'cart.product_added',
    entityType: 'cart',
    entityId: 'cart-123',
    requestId: 'request-123',
    metadata: { productId: 12, quantity: 3 },
    occurredAt: '2026-04-01T12:00:00.000Z',
  };
  assert.equal(Value.Check(AuditEvent, event), true);
  assert.equal(Value.Check(AuditEvent, { ...event, metadataJson: '{"productId":12}' }), false);
  assert.equal(
    Value.Check(AuditEventListResponse, { items: [event], total: 1, page: 1, pageSize: 50 }),
    true,
  );
});
