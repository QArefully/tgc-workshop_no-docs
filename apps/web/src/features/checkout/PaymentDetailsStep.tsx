import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLocalisation } from '@/i18n/LocaleContext';
import { checkoutMessages } from '@shop/localisation/messages/checkout';
import type { CreditAccountMemberView } from '@shop/contracts/trade-credit';
import { translateValidationError } from './checkoutCopy';
import type { CheckoutPaymentMethod, CreditSummaryStatus } from './checkoutState';

type CardField = 'cardNumber' | 'cardExpiry' | 'cardCvc';

interface PaymentDetailsStepProps {
  paymentMethod: CheckoutPaymentMethod;
  onPaymentMethodChange: (paymentMethod: CheckoutPaymentMethod) => void;
  isAuthenticated: boolean;
  creditSummary: CreditAccountMemberView | null;
  creditSummaryStatus: CreditSummaryStatus;
  creditSummaryError: string | null;
  creditSummaryUnavailable: boolean;
  onRetryCreditSummary: () => void;
  card: Record<CardField, string>;
  fieldError: (field: CardField) => string | undefined;
  onChange: (field: CardField, value: string) => void;
  onBlur: (field: CardField) => void;
  onBack: () => void;
  onSubmit: () => void;
  submitting: boolean;
  disabled: boolean;
}
export function PaymentDetailsStep({
  paymentMethod,
  onPaymentMethodChange,
  isAuthenticated,
  creditSummary,
  creditSummaryStatus,
  creditSummaryError,
  creditSummaryUnavailable,
  onRetryCreditSummary,
  card,
  fieldError,
  onChange,
  onBlur,
  onBack,
  onSubmit,
  submitting,
  disabled,
}: PaymentDetailsStepProps) {
  const { translate, formatSettlementMoney } = useLocalisation();
  const t = (key: keyof typeof checkoutMessages, params?: Record<string, string | number>) =>
    translate(checkoutMessages, key, params);
  const errorFor = (field: CardField) => {
    const error = fieldError(field);
    return error ? translateValidationError(error, t) : undefined;
  };
  const cardNumberError = errorFor('cardNumber');
  const cardExpiryError = errorFor('cardExpiry');
  const cardCvcError = errorFor('cardCvc');
  const creditState = creditSummary?.state ?? null;
  const creditIsLoading = creditSummaryStatus === 'loading';
  const creditIsActive = creditSummaryStatus === 'loaded' && creditState === 'active';
  const creditHasBlockedState = creditState === 'on_hold' || creditState === 'suspended';
  const creditResultUnavailable =
    creditSummaryUnavailable ||
    creditSummaryStatus === 'unavailable' ||
    (creditSummaryStatus === 'loaded' && creditSummary === null) ||
    creditHasBlockedState;
  const creditOptionDisabled = !isAuthenticated || creditResultUnavailable;
  const creditSubmitDisabled =
    paymentMethod === 'trade_credit' && (!creditIsActive || creditSummaryError !== null);

  const creditUnavailableReason = !isAuthenticated
    ? t('checkout.paymentMethod.tradeCreditIneligible')
    : creditState === 'on_hold'
      ? t('checkout.paymentMethod.tradeCreditOnHold')
      : creditState === 'suspended'
        ? t('checkout.paymentMethod.tradeCreditSuspended')
        : creditSummaryUnavailable
          ? t('checkout.paymentMethod.tradeCreditIneligible')
          : t('checkout.paymentMethod.tradeCreditUnavailable');

  const creditStateLabel = creditState
    ? t(
        creditState === 'active'
          ? 'checkout.creditState.active'
          : creditState === 'on_hold'
            ? 'checkout.creditState.on_hold'
            : 'checkout.creditState.suspended',
      )
    : null;
  const creditTerms =
    creditSummary?.terms === 'net_30' ||
    creditSummary?.terms === 30 ||
    creditSummary?.termsDays === 30
      ? t('checkout.paymentMethod.tradeCreditTerms')
      : null;
  const creditFactLabel = (
    key:
      | 'checkout.credit.limit'
      | 'checkout.credit.outstanding'
      | 'checkout.credit.held'
      | 'checkout.credit.exposure'
      | 'checkout.credit.available',
  ) =>
    t(key, { money: '__credit_value__' }).replace('__credit_value__', '').trim().replace(/:$/, '');

  return (
    <section aria-labelledby="payment-step-title" className="space-y-4">
      <div>
        <h2 id="payment-step-title" className="text-lg font-semibold">
          {t('checkout.step.payment')}
        </h2>
        {paymentMethod === 'card' && (
          <p className="text-sm text-muted-foreground">{t('checkout.cardPageOnly')}</p>
        )}
      </div>
      <fieldset className="space-y-2 border-0 p-0">
        <legend className="text-sm font-medium">{t('checkout.paymentMethod.heading')}</legend>
        <div className="grid gap-2">
          <label
            htmlFor="payment-method-card"
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
              paymentMethod === 'card' ? 'border-primary bg-primary/5' : 'border-border'
            }`}
          >
            <input
              id="payment-method-card"
              type="radio"
              name="payment-method"
              value="card"
              checked={paymentMethod === 'card'}
              onChange={() => onPaymentMethodChange('card')}
              aria-label={t('checkout.paymentMethod.card')}
              aria-describedby="payment-method-card-description"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{t('checkout.paymentMethod.card')}</span>
              <span
                id="payment-method-card-description"
                className="block text-xs text-muted-foreground"
              >
                {t('checkout.paymentMethod.cardDescription')}
              </span>
            </span>
          </label>
          <label
            htmlFor="payment-method-trade-credit"
            className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${
              creditOptionDisabled
                ? 'cursor-not-allowed opacity-60'
                : paymentMethod === 'trade_credit'
                  ? 'cursor-pointer border-primary bg-primary/5'
                  : 'cursor-pointer border-border'
            }`}
          >
            <input
              id="payment-method-trade-credit"
              type="radio"
              name="payment-method"
              value="trade_credit"
              checked={paymentMethod === 'trade_credit'}
              onChange={() => onPaymentMethodChange('trade_credit')}
              disabled={creditOptionDisabled}
              aria-label={t('checkout.paymentMethod.tradeCredit')}
              aria-describedby={`payment-method-trade-credit-description${
                creditOptionDisabled ? ' payment-method-trade-credit-reason' : ''
              }`}
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium">
                {t('checkout.paymentMethod.tradeCredit')}
              </span>
              <span
                id="payment-method-trade-credit-description"
                className="block text-xs text-muted-foreground"
              >
                {t('checkout.paymentMethod.tradeCreditDescription')}
              </span>
              {!creditOptionDisabled && creditIsLoading && (
                <span role="status" className="mt-1 block text-xs text-muted-foreground">
                  {t('checkout.paymentMethod.tradeCreditLoading')}
                </span>
              )}
              {creditOptionDisabled && (
                <span
                  id="payment-method-trade-credit-reason"
                  className="mt-1 block text-xs text-destructive"
                >
                  {creditUnavailableReason}
                </span>
              )}
            </span>
          </label>
        </div>
      </fieldset>

      {creditSummaryStatus === 'error' && creditSummaryError && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          <span>{creditSummaryError}</span>
          <Button type="button" variant="outline" size="sm" onClick={onRetryCreditSummary}>
            {t('checkout.paymentMethod.retryTradeCredit')}
          </Button>
        </div>
      )}

      {paymentMethod === 'trade_credit' && creditSummary && (
        <section
          aria-labelledby="checkout-credit-summary-title"
          className="space-y-2 rounded-lg border border-border bg-muted/40 p-3"
          data-testid="checkout-credit-summary"
        >
          <h3 id="checkout-credit-summary-title" className="text-sm font-semibold">
            {t('checkout.creditSummary')}
          </h3>
          {creditStateLabel && (
            <p className="text-xs">
              <span className="text-muted-foreground">{t('checkout.creditSummary')}: </span>
              <span className="font-medium">{creditStateLabel}</span>
            </p>
          )}
          {creditTerms && <p className="text-xs font-medium">{creditTerms}</p>}
          <p className="text-xs text-muted-foreground">
            {t('checkout.paymentMethod.tradeCreditDue')}
          </p>
          <dl className="grid gap-1 text-xs sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">{creditFactLabel('checkout.credit.limit')}</dt>
              <dd className="font-medium">
                {formatSettlementMoney(creditSummary.creditLimitCents)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">
                {creditFactLabel('checkout.credit.outstanding')}
              </dt>
              <dd className="font-medium">
                {formatSettlementMoney(creditSummary.outstandingCents)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{creditFactLabel('checkout.credit.held')}</dt>
              <dd className="font-medium">{formatSettlementMoney(creditSummary.heldCents)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">
                {creditFactLabel('checkout.credit.exposure')}
              </dt>
              <dd className="font-medium">{formatSettlementMoney(creditSummary.exposureCents)}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="font-semibold">{creditFactLabel('checkout.credit.available')}</dt>
              <dd className="font-semibold">
                {formatSettlementMoney(creditSummary.availableCreditCents)}
              </dd>
            </div>
          </dl>
          {creditSummary.holdReason && creditHasBlockedState && (
            <p role="alert" className="text-xs text-destructive">
              {t('checkout.credit.reason', { reason: creditSummary.holdReason })}
            </p>
          )}
          {paymentMethod === 'trade_credit' && creditIsActive && (
            <p role="status" className="text-xs text-muted-foreground">
              {t('checkout.paymentMethod.tradeCreditNotice')}
            </p>
          )}
        </section>
      )}

      {paymentMethod === 'trade_credit' && creditSummaryStatus === 'loaded' && !creditSummary && (
        <p role="alert" className="text-sm text-destructive">
          {creditUnavailableReason}
        </p>
      )}

      {paymentMethod === 'card' && (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="cardNumber" className="text-sm font-medium">
              {t('checkout.cardNumber')}
            </label>
            <Input
              id="cardNumber"
              value={card.cardNumber}
              onChange={(event) => onChange('cardNumber', event.target.value)}
              onBlur={() => onBlur('cardNumber')}
              placeholder="4242 4242 4242 4242"
              autoComplete="cc-number"
              maxLength={25}
              aria-invalid={Boolean(cardNumberError)}
              aria-describedby={cardNumberError ? 'cardNumber-error' : undefined}
            />
            {cardNumberError && (
              <p id="cardNumber-error" role="alert" className="text-xs text-destructive">
                {cardNumberError}
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="cardExpiry" className="text-sm font-medium">
                {t('checkout.expiry')}
              </label>
              <Input
                id="cardExpiry"
                value={card.cardExpiry}
                onChange={(event) => onChange('cardExpiry', event.target.value)}
                onBlur={() => onBlur('cardExpiry')}
                placeholder="MM/YY"
                autoComplete="cc-exp"
                maxLength={5}
                aria-invalid={Boolean(cardExpiryError)}
                aria-describedby={cardExpiryError ? 'cardExpiry-error' : undefined}
              />
              {cardExpiryError && (
                <p id="cardExpiry-error" role="alert" className="text-xs text-destructive">
                  {cardExpiryError}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <label htmlFor="cardCvc" className="text-sm font-medium">
                {t('checkout.cvc')}
              </label>
              <Input
                id="cardCvc"
                value={card.cardCvc}
                onChange={(event) => onChange('cardCvc', event.target.value)}
                onBlur={() => onBlur('cardCvc')}
                placeholder="123"
                autoComplete="cc-csc"
                maxLength={4}
                aria-invalid={Boolean(cardCvcError)}
                aria-describedby={cardCvcError ? 'cardCvc-error' : undefined}
              />
              {cardCvcError && (
                <p id="cardCvc-error" role="alert" className="text-xs text-destructive">
                  {cardCvcError}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
      <div className="flex gap-3">
        <Button type="button" variant="outline" className="flex-1" onClick={onBack}>
          {t('checkout.backSchedule')}
        </Button>
        <Button
          type="button"
          className="flex-1"
          disabled={disabled || creditSubmitDisabled}
          onClick={onSubmit}
        >
          {submitting ? t('checkout.processingPayment') : t('checkout.simulatePayment')}
        </Button>
      </div>
    </section>
  );
}
