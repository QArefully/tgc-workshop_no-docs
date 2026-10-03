import { useCallback, useEffect, useRef, useState } from 'react';
import type { AdminProduct, CreateAdminProductBody } from '@shop/contracts/admin-products';
import {
  createAdminProduct,
  getAdminProducts,
  retireAdminProduct,
  updateAdminProduct,
} from '@/api/adminProducts';
import { ErrorMessage } from '@/components/ErrorMessage';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useLocalisation, useMessages } from '@/i18n/LocaleContext';
import { adminCatalogMessages, localizeAdminError } from '@shop/localisation/messages/adminCatalog';

const categories = [
  'Sports Nutrition',
  'Baking & Pantry',
  'Drinks',
  'Household & Cleaning',
  'Garden & Outdoors',
  'Trade & Creative Materials',
] as const;
const mixingGroups = [
  'food-grade',
  'cleaning',
  'garden-treatment',
  'cementitious-materials',
  'casting-materials',
  'pigments',
  'theatrical-effects',
  'absorbents',
] as const;
const classifications = ['food', 'non-food', 'caution'] as const;
const blank: CreateAdminProductBody = {
  name: '',
  description: '',
  priceCents: 0,
  category: 'Trade & Creative Materials',
  stockCount: 0,
  slug: '',
  consumptionClassification: 'non-food',
  mixingGroup: null,
};
function formFor(product: AdminProduct | null): CreateAdminProductBody {
  return product
    ? {
        name: product.name,
        description: product.description,
        priceCents: product.priceCents,
        category: product.category,
        stockCount: product.stockCount,
        imageSetId: product.imageSetId,
        slug: product.slug,
        compareAtPriceCents: product.compareAtPriceCents,
        consumptionClassification: product.consumptionClassification,
        mixingGroup: product.mixingGroup,
        detailsJson: product.detailsJson,
      }
    : blank;
}

