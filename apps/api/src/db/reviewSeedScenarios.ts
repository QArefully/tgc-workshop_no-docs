import { LEGACY_DATA_COUNTRY } from '@shop/contracts';
import type Database from 'better-sqlite3';

type ReviewScenario = {
  key: string;
  userEmail: string;
  productId: number;
  rating: number;
  body: string;
  status: 'published' | 'hidden';
  createdAt: string;
};

const SCENARIOS: readonly ReviewScenario[] = [
  {
    key: 'alice-published-helpful',
    userEmail: 'alice@example.com',
    productId: 1,
    rating: 5,
    body: 'Reliable daily protein powder with a smooth texture and easy mixing.',
    status: 'published',
    createdAt: '2026-07-16T09:00:00.000Z',
  },
  {
    key: 'bob-published-open-report',
    userEmail: 'bob@example.com',
    productId: 27,
    rating: 2,
    body: 'Texture is difficult to use and the product description needs clearer safety guidance.',
    status: 'published',
    createdAt: '2026-07-16T10:00:00.000Z',
  },
  {
    key: 'alice-hidden',
    userEmail: 'alice@example.com',
    productId: 2,
    rating: 3,
    body: 'Useful product overall, though the preparation instructions need more detail.',
    status: 'hidden',
    createdAt: '2026-07-16T11:00:00.000Z',
  },
];

/** Installs moderation examples without changing local reviews outside canonical scenario rows. */
export function seedReviewScenarios(db: Database.Database): void {
  const findUser = db.prepare('SELECT id FROM users WHERE email = ? AND country = ?');
  const insertReview = db.prepare(`
    INSERT OR IGNORE INTO reviews
      (product_id, user_id, rating, body, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const findCanonicalReview = db.prepare(`
    SELECT reviews.id
    FROM reviews
    INNER JOIN users ON users.id = reviews.user_id
    WHERE users.email = ?
      AND users.country = ?
      AND reviews.product_id = ?
      AND reviews.rating = ?
      AND reviews.body = ?
      AND reviews.status = ?
      AND reviews.created_at = ?
      AND reviews.updated_at = ?
  `);
  const reviewIds = new Map<string, number>();

  for (const scenario of SCENARIOS) {
    const user = findUser.get(scenario.userEmail, LEGACY_DATA_COUNTRY) as
      { id: number } | undefined;
    if (!user) throw new Error(`Missing seeded user ${scenario.userEmail} for review scenario`);
    insertReview.run(
      scenario.productId,
      user.id,
      scenario.rating,
      scenario.body,
      scenario.status,
      scenario.createdAt,
      scenario.createdAt,
    );
    const review = findCanonicalReview.get(
      scenario.userEmail,
      LEGACY_DATA_COUNTRY,
      scenario.productId,
      scenario.rating,
      scenario.body,
      scenario.status,
      scenario.createdAt,
      scenario.createdAt,
    ) as { id: number } | undefined;
    if (review) reviewIds.set(scenario.key, review.id);
  }

  const alice = findUser.get('alice@example.com', LEGACY_DATA_COUNTRY) as
    { id: number } | undefined;
  const bob = findUser.get('bob@example.com', LEGACY_DATA_COUNTRY) as { id: number } | undefined;
  if (!alice || !bob) throw new Error('Missing seeded customer for review scenario');

  const insertHelpfulVote = db.prepare(`
    INSERT OR IGNORE INTO review_helpful_votes (review_id, user_id, created_at)
    VALUES (?, ?, ?)
  `);
  const reportedReviewId = reviewIds.get('bob-published-open-report');
  const helpfulReviewId = reviewIds.get('alice-published-helpful');
  if (helpfulReviewId) insertHelpfulVote.run(helpfulReviewId, bob.id, '2026-07-16T12:00:00.000Z');
  if (reportedReviewId) {
    insertHelpfulVote.run(reportedReviewId, alice.id, '2026-07-16T12:01:00.000Z');
    db.prepare(
      `
      INSERT OR IGNORE INTO review_reports
        (review_id, user_id, reason, detail, status, created_at, updated_at, resolved_at, resolved_by_user_id)
      VALUES (?, ?, 'unsafe', 'Seeded moderation example for the reported queue.', 'open', ?, ?, NULL, NULL)
    `,
    ).run(reportedReviewId, alice.id, '2026-07-16T12:02:00.000Z', '2026-07-16T12:02:00.000Z');
  }
}
