import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAuditEventQuery } from './auditQuery.js';

void test('normalizes every async audit entity type and canonical action', () => {
  for (const entityType of ['job', 'notification', 'webhook', 'standing_order']) {
    assert.equal(normalizeAuditEventQuery({ entityType }).entityType, entityType);
  }

  for (const action of [
    'job.retry_scheduled',
    'job.dead_lettered',
    'job.retried_by_admin',
    'notification.delivery_skipped',
    'webhook.ignored_stale',
  ]) {
    assert.equal(normalizeAuditEventQuery({ action }).action, action);
  }
});
