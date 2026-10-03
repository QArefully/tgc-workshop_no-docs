import assert from 'node:assert/strict';
import test from 'node:test';
import { createUnitOfWork } from '../../src/db/unitOfWork.js';
import { createAuditRepository } from '../../src/features/audit/auditRepository.js';
import { createAuditWriter } from '../../src/features/audit/auditService.js';
import { createReviewRepository } from '../../src/features/reviews/reviewRepository.js';
import {
  createReviewService,
  ReviewServiceError,
} from '../../src/features/reviews/reviewService.js';
import { createSeededFixture, openSeededDatabase } from '../support/seededDatabase.js';

const clock = { now: () => new Date('2026-07-18T12:00:00.000Z') };
const context = { actor: { type: 'user' as const, userId: 1 }, requestId: 'review-test-request' };
const body = 'This is a sufficiently detailed review body.';

function setup() {
  const fixture = openSeededDatabase();
  const { db } = fixture;
  db.exec(`
    DELETE FROM review_reports;
    DELETE FROM review_helpful_votes;
    DELETE FROM reviews;
    DELETE FROM review_rating_aggregates;
  `);
  const repository = createReviewRepository(db);
  const auditRepository = createAuditRepository(db);
  const service = createReviewService({
    repository,
    unitOfWork: createUnitOfWork(db),
    audit: createAuditWriter({ repository: auditRepository, clock }),
    clock,
  });
  return { ...fixture, repository, service };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseMetadataJson(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed)) {
    throw new Error('Expected audit metadata to be a JSON object');
  }
  return parsed;
}

void test('published list and aggregate share visibility while owner can read hidden review', (t) => {
  const { service, cleanup } = setup();
  t.after(cleanup);

  const first = service.create(1, 1, { rating: 5, body }, context);
  service.create(
    2,
    1,
    { rating: 1, body: `${body} More detail.` },
    {
      actor: { type: 'user', userId: 2 },
      requestId: 'review-test-request-2',
    },
  );
  service.hide(Number(first.id), {
    actor: { type: 'user', userId: 3 },
    requestId: 'admin-request',
  });

  for (const sort of ['newest', 'oldest', 'highest', 'lowest'] as const) {
    const page = service.listProduct(1, { sort, page: 1, pageSize: 10 });
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0]?.rating, 1);
    assert.equal(page.summary.total, 1);
    assert.equal(page.summary.averageRating, 1);
    assert.deepEqual(page.summary.distribution, [
      { rating: 1, count: 1 },
      { rating: 2, count: 0 },
      { rating: 3, count: 0 },
      { rating: 4, count: 0 },
      { rating: 5, count: 0 },
    ]);
  }
  assert.equal(service.findOwned(1, 1)?.status, 'hidden');
});

void test('admin review failures use selected admin country copy and stable code', async (t) => {
  const { app } = await createSeededFixture(t);

  const login = await app.inject({
    method: 'POST',
    url: '/login',
    payload: { email: 'admin@example.com', password: 'Password123!', country: 'UK' },
  });
  assert.equal(login.statusCode, 200, login.body);
  const setCookie = login.headers['set-cookie'];
  const session = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(';', 1)[0];
  if (!session) throw new Error('Expected admin session cookie');

  const fr = await app.inject({
    method: 'POST',
    url: '/api/admin/reviews/999999/moderation',
    headers: { cookie: session, 'x-shop-country': 'FR' },
    payload: { decision: 'hide_review' },
  });
  const uk = await app.inject({
    method: 'POST',
    url: '/api/admin/reviews/999999/moderation',
    headers: { cookie: session, 'x-shop-country': 'UK' },
    payload: { decision: 'hide_review' },
  });
  assert.equal(fr.statusCode, 404);
  assert.equal(uk.statusCode, 404);
  assert.equal(fr.json<{ code: string }>().code, 'NOT_FOUND');
  assert.equal(uk.json<{ code: string }>().code, 'NOT_FOUND');
  assert.notEqual(fr.json<{ error: string }>().error, uk.json<{ error: string }>().error);
});

