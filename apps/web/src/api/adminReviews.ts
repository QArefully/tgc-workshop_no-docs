import {
  AdminReviewModerationResponse,
  AdminReviewQueueResponse,
  ReviewMutationResponse,
} from '@shop/contracts/reviews';
import type { AdminReviewModerationBody, AdminReviewQueueQuery } from '@shop/contracts/reviews';
import { apiFetch } from './client';

export type GetAdminReviewQueueParams = AdminReviewQueueQuery;

/** Fetches one server-authorized admin moderation queue page. */
export function getAdminReviewQueue(
  params: GetAdminReviewQueueParams,
  signal?: AbortSignal,
): Promise<AdminReviewQueueResponse> {
  const query = new URLSearchParams({
    queue: params.queue,
    page: String(params.page ?? 1),
    pageSize: String(params.pageSize ?? 10),
  });
  if (params.sort) query.set('sort', params.sort);
  return apiFetch(AdminReviewQueueResponse, `/api/admin/reviews/moderation?${query}`, { signal });
}

/** Hides a reported review or dismisses its open reports. */
export function moderateAdminReview(
  reviewId: string,
  body: AdminReviewModerationBody,
): Promise<AdminReviewModerationResponse> {
  return apiFetch(AdminReviewModerationResponse, `/api/admin/reviews/${reviewId}/moderation`, {
    method: 'POST',
    body: JSON.stringify(body satisfies AdminReviewModerationBody),
  });
}

/** Restores a hidden review. Backend permission checks remain authoritative. */
export function restoreAdminReview(reviewId: string): Promise<ReviewMutationResponse> {
  return apiFetch(ReviewMutationResponse, `/api/admin/reviews/${reviewId}/restore`, {
    method: 'POST',
  });
}
