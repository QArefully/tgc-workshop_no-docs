import assert from 'node:assert/strict';
import test from 'node:test';
import { JOB_BACKOFF_CAP_MS } from '@shop/contracts/jobs';
import { classifyAttemptOutcome, isLeaseExpired, nextBackoffMs } from './jobRules.js';

void test('job retry rules are deterministic and capped', () => {
  assert.equal(nextBackoffMs(1), 1_000);
  assert.equal(nextBackoffMs(2), 2_000);
  assert.equal(nextBackoffMs(99), JOB_BACKOFF_CAP_MS);
  assert.equal(classifyAttemptOutcome(4, 5), 'retry');
  assert.equal(classifyAttemptOutcome(5, 5), 'dead');
  assert.equal(isLeaseExpired('2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'), true);
});
