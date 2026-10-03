/* eslint-disable @typescript-eslint/no-floating-promises, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument */
import assert from 'node:assert/strict';
import test from 'node:test';
import { countOutcomes, nextRunAt, standingOrderDedupeKey } from './standingOrderRules.js';

test('monthly cadence clamps a 31st schedule to the end of shorter months', () => {
  assert.equal(
    nextRunAt(new Date('2026-01-31T09:30:00.000Z'), 'monthly').toISOString(),
    '2026-02-28T09:30:00.000Z',
  );
  assert.equal(
    nextRunAt(new Date('2026-02-28T09:30:00.000Z'), 'monthly').toISOString(),
    '2026-03-31T09:30:00.000Z',
  );
  assert.equal(
    nextRunAt(new Date('2026-01-01T00:00:00.000Z'), 'fortnightly').toISOString(),
    '2026-01-15T00:00:00.000Z',
  );
});

test('dedupe and outcome summary are stable', () => {
  assert.equal(
    standingOrderDedupeKey(4, '2026-01-01T00:00:00.000Z'),
    'standing-order:4:2026-01-01T00:00:00.000Z',
  );
  assert.deepEqual(countOutcomes([{ status: 'added' }, { status: 'skipped' }] as any), {
    addedLineCount: 1,
    skippedLineCount: 1,
  });
});
