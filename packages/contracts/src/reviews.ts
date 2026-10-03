import { Type, type Static } from '@sinclair/typebox';
import { PositiveIntegerString } from './common.js';

const UtcIsoInstant = Type.String({
  minLength: 24,
  maxLength: 24,
  pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$',
});

const ReviewBody = Type.String({ minLength: 20, maxLength: 4000 });
const ReviewRating = Type.Integer({ minimum: 1, maximum: 5 });

export const ReviewStatus = Type.Union([Type.Literal('published'), Type.Literal('hidden')]);
export type ReviewStatus = Static<typeof ReviewStatus>;

export const ReviewSort = Type.Union([
  Type.Literal('newest'),
  Type.Literal('oldest'),
  Type.Literal('highest'),
  Type.Literal('lowest'),
  Type.Literal('helpful'),
]);
export type ReviewSort = Static<typeof ReviewSort>;

export const ReviewAuthor = Type.Object(
  { displayName: Type.String({ minLength: 1, maxLength: 120 }) },
  { additionalProperties: false },
);
export type ReviewAuthor = Static<typeof ReviewAuthor>;

/** Public, published review. Moderation state is deliberately not exposed. */
export const Review = Type.Object(
  {
    id: PositiveIntegerString,
    productId: PositiveIntegerString,
    author: ReviewAuthor,
    rating: ReviewRating,
    body: ReviewBody,
    verifiedPurchase: Type.Boolean(),
    helpfulCount: Type.Integer({ minimum: 0 }),
    viewerCanEngage: Type.Boolean(),
    viewerHasHelpfulVote: Type.Boolean(),
    viewerHasOpenReport: Type.Boolean(),
    createdAt: UtcIsoInstant,
    updatedAt: UtcIsoInstant,
  },
  { additionalProperties: false },
);
export type Review = Static<typeof Review>;

/** An authenticated review owner's record, including its moderation status. */
export const OwnedReview = Type.Object(
  { ...Review.properties, status: ReviewStatus },
  { additionalProperties: false },
);
export type OwnedReview = Static<typeof OwnedReview>;

const ReviewStarCountFor = (rating: 1 | 2 | 3 | 4 | 5) =>
  Type.Object(
    { rating: Type.Literal(rating), count: Type.Integer({ minimum: 0 }) },
    { additionalProperties: false },
  );

export const ReviewStarCount = Type.Union([
  ReviewStarCountFor(1),
  ReviewStarCountFor(2),
  ReviewStarCountFor(3),
  ReviewStarCountFor(4),
  ReviewStarCountFor(5),
]);
export type ReviewStarCount = Static<typeof ReviewStarCount>;

export const ReviewSummary = Type.Object(
  {
    total: Type.Integer({ minimum: 0 }),
    averageRating: Type.Union([Type.Number({ minimum: 1, maximum: 5 }), Type.Null()]),
    distribution: Type.Tuple([
      ReviewStarCountFor(1),
      ReviewStarCountFor(2),
      ReviewStarCountFor(3),
      ReviewStarCountFor(4),
      ReviewStarCountFor(5),
    ]),
  },
  { additionalProperties: false },
);
export type ReviewSummary = Static<typeof ReviewSummary>;

export const ReviewListQuery = Type.Object(
  {
    sort: Type.Optional(ReviewSort),
    page: Type.Optional(Type.Integer({ minimum: 1, maximum: 10_000 })),
    pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
  },
  { additionalProperties: false },
);
export type ReviewListQuery = Static<typeof ReviewListQuery>;

export const ReviewListResponse = Type.Object(
  {
    summary: ReviewSummary,
    items: Type.Array(Review),
    page: Type.Integer({ minimum: 1, maximum: 10_000 }),
    pageSize: Type.Integer({ minimum: 1, maximum: 50 }),
  },
  { additionalProperties: false },
);
export type ReviewListResponse = Static<typeof ReviewListResponse>;

export const ReviewProductParam = Type.Object(
  { productId: PositiveIntegerString },
  { additionalProperties: false },
);
export type ReviewProductParam = Static<typeof ReviewProductParam>;

export const ReviewIdParam = Type.Object(
  { reviewId: PositiveIntegerString },
  { additionalProperties: false },
);
export type ReviewIdParam = Static<typeof ReviewIdParam>;

export const ReviewReportReason = Type.Union([
  Type.Literal('spam'),
  Type.Literal('harassment'),
  Type.Literal('unsafe'),
  Type.Literal('off_topic'),
  Type.Literal('other'),
]);
export type ReviewReportReason = Static<typeof ReviewReportReason>;

const ReviewReportDetail = Type.String({
  minLength: 1,
  maxLength: 1000,
  pattern: '^\\S(?:.*\\S)?$',
});

