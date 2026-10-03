import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type {
  AdminReviewModerationBody,
  AdminReviewQueueItem,
  AdminReviewQueueQuery,
  AdminReviewQueueResponse,
  ReviewReportReason,
  ReviewStatus,
} from '@shop/contracts/reviews';
import type { MessageParams } from '@shop/localisation';
import { apiErrors } from '@shop/localisation/messages/apiErrors';
import {
  adminCommerceMessages,
  type AdminCommerceMessageKey,
} from '@shop/localisation/messages/adminCommerce';
import { getAdminReviewQueue, moderateAdminReview, restoreAdminReview } from '@/api/adminReviews';
import { ApiError } from '@/api/client';
import { ErrorMessage } from '@/components/ErrorMessage';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useLocalisation } from '@/i18n/LocaleContext';

const PAGE_SIZE = 10;
type Queue = 'reported' | 'hidden';
type Sort = 'oldest' | 'newest';

function readQueue(value: string | null): Queue {
  return value === 'hidden' ? 'hidden' : 'reported';
}

function readSort(value: string | null): Sort {
  return value === 'newest' ? 'newest' : 'oldest';
}

function readPage(value: string | null): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

type Translate = (key: AdminCommerceMessageKey, params?: MessageParams) => string;
type TranslateApiError = (key: string, params?: MessageParams) => string;

const statusMessageKeys: Record<ReviewStatus, AdminCommerceMessageKey> = {
  published: 'adminCommerce.reviews.status.published',
  hidden: 'adminCommerce.reviews.status.hidden',
};

const reasonMessageKeys: Record<ReviewReportReason, AdminCommerceMessageKey> = {
  spam: 'adminCommerce.reviews.reason.spam',
  harassment: 'adminCommerce.reviews.reason.harassment',
  unsafe: 'adminCommerce.reviews.reason.unsafe',
  off_topic: 'adminCommerce.reviews.reason.off_topic',
  other: 'adminCommerce.reviews.reason.other',
};

function errorParams(error: ApiError): MessageParams {
  if (!error.meta || typeof error.meta !== 'object') return {};
  const params: Record<string, string | number | bigint> = {};
  for (const [key, value] of Object.entries(error.meta)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint')
      params[key] = value;
  }
  return params;
}

function messageFor(
  error: unknown,
  fallback: AdminCommerceMessageKey,
  t: Translate,
  translateApiError: TranslateApiError,
): string {
  if (error instanceof ApiError) {
    if (error.code && error.code in apiErrors)
      return translateApiError(error.code, errorParams(error));
    return t(fallback);
  }
  return t(fallback);
}

function actionLabel(decision: AdminReviewModerationBody['decision'], t: Translate): string {
  return t(
    decision === 'hide_review'
      ? 'adminCommerce.reviews.action.hideSuccess'
      : 'adminCommerce.reviews.action.dismissSuccess',
  );
}

