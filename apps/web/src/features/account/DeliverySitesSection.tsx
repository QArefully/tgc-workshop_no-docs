import { useState } from 'react';
import { formatPostalAddress } from '@shop/contracts/address';
import type {
  CreateDeliverySiteBody,
  DeliverySite,
  UpdateDeliverySiteBody,
} from '@shop/contracts/trade-account';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MapPin } from 'lucide-react';
import {
  EMPTY_POSTAL_ADDRESS_DRAFT,
  PostalAddressFields,
  toPostalAddressDraft,
  validatePostalAddressDraft,
  type PostalAddressDraft,
  type PostalAddressFieldErrors,
} from './PostalAddressFields';
import { TradeCheckbox, TradeListStatus, TradeTextField } from './TradeFormFields';
import { useLocalisation } from '@/i18n/LocaleContext';
import { identityAccountMessages } from '@shop/localisation/messages/identityAccount';
import {
  localizeAccountError,
  localizeValidationErrors,
  localizeValidationMessage,
} from './accountError';
import {
  TRADE_FIELD_BOUNDS,
  CONTACT_PHONE_BOUNDS,
  checkContactPhone,
  checkRequiredTradeText,
} from './tradeFieldValidation';
import type { UseTradeProfileResult } from './useTradeProfile';

/**
 * `Delivery sites` account section — the buyer's saved trade destinations.
 * Create, edit, set default, and retire. The server stays authoritative: this section only ever
 * sends the identifier plus edited fields and re-reads the list afterwards.
 */

interface SiteDraft {
  label: string;
  contactName: string;
  contactPhone: string;
  address: PostalAddressDraft;
  isDefault: boolean;
}

interface SiteDraftErrors {
  label?: string;
  contactName?: string;
  contactPhone?: string;
  address?: PostalAddressFieldErrors;
}

const EMPTY_SITE_DRAFT: SiteDraft = {
  label: '',
  contactName: '',
  contactPhone: '',
  address: EMPTY_POSTAL_ADDRESS_DRAFT,
  isDefault: false,
};

function draftFromSite(site: DeliverySite): SiteDraft {
  return {
    label: site.label,
    contactName: site.contactName,
    contactPhone: site.contactPhone ?? '',
    address: toPostalAddressDraft(site.address),
    isDefault: site.isDefault,
  };
}

type SiteValidation =
  { ok: true; body: CreateDeliverySiteBody } | { ok: false; errors: SiteDraftErrors };

function validateSiteDraft(draft: SiteDraft): SiteValidation {
  const errors: SiteDraftErrors = {};
  const labelError = checkRequiredTradeText(draft.label, 'Site name', TRADE_FIELD_BOUNDS.label);
  if (labelError) errors.label = labelError;
  const contactNameError = checkRequiredTradeText(
    draft.contactName,
    'Contact name',
    TRADE_FIELD_BOUNDS.contactName,
  );
  if (contactNameError) errors.contactName = contactNameError;
  const phoneError = checkContactPhone(draft.contactPhone);
  if (phoneError) errors.contactPhone = phoneError;

  const address = validatePostalAddressDraft(draft.address);
  if (!address.ok) errors.address = address.errors;

  if (Object.keys(errors).length > 0 || !address.ok) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    body: {
      label: draft.label.trim(),
      contactName: draft.contactName.trim(),
      contactPhone: draft.contactPhone.trim(),
      address: address.address,
      isDefault: draft.isDefault,
    },
  };
}

interface SiteFormProps {
  idPrefix: string;
  initialDraft: SiteDraft;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (body: CreateDeliverySiteBody) => Promise<void>;
}

function DeliverySiteForm({
  idPrefix,
  initialDraft,
  submitLabel,
  onCancel,
  onSubmit,
}: SiteFormProps) {
  const { translate } = useLocalisation();
  const [draft, setDraft] = useState<SiteDraft>(initialDraft);
  const [errors, setErrors] = useState<SiteDraftErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitError(null);
    const result = validateSiteDraft(draft);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      await onSubmit(result.body);
    } catch (error) {
      setSubmitError(localizeAccountError(error, translate, 'account.common.saveError'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className="space-y-4 rounded-lg bg-muted/40 p-4"
    >
      {submitError && (
        <p role="alert" className="text-sm text-destructive">
          {submitError}
        </p>
      )}
      <TradeTextField
        id={`${idPrefix}-label`}
        label={translate(identityAccountMessages, 'account.trade.siteName')}
        value={draft.label}
        onChange={(label) => setDraft({ ...draft, label })}
        error={localizeValidationMessage(errors.label, translate, translate)}
        maxLength={TRADE_FIELD_BOUNDS.label}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <TradeTextField
          id={`${idPrefix}-contactName`}
          label={translate(identityAccountMessages, 'account.trade.contactName')}
          value={draft.contactName}
          onChange={(contactName) => setDraft({ ...draft, contactName })}
          error={localizeValidationMessage(errors.contactName, translate, translate)}
          maxLength={TRADE_FIELD_BOUNDS.contactName}
          autoComplete="name"
        />
        <TradeTextField
          id={`${idPrefix}-contactPhone`}
          label={translate(identityAccountMessages, 'account.trade.contactPhone')}
          value={draft.contactPhone}
          onChange={(contactPhone) => setDraft({ ...draft, contactPhone })}
          error={localizeValidationMessage(errors.contactPhone, translate, translate)}
          maxLength={CONTACT_PHONE_BOUNDS.max}
          autoComplete="tel"
          inputMode="tel"
        />
      </div>
      <PostalAddressFields
        idPrefix={idPrefix}
        legend={translate(identityAccountMessages, 'account.delivery.addressLegend')}
        value={draft.address}
        errors={localizeValidationErrors(errors.address, translate, translate)}
        onChange={(address) => setDraft({ ...draft, address })}
      />
      <TradeCheckbox
        id={`${idPrefix}-isDefault`}
        label={translate(identityAccountMessages, 'account.delivery.defaultCheckbox')}
        checked={draft.isDefault}
        onChange={(isDefault) => setDraft({ ...draft, isDefault })}
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={submitting}>
          {submitting ? translate(identityAccountMessages, 'account.common.saving') : submitLabel}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel} disabled={submitting}>
          {translate(identityAccountMessages, 'account.common.cancel')}
        </Button>
      </div>
    </form>
  );
}

