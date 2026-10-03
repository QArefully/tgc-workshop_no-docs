import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { PromoValidationErrorCode } from '@shop/contracts/promos';
import { useLocalisation } from '@/i18n/LocaleContext';
import { checkoutMessages } from '@shop/localisation/messages/checkout';

interface PromoCodeFormProps {
  promoCode: string;
  appliedPromo: string | null;
  error: string | null;
  errorCode: PromoValidationErrorCode | null;
  minSubtotalCents: number | null;
  validating: boolean;
  eligible: boolean;
  onChange: (value: string) => void;
  onApply: () => void;
  onRemove: () => void;
}
export function PromoCodeForm({
  promoCode,
  appliedPromo,
  error,
  errorCode,
  minSubtotalCents,
  validating,
  eligible,
  onChange,
  onApply,
  onRemove,
}: PromoCodeFormProps) {
  const { translate, formatDisplayMoney } = useLocalisation();
  const t = (key: keyof typeof checkoutMessages, params?: Record<string, string | number>) =>
    translate(checkoutMessages, key, params);

  const errorMessage = (() => {
    switch (errorCode) {
      case 'CATEGORY_MISMATCH':
        return t('checkout.promoCategoryMismatch');
      case 'EXPIRED':
        return t('checkout.promoError.expired');
      case 'NOT_STARTED':
        return t('checkout.promoError.notStarted');
      case 'MIN_ITEMS':
        return t('checkout.promoError.minItems', { count: 5 });
      case 'MIN_SUBTOTAL':
        return minSubtotalCents === null
          ? t('checkout.promoError.minSubtotal')
          : t('checkout.promoError.minSubtotalAmount', {
              money: formatDisplayMoney(minSubtotalCents),
            });
      case 'USAGE_LIMIT':
        return t('checkout.promoError.usageLimit');
      case 'AUTH_REQUIRED':
        return t('checkout.promoError.authRequired');
      case 'INVALID':
        return t('checkout.promoError.invalid');
      default:
        return error;
    }
  })();

  return (
    <div className="space-y-2">
      <label htmlFor="promoCode" className="text-sm font-medium">
        {t('checkout.promoLabel')}
      </label>
      <p className="text-xs text-muted-foreground">
        {t('checkout.promoDescription', { count: 5 })}
      </p>
      {!appliedPromo ? (
        <div className="flex gap-2">
          <Input
            id="promoCode"
            value={promoCode}
            onChange={(event) => onChange(event.target.value)}
            placeholder={
              eligible ? t('checkout.promoEnter') : t('checkout.promoUnlock', { count: 5 })
            }
            disabled={!eligible}
            className="flex-1"
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onApply();
              }
            }}
            aria-describedby={errorMessage ? 'promo-error' : undefined}
            aria-invalid={Boolean(errorMessage)}
          />
          <Button
            type="button"
            variant="outline"
            disabled={!eligible || !promoCode.trim() || validating}
            onClick={onApply}
          >
            {validating ? t('checkout.checking') : t('checkout.apply')}
          </Button>
        </div>
      ) : (
        <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2">
          <span className="text-sm font-medium text-green-700">
            {t('checkout.applied', { promo: appliedPromo })}
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
            {t('checkout.remove')}
          </Button>
        </div>
      )}
      {errorMessage && (
        <p id="promo-error" role="alert" className="text-xs text-destructive">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
