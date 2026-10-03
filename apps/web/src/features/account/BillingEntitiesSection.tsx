import { useState } from 'react';
import { formatPostalAddress } from '@shop/contracts/address';
import type {
  BillingEntity,
  CreateBillingEntityBody,
  UpdateBillingEntityBody,
} from '@shop/contracts/trade-account';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Building2 } from 'lucide-react';
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
  checkOptionalTradeText,
  checkRequiredTradeText,
} from './tradeFieldValidation';
import type { UseTradeProfileResult } from './useTradeProfile';

/**
 * `Billing details` account section — the buyer's saved invoice parties.
 * Create, edit, set default, and retire. Mirrors `DeliverySitesSection` so the two trade
 * collections behave identically; the server stays authoritative for defaults and retirement.
 */

interface EntityDraft {
  legalName: string;
  registrationNumber: string;
  vatNumber: string;
  address: PostalAddressDraft;
  isDefault: boolean;
}

interface EntityDraftErrors {
  legalName?: string;
  registrationNumber?: string;
  vatNumber?: string;
  address?: PostalAddressFieldErrors;
}

const EMPTY_ENTITY_DRAFT: EntityDraft = {
  legalName: '',
  registrationNumber: '',
  vatNumber: '',
  address: EMPTY_POSTAL_ADDRESS_DRAFT,
  isDefault: false,
};

function draftFromEntity(entity: BillingEntity): EntityDraft {
  return {
    legalName: entity.legalName,
    registrationNumber: entity.registrationNumber ?? '',
    vatNumber: entity.vatNumber ?? '',
    address: toPostalAddressDraft(entity.address),
    isDefault: entity.isDefault,
  };
}

type EntityValidation =
  { ok: true; body: CreateBillingEntityBody } | { ok: false; errors: EntityDraftErrors };

/**
 * Validates a draft and builds the request body. Blank optional identifiers are omitted rather
 * than sent as empty strings, which the contract rejects.
 */
function validateEntityDraft(draft: EntityDraft): EntityValidation {
  const errors: EntityDraftErrors = {};
  const legalNameError = checkRequiredTradeText(
    draft.legalName,
    'Registered company name',
    TRADE_FIELD_BOUNDS.legalName,
  );
  if (legalNameError) errors.legalName = legalNameError;
  const registrationError = checkOptionalTradeText(
    draft.registrationNumber,
    'Company registration number',
    TRADE_FIELD_BOUNDS.registrationNumber,
  );
  if (registrationError) errors.registrationNumber = registrationError;
  const vatError = checkOptionalTradeText(
    draft.vatNumber,
    'VAT number',
    TRADE_FIELD_BOUNDS.vatNumber,
  );
  if (vatError) errors.vatNumber = vatError;

  const address = validatePostalAddressDraft(draft.address);
  if (!address.ok) errors.address = address.errors;

  if (Object.keys(errors).length > 0 || !address.ok) {
    return { ok: false, errors };
  }

  const body: CreateBillingEntityBody = {
    legalName: draft.legalName.trim(),
    address: address.address,
    isDefault: draft.isDefault,
  };
  const registrationNumber = draft.registrationNumber.trim();
  if (registrationNumber) body.registrationNumber = registrationNumber;
  const vatNumber = draft.vatNumber.trim();
  if (vatNumber) body.vatNumber = vatNumber;
  return { ok: true, body };
}

/**
 * Create body -> edit patch. The edit form always renders both identifier fields prefilled from the
 * saved entity, so an identifier missing from the validated body means the buyer cleared it. Sending
 * explicit `null` clears the stored value; omitting it would read as "no change" on the server and
 * the cleared field would silently survive while the form reported success.
 */
function toUpdateBody(body: CreateBillingEntityBody): UpdateBillingEntityBody {
  return {
    ...body,
    registrationNumber: body.registrationNumber ?? null,
    vatNumber: body.vatNumber ?? null,
  };
}

interface EntityFormProps {
  idPrefix: string;
  initialDraft: EntityDraft;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (body: CreateBillingEntityBody) => Promise<void>;
}

