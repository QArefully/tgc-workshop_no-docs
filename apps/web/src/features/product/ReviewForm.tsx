import { useEffect, useState, type FormEvent } from 'react';
import type { CreateReviewBody, OwnedReview } from '@shop/contracts/reviews';
import { Button } from '@/components/ui/button';
import { productMessages } from '@shop/localisation/messages/product';
import { useLocalisation } from '@/i18n/LocaleContext';
import type { MessageParams } from '@shop/localisation';

interface ReviewFormProps {
  review: OwnedReview | null;
  isPending: boolean;
  error: string | null;
  onSubmit: (body: CreateReviewBody) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
}

const MIN_BODY_LENGTH = 20;
const MAX_BODY_LENGTH = 4000;
type ValidationError =
  | { readonly key: 'product.chooseRating'; readonly params?: MessageParams }
  | {
      readonly key: 'product.reviewLength';
      readonly params: { readonly min: number; readonly max: number };
    };

export function ReviewForm({ review, isPending, error, onSubmit, onDelete }: ReviewFormProps) {
  const [rating, setRating] = useState(review?.rating ?? 5);
  const [body, setBody] = useState(review?.body ?? '');
  const [validationError, setValidationError] = useState<ValidationError | null>(null);
  const { translate, formatCount } = useLocalisation();
  const t = <K extends keyof typeof productMessages>(
    key: K,
    params?: Record<string, string | number>,
  ) => translate(productMessages, key, params);

  useEffect(() => {
    setRating(review?.rating ?? 5);
    setBody(review?.body ?? '');
    setValidationError(null);
  }, [review?.id]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = body.trim();
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      setValidationError({ key: 'product.chooseRating' });
      return;
    }
    if (trimmed.length < MIN_BODY_LENGTH || trimmed.length > MAX_BODY_LENGTH) {
      setValidationError({
        key: 'product.reviewLength',
        params: { min: MIN_BODY_LENGTH, max: MAX_BODY_LENGTH },
      });
      return;
    }
    setValidationError(null);
    const saved = await onSubmit({ rating, body: trimmed });
    if (saved && !review) setBody('');
  }

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className="space-y-4 rounded-lg border border-border p-4"
      aria-label={review ? t('product.editReview') : t('product.writeReview')}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold">
          {review ? t('product.yourReview') : t('product.writeReview')}
        </h3>
        {review?.status === 'hidden' && (
          <span className="text-sm text-muted-foreground">{t('product.hiddenByModeration')}</span>
        )}
      </div>
      <fieldset disabled={isPending}>
        <legend className="text-sm font-medium">{t('product.rating')}</legend>
        <div className="mt-1 flex gap-2">
          {[1, 2, 3, 4, 5].map((value) => (
            <label key={value} className="cursor-pointer text-sm">
              <input
                type="radio"
                name="review-rating"
                value={value}
                checked={rating === value}
                onChange={() => setRating(value)}
                className="peer sr-only"
              />
              <span className="rounded border border-border px-2 py-1 peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground">
                {value}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label htmlFor="review-body" className="text-sm font-medium">
          {t('product.review')}
        </label>
        <textarea
          id="review-body"
          value={body}
          disabled={isPending}
          minLength={MIN_BODY_LENGTH}
          maxLength={MAX_BODY_LENGTH}
          onChange={(event) => setBody(event.target.value)}
          className="mt-1 min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          aria-describedby="review-body-help"
        />
        <p id="review-body-help" className="mt-1 text-xs text-muted-foreground">
          {t('product.characters', {
            count: formatCount(body.trim().length),
            max: formatCount(MAX_BODY_LENGTH),
            min: formatCount(MIN_BODY_LENGTH),
          })}
        </p>
      </div>
      {(validationError || error) && (
        <p role="alert" className="text-sm text-destructive">
          {validationError
            ? validationError.key === 'product.reviewLength'
              ? t(validationError.key, {
                  min: formatCount(validationError.params.min),
                  max: formatCount(validationError.params.max),
                })
              : t(validationError.key)
            : error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={isPending}>
          {isPending
            ? t('product.saving')
            : review
              ? t('product.updateReview')
              : t('product.publishReview')}
        </Button>
        {review && (
          <Button
            type="button"
            variant="destructive"
            disabled={isPending}
            onClick={() => void onDelete()}
          >
            {isPending ? t('product.saving') : t('product.deleteReview')}
          </Button>
        )}
      </div>
    </form>
  );
}
