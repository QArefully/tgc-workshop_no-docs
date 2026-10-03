import type Database from 'better-sqlite3';
import type { Country } from '@shop/contracts/country';
import type {
  NormalizedAdminReviewQueueQuery,
  NormalizedReviewReport,
  ReviewSort,
} from './reviewRules.js';

export type PersistedReviewStatus = 'published' | 'hidden';
export type PersistedReportStatus = 'open' | 'withdrawn' | 'dismissed' | 'actioned';

export interface ReviewRecord {
  id: number;
  productId: number;
  userId: number;
  authorDisplayName: string;
  rating: number;
  body: string;
  status: PersistedReviewStatus;
  createdAt: string;
  updatedAt: string;
  verifiedPurchase: boolean;
  helpfulCount: number;
  viewerHasHelpfulVote: boolean;
  viewerHasOpenReport: boolean;
}
export interface ReviewSummaryRecord {
  total: number;
  averageRating: number | null;
  starCounts: Readonly<Record<1 | 2 | 3 | 4 | 5, number>>;
}
export interface EngagementRecord {
  reviewId: number;
  helpfulCount: number;
  viewerHasHelpfulVote: boolean;
  viewerHasOpenReport: boolean;
}
export interface AdminReportRecord {
  id: number;
  reporterId: number;
  reporterDisplayName: string;
  reason: NormalizedReviewReport['reason'];
  detail: string | null;
  createdAt: string;
}
export interface AdminQueueRecord extends ReviewRecord {
  productName: string;
  productSlug: string;
  openReportCount: number;
  openReports: AdminReportRecord[];
}

export interface ReviewRepository {
  activeProductExists(productId: number): boolean;
  listPublished(
    productId: number,
    sort: ReviewSort,
    page: number,
    pageSize: number,
    viewerUserId: number | null,
  ): ReviewRecord[];
  summaryPublished(productId: number): ReviewSummaryRecord;
  findOwnedByProduct(userId: number, productId: number): ReviewRecord | undefined;
  findById(reviewId: number, country?: Country): ReviewRecord | undefined;
  create(input: {
    productId: number;
    userId: number;
    rating: number;
    body: string;
    now: string;
  }): ReviewRecord;
  update(
    reviewId: number,
    userId: number,
    input: { rating: number; body: string; now: string },
  ): ReviewRecord | undefined;
  delete(reviewId: number, userId: number): boolean;
  transitionStatus(
    reviewId: number,
    from: PersistedReviewStatus,
    to: PersistedReviewStatus,
    now: string,
  ): ReviewRecord | undefined;
  addHelpfulVote(reviewId: number, userId: number, now: string): boolean;
  removeHelpfulVote(reviewId: number, userId: number): boolean;
  engagement(reviewId: number, userId: number): EngagementRecord;
  openReportCountForUser(userId: number): number;
  findReport(reviewId: number, userId: number): PersistedReportStatus | undefined;
  createOrReopenReport(
    reviewId: number,
    userId: number,
    input: NormalizedReviewReport,
    now: string,
  ): void;
  withdrawReport(reviewId: number, userId: number, now: string): boolean;
  listModeration(
    query: NormalizedAdminReviewQueueQuery,
    country?: Country,
  ): {
    total: number;
    items: AdminQueueRecord[];
  };
  decideModeration(
    reviewId: number,
    decision: 'hide_review' | 'dismiss_reports',
    adminUserId: number,
    now: string,
    country?: Country,
  ): { review: ReviewRecord; resolvedReportCount: number };
}

interface ReviewRow {
  id: number;
  product_id: number;
  user_id: number;
  display_name: string;
  rating: number;
  body: string;
  status: PersistedReviewStatus;
  created_at: string;
  updated_at: string;
  verified_purchase: number;
  helpful_count: number;
  viewer_has_helpful_vote: number;
  viewer_has_open_report: number;
}
const REVIEW_COLUMNS = `r.id, r.product_id, r.user_id, u.display_name, r.rating, r.body, r.status, r.created_at, r.updated_at,
 EXISTS (SELECT 1 FROM orders o INNER JOIN order_line_items oli ON oli.order_id = o.id AND oli.product_id = r.product_id INNER JOIN payments pay ON pay.order_id = o.id AND pay.status = 'succeeded' WHERE o.user_id = r.user_id) AS verified_purchase`;
