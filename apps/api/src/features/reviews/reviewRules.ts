export const REVIEW_BODY_MIN_LENGTH = 20;
export const REVIEW_BODY_MAX_LENGTH = 4_000;
export const REVIEW_PAGE_DEFAULT = 1;
export const REVIEW_PAGE_SIZE_DEFAULT = 10;
export const REVIEW_PAGE_SIZE_MAX = 50;
export const REVIEW_SORTS = ['newest', 'oldest', 'highest', 'lowest', 'helpful'] as const;
export const REVIEW_OPEN_REPORT_CAP = 5;

export type ReviewSort = (typeof REVIEW_SORTS)[number];

export interface ReviewWriteInput {
  rating: unknown;
  body: unknown;
}

export interface NormalizedReviewWrite {
  rating: number;
  body: string;
}

export interface ReviewListQueryInput {
  sort?: unknown;
  page?: unknown;
  pageSize?: unknown;
}

export interface NormalizedReviewListQuery {
  sort: ReviewSort;
  page: number;
  pageSize: number;
}

export interface ReviewReportInput {
  reason: unknown;
  detail?: unknown;
}

export interface NormalizedReviewReport {
  reason: 'spam' | 'harassment' | 'unsafe' | 'off_topic' | 'other';
  detail: string | null;
}

export interface AdminReviewQueueQueryInput {
  queue?: unknown;
  sort?: unknown;
  page?: unknown;
  pageSize?: unknown;
}

export interface NormalizedAdminReviewQueueQuery {
  queue: 'reported' | 'hidden';
  sort: 'oldest' | 'newest';
  page: number;
  pageSize: number;
}

export class ReviewRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReviewRuleError';
  }
}

function unicodeCharacterCount(value: string): number {
  return Array.from(value).length;
}

function normalizeBoundedPositiveInteger(
  value: unknown,
  field: 'page' | 'pageSize',
  fallback: number,
  maximum: number,
): number {
  const normalized = value ?? fallback;
  if (
    typeof normalized !== 'number' ||
    !Number.isSafeInteger(normalized) ||
    normalized < 1 ||
    normalized > maximum
  ) {
    throw new ReviewRuleError(`${field} must be an integer between 1 and ${maximum}`);
  }
  return normalized;
}

/** Trims and validates the only customer-controlled review fields before persistence. */
export function normalizeReviewWrite(input: ReviewWriteInput): NormalizedReviewWrite {
  if (
    typeof input.rating !== 'number' ||
    !Number.isSafeInteger(input.rating) ||
    input.rating < 1 ||
    input.rating > 5
  ) {
    throw new ReviewRuleError('rating must be an integer between 1 and 5');
  }
  if (typeof input.body !== 'string') {
    throw new ReviewRuleError('body must be text');
  }

  const body = input.body.trim();
  const characterCount = unicodeCharacterCount(body);
  if (characterCount < REVIEW_BODY_MIN_LENGTH || characterCount > REVIEW_BODY_MAX_LENGTH) {
    throw new ReviewRuleError(
      `body must be between ${REVIEW_BODY_MIN_LENGTH} and ${REVIEW_BODY_MAX_LENGTH} characters`,
    );
  }

  return { rating: input.rating, body };
}

/** Applies the fixed public-review sort allowlist and bounded pagination defaults. */
export function normalizeReviewListQuery(query: ReviewListQueryInput): NormalizedReviewListQuery {
  const sort = query.sort ?? 'newest';
  if (typeof sort !== 'string' || !REVIEW_SORTS.includes(sort as ReviewSort)) {
    throw new ReviewRuleError('sort must be one of newest, oldest, highest, lowest, or helpful');
  }

  return {
    sort: sort as ReviewSort,
    page: normalizeBoundedPositiveInteger(query.page, 'page', REVIEW_PAGE_DEFAULT, 10_000),
    pageSize: normalizeBoundedPositiveInteger(
      query.pageSize,
      'pageSize',
      REVIEW_PAGE_SIZE_DEFAULT,
      REVIEW_PAGE_SIZE_MAX,
    ),
  };
}

/** Normalizes report text before it crosses the persistence boundary. */
export function normalizeReviewReport(input: ReviewReportInput): NormalizedReviewReport {
  const reasons = ['spam', 'harassment', 'unsafe', 'off_topic', 'other'] as const;
  if (
    typeof input.reason !== 'string' ||
    !reasons.includes(input.reason as (typeof reasons)[number])
  ) {
    throw new ReviewRuleError('reason must be spam, harassment, unsafe, off_topic, or other');
  }
  if (input.detail !== undefined && typeof input.detail !== 'string') {
    throw new ReviewRuleError('detail must be text');
  }
  const detail = typeof input.detail === 'string' ? input.detail.trim() : null;
  if (
    detail !== null &&
    (unicodeCharacterCount(detail) < 1 || unicodeCharacterCount(detail) > 1000)
  ) {
    throw new ReviewRuleError('detail must be between 1 and 1000 characters');
  }
  if (input.reason === 'other' && detail === null) {
    throw new ReviewRuleError('detail is required when reason is other');
  }
  return { reason: input.reason as NormalizedReviewReport['reason'], detail };
}

/** Applies fixed moderation queue filters and bounded pagination. */
export function normalizeAdminReviewQueueQuery(
  query: AdminReviewQueueQueryInput,
): NormalizedAdminReviewQueueQuery {
  if (query.queue !== 'reported' && query.queue !== 'hidden') {
    throw new ReviewRuleError('queue must be reported or hidden');
  }
  const sort = query.sort ?? 'oldest';
  if (sort !== 'oldest' && sort !== 'newest') {
    throw new ReviewRuleError('sort must be oldest or newest');
  }
  return {
    queue: query.queue,
    sort,
    page: normalizeBoundedPositiveInteger(query.page, 'page', REVIEW_PAGE_DEFAULT, 10_000),
    pageSize: normalizeBoundedPositiveInteger(
      query.pageSize,
      'pageSize',
      REVIEW_PAGE_SIZE_DEFAULT,
      REVIEW_PAGE_SIZE_MAX,
    ),
  };
}
