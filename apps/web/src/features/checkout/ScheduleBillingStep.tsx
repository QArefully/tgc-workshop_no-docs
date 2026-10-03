import type { DeliverySlot, DeliverySlotOptionsResponse } from '@shop/contracts/delivery';
import type { BillingEntity } from '@shop/contracts/trade-account';
import { formatPostalAddress } from '@shop/contracts/address';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  PostalAddressFields,
  type PostalAddressDraft,
  type PostalAddressFieldErrors,
} from '@/features/account/PostalAddressFields';
import { useLocalisation } from '@/i18n/LocaleContext';
import { checkoutMessages } from '@shop/localisation/messages/checkout';
import { translateValidationError } from './checkoutCopy';
import { slotKey, type CheckoutBilling, type CheckoutSchedule, type Field } from './checkoutState';

interface ScheduleBillingStepProps {
  schedule: CheckoutSchedule;
  billing: CheckoutBilling;
  slotOptions: DeliverySlotOptionsResponse | null;
  slotsLoading: boolean;
  slotsError: string | null;
  onReloadSlots: () => void;
  billingEntities: BillingEntity[];
  billingEntitiesLoading: boolean;
  billingEntitiesError: string | null;
  onReloadBillingEntities: () => void;
  canUseSavedBillingEntities: boolean;
  fieldError: (field: Field) => string | undefined;
  addressErrors: PostalAddressFieldErrors;
  onSlotChange: (slot: DeliverySlot | null) => void;
  onBillingChange: (patch: Partial<CheckoutBilling>) => void;
  onBlur: (field: Field) => void;
  onBack: () => void;
  onContinue: () => void;
  disabled: boolean;
}

