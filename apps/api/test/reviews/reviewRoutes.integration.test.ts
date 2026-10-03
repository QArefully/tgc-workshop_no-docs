import assert from 'node:assert/strict';
import test from 'node:test';
import type { ReviewMutationResponse } from '@shop/contracts/reviews';
import { createSeededFixture } from '../support/seededDatabase.js';

const body = 'This is a sufficiently detailed customer review body.';

function cookieHeader(response: {
  headers: Record<string, string | string[] | undefined>;
}): string {
  const value = response.headers['set-cookie'];
  const cookie = Array.isArray(value) ? value[0] : value;
  if (!cookie) throw new Error('Expected session cookie');
  return cookie.split(';', 1)[0]!;
}

function responseJson<T>(response: { body: string }): T {
  return JSON.parse(response.body) as T;
}

void test('review routes enforce public visibility, roles, ownership, moderation, and strict bodies', async (t) => {
  const { db, app } = await createSeededFixture({
    testContext: t,
    app: { clock: { now: () => new Date('2026-07-18T12:00:00.000Z') } },
  });
  db.exec(`
    DELETE FROM review_reports;
    DELETE FROM review_helpful_votes;
    DELETE FROM reviews;
    DELETE FROM review_rating_aggregates;
  `);

  const login = async (email: string) =>
    cookieHeader(
      await app.inject({
        method: 'POST',
        url: '/login',
        payload: { email, password: 'Password123!', country: 'UK' },
      }),
    );
  const alice = await login('alice@example.com');
  const bob = await login('bob@example.com');
  const admin = await login('admin@example.com');

  const initial = await app.inject('/api/products/1/reviews?sort=highest&page=1&pageSize=10');
  assert.equal(initial.statusCode, 200);
  assert.deepEqual(initial.json(), {
    summary: {
      total: 0,
      averageRating: null,
      distribution: [
        { rating: 1, count: 0 },
        { rating: 2, count: 0 },
        { rating: 3, count: 0 },
        { rating: 4, count: 0 },
        { rating: 5, count: 0 },
      ],
    },
    items: [],
    page: 1,
    pageSize: 10,
  });
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/products/1/reviews',
        payload: { rating: 5, body },
      })
    ).statusCode,
    401,
  );
  assert.equal((await app.inject('/api/products/1/reviews/me')).statusCode, 401);

  const created = await app.inject({
    method: 'POST',
    url: '/api/products/1/reviews',
    headers: { cookie: alice },
    payload: { rating: 5, body: `  ${body}  ` },
  });
  assert.equal(created.statusCode, 201);
  const review = responseJson<ReviewMutationResponse>(created);
  assert.equal(review.body, body);
  assert.equal(review.status, 'published');
  assert.deepEqual(review.author, { displayName: 'Alice' });
  assert.equal('email' in review, false);

  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/products/1/reviews',
        headers: { cookie: alice },
        payload: { rating: 5, body },
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/products/2/reviews',
        headers: { cookie: alice },
        payload: { rating: 5, body, verifiedPurchase: true },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/products/2/reviews',
        headers: { cookie: admin },
        payload: { rating: 5, body },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: `/api/reviews/${review.id}`,
        headers: { cookie: bob },
        payload: { rating: 1, body },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: 'DELETE',
        url: `/api/reviews/${review.id}`,
        headers: { cookie: bob },
      })
    ).statusCode,
    403,
  );

  assert.equal(
    (await app.inject({ method: 'POST', url: `/api/admin/reviews/${review.id}/hide` })).statusCode,
    401,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: `/api/admin/reviews/${review.id}/hide`,
        headers: { cookie: alice },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/admin/reviews/999999/hide',
        headers: { cookie: admin },
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: `/api/admin/reviews/${review.id}/hide`,
        headers: { cookie: admin },
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: `/api/admin/reviews/${review.id}/hide`,
        headers: { cookie: admin },
      })
    ).statusCode,
    409,
  );
  const ownerHidden = await app.inject({
    url: '/api/products/1/reviews/me',
    headers: { cookie: alice },
  });
  assert.equal(ownerHidden.statusCode, 200);
  assert.equal(responseJson<ReviewMutationResponse>(ownerHidden).status, 'hidden');
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: `/api/admin/reviews/${review.id}/restore`,
        headers: { cookie: admin },
      })
    ).statusCode,
    200,
  );
});

void test('engagement and moderation routes enforce roles and return current state', async (t) => {
  const { db, app } = await createSeededFixture({
    testContext: t,
    app: { clock: { now: () => new Date('2026-07-18T12:00:00.000Z') } },
  });
  db.exec(`
    DELETE FROM review_reports;
    DELETE FROM review_helpful_votes;
    DELETE FROM reviews;
    DELETE FROM review_rating_aggregates;
  `);
  const login = async (email: string) =>
    cookieHeader(
      await app.inject({
        method: 'POST',
        url: '/login',
        payload: { email, password: 'Password123!', country: 'UK' },
      }),
    );
  const alice = await login('alice@example.com');
  const bob = await login('bob@example.com');
  const admin = await login('admin@example.com');
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/admin/reviews/999999/moderation',
        headers: { cookie: admin },
        payload: { decision: 'hide_review' },
      })
    ).statusCode,
    404,
  );
  const create = await app.inject({
    method: 'POST',
    url: '/api/products/1/reviews',
    headers: { cookie: alice },
    payload: { rating: 5, body },
  });
  const review = responseJson<ReviewMutationResponse>(create);
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: `/api/reviews/${review.id}/helpful`,
        headers: { cookie: bob },
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: `/api/reviews/${review.id}/helpful`,
        headers: { cookie: alice },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: `/api/reviews/${review.id}/reports`,
        headers: { cookie: bob },
        payload: { reason: 'other' },
      })
    ).statusCode,
    400,
  );
  const report = await app.inject({
    method: 'POST',
    url: `/api/reviews/${review.id}/reports`,
    headers: { cookie: bob },
    payload: { reason: 'other', detail: 'Targeted abuse.' },
  });
  assert.equal(report.statusCode, 200);
  assert.equal(responseJson<{ viewerHasOpenReport: boolean }>(report).viewerHasOpenReport, true);
  assert.equal(
    (
      await app.inject({
        url: '/api/admin/reviews/moderation?queue=reported',
        headers: { cookie: bob },
      })
    ).statusCode,
    403,
  );
  const queue = await app.inject({
    url: '/api/admin/reviews/moderation?queue=reported',
    headers: { cookie: admin },
  });
  assert.equal(queue.statusCode, 200);
  assert.equal(responseJson<{ total: number }>(queue).total, 1);
  const moderation = await app.inject({
    method: 'POST',
    url: `/api/admin/reviews/${review.id}/moderation`,
    headers: { cookie: admin },
    payload: { decision: 'hide_review' },
  });
  assert.equal(moderation.statusCode, 200);
  assert.deepEqual(responseJson<{ status: string; resolvedReportCount: number }>(moderation), {
    reviewId: review.id,
    status: 'hidden',
    resolvedReportCount: 1,
    decision: 'hide_review',
  });
});
