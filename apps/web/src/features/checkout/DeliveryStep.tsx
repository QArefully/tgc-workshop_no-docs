import type { DeliverySite } from '@shop/contracts/trade-account';
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
import type { CheckoutDelivery, ContactField, Field } from './checkoutState';

interface DeliveryStepProps {
  contact: Record<ContactField, string>;
  delivery: CheckoutDelivery;
  /** Saved sites are offered to signed-in buyers only; anonymous buyers get the ad-hoc form. */
  savedSites: DeliverySite[];
  savedSitesLoading: boolean;
  savedSitesError: string | null;
  onReloadSavedSites: () => void;
  canUseSavedSites: boolean;
  fieldError: (field: Field) => string | undefined;
  addressErrors: PostalAddressFieldErrors;
  onContactChange: (field: ContactField, value: string) => void;
  onDeliveryChange: (patch: Partial<CheckoutDelivery>) => void;
  onBlur: (field: Field) => void;
  onContinue: () => void;
  disabled: boolean;
}
const contactInputs: Array<{
  id: ContactField;
  labelKey: 'checkout.fullName' | 'checkout.email';
  type?: 'email';
  autoComplete: string;
}> = [
  { id: 'customerName', labelKey: 'checkout.fullName', autoComplete: 'name' },
  { id: 'customerEmail', labelKey: 'checkout.email', type: 'email', autoComplete: 'email' },
];

export function DeliveryStep({
  contact,
  delivery,
  savedSites,
  savedSitesLoading,
  savedSitesError,
  onReloadSavedSites,
  canUseSavedSites,
  fieldError,
  addressErrors,
  onContactChange,
  onDeliveryChange,
  onBlur,
  onContinue,
  disabled,
}: DeliveryStepProps) {
  const { translate } = useLocalisation();
  const t = (key: keyof typeof checkoutMessages, params?: Record<string, string | number>) =>
    translate(checkoutMessages, key, params);
  const errorFor = (field: Field) => {
    const error = fieldError(field);
    return error ? translateValidationError(error, t) : undefined;
  };
  const siteError = errorFor('deliverySiteId');
  const showSavedSites = canUseSavedSites && savedSites.length > 0;

  return (
    <section aria-labelledby="delivery-step-title" className="space-y-5">
      <div>
        <h2 id="delivery-step-title" className="text-lg font-semibold">
          {t('checkout.step.delivery')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('checkout.stepLabel', { step: 1 })}</p>
      </div>

      {contactInputs.map((field) => {
        const error = errorFor(field.id);
        return (
          <div key={field.id} className="space-y-1.5">
            <label htmlFor={field.id} className="text-sm font-medium">
              {t(field.labelKey)}
            </label>
            <Input
              id={field.id}
              type={field.type}
              value={contact[field.id]}
              onChange={(event) => onContactChange(field.id, event.target.value)}
              onBlur={() => onBlur(field.id)}
              autoComplete={field.autoComplete}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? `${field.id}-error` : undefined}
            />
            {error && (
              <p id={`${field.id}-error`} role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
          </div>
        );
      })}

      {canUseSavedSites && savedSitesLoading && (
        <p className="text-sm text-muted-foreground">{t('checkout.loadingDeliverySites')}</p>
      )}
      {canUseSavedSites && savedSitesError && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          <span>{savedSitesError}</span>
          <Button type="button" variant="outline" size="sm" onClick={onReloadSavedSites}>
            {t('checkout.retryDeliverySites')}
          </Button>
        </div>
      )}

      {showSavedSites && (
        <fieldset className="space-y-2 border-0 p-0">
          <legend className="text-sm font-medium">{t('checkout.deliverySite')}</legend>
          {savedSites.map((site) => {
            const inputId = `delivery-site-${site.id}`;
            return (
              <div key={site.id} className="flex items-start gap-2">
                <input
                  id={inputId}
                  type="radio"
                  name="delivery-destination"
                  className="mt-1"
                  value={site.id}
                  checked={
                    delivery.destinationKind === 'saved' && delivery.deliverySiteId === site.id
                  }
                  onChange={() =>
                    onDeliveryChange({ destinationKind: 'saved', deliverySiteId: site.id })
                  }
                  onBlur={() => onBlur('deliverySiteId')}
                />
                <label htmlFor={inputId} className="text-sm">
                  <span className="font-medium">{site.label}</span>
                  {site.isDefault && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {t('checkout.default')}
                    </span>
                  )}
                  <span className="block text-xs text-muted-foreground">
                    {formatPostalAddress(site.address)}
                  </span>
                </label>
              </div>
            );
          })}
          <div className="flex items-start gap-2">
            <input
              id="delivery-site-adhoc"
              type="radio"
              name="delivery-destination"
              className="mt-1"
              checked={delivery.destinationKind === 'adhoc'}
              onChange={() => onDeliveryChange({ destinationKind: 'adhoc', deliverySiteId: '' })}
              onBlur={() => onBlur('deliverySiteId')}
            />
            <label htmlFor="delivery-site-adhoc" className="text-sm font-medium">
              {t('checkout.differentAddress')}
            </label>
          </div>
          {siteError && (
            <p id="deliverySiteId-error" role="alert" className="text-xs text-destructive">
              {siteError}
            </p>
          )}
        </fieldset>
      )}

      {delivery.destinationKind === 'adhoc' && (
        <PostalAddressFields
          idPrefix="checkout-delivery"
          legend={t('checkout.deliveryAddress')}
          value={delivery.address}
          errors={addressErrors}
          onChange={(address: PostalAddressDraft) => onDeliveryChange({ address })}
          disabled={disabled}
        />
      )}

      <Button type="button" size="lg" className="w-full" disabled={disabled} onClick={onContinue}>
        {t('checkout.continueSchedule')}
      </Button>
    </section>
  );
}
