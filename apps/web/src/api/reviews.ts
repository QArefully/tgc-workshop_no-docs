import { apiFetch } from './client';
import {
  CreateReviewReportBody,
  OwnedReviewResponse,
  ReviewEngagementResponse,
  ReviewListResponse,
  ReviewMutationResponse,
} from '@shop/contracts/reviews';
import { SuccessResponse } from '@shop/contracts/common';
import type { CreateReviewBody, ReviewSort, UpdateReviewBody } from '@shop/contracts/reviews';

export interface GetProductReviewsParams {
  sort?: ReviewSort;
  page?: number;
  pageSize?: number;
}

export function getProductReviews(
  productId: string,
  params: GetProductReviewsParams = {},
  signal?: AbortSignal,
): Promise<ReviewListResponse> {
  const query = new URLSearchParams();
  if (params.sort) query.set('sort', params.sort);
  if (params.page) query.set('page', String(params.page));
  if (params.pageSize) query.set('pageSize', String(params.pageSize));
  const suffix = query.size ? `?${query.toString()}` : '';
  return apiFetch(ReviewListResponse, `/api/products/${productId}/reviews${suffix}`, { signal });
}

export function getMyProductReview(
  productId: string,
  signal?: AbortSignal,
): Promise<OwnedReviewResponse> {
  return apiFetch(OwnedReviewResponse, `/api/products/${productId}/reviews/me`, { signal });
}

export function createProductReview(
  productId: string,
  body: CreateReviewBody,
): Promise<ReviewMutationResponse> {
  return apiFetch(ReviewMutationResponse, `/api/products/${productId}/reviews`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function updateReview(
  reviewId: string,
  body: UpdateReviewBody,
): Promise<ReviewMutationResponse> {
  return apiFetch(ReviewMutationResponse, `/api/reviews/${reviewId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function deleteReview(reviewId: string): Promise<SuccessResponse> {
  return apiFetch(SuccessResponse, `/api/reviews/${reviewId}`, { method: 'DELETE' });
}

export function addHelpfulVote(
  reviewId: string,
  signal?: AbortSignal,
): Promise<ReviewEngagementResponse> {
  return apiFetch(ReviewEngagementResponse, `/api/reviews/${reviewId}/helpful`, {
    method: 'PUT',
    signal,
  });
}

export function removeHelpfulVote(
  reviewId: string,
  signal?: AbortSignal,
): Promise<ReviewEngagementResponse> {
  return apiFetch(ReviewEngagementResponse, `/api/reviews/${reviewId}/helpful`, {
    method: 'DELETE',
    signal,
  });
}

export function createReviewReport(
  reviewId: string,
  body: CreateReviewReportBody,
  signal?: AbortSignal,
): Promise<ReviewEngagementResponse> {
  return apiFetch(ReviewEngagementResponse, `/api/reviews/${reviewId}/reports`, {
    method: 'POST',
    body: JSON.stringify(body),
    signal,
  });
}

export function withdrawReviewReport(
  reviewId: string,
  signal?: AbortSignal,
): Promise<ReviewEngagementResponse> {
  return apiFetch(ReviewEngagementResponse, `/api/reviews/${reviewId}/reports/me`, {
    method: 'DELETE',
    signal,
  });
}