/** Product catalogue administration. Server validates all submitted catalogue rules. */
export function AdminProductsPage() {
  const { country } = useLocalisation();
  const t = useMessages(adminCatalogMessages);
  const [items, setItems] = useState<AdminProduct[] | null>(null);
  const [selected, setSelected] = useState<AdminProduct | null>(null);
  const [form, setForm] = useState<CreateAdminProductBody>(blank);
  const [includeRetired, setIncludeRetired] = useState(false);
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
      const response = await getAdminProducts({ includeRetired });
      if (version === loadVersion.current) setItems(response.items);
    } catch (e) {
      if (version === loadVersion.current) setError(localizeAdminError(e, country));
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, [country, includeRetired]);
  useEffect(() => {
    void load();
  }, [load]);
  const choose = (product: AdminProduct | null) => {
    setSelected(product);
    setForm(formFor(product));
    setConfirming(false);
    setError(null);
  };
  const set = <K extends keyof CreateAdminProductBody>(key: K, value: CreateAdminProductBody[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const saved = selected
        ? await updateAdminProduct(selected.id, form)
        : await createAdminProduct(form);
      setSelected(saved);
      setForm(formFor(saved));
      await load();
    } catch (e) {
      setError(localizeAdminError(e, country));
    } finally {
      setSaving(false);
    }
  };
  const retire = async () => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      await retireAdminProduct(selected.id);
      choose(null);
      await load();
    } catch (e) {
      setError(localizeAdminError(e, country));
    } finally {
      setSaving(false);
      setConfirming(false);
    }
  };
  if (loading && !items) return <LoadingSpinner />;
  if (error && !items) return <ErrorMessage message={error} onRetry={() => void load()} />;
  return (
    <section className="space-y-6" aria-labelledby="admin-products-heading">
      <div>
        <h1 id="admin-products-heading" className="section-heading">
          {t('adminCatalog.products.heading')}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t('adminCatalog.products.description')}
        </p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <label className="flex gap-2 text-sm">
        <input
          type="checkbox"
          checked={includeRetired}
          onChange={(e) => setIncludeRetired(e.target.checked)}
        />{' '}
        {t('adminCatalog.products.includeRetired')}
      </label>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Card>
          <CardContent className="space-y-3 py-5">
            <Button type="button" onClick={() => choose(null)}>
              {t('adminCatalog.products.new')}
            </Button>
            {items?.length ? (
              items.map((product) => (
                <button
                  type="button"
                  key={product.id}
                  onClick={() => choose(product)}
                  className="block w-full rounded border p-3 text-left hover:bg-muted"
                >
                  <span className="font-medium">{product.name}</span>
                  <span className="ml-2 text-sm text-muted-foreground">
                    {product.active
                      ? t('adminCatalog.products.active')
                      : t('adminCatalog.products.retired')}
                  </span>
                </button>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">{t('adminCatalog.products.empty')}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-5">
            <form className="space-y-3" onSubmit={(e) => void save(e)}>
              <h2 className="font-semibold">
                {selected
                  ? t('adminCatalog.products.edit', { name: selected.name })
                  : t('adminCatalog.products.new')}
              </h2>
              <label className="block text-sm">
                {t('adminCatalog.products.name')}
                <input
                  aria-label={t('adminCatalog.products.name')}
                  required
                  value={form.name}
                  onChange={(e) => set('name', e.target.value)}
                  className="mt-1 w-full rounded border p-2"
                />
              </label>
              <label className="block text-sm">
                {t('adminCatalog.products.descriptionLabel')}
                <textarea
                  aria-label={t('adminCatalog.products.descriptionLabel')}
                  required
                  value={form.description}
                  onChange={(e) => set('description', e.target.value)}
                  className="mt-1 w-full rounded border p-2"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm">
                  {t('adminCatalog.products.pricePence')}
                  <input
                    aria-label={t('adminCatalog.products.pricePence')}
                    type="number"
                    min="0"
                    required
                    value={form.priceCents}
                    onChange={(e) => set('priceCents', Number(e.target.value))}
                    className="mt-1 w-full rounded border p-2"
                  />
                </label>
                <label className="text-sm">
                  {t('adminCatalog.products.stock')}
                  <input
                    aria-label={t('adminCatalog.products.stock')}
                    type="number"
                    min="0"
                    required
                    value={form.stockCount}
                    onChange={(e) => set('stockCount', Number(e.target.value))}
                    className="mt-1 w-full rounded border p-2"
                  />
                </label>
              </div>
              <label className="block text-sm">
                {t('adminCatalog.products.slug')}
                <input
                  aria-label={t('adminCatalog.products.slug')}
                  required
                  value={form.slug}
                  onChange={(e) => set('slug', e.target.value)}
                  className="mt-1 w-full rounded border p-2"
                />
              </label>
              <label className="block text-sm">
                {t('adminCatalog.products.category')}
                <select
                  aria-label={t('adminCatalog.products.category')}
                  value={form.category}
                  onChange={(e) =>
                    set('category', e.target.value as CreateAdminProductBody['category'])
                  }
                  className="mt-1 w-full rounded border p-2"
                >
                  {categories.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                {t('adminCatalog.products.classification')}
                <select
                  aria-label={t('adminCatalog.products.classification')}
                  value={form.consumptionClassification}
                  onChange={(e) =>
                    set(
                      'consumptionClassification',
                      e.target.value as CreateAdminProductBody['consumptionClassification'],
                    )
                  }
                  className="mt-1 w-full rounded border p-2"
                >
                  {classifications.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                {t('adminCatalog.products.mixingGroup')}
                <select
                  aria-label={t('adminCatalog.products.mixingGroup')}
                  value={form.mixingGroup ?? ''}
                  onChange={(e) =>
                    set(
                      'mixingGroup',
                      (e.target.value || null) as CreateAdminProductBody['mixingGroup'],
                    )
                  }
                  className="mt-1 w-full rounded border p-2"
                >
                  <option value="">{t('adminCatalog.products.none')}</option>
                  {mixingGroups.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
              <div className="flex flex-wrap gap-2">
                <Button disabled={saving} type="submit">
                  {saving ? t('adminCatalog.saving') : t('adminCatalog.products.save')}
                </Button>
                {selected?.active &&
                  (confirming ? (
                    <>
                      <Button
                        type="button"
                        variant="destructive"
                        disabled={saving}
                        onClick={() => void retire()}
                      >
                        {t('adminCatalog.confirmRetire')}
                      </Button>
                      <Button type="button" variant="outline" onClick={() => setConfirming(false)}>
                        {t('adminCatalog.cancel')}
                      </Button>
                    </>
                  ) : (
                    <Button type="button" variant="outline" onClick={() => setConfirming(true)}>
                      {t('adminCatalog.products.retire')}
                    </Button>
                  ))}
              </div>
              {confirming && <p className="text-sm">{t('adminCatalog.products.retiringNotice')}</p>}
            </form>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
