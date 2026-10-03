import assert from 'node:assert/strict';
import test from 'node:test';
import { SACK_WEIGHT_GRAMS } from '@shop/contracts/pricing';
import { resolveClearance } from './clearanceRules.js';

const startsAt = '2026-07-28T12:00:00.000Z';
const endsAt = '2026-07-29T12:00:00.000Z';
const validParams = {
  priceCents: 10_000,
  clearancePriceCents: 7_500,
  clearanceStartsAt: startsAt,
  clearanceEndsAt: endsAt,
  weightGrams: SACK_WEIGHT_GRAMS,
};

void test('resolves an active clearance from the injected clock', () => {
  assert.deepEqual(
    resolveClearance({ ...validParams, now: new Date('2026-07-28T12:00:00.000Z') }),
    {
      basePriceCents: 10_000,
      clearance: {
        priceCents: 7_500,
        perTonneCents: 300_000,
        startsAt,
        endsAt,
      },
    },
  );
});

void test('uses inclusive start and exclusive end boundaries', () => {
  assert.notEqual(resolveClearance({ ...validParams, now: new Date(startsAt) }).clearance, null);
  assert.equal(resolveClearance({ ...validParams, now: new Date(endsAt) }).clearance, null);
});

void test('invalid, incomplete, and inactive clearances safely fall back to list price', () => {
  const now = new Date('2026-07-28T18:00:00.000Z');
  const fallback = { basePriceCents: 10_000, clearance: null };
  const invalidWindows = [
    { clearancePriceCents: null, clearanceStartsAt: startsAt, clearanceEndsAt: endsAt },
    { clearancePriceCents: 0, clearanceStartsAt: startsAt, clearanceEndsAt: endsAt },
    { clearancePriceCents: 10_000, clearanceStartsAt: startsAt, clearanceEndsAt: endsAt },
    { clearancePriceCents: 7_500, clearanceStartsAt: null, clearanceEndsAt: endsAt },
    { clearancePriceCents: 7_500, clearanceStartsAt: startsAt, clearanceEndsAt: null },
    { clearancePriceCents: 7_500, clearanceStartsAt: endsAt, clearanceEndsAt: startsAt },
    { clearancePriceCents: 7_500, clearanceStartsAt: 'not-a-date', clearanceEndsAt: endsAt },
  ];

  for (const invalidWindow of invalidWindows) {
    assert.doesNotThrow(() => {
      assert.deepEqual(resolveClearance({ ...validParams, ...invalidWindow, now }), fallback);
    });
  }
  assert.deepEqual(
    resolveClearance({ ...validParams, now: new Date('2026-07-28T11:59:59.999Z') }),
    fallback,
  );
  assert.deepEqual(resolveClearance({ ...validParams, now: new Date(endsAt) }), fallback);
});
