import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CreateReviewBody,
  CreateReviewReportBody,
  OwnedReview,
  ReviewEngagementResponse,
  ReviewListResponse,
  ReviewSort,
} from '@shop/contracts/reviews';
import {
  addHelpfulVote,
  createReviewReport,
  createProductReview,
  deleteReview,
  getMyProductReview,
  getProductReviews,
  removeHelpfulVote,
  withdrawReviewReport,
  updateReview,
} from '@/api/reviews';
import { ApiError, type ApiErrorMeta } from '@/api/client';
import { useAuth } from './AuthContext';
import type { PublicErrorCode } from '@shop/contracts/public-errors';
import type { MessageCatalog, MessageParams } from '@shop/localisation';
import { apiErrors } from '@shop/localisation/messages/apiErrors';
import { productMessages } from '@shop/localisation/messages/product';
import { useLocalisation } from '@/i18n/LocaleContext';

const DEFAULT_PAGE_SIZE = 10;
type ProductMessageKey = keyof typeof productMessages;

/** Stable P17 failure identity. Copy resolves against active country during render. */
type ProductErrorState = {
  readonly code: PublicErrorCode | null;
  readonly meta: ApiErrorMeta | null;
  readonly key: ProductMessageKey;
  readonly params?: MessageParams;
};

function safeMessageParams(meta: ApiErrorMeta | null): MessageParams {
  if (meta === null || typeof meta !== 'object') return {};
  const params: Record<string, string | number | bigint> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint')
      params[key] = value;
  }
  return params;
}

function localizeProductError(
  state: ProductErrorState | null,
  translate: (catalog: MessageCatalog, key: string, params?: MessageParams) => string,
): string | null {
  if (state === null) return null;
  if (state.code !== null) {
    try {
      return translate(apiErrors, state.code, safeMessageParams(state.meta));
    } catch {
      // Malformed/stale descriptor falls through to safe P17 copy.
    }
  }
  return translate(productMessages, state.key, state.params);
}

function errorState(error: unknown, fallback: ProductMessageKey): ProductErrorState {
  if (error instanceof ApiError && error.code !== null) {
    return { code: error.code, meta: error.meta, key: fallback };
  }
  // Network, contract, legacy, and unknown failures never expose Error.message.
  return { code: null, meta: null, key: fallback };
}

export interface UseProductReviewsResult {
  list: ReviewListResponse | null;
  listError: string | null;
  isListLoading: boolean;
  ownerReview: OwnedReview | null;
  ownerError: string | null;
  isOwnerLoading: boolean;
  sort: ReviewSort;
  page: number;
  isMutating: boolean;
  mutationError: string | null;
  engagementStatus: string | null;
  engagementErrors: Readonly<Record<string, string | undefined>>;
  setSort: (sort: ReviewSort) => void;
  setPage: (page: number) => void;
  retryList: () => void;
  retryOwner: () => void;
  submitReview: (body: CreateReviewBody) => Promise<boolean>;
  removeReview: () => Promise<boolean>;
  toggleHelpful: (reviewId: string, hasHelpfulVote: boolean) => Promise<boolean>;
  submitReport: (reviewId: string, body: CreateReviewReportBody) => Promise<boolean>;
  withdrawReport: (reviewId: string) => Promise<boolean>;
  isEngagementMutating: (reviewId: string) => boolean;
}

/**
 * Keeps public review data and the optional owner record independent: a failed
 * owner request never hides public reviews, and vice versa.
 */