function BillingEntityForm({
  idPrefix,
  initialDraft,
  submitLabel,
  onCancel,
  onSubmit,
}: EntityFormProps) {
  const { translate } = useLocalisation();
  const [draft, setDraft] = useState<EntityDraft>(initialDraft);
  const [errors, setErrors] = useState<EntityDraftErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitError(null);
    const result = validateEntityDraft(draft);
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
        id={`${idPrefix}-legalName`}
        label={translate(identityAccountMessages, 'account.trade.registeredCompanyName')}
        value={draft.legalName}
        onChange={(legalName) => setDraft({ ...draft, legalName })}
        error={localizeValidationMessage(errors.legalName, translate, translate)}
        maxLength={TRADE_FIELD_BOUNDS.legalName}
        autoComplete="organization"
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <TradeTextField
          id={`${idPrefix}-registrationNumber`}
          label={translate(identityAccountMessages, 'account.trade.registrationNumber')}
          value={draft.registrationNumber}
          onChange={(registrationNumber) => setDraft({ ...draft, registrationNumber })}
          error={localizeValidationMessage(errors.registrationNumber, translate, translate)}
          maxLength={TRADE_FIELD_BOUNDS.registrationNumber}
          optional
        />
        <TradeTextField
          id={`${idPrefix}-vatNumber`}
          label={translate(identityAccountMessages, 'account.trade.vatNumber')}
          value={draft.vatNumber}
          onChange={(vatNumber) => setDraft({ ...draft, vatNumber })}
          error={localizeValidationMessage(errors.vatNumber, translate, translate)}
          maxLength={TRADE_FIELD_BOUNDS.vatNumber}
          optional
        />
      </div>
      <PostalAddressFields
        idPrefix={idPrefix}
        legend={translate(identityAccountMessages, 'account.billing.addressLegend')}
        value={draft.address}
        errors={localizeValidationErrors(errors.address, translate, translate)}
        onChange={(address) => setDraft({ ...draft, address })}
      />
      <TradeCheckbox
        id={`${idPrefix}-isDefault`}
        label={translate(identityAccountMessages, 'account.billing.defaultCheckbox')}
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

/** Renders the identifiers a buyer saved, or nothing when both are absent. */
function identifierLine(
  entity: BillingEntity,
  translate: ReturnType<typeof useLocalisation>['translate'],
): string | null {
  const parts: string[] = [];
  if (entity.registrationNumber) {
    parts.push(
      translate(identityAccountMessages, 'account.billing.companyNo', {
        number: entity.registrationNumber,
      }),
    );
  }
  if (entity.vatNumber) {
    parts.push(
      translate(identityAccountMessages, 'account.billing.vat', { number: entity.vatNumber }),
    );
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

interface BillingEntitiesSectionProps {
  profile: UseTradeProfileResult;
}

export function BillingEntitiesSection({ profile }: BillingEntitiesSectionProps) {
  const { translate } = useLocalisation();
  const { billingEntities } = profile;
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const activeEntities = billingEntities.items.filter((entity) => entity.active);

  async function runRowAction(entityId: string, action: () => Promise<void>) {
    setRowError(null);
    setBusyId(entityId);
    try {
      await action();
    } catch (error) {
      setRowError(localizeAccountError(error, translate, 'account.common.actionFailed'));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section aria-labelledby="billing-details-heading" className="mt-6 rounded-lg border p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2
            id="billing-details-heading"
            className="flex items-center gap-2 text-base font-medium"
          >
            <Building2 className="h-4 w-4 text-muted-foreground" />
            {translate(identityAccountMessages, 'account.billing.title')}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {translate(identityAccountMessages, 'account.billing.description')}
          </p>
        </div>
        {!adding && (
          <Button type="button" size="sm" onClick={() => setAdding(true)}>
            {translate(identityAccountMessages, 'account.billing.add')}
          </Button>
        )}
      </div>

      {adding && (
        <div className="mt-4">
          <BillingEntityForm
            idPrefix="new-entity"
            initialDraft={EMPTY_ENTITY_DRAFT}
            submitLabel={translate(identityAccountMessages, 'account.billing.save')}
            onCancel={() => setAdding(false)}
            onSubmit={async (body) => {
              await profile.addBillingEntity(body);
              setAdding(false);
            }}
          />
        </div>
      )}

      <TradeListStatus
        loading={billingEntities.loading}
        error={billingEntities.error}
        onRetry={profile.reloadBillingEntities}
        isEmpty={activeEntities.length === 0}
        loadingLabel={translate(identityAccountMessages, 'account.billing.loading')}
        emptyLabel={translate(identityAccountMessages, 'account.billing.empty')}
      />

      {rowError && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {rowError}
        </p>
      )}

      <ul className="mt-4 space-y-3">
        {activeEntities.map((entity) => {
          const identifiers = identifierLine(entity, translate);
          return (
            <li key={entity.id} className="rounded-lg border p-4">
              {editingId === entity.id ? (
                <BillingEntityForm
                  idPrefix={`entity-${entity.id}`}
                  initialDraft={draftFromEntity(entity)}
                  submitLabel={translate(identityAccountMessages, 'account.common.save')}
                  onCancel={() => setEditingId(null)}
                  onSubmit={async (body) => {
                    await profile.editBillingEntity(entity.id, toUpdateBody(body));
                    setEditingId(null);
                  }}
                />
              ) : (
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{entity.legalName}</span>
                      {entity.isDefault && (
                        <Badge variant="secondary">
                          {translate(identityAccountMessages, 'account.delivery.default')}
                        </Badge>
                      )}
                    </div>
                    {identifiers && (
                      <p className="mt-1 text-sm text-muted-foreground">{identifiers}</p>
                    )}
                    <p className="text-sm text-muted-foreground">
                      {formatPostalAddress(entity.address)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {!entity.isDefault && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busyId === entity.id}
                        onClick={() =>
                          void runRowAction(entity.id, () =>
                            profile.setDefaultBillingEntity(entity.id),
                          )
                        }
                      >
                        {translate(identityAccountMessages, 'account.delivery.setDefault')}
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setEditingId(entity.id)}
                    >
                      {translate(identityAccountMessages, 'account.delivery.edit', {
                        name: entity.legalName,
                      })}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busyId === entity.id}
                      onClick={() =>
                        void runRowAction(entity.id, () => profile.retireEntity(entity.id))
                      }
                    >
                      {translate(identityAccountMessages, 'account.delivery.remove', {
                        name: entity.legalName,
                      })}
                    </Button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
