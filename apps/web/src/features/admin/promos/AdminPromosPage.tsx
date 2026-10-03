import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AdminPromo,
  CreateAdminPromoBody,
  UpdateAdminPromoBody,
} from '@shop/contracts/admin-promos';
import { SUPPORTED_COUNTRIES, type Country } from '@shop/contracts/country';
import {
  createAdminPromo,
  deactivateAdminPromo,
  getAdminPromos,
  updateAdminPromo,
} from '@/api/adminPromos';
import { ErrorMessage } from '@/components/ErrorMessage';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useCountry } from '@/hooks/CountryContext';
import { useLocalisation, useMessages } from '@/i18n/LocaleContext';
import {
  adminCatalogMessages,
  adminDateTimeInputValue,
  localizeAdminError,
} from '@shop/localisation/messages/adminCatalog';
const blank: CreateAdminPromoBody = {
  code: '',
  discountPercent: 0,
  minItemCount: 0,
  kind: 'percent',
  amountCents: null,
  minSubtotalCents: null,
  categoryScope: null,
  startAt: null,
  endAt: null,
  maxRedemptions: null,
  perUserLimit: null,
  countries: [],
};
const categories = [
  'Sports Nutrition',
  'Baking & Pantry',
  'Drinks',
  'Household & Cleaning',
  'Garden & Outdoors',
  'Trade & Creative Materials',
] as const;
function editable(promo: AdminPromo): CreateAdminPromoBody {
  return {
    code: promo.code,
    discountPercent: promo.discountPercent,
    minItemCount: promo.minItemCount,
    kind: promo.kind,
    amountCents: promo.amountCents,
    minSubtotalCents: promo.minSubtotalCents,
    categoryScope: promo.categoryScope,
    startAt: promo.startAt,
    endAt: promo.endAt,
    maxRedemptions: promo.maxRedemptions,
    perUserLimit: promo.perUserLimit,
    countries: promo.countries ?? [],
  };
}
function updateBody({ code, ...body }: CreateAdminPromoBody): UpdateAdminPromoBody {
  void code;
  return body;
}
function isoOrNull(value: string) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
/** Promotion administration; eligibility and redemption validation remain server-owned. */
export function AdminPromosPage() {
  const { activeCountry } = useCountry();
  const { country } = useLocalisation();
  const t = useMessages(adminCatalogMessages);
  const [items, setItems] = useState<AdminPromo[] | null>(null);
  const [selected, setSelected] = useState<AdminPromo | null>(null);
  const [form, setForm] = useState<CreateAdminPromoBody>(blank);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const loadVersion = useRef(0);
  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    setLoading(true);
    setError(null);
    try {
      const response = await getAdminPromos();
      if (version === loadVersion.current) setItems(response.items);
    } catch (e) {
      if (version === loadVersion.current) setError(localizeAdminError(e, country));
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, [activeCountry, country]);
  useEffect(() => {
    void load();
  }, [load]);
  const choose = (promo: AdminPromo | null) => {
    setSelected(promo);
    setForm(promo ? editable(promo) : blank);
    setConfirming(false);
    setError(null);
  };
  const set = <K extends keyof CreateAdminPromoBody>(key: K, value: CreateAdminPromoBody[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const saved = selected
        ? await updateAdminPromo(selected.code, updateBody(form))
        : await createAdminPromo(form);
      choose(saved);
      await load();
    } catch (failure) {
      setError(localizeAdminError(failure, country));
    } finally {
      setSaving(false);
    }
  };
  const deactivate = async () => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await deactivateAdminPromo(selected.code);
      choose(saved);
      await load();
    } catch (failure) {
      setError(localizeAdminError(failure, country));
    } finally {
      setSaving(false);
      setConfirming(false);
    }
  };
  if (loading && !items) return <LoadingSpinner />;
  if (error && !items) return <ErrorMessage message={error} onRetry={() => void load()} />;
  return (
    <section className="space-y-6" aria-labelledby="admin-promos-heading">
      <div>
        <h1 id="admin-promos-heading" className="section-heading">
          {t('adminCatalog.promos.heading')}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{t('adminCatalog.promos.description')}</p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardContent className="space-y-3 py-5">
            <Button type="button" onClick={() => choose(null)}>
              {t('adminCatalog.promos.new')}
            </Button>
            {items?.length ? (
              items.map((promo) => (
                <button
                  type="button"
                  key={promo.code}
                  onClick={() => choose(promo)}
                  className="block w-full rounded border p-3 text-left"
                >
                  <span className="font-medium">{promo.code}</span>
                  <span className="ml-2 text-sm text-muted-foreground">
                    {promo.active
                      ? t('adminCatalog.promos.active')
                      : t('adminCatalog.promos.inactive')}
                  </span>
                </button>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">{t('adminCatalog.promos.empty')}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-5">
            <form className="space-y-3" onSubmit={(e) => void save(e)}>
              <h2 className="font-semibold">
                {selected
                  ? t('adminCatalog.promos.edit', { code: selected.code })
                  : t('adminCatalog.promos.new')}
              </h2>
              <label className="block text-sm">
                {t('adminCatalog.promos.code')}
                <input
                  aria-label={t('adminCatalog.promos.code')}
                  disabled={Boolean(selected)}
                  required
                  value={form.code}
                  onChange={(e) => set('code', e.target.value.toUpperCase())}
                  className="mt-1 w-full rounded border p-2"
                />
              </label>
              <label className="block text-sm">
                {t('adminCatalog.promos.kind')}
                <select
                  aria-label={t('adminCatalog.promos.kind')}
                  value={form.kind}
                  onChange={(e) => set('kind', e.target.value as CreateAdminPromoBody['kind'])}
                  className="mt-1 w-full rounded border p-2"
                >
                  <option value="percent">{t('adminCatalog.promos.percentage')}</option>
                  <option value="fixed">{t('adminCatalog.promos.fixedAmount')}</option>
                </select>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-sm">
                  {t('adminCatalog.promos.discountPercent')}
                  <input
                    aria-label={t('adminCatalog.promos.discountPercent')}
                    type="number"
                    value={form.discountPercent}
                    onChange={(e) => set('discountPercent', Number(e.target.value))}
                    className="mt-1 w-full rounded border p-2"
                  />
                </label>
                <label className="text-sm">
                  {t('adminCatalog.promos.minimumItems')}
                  <input
                    aria-label={t('adminCatalog.promos.minimumItems')}
                    type="number"
                    value={form.minItemCount}
                    onChange={(e) => set('minItemCount', Number(e.target.value))}
                    className="mt-1 w-full rounded border p-2"
                  />
                </label>
              </div>
              <label className="block text-sm">
                {t('adminCatalog.promos.fixedAmountPence')}
                <input
                  aria-label={t('adminCatalog.promos.fixedAmountPence')}
                  type="number"
                  value={form.amountCents ?? ''}
                  onChange={(e) =>
                    set('amountCents', e.target.value === '' ? null : Number(e.target.value))
                  }
                  className="mt-1 w-full rounded border p-2"
                />
              </label>
              <label className="block text-sm">
                {t('adminCatalog.promos.minimumSubtotalPence')}
                <input
                  aria-label={t('adminCatalog.promos.minimumSubtotalPence')}
                  type="number"
                  value={form.minSubtotalCents ?? ''}
                  onChange={(e) =>
                    set('minSubtotalCents', e.target.value === '' ? null : Number(e.target.value))
                  }
                  className="mt-1 w-full rounded border p-2"
                />
              </label>
              <label className="block text-sm">
                {t('adminCatalog.promos.categoryScope')}
                <select
                  aria-label={t('adminCatalog.promos.categoryScope')}
                  value={form.categoryScope ?? ''}
                  onChange={(e) =>
                    set(
                      'categoryScope',
                      (e.target.value || null) as CreateAdminPromoBody['categoryScope'],
                    )
                  }
                  className="mt-1 w-full rounded border p-2"
                >
                  <option value="">{t('adminCatalog.promos.allCategories')}</option>
                  {categories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                {t('adminCatalog.promos.countryTargeting')}
                <select
                  aria-label={t('adminCatalog.promos.countryTargeting')}
                  multiple
                  value={form.countries ?? []}
                  onChange={(e) =>
                    set(
                      'countries',
                      Array.from(e.target.selectedOptions, (option) => option.value as Country),
                    )
                  }
                  className="mt-1 min-h-28 w-full rounded border p-2"
                >
                  {SUPPORTED_COUNTRIES.map((country) => (
                    <option key={country} value={country}>
                      {country}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {t('adminCatalog.promos.countryTargetingHint')}
                </span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-sm">
                  {t('adminCatalog.promos.startsAt')}
                  <input
                    aria-label={t('adminCatalog.promos.startsAt')}
                    type="datetime-local"
                    value={adminDateTimeInputValue(form.startAt)}
                    onChange={(e) => set('startAt', isoOrNull(e.target.value))}
                    className="mt-1 w-full rounded border p-2"
                  />
                </label>
                <label className="text-sm">
                  {t('adminCatalog.promos.endsAt')}
                  <input
                    aria-label={t('adminCatalog.promos.endsAt')}
                    type="datetime-local"
                    value={adminDateTimeInputValue(form.endAt)}
                    onChange={(e) => set('endAt', isoOrNull(e.target.value))}
                    className="mt-1 w-full rounded border p-2"
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-sm">
                  {t('adminCatalog.promos.maximumRedemptions')}
                  <input
                    aria-label={t('adminCatalog.promos.maximumRedemptions')}
                    type="number"
                    min="0"
                    value={form.maxRedemptions ?? ''}
                    onChange={(e) =>
                      set('maxRedemptions', e.target.value === '' ? null : Number(e.target.value))
                    }
                    className="mt-1 w-full rounded border p-2"
                  />
                </label>
                <label className="text-sm">
                  {t('adminCatalog.promos.perUserLimit')}
                  <input
                    aria-label={t('adminCatalog.promos.perUserLimit')}
                    type="number"
                    min="1"
                    value={form.perUserLimit ?? ''}
                    onChange={(e) =>
                      set('perUserLimit', e.target.value === '' ? null : Number(e.target.value))
                    }
                    className="mt-1 w-full rounded border p-2"
                  />
                </label>
              </div>
              <Button disabled={saving} type="submit">
                {saving ? t('adminCatalog.saving') : t('adminCatalog.promos.save')}
              </Button>
            </form>
            {selected?.active && (
              <div className="mt-6 border-t pt-4">
                {confirming ? (
                  <>
                    <p className="mb-2 text-sm">{t('adminCatalog.promos.deactivateQuestion')}</p>
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={saving}
                      onClick={() => void deactivate()}
                    >
                      {t('adminCatalog.promos.confirmDeactivate')}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setConfirming(false)}>
                      {t('adminCatalog.cancel')}
                    </Button>
                  </>
                ) : (
                  <Button type="button" variant="outline" onClick={() => setConfirming(true)}>
                    {t('adminCatalog.promos.deactivate')}
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