export function useProductReviews(productId: string): UseProductReviewsResult {
  const { user } = useAuth();
  const { translate } = useLocalisation();
  const viewerIdentity = user ? `${user.id}:${user.role}` : 'anonymous';
  const [list, setList] = useState<ReviewListResponse | null>(null);
  const [listErrorState, setListErrorState] = useState<ProductErrorState | null>(null);
  const [isListLoading, setIsListLoading] = useState(true);
  const [ownerReview, setOwnerReview] = useState<OwnedReview | null>(null);
  const [ownerErrorState, setOwnerErrorState] = useState<ProductErrorState | null>(null);
  const [isOwnerLoading, setIsOwnerLoading] = useState(Boolean(user));
  const [sort, setSortState] = useState<ReviewSort>('newest');
  const [page, setPageState] = useState(1);
  const previousProductId = useRef(productId);
  const [listReloadVersion, setListReloadVersion] = useState(0);
  const [ownerReloadVersion, setOwnerReloadVersion] = useState(0);
  const [isMutating, setIsMutating] = useState(false);
  const [mutationErrorState, setMutationErrorState] = useState<ProductErrorState | null>(null);
  const [engagementStatusState, setEngagementStatusState] = useState<ProductErrorState | null>(
    null,
  );
  const [engagementErrorStates, setEngagementErrorStates] = useState<
    Record<string, ProductErrorState | undefined>
  >({});
  const [engagementMutationIds, setEngagementMutationIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const engagementControllers = useRef(new Map<string, AbortController>());
  const engagementGeneration = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    const productChanged = previousProductId.current !== productId;
    const requestPage = productChanged ? 1 : page;
    if (productChanged) {
      previousProductId.current = productId;
      setList(null);
      setListErrorState(null);
      setOwnerReview(null);
      setOwnerErrorState(null);
      setPageState(1);
    }
    setIsListLoading(true);
    setListErrorState(null);

    getProductReviews(
      productId,
      { sort, page: requestPage, pageSize: DEFAULT_PAGE_SIZE },
      controller.signal,
    )
      .then((response) => {
        if (!current) return;
        const maximumPage = Math.max(1, Math.ceil(response.summary.total / response.pageSize));
        if (requestPage > maximumPage) {
          setList(null);
          setPageState(maximumPage);
          return;
        }
        setList(response);
      })
      .catch((error: unknown) => {
        if (current && !controller.signal.aborted) {
          setListErrorState(errorState(error, 'product.couldNotLoadReviews'));
        }
      })
      .finally(() => {
        if (current) setIsListLoading(false);
      });

    return () => {
      current = false;
      controller.abort();
    };
  }, [listReloadVersion, page, productId, sort, viewerIdentity]);

  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setOwnerReview(null);
    setOwnerErrorState(null);
    if (!user) {
      setIsOwnerLoading(false);
      return () => controller.abort();
    }

    setIsOwnerLoading(true);
    setOwnerErrorState(null);
    getMyProductReview(productId, controller.signal)
      .then((response) => {
        if (current) setOwnerReview(response);
      })
      .catch((error: unknown) => {
        if (current && !controller.signal.aborted) {
          setOwnerErrorState(errorState(error, 'product.couldNotLoadReview'));
        }
      })
      .finally(() => {
        if (current) setIsOwnerLoading(false);
      });

    return () => {
      current = false;
      controller.abort();
    };
  }, [ownerReloadVersion, productId, viewerIdentity]);

  useEffect(() => {
    engagementGeneration.current += 1;
    for (const controller of engagementControllers.current.values()) controller.abort();
    engagementControllers.current.clear();
    setEngagementMutationIds(new Set());
    setEngagementErrorStates({});
    setEngagementStatusState(null);
  }, [productId, viewerIdentity]);

  const retryList = useCallback(() => setListReloadVersion((version) => version + 1), []);
  const retryOwner = useCallback(() => setOwnerReloadVersion((version) => version + 1), []);
  const refresh = useCallback(() => {
    retryList();
    retryOwner();
  }, [retryList, retryOwner]);

  const setSort = useCallback((nextSort: ReviewSort) => {
    setSortState(nextSort);
    setPageState(1);
  }, []);

  const setPage = useCallback((nextPage: number) => {
    setPageState(Math.max(1, nextPage));
  }, []);

  const submitReview = useCallback(
    async (body: CreateReviewBody): Promise<boolean> => {
      setMutationErrorState(null);
      setIsMutating(true);
      try {
        if (ownerReview) {
          await updateReview(ownerReview.id, body);
        } else {
          await createProductReview(productId, body);
        }
        refresh();
        return true;
      } catch (error) {
        setMutationErrorState(errorState(error, 'product.couldNotSaveReview'));
        return false;
      } finally {
        setIsMutating(false);
      }
    },
    [ownerReview, productId, refresh],
  );

  const removeReview = useCallback(async (): Promise<boolean> => {
    if (!ownerReview) return false;
    setMutationErrorState(null);
    setIsMutating(true);
    try {
      await deleteReview(ownerReview.id);
      refresh();
      return true;
    } catch (error) {
      setMutationErrorState(errorState(error, 'product.couldNotDeleteReview'));
      return false;
    } finally {
      setIsMutating(false);
    }
  }, [ownerReview, refresh]);

  const updateEngagement = useCallback((response: ReviewEngagementResponse) => {
    setList((current) => {
      if (!current) return current;
      return {
        ...current,
        items: current.items.map((review) =>
          review.id === response.reviewId
            ? {
                ...review,
                helpfulCount: response.helpfulCount,
                viewerHasHelpfulVote: response.viewerHasHelpfulVote,
                viewerHasOpenReport: response.viewerHasOpenReport,
              }
            : review,
        ),
      };
    });
  }, []);

  const performEngagementMutation = useCallback(
    async (
      reviewId: string,
      action: (signal: AbortSignal) => Promise<ReviewEngagementResponse>,
      successKey: ProductMessageKey,
      failureKey: ProductMessageKey,
    ): Promise<boolean> => {
      const priorController = engagementControllers.current.get(reviewId);
      if (priorController) return false;

      const controller = new AbortController();
      const generation = engagementGeneration.current;
      engagementControllers.current.set(reviewId, controller);
      setEngagementMutationIds((current) => new Set(current).add(reviewId));
      setEngagementErrorStates((current) => ({ ...current, [reviewId]: undefined }));
      setEngagementStatusState(null);

      try {
        const response = await action(controller.signal);
        if (generation !== engagementGeneration.current || controller.signal.aborted) return false;
        updateEngagement(response);
        setEngagementStatusState({ code: null, meta: null, key: successKey });
        return true;
      } catch (error) {
        if (generation !== engagementGeneration.current || controller.signal.aborted) return false;
        setEngagementErrorStates((current) => ({
          ...current,
          [reviewId]: errorState(error, failureKey),
        }));
        return false;
      } finally {
        if (generation === engagementGeneration.current) {
          engagementControllers.current.delete(reviewId);
          setEngagementMutationIds((current) => {
            const next = new Set(current);
            next.delete(reviewId);
            return next;
          });
        }
      }
    },
    [updateEngagement],
  );

  const toggleHelpful = useCallback(
    (reviewId: string, hasHelpfulVote: boolean) =>
      performEngagementMutation(
        reviewId,
        (signal) =>
          hasHelpfulVote ? removeHelpfulVote(reviewId, signal) : addHelpfulVote(reviewId, signal),
        hasHelpfulVote ? 'product.removedHelpful' : 'product.markedHelpful',
        'product.couldNotUpdateHelpful',
      ),
    [performEngagementMutation],
  );

  const submitReport = useCallback(
    (reviewId: string, body: CreateReviewReportBody) =>
      performEngagementMutation(
        reviewId,
        (signal) => createReviewReport(reviewId, body, signal),
        'product.reportSubmitted',
        'product.couldNotSubmitReport',
      ),
    [performEngagementMutation],
  );

  const withdrawReport = useCallback(
    (reviewId: string) =>
      performEngagementMutation(
        reviewId,
        (signal) => withdrawReviewReport(reviewId, signal),
        'product.reportWithdrawn',
        'product.couldNotWithdrawReport',
      ),
    [performEngagementMutation],
  );

  const isEngagementMutating = useCallback(
    (reviewId: string) => engagementMutationIds.has(reviewId),
    [engagementMutationIds],
  );

  const listError = useMemo(
    () => localizeProductError(listErrorState, translate),
    [listErrorState, translate],
  );
  const ownerError = useMemo(
    () => localizeProductError(ownerErrorState, translate),
    [ownerErrorState, translate],
  );
  const mutationError = useMemo(
    () => localizeProductError(mutationErrorState, translate),
    [mutationErrorState, translate],
  );
  const engagementStatus = useMemo(
    () => localizeProductError(engagementStatusState, translate),
    [engagementStatusState, translate],
  );
  const engagementErrors = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(engagementErrorStates).map(([reviewId, state]) => [
          reviewId,
          localizeProductError(state ?? null, translate) ?? undefined,
        ]),
      ) as Readonly<Record<string, string | undefined>>,
    [engagementErrorStates, translate],
  );

  return {
    list,
    listError,
    isListLoading,
    ownerReview,
    ownerError,
    isOwnerLoading,
    sort,
    page,
    isMutating,
    mutationError,
    engagementStatus,
    engagementErrors,
    setSort,
    setPage,
    retryList,
    retryOwner,
    submitReview,
    removeReview,
    toggleHelpful,
    submitReport,
    withdrawReport,
    isEngagementMutating,
  };
}
