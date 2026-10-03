import { act, renderHook, waitFor } from '@testing-library/react';
import type { OwnedReview, ReviewListResponse } from '@shop/contracts/reviews';
import type { PublicUser } from '@shop/contracts/auth';
import { ApiContractError, ApiError } from '@/api/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useProductReviews } from './useProductReviews';

const reviewsApi = vi.hoisted(() => ({
  getProductReviews: vi.fn(),
  getMyProductReview: vi.fn(),
  createProductReview: vi.fn(),
  updateReview: vi.fn(),
  deleteReview: vi.fn(),
  addHelpfulVote: vi.fn(),
  removeHelpfulVote: vi.fn(),
  createReviewReport: vi.fn(),
  withdrawReviewReport: vi.fn(),
}));

const authState = vi.hoisted(() => ({ user: null as PublicUser | null }));

vi.mock('@/api/reviews', () => reviewsApi);
vi.mock('./AuthContext', () => ({ useAuth: () => ({ user: authState.user }) }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function response(id: string, total = 1, page = 1): ReviewListResponse {
  return {
    summary: {
      total,
      averageRating: 5,
      distribution: [
        { rating: 1, count: 0 },
        { rating: 2, count: 0 },
        { rating: 3, count: 0 },
        { rating: 4, count: 0 },
        { rating: 5, count: total > 0 ? 1 : 0 },
      ],
    },
    items: [
      {
        id,
        productId: id,
        author: { displayName: id },
        rating: 5,
        body: 'This review has enough characters.',
        verifiedPurchase: false,
        helpfulCount: 0,
        viewerCanEngage: false,
        viewerHasHelpfulVote: false,
        viewerHasOpenReport: false,
        createdAt: '2026-07-14T00:00:00.000Z',
        updatedAt: '2026-07-14T00:00:00.000Z',
      },
    ],
    page,
    pageSize: 10,
  };
}

function ownedReview(id: string): OwnedReview {
  return { ...response(id).items[0]!, status: 'published' };
}

describe('useProductReviews', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.user = null;
  });

  it('aborts and ignores an out-of-date product response', async () => {
    const first = deferred<ReviewListResponse>();
    const second = deferred<ReviewListResponse>();
    reviewsApi.getProductReviews
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { result, rerender } = renderHook(({ productId }) => useProductReviews(productId), {
      initialProps: { productId: 'one' },
    });

    rerender({ productId: 'two' });
    await waitFor(() => expect(reviewsApi.getProductReviews).toHaveBeenCalledTimes(2));
    const firstSignal = reviewsApi.getProductReviews.mock.calls[0]?.[2] as AbortSignal | undefined;
    expect(firstSignal?.aborted).toBe(true);

    await act(async () => {
      second.resolve(response('two'));
      await second.promise;
    });
    await act(async () => {
      first.resolve(response('one'));
      await first.promise;
    });
    expect(result.current.list?.items[0]?.id).toBe('two');
  });

  it('uses localized fallback copy for raw and contract failures', async () => {
    reviewsApi.getProductReviews.mockRejectedValueOnce(new Error('raw server detail'));
    const first = renderHook(() => useProductReviews('one'));
    await waitFor(() => expect(first.result.current.isListLoading).toBe(false));
    expect(first.result.current.listError).toBe('Could not load reviews.');
    first.unmount();

    reviewsApi.getProductReviews.mockRejectedValueOnce(
      new ApiContractError('/api/products/one/reviews', 'raw contract detail'),
    );
    const second = renderHook(() => useProductReviews('one'));
    await waitFor(() => expect(second.result.current.isListLoading).toBe(false));
    expect(second.result.current.listError).toBe('Could not load reviews.');
  });

  it('maps recognized API review failures by code and safe metadata', async () => {
    reviewsApi.getProductReviews.mockRejectedValueOnce(
      new ApiError('raw server detail', 429, {
        error: 'raw server detail',
        code: 'TOO_MANY_REPORTS',
      } as never),
    );
    const { result } = renderHook(() => useProductReviews('one'));
    await waitFor(() => expect(result.current.isListLoading).toBe(false));
    expect(result.current.listError).toBe('You have submitted too many reports.');
    expect(result.current.listError).not.toContain('raw server detail');
  });

  it('aborts and ignores stale public and owner responses after a product route change', async () => {
    authState.user = {
      id: 'customer',
      email: 'customer@example.com',
      displayName: 'Customer',
      role: 'customer',
      country: 'UK',
    };
    const listOne = deferred<ReviewListResponse>();
    const listTwo = deferred<ReviewListResponse>();
    const ownerOne = deferred<OwnedReview | null>();
    const ownerTwo = deferred<OwnedReview | null>();
    reviewsApi.getProductReviews
      .mockReturnValueOnce(listOne.promise)
      .mockReturnValueOnce(listTwo.promise);
    reviewsApi.getMyProductReview
      .mockReturnValueOnce(ownerOne.promise)
      .mockReturnValueOnce(ownerTwo.promise);
    const { result, rerender } = renderHook(({ productId }) => useProductReviews(productId), {
      initialProps: { productId: 'one' },
    });

    rerender({ productId: 'two' });
    await waitFor(() => {
      expect(reviewsApi.getProductReviews).toHaveBeenCalledTimes(2);
      expect(reviewsApi.getMyProductReview).toHaveBeenCalledTimes(2);
    });
    expect((reviewsApi.getProductReviews.mock.calls[0]?.[2] as AbortSignal).aborted).toBe(true);
    expect((reviewsApi.getMyProductReview.mock.calls[0]?.[1] as AbortSignal).aborted).toBe(true);

    await act(async () => {
      listTwo.resolve(response('two'));
      ownerTwo.resolve(ownedReview('two'));
      await Promise.all([listTwo.promise, ownerTwo.promise]);
      listOne.resolve(response('one'));
      ownerOne.resolve(ownedReview('one'));
      await Promise.all([listOne.promise, ownerOne.promise]);
    });

    await waitFor(() => expect(result.current.ownerReview?.id).toBe('two'));
    expect(result.current.list?.items[0]?.id).toBe('two');
  });

  it('resets to the first page and reloads when the sort changes', async () => {
    reviewsApi.getProductReviews.mockResolvedValue(response('one'));
    const { result } = renderHook(() => useProductReviews('one'));
    await waitFor(() => expect(result.current.isListLoading).toBe(false));

    act(() => result.current.setPage(2));
    await waitFor(() =>
      expect(reviewsApi.getProductReviews).toHaveBeenLastCalledWith(
        'one',
        { sort: 'newest', page: 2, pageSize: 10 },
        expect.any(AbortSignal),
      ),
    );
    act(() => result.current.setSort('highest'));
    await waitFor(() =>
      expect(reviewsApi.getProductReviews).toHaveBeenLastCalledWith(
        'one',
        { sort: 'highest', page: 1, pageSize: 10 },
        expect.any(AbortSignal),
      ),
    );
  });

  it('clears public and owner reviews before loading a different product', async () => {
    authState.user = {
      id: '1',
      email: 'customer@example.com',
      displayName: 'Customer',
      role: 'customer',
      country: 'UK',
    };
    const listOne = deferred<ReviewListResponse>();
    const listTwo = deferred<ReviewListResponse>();
    const ownerOne = deferred<OwnedReview | null>();
    const ownerTwo = deferred<OwnedReview | null>();
    reviewsApi.getProductReviews
      .mockReturnValueOnce(listOne.promise)
      .mockReturnValueOnce(listTwo.promise);
    reviewsApi.getMyProductReview
      .mockReturnValueOnce(ownerOne.promise)
      .mockReturnValueOnce(ownerTwo.promise);
    const { result, rerender } = renderHook(({ productId }) => useProductReviews(productId), {
      initialProps: { productId: 'one' },
    });

    await act(async () => {
      listOne.resolve(response('one'));
      ownerOne.resolve(ownedReview('one'));
      await Promise.all([listOne.promise, ownerOne.promise]);
    });
    await waitFor(() => expect(result.current.ownerReview?.id).toBe('one'));

    rerender({ productId: 'two' });
    await waitFor(() => {
      expect(reviewsApi.getProductReviews).toHaveBeenCalledTimes(2);
      expect(reviewsApi.getMyProductReview).toHaveBeenCalledTimes(2);
    });
    expect(result.current.list).toBeNull();
    expect(result.current.ownerReview).toBeNull();

    await act(async () => {
      listTwo.resolve(response('two'));
      ownerTwo.resolve(ownedReview('two'));
      await Promise.all([listTwo.promise, ownerTwo.promise]);
    });
    await waitFor(() => expect(result.current.ownerReview?.id).toBe('two'));
    expect(result.current.list?.items[0]?.id).toBe('two');
  });

  it('clamps an invalidated page and reloads after the total shrinks', async () => {
    reviewsApi.getProductReviews
      .mockResolvedValueOnce(response('one', 11, 1))
      .mockResolvedValueOnce(response('one', 11, 2))
      .mockResolvedValueOnce(response('one', 1, 2))
      .mockResolvedValueOnce(response('one', 1, 1));
    const { result } = renderHook(() => useProductReviews('one'));
    await waitFor(() => expect(result.current.isListLoading).toBe(false));

    act(() => result.current.setPage(2));
    await waitFor(() => expect(result.current.page).toBe(2));
    act(() => result.current.retryList());

    await waitFor(() =>
      expect(reviewsApi.getProductReviews).toHaveBeenLastCalledWith(
        'one',
        { sort: 'newest', page: 1, pageSize: 10 },
        expect.any(AbortSignal),
      ),
    );
    expect(result.current.page).toBe(1);
  });

  it('refetches public viewer state when the signed-in customer changes', async () => {
    reviewsApi.getProductReviews.mockResolvedValue(response('one'));
    reviewsApi.getMyProductReview.mockResolvedValue(null);
    const { rerender } = renderHook(() => useProductReviews('one'));
    await waitFor(() => expect(reviewsApi.getProductReviews).toHaveBeenCalledTimes(1));

    authState.user = {
      id: 'customer',
      email: 'customer@example.com',
      displayName: 'Customer',
      role: 'customer',
      country: 'UK',
    };
    rerender();

    await waitFor(() => expect(reviewsApi.getProductReviews).toHaveBeenCalledTimes(2));
  });

  it('uses the server engagement response rather than an optimistic count', async () => {
    authState.user = {
      id: 'customer',
      email: 'customer@example.com',
      displayName: 'Customer',
      role: 'customer',
      country: 'UK',
    };
    reviewsApi.getProductReviews.mockResolvedValue({
      ...response('one'),
      items: [{ ...response('one').items[0]!, viewerCanEngage: true, helpfulCount: 3 }],
    });
    reviewsApi.getMyProductReview.mockResolvedValue(null);
    reviewsApi.addHelpfulVote.mockResolvedValue({
      reviewId: 'one',
      helpfulCount: 8,
      viewerHasHelpfulVote: true,
      viewerHasOpenReport: false,
    });
    const { result } = renderHook(() => useProductReviews('one'));
    await waitFor(() => expect(result.current.isListLoading).toBe(false));

    await act(async () => {
      await result.current.toggleHelpful('one', false);
    });

    expect(result.current.list?.items[0]).toMatchObject({
      helpfulCount: 8,
      viewerHasHelpfulVote: true,
    });
  });

  it('aborts and ignores a stale engagement response after the viewer changes', async () => {
    authState.user = {
      id: 'customer-one',
      email: 'one@example.com',
      displayName: 'One',
      role: 'customer',
      country: 'UK',
    };
    const engagement = deferred<{
      reviewId: string;
      helpfulCount: number;
      viewerHasHelpfulVote: boolean;
      viewerHasOpenReport: boolean;
    }>();
    reviewsApi.getProductReviews.mockResolvedValue({
      ...response('one'),
      items: [{ ...response('one').items[0]!, viewerCanEngage: true, helpfulCount: 3 }],
    });
    reviewsApi.getMyProductReview.mockResolvedValue(null);
    reviewsApi.addHelpfulVote.mockReturnValue(engagement.promise);
    const { result, rerender } = renderHook(() => useProductReviews('one'));
    await waitFor(() => expect(result.current.isListLoading).toBe(false));

    act(() => {
      void result.current.toggleHelpful('one', false);
    });
    await waitFor(() => expect(reviewsApi.addHelpfulVote).toHaveBeenCalledTimes(1));

    authState.user = {
      id: 'customer-two',
      email: 'two@example.com',
      displayName: 'Two',
      role: 'customer',
      country: 'UK',
    };
    act(() => rerender());
    await waitFor(() => expect(reviewsApi.getProductReviews).toHaveBeenCalledTimes(2));
    const mutationSignal = reviewsApi.addHelpfulVote.mock.calls[0]?.[1] as AbortSignal;
    expect(mutationSignal.aborted).toBe(true);

    await act(async () => {
      engagement.resolve({
        reviewId: 'one',
        helpfulCount: 8,
        viewerHasHelpfulVote: true,
        viewerHasOpenReport: false,
      });
      await engagement.promise;
    });
    expect(result.current.list?.items[0]?.helpfulCount).toBe(3);
  });

  it('clears an engagement status when the authenticated viewer changes', async () => {
    authState.user = {
      id: 'customer-one',
      email: 'one@example.com',
      displayName: 'One',
      role: 'customer',
      country: 'UK',
    };
    reviewsApi.getProductReviews.mockResolvedValue({
      ...response('one'),
      items: [{ ...response('one').items[0]!, viewerCanEngage: true }],
    });
    reviewsApi.getMyProductReview.mockResolvedValue(null);
    reviewsApi.addHelpfulVote.mockResolvedValue({
      reviewId: 'one',
      helpfulCount: 1,
      viewerHasHelpfulVote: true,
      viewerHasOpenReport: false,
    });
    const { result, rerender } = renderHook(() => useProductReviews('one'));
    await waitFor(() => expect(result.current.isListLoading).toBe(false));

    await act(async () => {
      await result.current.toggleHelpful('one', false);
    });
    expect(result.current.engagementStatus).toBe('Marked this review helpful.');

    authState.user = {
      id: 'customer-two',
      email: 'two@example.com',
      displayName: 'Two',
      role: 'customer',
      country: 'UK',
    };
    act(() => rerender());
    await waitFor(() => expect(reviewsApi.getProductReviews).toHaveBeenCalledTimes(2));
    expect(result.current.engagementStatus).toBeNull();
  });
});
