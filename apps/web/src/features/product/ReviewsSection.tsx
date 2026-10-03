import { Link, useLocation } from 'react-router-dom';
import type { ReviewSort } from '@shop/contracts/reviews';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/AuthContext';
import { useProductReviews } from '@/hooks/useProductReviews';
import { ReviewForm } from './ReviewForm';
import { ReviewList } from './ReviewList';
import { ReviewSummary } from './ReviewSummary';
import { productMessages } from '@shop/localisation/messages/product';
import { useLocalisation } from '@/i18n/LocaleContext';

interface ReviewsSectionProps {
  productId: string;
}

export function ReviewsSection({ productId }: ReviewsSectionProps) {
  const { user, loading: isAuthLoading } = useAuth();
  const location = useLocation();
  const reviews = useProductReviews(productId);
  const { translate, formatCount } = useLocalisation();
  const t = <K extends keyof typeof productMessages>(
    key: K,
    params?: Record<string, string | number>,
  ) => translate(productMessages, key, params);
  const sortOptions: Array<{ value: ReviewSort; label: string }> = [
    { value: 'newest', label: t('product.sortNewest') },
    { value: 'oldest', label: t('product.sortOldest') },
    { value: 'highest', label: t('product.sortHighest') },
    { value: 'lowest', label: t('product.sortLowest') },
    { value: 'helpful', label: t('product.sortHelpful') },
  ];
  const totalPages = reviews.list
    ? Math.max(1, Math.ceil(reviews.list.summary.total / reviews.list.pageSize))
    : 1;
  const returnPath = `${location.pathname}${location.search}${location.hash}`;

  return (
    <section className="mt-16" aria-labelledby="reviews-heading">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="section-eyebrow">{t('product.reviewsEyebrow')}</p>
          <h2 id="reviews-heading" className="section-heading mt-2">
            {t('product.customerReviews')}
          </h2>
        </div>
        {reviews.list && reviews.list.summary.total > 0 && (
          <label className="text-sm font-medium">
            {t('product.sortReviews')}
            <select
              className="ml-2 rounded-md border border-input bg-background px-2 py-1"
              value={reviews.sort}
              onChange={(event) => reviews.setSort(event.target.value as ReviewSort)}
              disabled={reviews.isListLoading}
            >
              {sortOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(15rem,0.55fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          {reviews.list && <ReviewSummary summary={reviews.list.summary} />}
          {!isAuthLoading && !user && (
            <p className="rounded-lg border border-border p-4 text-sm">
              <Link
                className="font-medium text-primary underline-offset-4 hover:underline"
                to="/login"
                state={{ from: returnPath }}
              >
                {t('product.signInReview')}
              </Link>{' '}
              {t('product.reviewEngagementHint')}
            </p>
          )}
          {!isAuthLoading && user?.role === 'customer' && reviews.isOwnerLoading && (
            <p className="text-sm text-muted-foreground" aria-busy="true">
              {t('product.loadingReview')}
            </p>
          )}
          {!isAuthLoading && user?.role === 'customer' && reviews.ownerError && (
            <div className="rounded-lg border border-border p-4">
              <p role="alert" className="text-sm text-destructive">
                {t('product.couldNotLoadReview')}
              </p>
              <Button
                type="button"
                variant="link"
                className="mt-1 px-0"
                onClick={reviews.retryOwner}
              >
                {t('product.tryAgain')}
              </Button>
            </div>
          )}
          {!isAuthLoading &&
            user?.role === 'customer' &&
            !reviews.isOwnerLoading &&
            !reviews.ownerError && (
              <ReviewForm
                review={reviews.ownerReview}
                isPending={reviews.isMutating}
                error={reviews.mutationError}
                onSubmit={reviews.submitReview}
                onDelete={reviews.removeReview}
              />
            )}
        </div>

        <div>
          {reviews.isListLoading && (
            <p className="text-sm text-muted-foreground" aria-busy="true">
              {t('product.loadingReviews')}
            </p>
          )}
          {reviews.listError && (
            <div>
              <p role="alert" className="text-sm text-destructive">
                {t('product.couldNotLoadReviews')}
              </p>
              <Button
                type="button"
                variant="link"
                className="mt-1 px-0"
                onClick={reviews.retryList}
              >
                {t('product.tryAgain')}
              </Button>
            </div>
          )}
          {!reviews.isListLoading && !reviews.listError && reviews.list && (
            <>
              <ReviewList
                reviews={reviews.list.items}
                engagementStatus={reviews.engagementStatus}
                engagementErrors={reviews.engagementErrors}
                onToggleHelpful={reviews.toggleHelpful}
                onSubmitReport={reviews.submitReport}
                onWithdrawReport={reviews.withdrawReport}
                isEngagementMutating={reviews.isEngagementMutating}
              />
              {totalPages > 1 && (
                <nav className="mt-5 flex items-center gap-3" aria-label={t('product.reviewPages')}>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={reviews.page === 1}
                    onClick={() => reviews.setPage(reviews.page - 1)}
                  >
                    {t('product.previous')}
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    {t('product.pageOf', {
                      page: formatCount(reviews.page),
                      total: formatCount(totalPages),
                    })}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={reviews.page === totalPages}
                    onClick={() => reviews.setPage(reviews.page + 1)}
                  >
                    {t('product.next')}
                  </Button>
                </nav>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
