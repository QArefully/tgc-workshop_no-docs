import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import {
  AdminReviewModerationBody,
  AdminReviewQueueQuery,
  AdminReviewQueueResponse,
  CreateReviewReportBody,
  CreateReviewBody,
  OwnedReviewResponse,
  ReviewEngagementResponse,
  ReviewListQuery,
  ReviewListResponse,
  ReviewMutationResponse,
} from '../src/reviews.js';

const review = {
  id: '7',
  productId: '12',
  author: { displayName: 'Ada Shopper' },
  rating: 5,
  body: 'This product was consistently excellent and easy to use.',
  verifiedPurchase: true,
  helpfulCount: 4,
  viewerCanEngage: true,
  viewerHasHelpfulVote: false,
  viewerHasOpenReport: false,
  createdAt: '2026-07-18T12:00:00.000Z',
  updatedAt: '2026-07-18T12:00:00.000Z',
};

void test('review write payload is bounded and rejects client-derived fields', () => {
  assert.equal(Value.Check(CreateReviewBody, { rating: 1, body: 'x'.repeat(20) }), true);
  assert.equal(Value.Check(CreateReviewBody, { rating: 5, body: 'x'.repeat(4000) }), true);
  assert.equal(Value.Check(CreateReviewBody, { rating: 0, body: 'x'.repeat(20) }), false);
  assert.equal(Value.Check(CreateReviewBody, { rating: 3.5, body: 'x'.repeat(20) }), false);
  assert.equal(Value.Check(CreateReviewBody, { rating: 5, body: 'x'.repeat(19) }), false);
  assert.equal(Value.Check(CreateReviewBody, { rating: 5, body: 'x'.repeat(4001) }), false);
  assert.equal(Value.Check(CreateReviewBody, { ...review, rating: 5 }), false);
  assert.equal(
    Value.Check(CreateReviewBody, {
      rating: 5,
      body: review.body,
      userId: '2',
      status: 'published',
      verifiedPurchase: true,
    }),
    false,
  );
});

void test('review list query permits only supported sorts and bounded pagination', () => {
  for (const sort of ['newest', 'oldest', 'highest', 'lowest', 'helpful']) {
    assert.equal(Value.Check(ReviewListQuery, { sort, page: 1, pageSize: 50 }), true);
  }
  assert.equal(Value.Check(ReviewListQuery, { sort: 'rating', page: 1 }), false);
  assert.equal(Value.Check(ReviewListQuery, { page: 0 }), false);
  assert.equal(Value.Check(ReviewListQuery, { pageSize: 51 }), false);
  assert.equal(Value.Check(ReviewListQuery, { page: 1, unknown: 'value' }), false);
});

void test('engagement and report payloads expose only bounded viewer state', () => {
  assert.equal(Value.Check(CreateReviewReportBody, { reason: 'spam' }), true);
  assert.equal(
    Value.Check(CreateReviewReportBody, { reason: 'unsafe', detail: 'Unsafe claim' }),
    true,
  );
  assert.equal(
    Value.Check(CreateReviewReportBody, { reason: 'other', detail: 'Explain concern' }),
    true,
  );
  assert.equal(Value.Check(CreateReviewReportBody, { reason: 'other' }), false);
  assert.equal(Value.Check(CreateReviewReportBody, { reason: 'spam', detail: ' padded ' }), false);
  assert.equal(
    Value.Check(CreateReviewReportBody, { reason: 'spam', detail: 'x'.repeat(1001) }),
    false,
  );
  assert.equal(
    Value.Check(ReviewEngagementResponse, {
      reviewId: '7',
      helpfulCount: 4,
      viewerHasHelpfulVote: true,
      viewerHasOpenReport: false,
      reporterId: '2',
    }),
    false,
  );
});

void test('admin moderation schemas contain report identity only in admin queue items', () => {
  assert.equal(
    Value.Check(AdminReviewQueueQuery, {
      queue: 'reported',
      sort: 'oldest',
      page: 1,
      pageSize: 50,
    }),
    true,
  );
  assert.equal(Value.Check(AdminReviewQueueQuery, { queue: 'all' }), false);
  assert.equal(
    Value.Check(AdminReviewQueueResponse, {
      total: 1,
      items: [
        {
          ...review,
          status: 'published',
          productName: 'Review product',
          productSlug: 'review-product',
          openReportCount: 1,
          openReports: [
            {
              id: '4',
              reporterId: '3',
              reporterDisplayName: 'Concerned shopper',
              reason: 'spam',
              detail: null,
              createdAt: '2026-07-18T12:00:00.000Z',
            },
          ],
        },
      ],
      page: 1,
      pageSize: 10,
    }),
    true,
  );
  assert.equal(Value.Check(AdminReviewModerationBody, { decision: 'hide_review' }), true);
  assert.equal(Value.Check(AdminReviewModerationBody, { decision: 'restore' }), false);
});

void test('public review list excludes moderation status and author email', () => {
  const response = {
    summary: {
      total: 1,
      averageRating: 5,
      distribution: [
        { rating: 1, count: 0 },
        { rating: 2, count: 0 },
        { rating: 3, count: 0 },
        { rating: 4, count: 0 },
        { rating: 5, count: 1 },
      ],
    },
    items: [review],
    page: 1,
    pageSize: 10,
  };
  assert.equal(Value.Check(ReviewListResponse, response), true);
  assert.equal(
    Value.Check(ReviewListResponse, {
      ...response,
      summary: {
        ...response.summary,
        distribution: [
          { rating: 1, count: 0 },
          { rating: 2, count: 0 },
          { rating: 3, count: 0 },
          { rating: 4, count: 0 },
          { rating: 4, count: 1 },
        ],
      },
    }),
    false,
  );
  assert.equal(
    Value.Check(ReviewListResponse, { ...response, items: [{ ...review, status: 'published' }] }),
    false,
  );
  assert.equal(
    Value.Check(ReviewListResponse, {
      ...response,
      items: [{ ...review, author: { ...review.author, email: 'ada@example.test' } }],
    }),
    false,
  );
});

void test('only owner and mutation responses expose review status', () => {
  assert.equal(Value.Check(OwnedReviewResponse, null), true);
  assert.equal(Value.Check(OwnedReviewResponse, { ...review, status: 'hidden' }), true);
  assert.equal(Value.Check(ReviewMutationResponse, { ...review, status: 'published' }), true);
  assert.equal(Value.Check(ReviewMutationResponse, review), false);
});