const ORDER_BY: Record<ReviewSort, string> = {
  newest: 'r.created_at DESC, r.id DESC',
  oldest: 'r.created_at ASC, r.id ASC',
  highest: 'r.rating DESC, r.created_at DESC, r.id DESC',
  lowest: 'r.rating ASC, r.created_at DESC, r.id DESC',
  helpful: 'helpful_count DESC, r.created_at DESC, r.id DESC',
};
function mapRow(row: ReviewRow): ReviewRecord {
  return {
    id: row.id,
    productId: row.product_id,
    userId: row.user_id,
    authorDisplayName: row.display_name,
    rating: row.rating,
    body: row.body,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    verifiedPurchase: row.verified_purchase === 1,
    helpfulCount: row.helpful_count,
    viewerHasHelpfulVote: row.viewer_has_helpful_vote === 1,
    viewerHasOpenReport: row.viewer_has_open_report === 1,
  };
}
function selectByWhere(
  db: Database.Database,
  where: string,
  params: readonly unknown[],
): ReviewRecord | undefined {
  const row = db
    .prepare(
      `SELECT ${REVIEW_COLUMNS}, 0 AS helpful_count, 0 AS viewer_has_helpful_vote, 0 AS viewer_has_open_report FROM reviews r INNER JOIN users u ON u.id = r.user_id WHERE ${where}`,
    )
    .get(...params) as ReviewRow | undefined;
  return row ? mapRow(row) : undefined;
}

