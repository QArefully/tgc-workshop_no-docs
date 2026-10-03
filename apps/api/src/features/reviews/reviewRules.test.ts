import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REVIEW_BODY_MAX_LENGTH,
  REVIEW_BODY_MIN_LENGTH,
  ReviewRuleError,
  normalizeReviewListQuery,
  normalizeAdminReviewQueueQuery,
  normalizeReviewReport,
  normalizeReviewWrite,
} from './reviewRules.js';

function expectRuleError(action: () => unknown): void {
  assert.throws(action, ReviewRuleError);
}

void test('trims review text and accepts inclusive rating and Unicode body bounds', () => {
  const emoji = String.fromCodePoint(0x1f600);
  const minimum = normalizeReviewWrite({
    rating: 1,
    body: `  ${emoji.repeat(REVIEW_BODY_MIN_LENGTH)}  `,
  });
  const maximum = normalizeReviewWrite({
    rating: 5,
    body: 'a'.repeat(REVIEW_BODY_MAX_LENGTH),
  });

  assert.deepEqual(minimum, { rating: 1, body: emoji.repeat(REVIEW_BODY_MIN_LENGTH) });
  assert.equal(maximum.rating, 5);
  assert.equal(maximum.body.length, REVIEW_BODY_MAX_LENGTH);
});

void test('rejects fractional or out-of-range ratings and invalid review bodies', () => {
  for (const rating of [0, 6, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    expectRuleError(() => normalizeReviewWrite({ rating, body: 'a'.repeat(20) }));
  }
  for (const body of [
    ' '.repeat(20),
    'a'.repeat(19),
    'a'.repeat(REVIEW_BODY_MAX_LENGTH + 1),
    null,
  ]) {
    expectRuleError(() => normalizeReviewWrite({ rating: 3, body }));
  }
});

void test('defaults and validates public review sort and pagination', () => {
  assert.deepEqual(normalizeReviewListQuery({}), {
    sort: 'newest',
    page: 1,
    pageSize: 10,
  });
  assert.deepEqual(normalizeReviewListQuery({ sort: 'lowest', page: 4, pageSize: 50 }), {
    sort: 'lowest',
    page: 4,
    pageSize: 50,
  });

  for (const query of [
    { sort: 'recent' },
    { page: 0 },
    { page: 1.5 },
    { pageSize: 0 },
    { pageSize: 51 },
  ]) {
    expectRuleError(() => normalizeReviewListQuery(query));
  }
});

void test('normalizes report detail and moderation queue bounds', () => {
  assert.deepEqual(normalizeReviewReport({ reason: 'other', detail: '  Specific abuse.  ' }), {
    reason: 'other',
    detail: 'Specific abuse.',
  });
  expectRuleError(() => normalizeReviewReport({ reason: 'other' }));
  expectRuleError(() => normalizeReviewReport({ reason: 'unknown' }));
  assert.deepEqual(normalizeAdminReviewQueueQuery({ queue: 'reported', page: 2, pageSize: 5 }), {
    queue: 'reported',
    sort: 'oldest',
    page: 2,
    pageSize: 5,
  });
  expectRuleError(() => normalizeAdminReviewQueueQuery({ queue: 'hidden', sort: 'recent' }));
});
