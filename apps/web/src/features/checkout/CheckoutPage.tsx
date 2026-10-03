import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ErrorMessage } from '@/components/ErrorMessage';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { useCartContext } from '@/hooks/CartContext';
import { CheckoutSummary } from './CheckoutSummary';
import { DeliveryStep } from './DeliveryStep';
import { PaymentDetailsStep } from './PaymentDetailsStep';
import { ScheduleBillingStep } from './ScheduleBillingStep';
import { useCheckoutFlow } from './useCheckoutFlow';
import { useLocalisation } from '@/i18n/LocaleContext';
import { checkoutMessages } from '@shop/localisation/messages/checkout';
import { localizeTradeCreditError } from './checkoutCopy';

export function CheckoutPage() {
  const { translate, formatCivilDate } = useLocalisation();
  const t = (key: keyof typeof checkoutMessages, params?: Record<string, string | number>) =>
    translate(checkoutMessages, key, params);
  const flow = useCheckoutFlow();
  const renderedPaymentError =
    flow.paymentMethod === 'trade_credit' && flow.paymentErrorState
      ? (localizeTradeCreditError(flow.paymentErrorState, translate) ?? flow.paymentError)
      : flow.paymentError;
  const {
    isInitializing: isCartInitializing,
    isLoading: isCartLoading,
    error: cartError,
    retryCart,
    isCartAvailable,
  } = useCartContext();

  if (isCartInitializing || isCartLoading) return <LoadingSpinner />;
  if (!flow.cart) {
    return (
      <ErrorMessage
        message={cartError ?? t('checkout.cartUnavailable')}
        onRetry={() => void retryCart()}
      />
    );
  }
  if (flow.cart.totalItems === 0) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 py-12 text-center">
        {flow.cartRecoveryMessage && (
          <p
            role="status"
            className="rounded-lg border border-border bg-muted/60 px-4 py-3 text-sm"
          >
            {flow.cartRecoveryMessage}
          </p>
        )}
        <p className="text-muted-foreground">{t('checkout.empty')}</p>
        <Button nativeButton={false} render={<Link to="/catalog" />}>
          {t('checkout.browseMaterials')}
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-2 text-2xl font-bold">{t('checkout.title')}</h1>
      <p className="mb-6 text-sm text-muted-foreground">{t('checkout.simulatedNotice')}</p>
      {cartError && (
        <div
          role="alert"
          className="mb-6 flex items-center justify-between gap-4 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3"
        >
          <p className="text-sm text-destructive">{cartError}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void retryCart()}>
            {t('checkout.retryCart')}
          </Button>
        </div>
      )}
      {flow.cartRecoveryMessage && (
        <p
          role="status"
          className="mb-6 rounded-lg border border-border bg-muted/60 px-4 py-3 text-sm text-foreground"
        >
          {flow.cartRecoveryMessage}
        </p>
      )}
      {flow.conflict?.code === 'INSUFFICIENT_STOCK' && (
        <div
          role="alert"
          className="mb-6 space-y-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
        >
          <p>{t('checkout.stockConflictTitle')}</p>
          <p className="text-muted-foreground">{t('checkout.stockConflictBody')}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void retryCart()}>
            {t('checkout.refreshCart')}
          </Button>
        </div>
      )}
      {flow.conflict?.code === 'RESERVATION_EXPIRED' && (
        <div
          role="alert"
          className="mb-6 space-y-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
        >
          <p>{t('checkout.reservationConflictTitle')}</p>
          <p className="text-muted-foreground">{t('checkout.reservationConflictBody')}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void retryCart()}>
            {t('checkout.refreshCart')}
          </Button>
        </div>
      )}
      {flow.conflict?.code === 'DELIVERY_SLOT_UNAVAILABLE' && (
        <div
          role="alert"
          className="mb-6 space-y-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
        >
          <p>{t('checkout.slotConflictTitle')}</p>
          <p className="text-muted-foreground">
            {t('checkout.slotConflictBody', {
              date: formatCivilDate(flow.conflict.earliestDate, 'long'),
            })}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={flow.goToScheduleStep}>
            {t('checkout.chooseAnotherSlot')}
          </Button>
        </div>
      )}
      {flow.conflict?.code === 'PENDING_APPROVAL' && (
        <div
          role="status"
          className="mb-6 space-y-3 rounded-lg border border-border bg-muted/60 p-4 text-sm"
        >
          <p>{t('checkout.pendingApprovalTitle')}</p>
          <p className="text-muted-foreground">{t('checkout.pendingApprovalBody')}</p>
          <Button nativeButton={false} size="sm" render={<Link to="/account/approvals" />}>
            {t('checkout.viewApprovalRequests')}
          </Button>
        </div>
      )}
      {flow.conflict?.code === 'APPROVAL_REJECTED' && (
        <p
          role="alert"
          className="mb-6 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
        >
          {t('checkout.approvalRejected')}
        </p>
      )}
      {flow.conflict?.code === 'APPROVAL_EXPIRED' && (
        <p
          role="alert"
          className="mb-6 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
        >
          {t('checkout.approvalExpired')}
        </p>
      )}
      {flow.conflict?.code === 'APPROVAL_TOTAL_DRIFT' && (
        <p
          role="alert"
          className="mb-6 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
        >
          {t('checkout.approvalTotalDrift')}
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardContent className="pt-6">
            {flow.step === 'delivery' && (
              <DeliveryStep
                contact={flow.contact}
                delivery={flow.delivery}
                savedSites={flow.savedSites}
                savedSitesLoading={flow.savedSitesLoading}
                savedSitesError={flow.savedSitesError}
                onReloadSavedSites={flow.reloadSavedSites}
                canUseSavedSites={flow.isAuthenticated}
                fieldError={flow.fieldError}
                addressErrors={flow.deliveryAddressErrors}
                onContactChange={flow.updateContact}
                onDeliveryChange={flow.updateDelivery}
                onBlur={flow.touchField}
                onContinue={flow.goToSchedule}
                disabled={flow.promoValidating || !isCartAvailable}
              />
            )}
            {flow.step === 'schedule' && (
              <ScheduleBillingStep
                schedule={flow.schedule}
                billing={flow.billing}
                slotOptions={flow.slotOptions}
                slotsLoading={flow.slotsLoading}
                slotsError={flow.slotsError}
                onReloadSlots={flow.reloadSlots}
                billingEntities={flow.savedBillingEntities}
                billingEntitiesLoading={flow.savedBillingEntitiesLoading}
                billingEntitiesError={flow.savedBillingEntitiesError}
                onReloadBillingEntities={flow.reloadSavedBillingEntities}
                canUseSavedBillingEntities={flow.isAuthenticated}
                fieldError={flow.fieldError}
                addressErrors={flow.billingAddressErrors}
                onSlotChange={flow.updateSchedule}
                onBillingChange={flow.updateBilling}
                onBlur={flow.touchField}
                onBack={flow.goToDelivery}
                onContinue={flow.goToPayment}
                disabled={flow.promoValidating || !isCartAvailable}
              />
            )}
            {flow.step === 'payment' && (
              <PaymentDetailsStep
                paymentMethod={flow.paymentMethod}
                onPaymentMethodChange={flow.updatePaymentMethod}
                isAuthenticated={flow.isAuthenticated}
                creditSummary={flow.creditSummary}
                creditSummaryStatus={flow.creditSummaryStatus}
                creditSummaryError={flow.creditSummaryError}
                creditSummaryUnavailable={flow.creditSummaryUnavailable}
                onRetryCreditSummary={flow.retryCreditSummary}
                card={flow.card}
                fieldError={flow.fieldError}
                onChange={flow.updateCard}
                onBlur={flow.touchField}
                onBack={flow.goToScheduleStep}
                onSubmit={() => void flow.submitPayment()}
                submitting={flow.submitting}
                disabled={flow.submitting || !isCartAvailable}
              />
            )}
            {renderedPaymentError && (
              <p
                role="alert"
                className="mt-4 rounded-md bg-destructive/5 p-3 text-sm text-destructive"
              >
                {renderedPaymentError}
              </p>
            )}
          </CardContent>
        </Card>
        <CheckoutSummary
          cart={flow.cart}
          promoCode={flow.promoCode}
          appliedPromo={flow.appliedPromo}
          discountCents={flow.discountCents}
          discountBaseCents={flow.discountBaseCents}
          promoCategoryScope={flow.promoCategoryScope}
          totalCents={flow.totalCents}
          promoError={flow.promoError}
          promoErrorCode={flow.promoErrorCode}
          promoMinSubtotalCents={flow.promoMinSubtotalCents}
          promoValidating={flow.promoValidating}
          isPromoEligible={flow.isPromoEligible}
          destinationSummary={flow.destinationSummary}
          billingSummary={flow.billingSummary}
          deliverySlot={flow.schedule.slot}
          purchaseOrderReference={flow.purchaseOrderReference}
          onPromoChange={flow.updatePromoCode}
          onApplyPromo={() => void flow.applyPromo()}
          onRemovePromo={flow.removePromo}
        />
      </div>
    </div>
  );
}
