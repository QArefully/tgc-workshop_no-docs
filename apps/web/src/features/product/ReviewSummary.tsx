import type { ReviewSummary as ReviewSummaryData } from '@shop/contracts/reviews';
import { productMessages } from '@shop/localisation/messages/product';
import { useLocalisation } from '@/i18n/LocaleContext';

interface ReviewSummaryProps {
  summary: ReviewSummaryData;
}

export function ReviewSummary({ summary }: ReviewSummaryProps) {
  const { translate, formatCount } = useLocalisation();
  const t = <K extends keyof typeof productMessages>(
    key: K,
    params?: Record<string, string | number>,
  ) => translate(productMessages, key, params);
  if (summary.total === 0) return null;

  const maximum = Math.max(...summary.distribution.map(({ count }) => count), 1);
  return (
    <div className="rounded-lg border border-border p-4" aria-label={t('product.reviewSummary')}>
      <p className="text-2xl font-semibold">
        {summary.averageRating?.toFixed(1)}{' '}
        <span className="text-base" aria-hidden="true">
          ★
        </span>
      </p>
      <p className="text-sm text-muted-foreground">
        {t('product.reviewsCount', { count: summary.total })}
      </p>
      <ul className="mt-3 space-y-1" aria-label={t('product.ratingDistributionLabel')}>
        {[...summary.distribution]
          .sort((a, b) => b.rating - a.rating)
          .map(({ rating, count }) => (
            <li
              key={rating}
              className="flex items-center gap-2 text-sm"
              aria-label={t('product.ratingDistribution', {
                rating: formatCount(rating),
                count: formatCount(count),
              })}
            >
              <span className="w-12">
                {formatCount(rating)} {t('product.stars', { count: rating })}
              </span>
              <span className="h-2 flex-1 overflow-hidden rounded bg-muted" aria-hidden="true">
                <span
                  className="block h-full bg-primary"
                  style={{ width: `${(count / maximum) * 100}%` }}
                />
              </span>
              <span className="w-8 text-right tabular-nums">{count}</span>
            </li>
          ))}
      </ul>
    </div>
  );
}
