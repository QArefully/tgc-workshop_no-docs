import type {
  AdminReviewModerationResponse,
  AdminReviewQueueResponse,
  OwnedReview,
  Review,
  ReviewEngagementResponse,
  ReviewListResponse,
  ReviewSummary,
} from '@shop/contracts/reviews';
import type { Country } from '@shop/contracts/country';
import type { UnitOfWork } from '../../db/unitOfWork.js';
import type { AuditContext } from '../audit/auditEvent.js';
import type { AuditWriter, Clock } from '../audit/auditService.js';
import {
  normalizeAdminReviewQueueQuery,
  normalizeReviewListQuery,
  normalizeReviewReport,
  normalizeReviewWrite,
  ReviewRuleError,
  type AdminReviewQueueQueryInput,
  type ReviewListQueryInput,
  type ReviewReportInput,
  type ReviewWriteInput,
} from './reviewRules.js';
import type { PersistedReviewStatus, ReviewRecord, ReviewRepository } from './reviewRepository.js';

export class ReviewServiceError extends Error {
  constructor(
    public readonly code:
      | 'NOT_FOUND'
      | 'FORBIDDEN'
      | 'DUPLICATE'
      | 'INVALID_TRANSITION'
      | 'INVALID_INPUT'
      | 'TOO_MANY_REPORTS',
    message: string,
  ) {
    super(message);
    this.name = 'ReviewServiceError';
  }
}
export interface ReviewServiceDependencies {
  repository: ReviewRepository;
  unitOfWork: UnitOfWork;
  audit: AuditWriter;
  clock: Clock;
}
export interface ReviewService {
  listProduct(
    productId: number,
    query: ReviewListQueryInput,
    viewerUserId?: number | null,
  ): ReviewListResponse;
  findOwned(userId: number, productId: number): OwnedReview | null;
  create(
    userId: number,
    productId: number,
    input: ReviewWriteInput,
    context: AuditContext,
  ): OwnedReview;
  update(
    userId: number,
    reviewId: number,
    input: ReviewWriteInput,
    context: AuditContext,
  ): OwnedReview;
  delete(userId: number, reviewId: number, context: AuditContext): void;
  hide(reviewId: number, context: AuditContext, country?: Country): OwnedReview;
  restore(reviewId: number, context: AuditContext, country?: Country): OwnedReview;
  addHelpful(userId: number, reviewId: number, context: AuditContext): ReviewEngagementResponse;
  removeHelpful(userId: number, reviewId: number, context: AuditContext): ReviewEngagementResponse;
  createReport(
    userId: number,
    reviewId: number,
    input: ReviewReportInput,
    context: AuditContext,
  ): ReviewEngagementResponse;
  withdrawReport(userId: number, reviewId: number, context: AuditContext): ReviewEngagementResponse;
  listModeration(input: AdminReviewQueueQueryInput, country?: Country): AdminReviewQueueResponse;
  moderate(
    reviewId: number,
    decision: 'hide_review' | 'dismiss_reports',
    adminUserId: number,
    context: AuditContext,
    country?: Country,
  ): AdminReviewModerationResponse;
}
function asReview(record: ReviewRecord, canEngage = false): Review {
  return {
    id: String(record.id),
    productId: String(record.productId),
    author: { displayName: record.authorDisplayName },
    rating: record.rating,
    body: record.body,
    verifiedPurchase: record.verifiedPurchase,
    helpfulCount: record.helpfulCount,
    viewerCanEngage: canEngage,
    viewerHasHelpfulVote: canEngage && record.viewerHasHelpfulVote,
    viewerHasOpenReport: canEngage && record.viewerHasOpenReport,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
function asOwnedReview(record: ReviewRecord): OwnedReview {
  return { ...asReview(record), status: record.status };
}
function asSummary(
  total: number,
  averageRating: number | null,
  stars: Readonly<Record<1 | 2 | 3 | 4 | 5, number>>,
): ReviewSummary {
  return {
    total,
    averageRating:
      averageRating === null ? null : Math.round((averageRating + Number.EPSILON) * 10) / 10,
    distribution: [
      { rating: 1, count: stars[1] },
      { rating: 2, count: stars[2] },
      { rating: 3, count: stars[3] },
      { rating: 4, count: stars[4] },
      { rating: 5, count: stars[5] },
    ],
  };
}
function now(clock: Clock): string {
  return clock.now().toISOString();
}
function normalize<T>(work: () => T): T {
  try {
    return work();
  } catch (error) {
    if (error instanceof ReviewRuleError)
      throw new ReviewServiceError('INVALID_INPUT', error.message);
    throw error;
  }
}
function requireOwner(
  repository: ReviewRepository,
  reviewId: number,
  userId: number,
): ReviewRecord {
  const review = repository.findById(reviewId);
  if (!review) throw new ReviewServiceError('NOT_FOUND', 'Review not found');
  if (review.userId !== userId)
    throw new ReviewServiceError('FORBIDDEN', 'Review is owned by another user');
  return review;
}
function requireReview(
  repository: ReviewRepository,
  reviewId: number,
  country?: Country,
): ReviewRecord {
  const review = repository.findById(reviewId, country);
  if (!review) throw new ReviewServiceError('NOT_FOUND', 'Review not found');
  return review;
}
function requirePublishedEngageable(
  repository: ReviewRepository,
  reviewId: number,
  userId: number,
): ReviewRecord {
  const review = requireReview(repository, reviewId);
  if (review.status !== 'published') throw new ReviewServiceError('NOT_FOUND', 'Review not found');
  if (review.userId === userId)
    throw new ReviewServiceError('FORBIDDEN', 'Customers cannot engage with their own review');
  return review;
}
function engagement(
  repository: ReviewRepository,
  reviewId: number,
  userId: number,
): ReviewEngagementResponse {
  const state = repository.engagement(reviewId, userId);
  return {
    reviewId: String(state.reviewId),
    helpfulCount: state.helpfulCount,
    viewerHasHelpfulVote: state.viewerHasHelpfulVote,
    viewerHasOpenReport: state.viewerHasOpenReport,
  };
}
function isUniqueConstraint(error: unknown): boolean {
  return (
    error instanceof Error &&
    /UNIQUE constraint failed: reviews\.user_id, reviews\.product_id/.test(error.message)
  );
}

/** Coordinates review workflows; every mutation and audit fact shares one SQLite transaction. */
export function createReviewService(dependencies: ReviewServiceDependencies): ReviewService {
  const { repository, unitOfWork, audit, clock } = dependencies;
  return {
    listProduct(productId, input, viewerUserId = null) {
      const query = normalize(() => normalizeReviewListQuery(input));
      return unitOfWork.run(() => {
        if (!repository.activeProductExists(productId))
          throw new ReviewServiceError('NOT_FOUND', 'Product not found');
        const eligibleViewerId = viewerUserId === null ? null : viewerUserId;
        const summary = repository.summaryPublished(productId);
        return {
          summary: asSummary(summary.total, summary.averageRating, summary.starCounts),
          items: repository
            .listPublished(productId, query.sort, query.page, query.pageSize, eligibleViewerId)
            .map((review) =>
              asReview(review, eligibleViewerId !== null && review.userId !== eligibleViewerId),
            ),
          page: query.page,
          pageSize: query.pageSize,
        };
      });
    },
    findOwned(userId, productId) {
      if (!repository.activeProductExists(productId))
        throw new ReviewServiceError('NOT_FOUND', 'Product not found');
      const review = repository.findOwnedByProduct(userId, productId);
      return review ? asOwnedReview(review) : null;
    },
    create(userId, productId, input, context) {
      const normalized = normalize(() => normalizeReviewWrite(input));
      try {
        return unitOfWork.run(() => {
          if (!repository.activeProductExists(productId))
            throw new ReviewServiceError('NOT_FOUND', 'Product not found');
          const review = repository.create({ productId, userId, ...normalized, now: now(clock) });
          audit.append({
            action: 'review.created',
            context,
            reviewId: review.id,
            productId,
            rating: review.rating,
          });
          return asOwnedReview(review);
        });
      } catch (error) {
        if (isUniqueConstraint(error))
          throw new ReviewServiceError('DUPLICATE', 'A review already exists for this product');
        throw error;
      }
    },
    update(userId, reviewId, input, context) {
      const normalized = normalize(() => normalizeReviewWrite(input));
      return unitOfWork.run(() => {
        const existing = requireOwner(repository, reviewId, userId);
        const review = repository.update(reviewId, userId, { ...normalized, now: now(clock) });
        if (!review) throw new ReviewServiceError('FORBIDDEN', 'Review is owned by another user');
        audit.append({
          action: 'review.updated',
          context,
          reviewId,
          productId: existing.productId,
          rating: review.rating,
        });
        return asOwnedReview(review);
      });
    },
    delete(userId, reviewId, context) {
      unitOfWork.run(() => {
        const review = requireOwner(repository, reviewId, userId);
        if (!repository.delete(reviewId, userId))
          throw new ReviewServiceError('FORBIDDEN', 'Review is owned by another user');
        audit.append({ action: 'review.deleted', context, reviewId, productId: review.productId });
      });
    },
    hide(reviewId, context, country) {
      return transition(
        repository,
        unitOfWork,
        audit,
        clock,
        reviewId,
        'published',
        'hidden',
        'review.hidden',
        context,
        country,
      );
    },
    restore(reviewId, context, country) {
      return transition(
        repository,
        unitOfWork,
        audit,
        clock,
        reviewId,
        'hidden',
        'published',
        'review.restored',
        context,
        country,
      );
    },
    addHelpful(userId, reviewId, context) {
      return unitOfWork.run(() => {
        const review = requirePublishedEngageable(repository, reviewId, userId);
        if (repository.addHelpfulVote(reviewId, userId, now(clock)))
          audit.append({
            action: 'review.helpful_added',
            context,
            reviewId,
            productId: review.productId,
          });
        return engagement(repository, reviewId, userId);
      });
    },
    removeHelpful(userId, reviewId, context) {
      return unitOfWork.run(() => {
        const review = requirePublishedEngageable(repository, reviewId, userId);
        if (repository.removeHelpfulVote(reviewId, userId))
          audit.append({
            action: 'review.helpful_removed',
            context,
            reviewId,
            productId: review.productId,
          });
        return engagement(repository, reviewId, userId);
      });
    },
    createReport(userId, reviewId, input, context) {
      const normalized = normalize(() => normalizeReviewReport(input));
      return unitOfWork.run(() => {
        const review = requirePublishedEngageable(repository, reviewId, userId);
        if (repository.findReport(reviewId, userId) === 'open')
          throw new ReviewServiceError(
            'DUPLICATE',
            'An open report already exists for this review',
          );
        if (repository.openReportCountForUser(userId) >= 5)
          throw new ReviewServiceError(
            'TOO_MANY_REPORTS',
            'Customers may have at most five open reports',
          );
        repository.createOrReopenReport(reviewId, userId, normalized, now(clock));
        audit.append({
          action: 'review.report_created',
          context,
          reviewId,
          productId: review.productId,
          reason: normalized.reason,
        });
        return engagement(repository, reviewId, userId);
      });
    },
    withdrawReport(userId, reviewId, context) {
      return unitOfWork.run(() => {
        const review = requirePublishedEngageable(repository, reviewId, userId);
        if (!repository.withdrawReport(reviewId, userId, now(clock)))
          throw new ReviewServiceError(
            'INVALID_TRANSITION',
            'No open report exists for this review',
          );
        audit.append({
          action: 'review.report_withdrawn',
          context,
          reviewId,
          productId: review.productId,
        });
        return engagement(repository, reviewId, userId);
      });
    },
    listModeration(input, country) {
      const query = normalize(() => normalizeAdminReviewQueueQuery(input));
      return unitOfWork.run(() => {
        const result = repository.listModeration(query, country);
        return {
          total: result.total,
          items: result.items.map((item) => ({
            ...asOwnedReview(item),
            productName: item.productName,
            productSlug: item.productSlug,
            helpfulCount: item.helpfulCount,
            openReportCount: item.openReportCount,
            openReports: item.openReports.map((report) => ({
              id: String(report.id),
              reporterId: String(report.reporterId),
              reporterDisplayName: report.reporterDisplayName,
              reason: report.reason,
              detail: report.detail,
              createdAt: report.createdAt,
            })),
          })),
          page: query.page,
          pageSize: query.pageSize,
        };
      });
    },
    moderate(reviewId, decision, adminUserId, context, country) {
      return unitOfWork.run(() => {
        if (decision !== 'hide_review' && decision !== 'dismiss_reports')
          throw new ReviewServiceError(
            'INVALID_INPUT',
            'decision must be hide_review or dismiss_reports',
          );
        requireReview(repository, reviewId, country);
        const result = repository.decideModeration(
          reviewId,
          decision,
          adminUserId,
          now(clock),
          country,
        );
        if (decision === 'hide_review')
          audit.append({
            action: 'review.hidden',
            context,
            reviewId,
            productId: result.review.productId,
          });
        if (decision === 'dismiss_reports')
          audit.append({
            action: 'review.reports_dismissed',
            context,
            reviewId,
            productId: result.review.productId,
            resolvedReportCount: result.resolvedReportCount,
          });
        return {
          reviewId: String(reviewId),
          status: result.review.status,
          resolvedReportCount: result.resolvedReportCount,
          decision,
        };
      });
    },
  };
}
function transition(
  repository: ReviewRepository,
  unitOfWork: UnitOfWork,
  audit: AuditWriter,
  clock: Clock,
  reviewId: number,
  from: PersistedReviewStatus,
  to: PersistedReviewStatus,
  action: 'review.hidden' | 'review.restored',
  context: AuditContext,
  country?: Country,
): OwnedReview {
  return unitOfWork.run(() => {
    const existing = requireReview(repository, reviewId, country);
    if (existing.status !== from)
      throw new ReviewServiceError('INVALID_TRANSITION', `Review is already ${existing.status}`);
    const review = repository.transitionStatus(reviewId, from, to, now(clock));
    if (!review) throw new ReviewServiceError('INVALID_TRANSITION', `Review is already ${to}`);
    audit.append({ action, context, reviewId, productId: review.productId });
    return asOwnedReview(review);
  });
}