export function ScheduleBillingStep({
  schedule,
  billing,
  slotOptions,
  slotsLoading,
  slotsError,
  onReloadSlots,
  billingEntities,
  billingEntitiesLoading,
  billingEntitiesError,
  onReloadBillingEntities,
  canUseSavedBillingEntities,
  fieldError,
  addressErrors,
  onSlotChange,
  onBillingChange,
  onBlur,
  onBack,
  onContinue,
  disabled,
}: ScheduleBillingStepProps) {
  const { translate, formatCivilDate } = useLocalisation();
  const t = (key: keyof typeof checkoutMessages, params?: Record<string, string | number>) =>
    translate(checkoutMessages, key, params);
  const errorFor = (field: Field) => {
    const error = fieldError(field);
    return error ? translateValidationError(error, t) : undefined;
  };
  const slotError = errorFor('deliverySlot');
  const entityError = errorFor('billingEntityId');
  const legalNameError = errorFor('billingLegalName');
  const registrationError = errorFor('billingRegistrationNumber');
  const vatError = errorFor('billingVatNumber');
  const purchaseOrderError = errorFor('purchaseOrderReference');
  const selectedSlotKey = schedule.slot ? slotKey(schedule.slot) : null;
  const showSavedEntities = canUseSavedBillingEntities && billingEntities.length > 0;
  const leadTimeReason = slotOptions
    ? slotOptions.delivery.mode === 'freight'
      ? t('checkout.freightReason', { days: slotOptions.leadTime.businessDays })
      : t('checkout.parcelReason')
    : null;

  return (
    <section aria-labelledby="schedule-step-title" className="space-y-6">
      <div>
        <h2 id="schedule-step-title" className="text-lg font-semibold">
          {t('checkout.step.schedule')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('checkout.stepLabel', { step: 2 })}</p>
      </div>

      <fieldset className="space-y-2 border-0 p-0">
        <legend className="text-sm font-medium">{t('checkout.deliverySlot')}</legend>
        {leadTimeReason && (
          <p className="text-sm text-muted-foreground" data-testid="lead-time-reason">
            {leadTimeReason}
          </p>
        )}
        {slotsLoading && (
          <p className="text-sm text-muted-foreground">{t('checkout.loadingDeliverySlots')}</p>
        )}
        {slotsError && (
          <div
            role="alert"
            className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          >
            <span>{slotsError}</span>
            <Button type="button" variant="outline" size="sm" onClick={onReloadSlots}>
              {t('checkout.retryDeliverySlots')}
            </Button>
          </div>
        )}
        {slotOptions && slotOptions.slots.length === 0 && !slotsLoading && (
          <p className="text-sm text-muted-foreground">{t('checkout.noDeliverySlots')}</p>
        )}
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {slotOptions?.slots.map((slot) => {
            const key = slotKey(slot);
            const inputId = `delivery-slot-${key}`;
            return (
              <div key={key} className="flex items-center gap-2">
                <input
                  id={inputId}
                  type="radio"
                  name="delivery-slot"
                  value={key}
                  checked={selectedSlotKey === key}
                  onChange={() => onSlotChange(slot)}
                  onBlur={() => onBlur('deliverySlot')}
                />
                <label htmlFor={inputId} className="text-sm">
                  {formatCivilDate(slot.date, 'long')} ·{' '}
                  {t(slot.window === 'am' ? 'checkout.slotMorning' : 'checkout.slotAfternoon')}
                </label>
              </div>
            );
          })}
        </div>
        {slotError && (
          <p role="alert" className="text-xs text-destructive">
            {slotError}
          </p>
        )}
      </fieldset>

      <fieldset className="space-y-3 border-0 p-0">
        <legend className="text-sm font-medium">{t('checkout.billingDetails')}</legend>
        {canUseSavedBillingEntities && billingEntitiesLoading && (
          <p className="text-sm text-muted-foreground">{t('checkout.loadingBilling')}</p>
        )}
        {canUseSavedBillingEntities && billingEntitiesError && (
          <div
            role="alert"
            className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          >
            <span>{billingEntitiesError}</span>
            <Button type="button" variant="outline" size="sm" onClick={onReloadBillingEntities}>
              {t('checkout.retryBilling')}
            </Button>
          </div>
        )}
        {showSavedEntities && (
          <div className="space-y-2">
            {billingEntities.map((entity) => {
              const inputId = `billing-entity-${entity.id}`;
              return (
                <div key={entity.id} className="flex items-start gap-2">
                  <input
                    id={inputId}
                    type="radio"
                    name="billing-selection"
                    className="mt-1"
                    value={entity.id}
                    checked={
                      billing.selectionKind === 'saved' && billing.billingEntityId === entity.id
                    }
                    onChange={() =>
                      onBillingChange({ selectionKind: 'saved', billingEntityId: entity.id })
                    }
                    onBlur={() => onBlur('billingEntityId')}
                  />
                  <label htmlFor={inputId} className="text-sm">
                    <span className="font-medium">{entity.legalName}</span>
                    {entity.isDefault && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {t('checkout.default')}
                      </span>
                    )}
                    <span className="block text-xs text-muted-foreground">
                      {formatPostalAddress(entity.address)}
                    </span>
                  </label>
                </div>
              );
            })}
            <div className="flex items-start gap-2">
              <input
                id="billing-entity-adhoc"
                type="radio"
                name="billing-selection"
                className="mt-1"
                checked={billing.selectionKind === 'adhoc'}
                onChange={() => onBillingChange({ selectionKind: 'adhoc', billingEntityId: '' })}
                onBlur={() => onBlur('billingEntityId')}
              />
              <label htmlFor="billing-entity-adhoc" className="text-sm font-medium">
                {t('checkout.differentBilling')}
              </label>
            </div>
            {entityError && (
              <p role="alert" className="text-xs text-destructive">
                {entityError}
              </p>
            )}
          </div>
        )}

        {billing.selectionKind === 'adhoc' && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label htmlFor="billingLegalName" className="text-sm font-medium">
                {t('checkout.legalName')}
              </label>
              <Input
                id="billingLegalName"
                value={billing.legalName}
                maxLength={120}
                onChange={(event) => onBillingChange({ legalName: event.target.value })}
                onBlur={() => onBlur('billingLegalName')}
                autoComplete="organization"
                aria-invalid={Boolean(legalNameError)}
                aria-describedby={legalNameError ? 'billingLegalName-error' : undefined}
              />
              {legalNameError && (
                <p id="billingLegalName-error" role="alert" className="text-xs text-destructive">
                  {legalNameError}
                </p>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="billingRegistrationNumber" className="text-sm font-medium">
                  {t('checkout.registrationNumber')}
                  <span className="ml-1 font-normal text-muted-foreground">
                    {t('checkout.optional')}
                  </span>
                </label>
                <Input
                  id="billingRegistrationNumber"
                  value={billing.registrationNumber}
                  maxLength={40}
                  onChange={(event) => onBillingChange({ registrationNumber: event.target.value })}
                  onBlur={() => onBlur('billingRegistrationNumber')}
                  aria-invalid={Boolean(registrationError)}
                  aria-describedby={
                    registrationError ? 'billingRegistrationNumber-error' : undefined
                  }
                />
                {registrationError && (
                  <p
                    id="billingRegistrationNumber-error"
                    role="alert"
                    className="text-xs text-destructive"
                  >
                    {registrationError}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <label htmlFor="billingVatNumber" className="text-sm font-medium">
                  {t('checkout.vatNumber')}
                  <span className="ml-1 font-normal text-muted-foreground">
                    {t('checkout.optional')}
                  </span>
                </label>
                <Input
                  id="billingVatNumber"
                  value={billing.vatNumber}
                  maxLength={40}
                  onChange={(event) => onBillingChange({ vatNumber: event.target.value })}
                  onBlur={() => onBlur('billingVatNumber')}
                  aria-invalid={Boolean(vatError)}
                  aria-describedby={vatError ? 'billingVatNumber-error' : undefined}
                />
                {vatError && (
                  <p id="billingVatNumber-error" role="alert" className="text-xs text-destructive">
                    {vatError}
                  </p>
                )}
              </div>
            </div>
            <PostalAddressFields
              idPrefix="checkout-billing"
              legend={t('checkout.billingAddress')}
              value={billing.address}
              errors={addressErrors}
              onChange={(address: PostalAddressDraft) => onBillingChange({ address })}
              disabled={disabled}
            />
          </div>
        )}
      </fieldset>

      <div className="space-y-1.5">
        <label htmlFor="purchaseOrderReference" className="text-sm font-medium">
          {t('checkout.purchaseOrderReference')}
          <span className="ml-1 font-normal text-muted-foreground">{t('checkout.optional')}</span>
        </label>
        <Input
          id="purchaseOrderReference"
          value={billing.purchaseOrderReference}
          maxLength={64}
          onChange={(event) => onBillingChange({ purchaseOrderReference: event.target.value })}
          onBlur={() => onBlur('purchaseOrderReference')}
          aria-invalid={Boolean(purchaseOrderError)}
          aria-describedby={purchaseOrderError ? 'purchaseOrderReference-error' : undefined}
        />
        {purchaseOrderError && (
          <p id="purchaseOrderReference-error" role="alert" className="text-xs text-destructive">
            {purchaseOrderError}
          </p>
        )}
      </div>

      <div className="flex gap-3">
        <Button type="button" variant="outline" className="flex-1" onClick={onBack}>
          {t('checkout.backDelivery')}
        </Button>
        <Button type="button" className="flex-1" disabled={disabled} onClick={onContinue}>
          {t('checkout.continuePayment')}
        </Button>
      </div>
    </section>
  );
}