export function AdminReviewModerationPage() {
  const { translate, formatCount } = useLocalisation();
  const t = useCallback<Translate>(
    (key, params = {}) => translate(adminCommerceMessages, key, params),
    [translate],
  );
  const translateApiError = useCallback<TranslateApiError>(
    (key, params = {}) => translate(apiErrors, key, params),
    [translate],
  );
  const [searchParams, setSearchParams] = useSearchParams();
  const queue = readQueue(searchParams.get('queue'));
  const sort = readSort(searchParams.get('sort'));
  const page = readPage(searchParams.get('page'));
  const [result, setResult] = useState<AdminReviewQueueResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [pendingReviewId, setPendingReviewId] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const queueHeadingRef = useRef<HTMLHeadingElement>(null);
  const firstCardRef = useRef<HTMLElement>(null);
  const focusAfterReloadRef = useRef(false);

  useEffect(() => {
    if (!focusAfterReloadRef.current) return;
    focusAfterReloadRef.current = false;
    (firstCardRef.current ?? queueHeadingRef.current)?.focus();
  }, [result]);

  const updateParams = useCallback(
    (next: Partial<AdminReviewQueueQuery>) => {
      const nextQueue = next.queue ?? queue;
      const nextSort = next.sort ?? sort;
      const nextPage = next.page ?? page;
      const params = new URLSearchParams({ queue: nextQueue, sort: nextSort });
      if (nextPage > 1) params.set('page', String(nextPage));
      setSearchParams(params, { replace: true });
    },
    [page, queue, setSearchParams, sort],
  );

  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setLoading(true);
    setError(null);

    getAdminReviewQueue({ queue, sort, page, pageSize: PAGE_SIZE }, controller.signal)
      .then((response) => {
        if (!current) return;
        setResult(response);
        const maximumPage = Math.max(1, Math.ceil(response.total / response.pageSize));
        if (page > maximumPage) updateParams({ page: maximumPage });
      })
      .catch((requestError: unknown) => {
        if (current && !controller.signal.aborted) {
          setError(
            messageFor(requestError, 'adminCommerce.reviews.error.load', t, translateApiError),
          );
        }
      })
      .finally(() => {
        if (current) setLoading(false);
      });

    return () => {
      current = false;
      controller.abort();
    };
  }, [page, queue, reloadVersion, sort, t, translateApiError, updateParams]);

  const retry = useCallback(() => setReloadVersion((version) => version + 1), []);

  const moderate = useCallback(
    async (review: AdminReviewQueueItem, decision: AdminReviewModerationBody['decision']) => {
      setMutationError(null);
      setStatus(null);
      setPendingReviewId(review.id);
      try {
        await moderateAdminReview(review.id, { decision });
        focusAfterReloadRef.current = true;
        if (result?.items.length === 1 && page > 1) {
          updateParams({ page: page - 1 });
        } else {
          retry();
        }
        setStatus(actionLabel(decision, t));
      } catch (requestError) {
        setMutationError(
          messageFor(requestError, 'adminCommerce.reviews.error.moderate', t, translateApiError),
        );
      } finally {
        setPendingReviewId(null);
      }
    },
    [page, result?.items.length, retry, t, translateApiError, updateParams],
  );

  const restore = useCallback(
    async (review: AdminReviewQueueItem) => {
      setMutationError(null);
      setStatus(null);
      setPendingReviewId(review.id);
      try {
        await restoreAdminReview(review.id);
        focusAfterReloadRef.current = true;
        if (result?.items.length === 1 && page > 1) {
          updateParams({ page: page - 1 });
        } else {
          retry();
        }
        setStatus(t('adminCommerce.reviews.action.restoreSuccess'));
      } catch (requestError) {
        setMutationError(
          messageFor(requestError, 'adminCommerce.reviews.error.restore', t, translateApiError),
        );
      } finally {
        setPendingReviewId(null);
      }
    },
    [page, result?.items.length, retry, t, translateApiError, updateParams],
  );

  if (loading && !result) return <LoadingSpinner />;
  if (error && !result) return <ErrorMessage message={error} onRetry={() => void retry()} />;
  if (!result)
    return (
      <ErrorMessage
        message={t('adminCommerce.reviews.error.unavailable')}
        onRetry={() => void retry()}
      />
    );

  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));

  return (
    <section className="mx-auto max-w-4xl space-y-6" aria-labelledby="admin-reviews-heading">
      <div>
        <p className="section-eyebrow">{t('adminCommerce.administration')}</p>
        <h1
          ref={queueHeadingRef}
          id="admin-reviews-heading"
          tabIndex={-1}
          className="section-heading mt-2"
        >
          {t('adminCommerce.reviews.heading')}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t('adminCommerce.reviews.description')}
        </p>
      </div>

      <p aria-live="polite" className="text-sm text-muted-foreground">
        {status}
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {mutationError && (
        <p role="alert" className="text-sm text-destructive">
          {mutationError}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <label className="text-sm font-medium">
          {t('adminCommerce.reviews.queue')}
          <select
            className="ml-2 rounded-md border border-input bg-background px-2 py-1"
            value={queue}
            onChange={(event) => updateParams({ queue: event.target.value as Queue, page: 1 })}
          >
            <option value="reported">{t('adminCommerce.reviews.queue.reported')}</option>
            <option value="hidden">{t('adminCommerce.reviews.queue.hidden')}</option>
          </select>
        </label>
        <label className="text-sm font-medium">
          {t('adminCommerce.reviews.sort')}
          <select
            className="ml-2 rounded-md border border-input bg-background px-2 py-1"
            value={sort}
            onChange={(event) => updateParams({ sort: event.target.value as Sort, page: 1 })}
          >
            <option value="oldest">{t('adminCommerce.reviews.sort.oldest')}</option>
            <option value="newest">{t('adminCommerce.reviews.sort.newest')}</option>
          </select>
        </label>
      </div>

      {result.items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="font-medium">
              {t('adminCommerce.reviews.noQueue', {
                queue: t(
                  queue === 'reported'
                    ? 'adminCommerce.reviews.queue.reportedLower'
                    : 'adminCommerce.reviews.queue.hiddenLower',
                ),
              })}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {queue === 'reported'
                ? t('adminCommerce.reviews.reportedEmpty')
                : t('adminCommerce.reviews.hiddenEmpty')}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4" aria-busy={loading}>
          {result.items.map((review, index) => {
            const pending = pendingReviewId === review.id;
            return (
              <article
                key={review.id}
                ref={index === 0 ? firstCardRef : undefined}
                tabIndex={-1}
                aria-label={t('adminCommerce.reviews.reviewAria', {
                  productName: review.productName,
                })}
              >
                <Card>
                  <CardContent className="space-y-4 py-5">
                    <div className="flex flex-wrap justify-between gap-3">
                      <div>
                        <h2 className="font-semibold">{review.productName}</h2>
                        <p className="text-sm text-muted-foreground">
                          {review.author.displayName} · {formatCount(review.rating)}/
                          {formatCount(5)} · {t(statusMessageKeys[review.status])}
                        </p>
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {t('adminCommerce.reviews.helpful', {
                          count: review.helpfulCount,
                          displayCount: formatCount(review.helpfulCount),
                        })}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap text-sm">{review.body}</p>
                    {queue === 'reported' && (
                      <div className="space-y-3 rounded-md border border-border p-3">
                        <h3 className="font-medium">
                          {t('adminCommerce.reviews.openReports', {
                            count: review.openReportCount,
                            displayCount: formatCount(review.openReportCount),
                          })}
                        </h3>
                        {review.openReports.map((report) => (
                          <div key={report.id} className="text-sm">
                            <p>
                              <span className="font-medium">
                                {t(reasonMessageKeys[report.reason])}
                              </span>{' '}
                              {t('adminCommerce.reviews.reportedBy')} {report.reporterDisplayName}
                            </p>
                            {report.detail && (
                              <p className="mt-1 whitespace-pre-wrap">{report.detail}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {queue === 'reported' ? (
                        <>
                          <Button
                            type="button"
                            variant="destructive"
                            disabled={pending}
                            onClick={() => void moderate(review, 'hide_review')}
                          >
                            {pending
                              ? t('adminCommerce.reviews.working')
                              : t('adminCommerce.reviews.hide')}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            disabled={pending}
                            onClick={() => void moderate(review, 'dismiss_reports')}
                          >
                            {t('adminCommerce.reviews.dismiss')}
                          </Button>
                        </>
                      ) : (
                        <Button
                          type="button"
                          disabled={pending}
                          onClick={() => void restore(review)}
                        >
                          {pending
                            ? t('adminCommerce.reviews.working')
                            : t('adminCommerce.reviews.restore')}
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </article>
            );
          })}
        </div>
      )}

      <nav
        className="flex items-center justify-between"
        aria-label={t('adminCommerce.reviews.pagesAria')}
      >
        <Button
          type="button"
          variant="outline"
          disabled={page <= 1 || loading}
          onClick={() => updateParams({ page: page - 1 })}
        >
          {t('adminCommerce.reviews.previous')}
        </Button>
        <span className="text-sm text-muted-foreground">
          {t('adminCommerce.reviews.pageOf', {
            page: formatCount(result.page),
            totalPages: formatCount(totalPages),
          })}
        </span>
        <Button
          type="button"
          variant="outline"
          disabled={page >= totalPages || loading}
          onClick={() => updateParams({ page: page + 1 })}
        >
          {t('adminCommerce.reviews.next')}
        </Button>
      </nav>
    </section>
  );
}