/** SQLite review persistence. Public engagement derives in one published-only query. */
export function createReviewRepository(db: Database.Database): ReviewRepository {
  return {
    activeProductExists(productId) {
      return (
        db.prepare('SELECT 1 FROM products WHERE id = ? AND active = 1').get(productId) !==
        undefined
      );
    },
    listPublished(productId, sort, page, pageSize, viewerUserId) {
      const offset = (page - 1) * pageSize;
      return db
        .prepare(
          `SELECT ${REVIEW_COLUMNS},
        (SELECT COUNT(*) FROM review_helpful_votes hv WHERE hv.review_id = r.id) AS helpful_count,
        CASE WHEN ? IS NOT NULL THEN EXISTS (SELECT 1 FROM review_helpful_votes hv WHERE hv.review_id = r.id AND hv.user_id = ?) ELSE 0 END AS viewer_has_helpful_vote,
        CASE WHEN ? IS NOT NULL THEN EXISTS (SELECT 1 FROM review_reports rr WHERE rr.review_id = r.id AND rr.user_id = ? AND rr.status = 'open') ELSE 0 END AS viewer_has_open_report
        FROM reviews r INNER JOIN users u ON u.id = r.user_id WHERE r.product_id = ? AND r.status = 'published'
        ORDER BY ${ORDER_BY[sort]} LIMIT ? OFFSET ?`,
        )
        .all(viewerUserId, viewerUserId, viewerUserId, viewerUserId, productId, pageSize, offset)
        .map((row) => mapRow(row as ReviewRow));
    },
    summaryPublished(productId) {
      const row = db
        .prepare(
          `SELECT COALESCE(published_count, 0) AS total, CASE WHEN published_count = 0 THEN NULL ELSE CAST(rating_sum AS REAL) / published_count END AS average_rating, COALESCE(stars_1, 0) AS stars_1, COALESCE(stars_2, 0) AS stars_2, COALESCE(stars_3, 0) AS stars_3, COALESCE(stars_4, 0) AS stars_4, COALESCE(stars_5, 0) AS stars_5 FROM review_rating_aggregates WHERE product_id = ? UNION ALL SELECT 0, NULL, 0, 0, 0, 0, 0 WHERE NOT EXISTS (SELECT 1 FROM review_rating_aggregates WHERE product_id = ?)`,
        )
        .get(productId, productId) as {
        total: number;
        average_rating: number | null;
        stars_1: number;
        stars_2: number;
        stars_3: number;
        stars_4: number;
        stars_5: number;
      };
      return {
        total: row.total,
        averageRating: row.average_rating,
        starCounts: {
          1: row.stars_1,
          2: row.stars_2,
          3: row.stars_3,
          4: row.stars_4,
          5: row.stars_5,
        },
      };
    },
    findOwnedByProduct(userId, productId) {
      return selectByWhere(db, 'r.user_id = ? AND r.product_id = ?', [userId, productId]);
    },
    findById(reviewId, country) {
      return selectByWhere(
        db,
        `r.id = ?${country ? ' AND u.country = ?' : ''}`,
        country ? [reviewId, country] : [reviewId],
      );
    },
    create(input) {
      const result = db
        .prepare(
          `INSERT INTO reviews (product_id, user_id, rating, body, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'published', ?, ?)`,
        )
        .run(input.productId, input.userId, input.rating, input.body, input.now, input.now);
      const review = selectByWhere(db, 'r.id = ?', [Number(result.lastInsertRowid)]);
      if (!review) throw new Error('Created review could not be read');
      return review;
    },
    update(reviewId, userId, input) {
      const result = db
        .prepare(
          'UPDATE reviews SET rating = ?, body = ?, updated_at = ? WHERE id = ? AND user_id = ?',
        )
        .run(input.rating, input.body, input.now, reviewId, userId);
      return result.changes === 1 ? selectByWhere(db, 'r.id = ?', [reviewId]) : undefined;
    },
    delete(reviewId, userId) {
      return (
        db.prepare('DELETE FROM reviews WHERE id = ? AND user_id = ?').run(reviewId, userId)
          .changes === 1
      );
    },
    transitionStatus(reviewId, from, to, now) {
      const result = db
        .prepare('UPDATE reviews SET status = ?, updated_at = ? WHERE id = ? AND status = ?')
        .run(to, now, reviewId, from);
      return result.changes === 1 ? selectByWhere(db, 'r.id = ?', [reviewId]) : undefined;
    },
    addHelpfulVote(reviewId, userId, now) {
      return (
        db
          .prepare(
            'INSERT INTO review_helpful_votes (review_id, user_id, created_at) VALUES (?, ?, ?) ON CONFLICT(review_id, user_id) DO NOTHING',
          )
          .run(reviewId, userId, now).changes === 1
      );
    },
    removeHelpfulVote(reviewId, userId) {
      return (
        db
          .prepare('DELETE FROM review_helpful_votes WHERE review_id = ? AND user_id = ?')
          .run(reviewId, userId).changes === 1
      );
    },
    engagement(reviewId, userId) {
      const row = db
        .prepare(
          `SELECT ? AS review_id, (SELECT COUNT(*) FROM review_helpful_votes WHERE review_id = ?) AS helpful_count, EXISTS (SELECT 1 FROM review_helpful_votes WHERE review_id = ? AND user_id = ?) AS viewer_has_helpful_vote, EXISTS (SELECT 1 FROM review_reports WHERE review_id = ? AND user_id = ? AND status = 'open') AS viewer_has_open_report`,
        )
        .get(reviewId, reviewId, reviewId, userId, reviewId, userId) as {
        review_id: number;
        helpful_count: number;
        viewer_has_helpful_vote: number;
        viewer_has_open_report: number;
      };
      return {
        reviewId: row.review_id,
        helpfulCount: row.helpful_count,
        viewerHasHelpfulVote: row.viewer_has_helpful_vote === 1,
        viewerHasOpenReport: row.viewer_has_open_report === 1,
      };
    },
    openReportCountForUser(userId) {
      return (
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM review_reports WHERE user_id = ? AND status = 'open'",
          )
          .get(userId) as { count: number }
      ).count;
    },
    findReport(reviewId, userId) {
      return (
        db
          .prepare('SELECT status FROM review_reports WHERE review_id = ? AND user_id = ?')
          .get(reviewId, userId) as { status: PersistedReportStatus } | undefined
      )?.status;
    },
    createOrReopenReport(reviewId, userId, input, now) {
      db.prepare(
        `INSERT INTO review_reports (review_id, user_id, reason, detail, status, created_at, updated_at, resolved_at, resolved_by_user_id) VALUES (?, ?, ?, ?, 'open', ?, ?, NULL, NULL) ON CONFLICT(review_id, user_id) DO UPDATE SET reason = excluded.reason, detail = excluded.detail, status = 'open', created_at = excluded.created_at, updated_at = excluded.updated_at, resolved_at = NULL, resolved_by_user_id = NULL`,
      ).run(reviewId, userId, input.reason, input.detail, now, now);
    },
    withdrawReport(reviewId, userId, now) {
      return (
        db
          .prepare(
            "UPDATE review_reports SET status = 'withdrawn', updated_at = ?, resolved_at = ?, resolved_by_user_id = NULL WHERE review_id = ? AND user_id = ? AND status = 'open'",
          )
          .run(now, now, reviewId, userId).changes === 1
      );
    },
    listModeration(query, country) {
      const queueWhere =
        query.queue === 'reported'
          ? "EXISTS (SELECT 1 FROM review_reports rr WHERE rr.review_id = r.id AND rr.status = 'open')"
          : "r.status = 'hidden'";
      const where = country ? `u.country = ? AND ${queueWhere}` : queueWhere;
      const order =
        query.sort === 'oldest' ? 'r.created_at ASC, r.id ASC' : 'r.created_at DESC, r.id DESC';
      const total = (
        db
          .prepare(
            `SELECT COUNT(*) AS count FROM reviews r INNER JOIN users u ON u.id = r.user_id WHERE ${where}`,
          )
          .get(...(country ? [country] : [])) as {
          count: number;
        }
      ).count;
      const rows = db
        .prepare(
          `SELECT ${REVIEW_COLUMNS}, p.name AS product_name, p.slug AS product_slug, (SELECT COUNT(*) FROM review_helpful_votes hv WHERE hv.review_id = r.id) AS helpful_count, (SELECT COUNT(*) FROM review_reports rr WHERE rr.review_id = r.id AND rr.status = 'open') AS open_report_count, 0 AS viewer_has_helpful_vote, 0 AS viewer_has_open_report FROM reviews r INNER JOIN users u ON u.id = r.user_id INNER JOIN products p ON p.id = r.product_id WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`,
        )
        .all(
          ...(country ? [country] : []),
          query.pageSize,
          (query.page - 1) * query.pageSize,
        ) as Array<
        ReviewRow & { product_name: string; product_slug: string; open_report_count: number }
      >;
      const reportRows =
        rows.length === 0
          ? []
          : (db
              .prepare(
                `SELECT rr.id, rr.review_id, rr.user_id, u.display_name, rr.reason, rr.detail, rr.created_at
                 FROM review_reports rr
                 INNER JOIN users u ON u.id = rr.user_id
                 WHERE rr.review_id IN (${rows.map(() => '?').join(', ')}) AND rr.status = 'open'
                 ORDER BY rr.review_id ASC, rr.created_at ASC, rr.id ASC`,
              )
              .all(...rows.map((row) => row.id)) as Array<{
              id: number;
              review_id: number;
              user_id: number;
              display_name: string;
              reason: NormalizedReviewReport['reason'];
              detail: string | null;
              created_at: string;
            }>);
      const reportsByReviewId = new Map<number, AdminReportRecord[]>();
      for (const report of reportRows) {
        const reports = reportsByReviewId.get(report.review_id) ?? [];
        reports.push({
          id: report.id,
          reporterId: report.user_id,
          reporterDisplayName: report.display_name,
          reason: report.reason,
          detail: report.detail,
          createdAt: report.created_at,
        });
        reportsByReviewId.set(report.review_id, reports);
      }
      return {
        total,
        items: rows.map((row) => ({
          ...mapRow(row),
          productName: row.product_name,
          productSlug: row.product_slug,
          openReportCount: row.open_report_count,
          openReports: reportsByReviewId.get(row.id) ?? [],
        })),
      };
    },
    decideModeration(reviewId, decision, adminUserId, now, country) {
      const review = selectByWhere(
        db,
        `r.id = ?${country ? ' AND u.country = ?' : ''}`,
        country ? [reviewId, country] : [reviewId],
      );
      if (!review) throw new Error('Review not found');
      if (decision === 'hide_review' && review.status === 'published')
        db.prepare("UPDATE reviews SET status = 'hidden', updated_at = ? WHERE id = ?").run(
          now,
          reviewId,
        );
      const status = decision === 'hide_review' ? 'actioned' : 'dismissed';
      const resolvedReportCount = db
        .prepare(
          "UPDATE review_reports SET status = ?, updated_at = ?, resolved_at = ?, resolved_by_user_id = ? WHERE review_id = ? AND status = 'open'",
        )
        .run(status, now, now, adminUserId, reviewId).changes;
      const updated = selectByWhere(db, 'r.id = ?', [reviewId]);
      if (!updated) throw new Error('Moderated review could not be read');
      return { review: updated, resolvedReportCount };
    },
  };
}