void test('verified purchase requires reviewer-owned order, matching line, and succeeded payment', (t) => {
  const { db, service, cleanup } = setup();
  t.after(cleanup);
  const reviewOne = service.create(1, 1, { rating: 4, body }, context);
  service.create(
    2,
    2,
    { rating: 3, body: `${body} Another review.` },
    {
      actor: { type: 'user', userId: 2 },
      requestId: 'review-test-request-2',
    },
  );

  const orderId = Number(
    db
      .prepare(
        `INSERT INTO orders (customer_name, customer_email, shipping_address, subtotal_cents, discount_cents, total_cents, user_id)
         VALUES ('Alice', 'alice@example.com', 'One Street', 100, 0, 100, 1)`,
      )
      .run().lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO order_line_items (order_id, product_id, product_name, product_price_cents, quantity, line_total_cents)
     VALUES (?, 1, 'Exact product', 100, 1, 100)`,
  ).run(orderId);
  db.prepare(
    `INSERT INTO payments (order_id, idempotency_key, request_fingerprint, status, amount_cents, card_last4, card_brand)
     VALUES (?, 'review-payment', 'review-payment', 'succeeded', 100, '4242', 'visa')`,
  ).run(orderId);

  const pageOne = service.listProduct(1, {});
  const pageTwo = service.listProduct(2, {});
  assert.equal(pageOne.items.find((item) => item.id === reviewOne.id)?.verifiedPurchase, true);
  assert.equal(pageTwo.items[0]?.verifiedPurchase, false);
});

void test('mutations enforce owner/unique/transition rules and audit failure rolls back', (t) => {
  const { db, repository, service, cleanup } = setup();
  t.after(cleanup);
  const review = service.create(1, 1, { rating: 2, body }, context);
  assert.throws(
    () => service.create(1, 1, { rating: 2, body }, context),
    (error: unknown) => error instanceof ReviewServiceError && error.code === 'DUPLICATE',
  );
  assert.throws(
    () =>
      service.update(
        2,
        Number(review.id),
        { rating: 5, body },
        { actor: { type: 'user', userId: 2 }, requestId: 'two' },
      ),
    (error: unknown) => error instanceof ReviewServiceError && error.code === 'FORBIDDEN',
  );
  assert.equal(
    repository.update(Number(review.id), 2, { rating: 5, body, now: clock.now().toISOString() }),
    undefined,
  );
  assert.equal(repository.delete(Number(review.id), 2), false);
  assert.equal(repository.findById(Number(review.id))?.rating, 2);
  const failing = createReviewService({
    repository,
    unitOfWork: createUnitOfWork(db),
    audit: {
      append: () => {
        throw new Error('audit unavailable');
      },
    },
    clock,
  });
  assert.throws(() =>
    failing.update(1, Number(review.id), { rating: 5, body: `${body} Changed.` }, context),
  );
  assert.equal(repository.findById(Number(review.id))?.rating, 2);
  assert.throws(() => failing.delete(1, Number(review.id), context));
  assert.ok(repository.findById(Number(review.id)));
  assert.throws(() => failing.hide(Number(review.id), context));
  assert.equal(repository.findById(Number(review.id))?.status, 'published');
  assert.equal(
    service.hide(Number(review.id), { actor: { type: 'user', userId: 3 }, requestId: 'admin' })
      .status,
    'hidden',
  );
  assert.throws(
    () =>
      service.hide(Number(review.id), { actor: { type: 'user', userId: 3 }, requestId: 'admin-2' }),
    (error: unknown) => error instanceof ReviewServiceError && error.code === 'INVALID_TRANSITION',
  );
  assert.throws(() => failing.restore(Number(review.id), context));
  assert.equal(repository.findById(Number(review.id))?.status, 'hidden');
});

void test('review lifecycle writes exact body-free audit facts', (t) => {
  const { db, service, cleanup } = setup();
  t.after(cleanup);
  const review = service.create(1, 1, { rating: 2, body }, context);
  service.update(1, Number(review.id), { rating: 5, body: `${body} Updated.` }, context);
  service.hide(Number(review.id), context);
  service.restore(Number(review.id), context);
  service.delete(1, Number(review.id), context);

  const rows = db
    .prepare(
      `SELECT action, entity_type, entity_id, actor_type, actor_user_id, request_id, metadata_json
       FROM audit_events ORDER BY id ASC`,
    )
    .all() as Array<{
    action: string;
    entity_type: string;
    entity_id: string;
    actor_type: string;
    actor_user_id: number;
    request_id: string;
    metadata_json: string;
  }>;
  assert.deepEqual(
    rows.map(({ metadata_json, ...row }) => ({
      ...row,
      metadata: parseMetadataJson(metadata_json),
    })),
    [
      {
        action: 'review.created',
        entity_type: 'review',
        entity_id: review.id,
        actor_type: 'user',
        actor_user_id: 1,
        request_id: 'review-test-request',
        metadata: { productId: 1, rating: 2 },
      },
      {
        action: 'review.updated',
        entity_type: 'review',
        entity_id: review.id,
        actor_type: 'user',
        actor_user_id: 1,
        request_id: 'review-test-request',
        metadata: { productId: 1, rating: 5 },
      },
      ...(['review.hidden', 'review.restored', 'review.deleted'] as const).map((action) => ({
        action,
        entity_type: 'review',
        entity_id: review.id,
        actor_type: 'user',
        actor_user_id: 1,
        request_id: 'review-test-request',
        metadata: { productId: 1 },
      })),
    ],
  );
});

void test('helpful and report workflows are published-only, idempotent, and reopenable', (t) => {
  const { service, cleanup } = setup();
  t.after(cleanup);
  const review = service.create(1, 1, { rating: 4, body }, context);
  const bobContext = {
    actor: { type: 'user' as const, userId: 2 },
    requestId: 'bob-review-request',
  };
  assert.equal(service.addHelpful(2, Number(review.id), bobContext).helpfulCount, 1);
  assert.equal(service.addHelpful(2, Number(review.id), bobContext).helpfulCount, 1);
  assert.throws(
    () => service.addHelpful(1, Number(review.id), context),
    (error: unknown) => error instanceof ReviewServiceError && error.code === 'FORBIDDEN',
  );
  assert.equal(
    service.createReport(
      2,
      Number(review.id),
      { reason: 'other', detail: '  Targeted abuse.  ' },
      bobContext,
    ).viewerHasOpenReport,
    true,
  );
  assert.throws(
    () => service.createReport(2, Number(review.id), { reason: 'spam' }, bobContext),
    (error: unknown) => error instanceof ReviewServiceError && error.code === 'DUPLICATE',
  );
  assert.equal(service.withdrawReport(2, Number(review.id), bobContext).viewerHasOpenReport, false);
  assert.equal(
    service.createReport(2, Number(review.id), { reason: 'spam' }, bobContext).viewerHasOpenReport,
    true,
  );
  const page = service.listProduct(1, { sort: 'helpful' }, 2);
  assert.equal(page.items[0]?.viewerCanEngage, true);
  assert.equal(page.items[0]?.viewerHasHelpfulVote, true);
  assert.equal(page.items[0]?.viewerHasOpenReport, true);
  service.hide(Number(review.id), { actor: { type: 'user', userId: 3 }, requestId: 'admin' });
  assert.throws(
    () => service.removeHelpful(2, Number(review.id), bobContext),
    (error: unknown) => error instanceof ReviewServiceError && error.code === 'NOT_FOUND',
  );
});

void test('moderation emits one decision-accurate audit fact', (t) => {
  const { db, service, cleanup } = setup();
  t.after(cleanup);
  const bobContext = { actor: { type: 'user' as const, userId: 2 }, requestId: 'bob-report' };
  const adminContext = { actor: { type: 'user' as const, userId: 3 }, requestId: 'admin-decision' };
  const hidden = service.create(1, 1, { rating: 4, body }, context);
  service.createReport(2, Number(hidden.id), { reason: 'spam' }, bobContext);
  service.moderate(Number(hidden.id), 'hide_review', 3, adminContext);
  const dismissed = service.create(1, 2, { rating: 3, body }, context);
  service.createReport(2, Number(dismissed.id), { reason: 'unsafe' }, bobContext);
  service.moderate(Number(dismissed.id), 'dismiss_reports', 3, adminContext);
  const moderationRows = db
    .prepare(
      `SELECT action, entity_id, metadata_json
       FROM audit_events
       WHERE request_id = 'admin-decision'
       ORDER BY id ASC`,
    )
    .all() as Array<{ action: string; entity_id: string; metadata_json: string }>;
  assert.deepEqual(
    moderationRows.map((row) => ({ ...row, metadata: parseMetadataJson(row.metadata_json) })),
    [
      {
        action: 'review.hidden',
        entity_id: hidden.id,
        metadata_json: '{"productId":1}',
        metadata: { productId: 1 },
      },
      {
        action: 'review.reports_dismissed',
        entity_id: dismissed.id,
        metadata_json: '{"productId":2,"resolvedReportCount":1}',
        metadata: { productId: 2, resolvedReportCount: 1 },
      },
    ],
  );
  assert.equal(
    db.prepare('SELECT status FROM review_reports WHERE review_id = ?').get(Number(hidden.id))
      .status,
    'actioned',
  );
});