interface DeliverySitesSectionProps {
  profile: UseTradeProfileResult;
}

export function DeliverySitesSection({ profile }: DeliverySitesSectionProps) {
  const { translate } = useLocalisation();
  const { deliverySites } = profile;
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const activeSites = deliverySites.items.filter((site) => site.active);

  async function runRowAction(siteId: string, action: () => Promise<void>) {
    setRowError(null);
    setBusyId(siteId);
    try {
      await action();
    } catch (error) {
      setRowError(localizeAccountError(error, translate, 'account.common.actionFailed'));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section aria-labelledby="delivery-sites-heading" className="mt-6 rounded-lg border p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="delivery-sites-heading" className="flex items-center gap-2 text-base font-medium">
            <MapPin className="h-4 w-4 text-muted-foreground" />
            {translate(identityAccountMessages, 'account.delivery.title')}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {translate(identityAccountMessages, 'account.delivery.description')}
          </p>
        </div>
        {!adding && (
          <Button type="button" size="sm" onClick={() => setAdding(true)}>
            {translate(identityAccountMessages, 'account.delivery.add')}
          </Button>
        )}
      </div>

      {adding && (
        <div className="mt-4">
          <DeliverySiteForm
            idPrefix="new-site"
            initialDraft={EMPTY_SITE_DRAFT}
            submitLabel={translate(identityAccountMessages, 'account.delivery.save')}
            onCancel={() => setAdding(false)}
            onSubmit={async (body) => {
              await profile.addDeliverySite(body);
              setAdding(false);
            }}
          />
        </div>
      )}

      <TradeListStatus
        loading={deliverySites.loading}
        error={deliverySites.error}
        onRetry={profile.reloadDeliverySites}
        isEmpty={activeSites.length === 0}
        loadingLabel={translate(identityAccountMessages, 'account.delivery.loading')}
        emptyLabel={translate(identityAccountMessages, 'account.delivery.empty')}
      />

      {rowError && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {rowError}
        </p>
      )}

      <ul className="mt-4 space-y-3">
        {activeSites.map((site) => (
          <li key={site.id} className="rounded-lg border p-4">
            {editingId === site.id ? (
              <DeliverySiteForm
                idPrefix={`site-${site.id}`}
                initialDraft={draftFromSite(site)}
                submitLabel={translate(identityAccountMessages, 'account.common.save')}
                onCancel={() => setEditingId(null)}
                onSubmit={async (body) => {
                  const patch: UpdateDeliverySiteBody = body;
                  await profile.editDeliverySite(site.id, patch);
                  setEditingId(null);
                }}
              />
            ) : (
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{site.label}</span>
                    {site.isDefault && (
                      <Badge variant="secondary">
                        {translate(identityAccountMessages, 'account.delivery.default')}
                      </Badge>
                    )}
                  </div>
                  {/* An absent phone renders nothing at all — no dangling separator, no empty label. */}
                  <p className="mt-1 text-sm text-muted-foreground">
                    {site.contactPhone
                      ? `${site.contactName} · ${site.contactPhone}`
                      : site.contactName}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {formatPostalAddress(site.address)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!site.isDefault && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busyId === site.id}
                      onClick={() =>
                        void runRowAction(site.id, () => profile.setDefaultDeliverySite(site.id))
                      }
                    >
                      {translate(identityAccountMessages, 'account.delivery.setDefault')}
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setEditingId(site.id)}
                  >
                    {translate(identityAccountMessages, 'account.delivery.edit', {
                      name: site.label,
                    })}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busyId === site.id}
                    onClick={() => void runRowAction(site.id, () => profile.retireSite(site.id))}
                  >
                    {translate(identityAccountMessages, 'account.delivery.remove', {
                      name: site.label,
                    })}
                  </Button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