/** Customer report payload. `other` requires a bounded, trimmed detail. */
export const CreateReviewReportBody = Type.Union([
  Type.Object(
    {
      reason: Type.Union([
        Type.Literal('spam'),
        Type.Literal('harassment'),
        Type.Literal('unsafe'),
        Type.Literal('off_topic'),
      ]),
      detail: Type.Optional(ReviewReportDetail),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { reason: Type.Literal('other'), detail: ReviewReportDetail },
    { additionalProperties: false },
  ),
]);
export type CreateReviewReportBody = Static<typeof CreateReviewReportBody>;

/** Viewer-specific state returned only after a customer engagement mutation. */
export const ReviewEngagementResponse = Type.Object(
  {
    reviewId: PositiveIntegerString,
    helpfulCount: Type.Integer({ minimum: 0 }),
    viewerHasHelpfulVote: Type.Boolean(),
    viewerHasOpenReport: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type ReviewEngagementResponse = Static<typeof ReviewEngagementResponse>;

export const AdminReviewQueueQuery = Type.Object(
  {
    queue: Type.Union([Type.Literal('reported'), Type.Literal('hidden')]),
    sort: Type.Optional(Type.Union([Type.Literal('oldest'), Type.Literal('newest')])),
    page: Type.Optional(Type.Integer({ minimum: 1, maximum: 10_000 })),
    pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
  },
  { additionalProperties: false },
);
export type AdminReviewQueueQuery = Static<typeof AdminReviewQueueQuery>;

export const AdminReviewReport = Type.Object(
  {
    id: PositiveIntegerString,
    reporterId: PositiveIntegerString,
    reporterDisplayName: Type.String({ minLength: 1, maxLength: 120 }),
    reason: ReviewReportReason,
    detail: Type.Union([ReviewReportDetail, Type.Null()]),
    createdAt: UtcIsoInstant,
  },
  { additionalProperties: false },
);
export type AdminReviewReport = Static<typeof AdminReviewReport>;

/** Admin-only review facts. Reporter identity is limited to open reports. */
export const AdminReviewQueueItem = Type.Object(
  {
    ...OwnedReview.properties,
    productName: Type.String({ minLength: 1, maxLength: 255 }),
    productSlug: Type.String({ maxLength: 255 }),
    helpfulCount: Type.Integer({ minimum: 0 }),
    openReportCount: Type.Integer({ minimum: 0 }),
    openReports: Type.Array(AdminReviewReport),
  },
  { additionalProperties: false },
);
export type AdminReviewQueueItem = Static<typeof AdminReviewQueueItem>;

export const AdminReviewQueueResponse = Type.Object(
  {
    total: Type.Integer({ minimum: 0 }),
    items: Type.Array(AdminReviewQueueItem),
    page: Type.Integer({ minimum: 1, maximum: 10_000 }),
    pageSize: Type.Integer({ minimum: 1, maximum: 50 }),
  },
  { additionalProperties: false },
);
export type AdminReviewQueueResponse = Static<typeof AdminReviewQueueResponse>;

export const AdminReviewModerationBody = Type.Object(
  { decision: Type.Union([Type.Literal('hide_review'), Type.Literal('dismiss_reports')]) },
  { additionalProperties: false },
);
export type AdminReviewModerationBody = Static<typeof AdminReviewModerationBody>;

export const AdminReviewModerationResponse = Type.Object(
  {
    reviewId: PositiveIntegerString,
    status: ReviewStatus,
    resolvedReportCount: Type.Integer({ minimum: 0 }),
    decision: AdminReviewModerationBody.properties.decision,
  },
  { additionalProperties: false },
);
export type AdminReviewModerationResponse = Static<typeof AdminReviewModerationResponse>;

/** Customer write payload. Server-derived and ownership fields are excluded. */
export const CreateReviewBody = Type.Object(
  { rating: ReviewRating, body: ReviewBody },
  { additionalProperties: false },
);
export type CreateReviewBody = Static<typeof CreateReviewBody>;

export const UpdateReviewBody = Type.Object(
  { rating: ReviewRating, body: ReviewBody },
  { additionalProperties: false },
);
export type UpdateReviewBody = Static<typeof UpdateReviewBody>;

/** Successful customer or admin review mutation result. */
export const ReviewMutationResponse = OwnedReview;
export type ReviewMutationResponse = Static<typeof ReviewMutationResponse>;

/** Authenticated owner's review for a product, or null when none exists. */
export const OwnedReviewResponse = Type.Union([OwnedReview, Type.Null()]);
export type OwnedReviewResponse = Static<typeof OwnedReviewResponse>;
