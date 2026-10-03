import { useRef, useState, type FormEvent } from 'react';
import type { CreateReviewReportBody, Review } from '@shop/contracts/reviews';
import { Button } from '@/components/ui/button';
import { productMessages } from '@shop/localisation/messages/product';
import { useLocalisation } from '@/i18n/LocaleContext';

interface ReviewListProps {
  reviews: Review[];
  engagementStatus: string | null;
  engagementErrors: Readonly<Record<string, string | undefined>>;
  onToggleHelpful: (reviewId: string, hasHelpfulVote: boolean) => Promise<boolean>;
  onSubmitReport: (reviewId: string, body: CreateReviewReportBody) => Promise<boolean>;
  onWithdrawReport: (reviewId: string) => Promise<boolean>;
  isEngagementMutating: (reviewId: string) => boolean;
}

interface ReviewRowProps extends Omit<ReviewListProps, 'reviews' | 'engagementStatus'> {
  review: Review;
}

function ReviewRow({
  review,
  engagementErrors,
  onToggleHelpful,
  onSubmitReport,
  onWithdrawReport,
  isEngagementMutating,
}: ReviewRowProps) {
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [reason, setReason] = useState<CreateReviewReportBody['reason']>('spam');
  const [detail, setDetail] = useState('');
  const [validationError, setValidationError] = useState<'product.provideDetail' | null>(null);
  const { translate, formatInstant, formatCount } = useLocalisation();
  const t = <K extends keyof typeof productMessages>(
    key: K,
    params?: Record<string, string | number>,
  ) => translate(productMessages, key, params);
  const reportActionRef = useRef<HTMLElement>(null);
  const isMutating = isEngagementMutating(review.id);
  const reportFormId = `review-report-${review.id}`;

  function closeReport() {
    setIsReportOpen(false);
    setValidationError(null);
    setDetail('');
    window.requestAnimationFrame(() => reportActionRef.current?.focus());
  }

  async function submitReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedDetail = detail.trim();
    if (reason === 'other' && !normalizedDetail) {
      setValidationError('product.provideDetail');
      return;
    }
    setValidationError(null);
    const body: CreateReviewReportBody =
      reason === 'other'
        ? { reason, detail: normalizedDetail }
        : normalizedDetail
          ? { reason, detail: normalizedDetail }
          : { reason };
    if (await onSubmitReport(review.id, body)) closeReport();
  }

  return (
    <li className="py-5 first:pt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="font-medium">{review.author.displayName}</p>
        <time className="text-sm text-muted-foreground" dateTime={review.createdAt}>
          {formatInstant(review.createdAt, 'date')}
        </time>
      </div>
      <p
        className="mt-1"
        aria-label={t('product.ratingOutOf', { rating: formatCount(review.rating) })}
      >
        <span aria-hidden="true">
          {'★'.repeat(review.rating)}
          {'☆'.repeat(5 - review.rating)}
        </span>
      </p>
      {review.verifiedPurchase && (
        <p
          className="mt-1 text-sm font-medium text-primary"
          aria-label={t('product.verifiedPurchase')}
        >
          {t('product.verifiedPurchase')}
        </p>
      )}
      <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{review.body}</p>
      <p className="mt-3 text-sm text-muted-foreground">
        {t('product.foundHelpful', { count: review.helpfulCount })}
      </p>
      {review.viewerCanEngage && (
        <div className="mt-2 space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={review.viewerHasHelpfulVote ? 'secondary' : 'outline'}
              size="sm"
              aria-pressed={review.viewerHasHelpfulVote}
              disabled={isMutating}
              onClick={() => void onToggleHelpful(review.id, review.viewerHasHelpfulVote)}
            >
              {t('product.helpful')}
            </Button>
            {review.viewerHasOpenReport ? (
              <Button
                ref={reportActionRef}
                type="button"
                variant="link"
                size="sm"
                disabled={isMutating}
                onClick={() => void onWithdrawReport(review.id)}
              >
                {t('product.withdrawReport')}
              </Button>
            ) : (
              <Button
                ref={reportActionRef}
                type="button"
                variant="link"
                size="sm"
                disabled={isMutating}
                aria-expanded={isReportOpen}
                aria-controls={reportFormId}
                onClick={() => {
                  setValidationError(null);
                  setIsReportOpen(true);
                }}
              >
                {t('product.reportReview')}
              </Button>
            )}
          </div>
          {isReportOpen && (
            <form
              id={reportFormId}
              className="space-y-3 rounded-md border border-border p-3"
              aria-label={t('product.reviewBy', { name: review.author.displayName })}
              onSubmit={(event) => void submitReport(event)}
            >
              <div>
                <label htmlFor={`${reportFormId}-reason`} className="text-sm font-medium">
                  {t('product.reason')}
                </label>
                <select
                  id={`${reportFormId}-reason`}
                  className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
                  value={reason}
                  disabled={isMutating}
                  onChange={(event) =>
                    setReason(event.target.value as CreateReviewReportBody['reason'])
                  }
                >
                  <option value="spam">{t('product.spam')}</option>
                  <option value="harassment">{t('product.harassment')}</option>
                  <option value="unsafe">{t('product.unsafeContent')}</option>
                  <option value="off_topic">{t('product.offTopic')}</option>
                  <option value="other">{t('product.other')}</option>
                </select>
              </div>
              <div>
                <label htmlFor={`${reportFormId}-detail`} className="text-sm font-medium">
                  {t('product.detail', {
                    required: reason === 'other' ? t('product.required') : t('product.optional'),
                  })}
                </label>
                <textarea
                  id={`${reportFormId}-detail`}
                  className="mt-1 min-h-20 w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
                  value={detail}
                  disabled={isMutating}
                  maxLength={1000}
                  required={reason === 'other'}
                  onChange={(event) => setDetail(event.target.value)}
                />
              </div>
              {(validationError || engagementErrors[review.id]) && (
                <p role="alert" className="text-sm text-destructive">
                  {validationError ? t(validationError) : engagementErrors[review.id]}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button type="submit" size="sm" disabled={isMutating}>
                  {isMutating ? t('product.submitting') : t('product.submitReport')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isMutating}
                  onClick={closeReport}
                >
                  {t('product.cancel')}
                </Button>
              </div>
            </form>
          )}
          {!isReportOpen && engagementErrors[review.id] && (
            <p role="alert" className="text-sm text-destructive">
              {engagementErrors[review.id]}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

export function ReviewList({
  reviews,
  engagementStatus,
  engagementErrors,
  onToggleHelpful,
  onSubmitReport,
  onWithdrawReport,
  isEngagementMutating,
}: ReviewListProps) {
  const { translate } = useLocalisation();
  if (reviews.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {translate(productMessages, 'product.noPublishedReviews')}
      </p>
    );
  }

  return (
    <>
      <p role="status" aria-live="polite" className="sr-only">
        {engagementStatus}
      </p>
      <ol
        className="divide-y divide-border"
        aria-label={translate(productMessages, 'product.customerReviews')}
      >
        {reviews.map((review) => (
          <ReviewRow
            key={review.id}
            review={review}
            engagementErrors={engagementErrors}
            onToggleHelpful={onToggleHelpful}
            onSubmitReport={onSubmitReport}
            onWithdrawReport={onWithdrawReport}
            isEngagementMutating={isEngagementMutating}
          />
        ))}
      </ol>
    </>
  );
}
