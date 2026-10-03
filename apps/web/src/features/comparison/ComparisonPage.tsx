import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getProductComparison } from '@/api/products';
import { Button } from '@/components/ui/button';
import { ComparisonMatrix } from './ComparisonMatrix';
import type { Product } from '@shop/contracts/products';
import { parseComparisonSelection, removeComparisonId } from './comparisonSelection';
import { useComparisonSelection } from './ComparisonSelectionContext';
import { useOptionalCountry } from '@/hooks/CountryContext';
import { useLocalisation } from '@/i18n/LocaleContext';
import { discoveryMessages } from '@shop/localisation/messages/discovery';

interface EnrichedProduct extends Product {
  priceRange?: { min: number; max: number };
  baseAvailability?: 'in_stock' | 'low_stock' | 'out_of_stock' | 'backorder';
  variants?: unknown[];
}

interface LoadedComparison {
  items: {
    id: string;
    status: 'available' | 'inactive' | 'missing';
    product?: EnrichedProduct;
  }[];
  products: EnrichedProduct[];
}

export function ComparisonPage() {
  const { translate } = useLocalisation();
  const t = (key: keyof typeof discoveryMessages, params?: Record<string, string | number>) =>
    translate(discoveryMessages, key, params);
  const [searchParams, setSearchParams] = useSearchParams();
  const [loaded, setLoaded] = useState<LoadedComparison | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const requestNumber = useRef(0);
  const skipStorageRestore = useRef(false);
  const { activeCountry } = useOptionalCountry();
  const selection = parseComparisonSelection(searchParams);
  const selectedIds = selection.status === 'valid' ? (selection.ids ?? []) : [];
  const { selectedIds: draftIds, syncValidSelection, toggle } = useComparisonSelection();

  useEffect(() => {
    if (selection.status !== 'missing' || skipStorageRestore.current) return;
    if (draftIds.length < 2) return;
    setSearchParams({ ids: draftIds.join(',') }, { replace: true });
  }, [draftIds, selection.status, setSearchParams]);

  useEffect(() => {
    if (selection.status !== 'valid' || selectedIds.length === 0) {
      setLoaded(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    const currentRequest = ++requestNumber.current;
    setIsLoading(true);
    setError(null);
    setLoaded(null);

    getProductComparison(selectedIds, controller.signal)
      .then((response) => {
        if (controller.signal.aborted || currentRequest !== requestNumber.current) return;
        const products = response.items.flatMap((item) => {
          if (item.status === 'available' && item.product) {
            return [item.product];
          }
          return [];
        });
        const items = response.items.map((item) => ({
          id: item.id,
          status: item.status,
          product:
            item.status === 'available' && 'product' in item
              ? (item as { product: EnrichedProduct }).product
              : undefined,
        }));
        if (products.length >= 2 && products.length <= 4)
          syncValidSelection(products.map((product) => product.id));
        setLoaded({ items, products });
      })
      .catch(() => {
        if (controller.signal.aborted || currentRequest !== requestNumber.current) return;
        setError(t('comparison.loadError'));
      })
      .finally(() => {
        if (!controller.signal.aborted && currentRequest === requestNumber.current)
          setIsLoading(false);
      });

    return () => controller.abort();
  }, [activeCountry, selection.status, selection.value, retry, syncValidSelection]);

  const updateIds = (ids: readonly string[]) => {
    if (ids.length < 2) {
      skipStorageRestore.current = true;
      setSearchParams({}, { replace: false });
      return;
    }
    setSearchParams({ ids: ids.join(',') }, { replace: false });
  };

  if (selection.status === 'invalid') {
    return (
      <ComparisonMessage
        title={t('comparison.invalidTitle')}
        detail={t('comparison.invalidDetail')}
      />
    );
  }

  if (selection.status === 'missing') {
    return (
      <ComparisonMessage
        title={t('comparison.missingTitle')}
        detail={t('comparison.missingDetail')}
      />
    );
  }

  const unavailable = loaded?.items.filter((item) => item.status !== 'available') ?? [];
  return (
    <div className="pb-12">
      <header className="mb-7 max-w-3xl">
        <p className="section-eyebrow">{t('comparison.eyebrow')}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          {t('comparison.title')}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{t('comparison.description')}</p>
      </header>

      {isLoading && (
        <p role="status" className="py-8 text-muted-foreground">
          {t('comparison.loading')}
        </p>
      )}
      {error && (
        <div role="alert" className="rounded-2xl border border-destructive/40 bg-destructive/5 p-5">
          <p className="text-destructive">{error}</p>
          <Button className="mt-3" size="sm" onClick={() => setRetry((value) => value + 1)}>
            {t('comparison.tryAgain')}
          </Button>
        </div>
      )}
      {unavailable.length > 0 && (
        <div role="status" className="mb-6 rounded-2xl border bg-surface-soft p-5">
          <h2 className="font-semibold">{t('comparison.unavailableTitle')}</h2>
          <ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground">
            {unavailable.map((item) => (
              <li key={`${item.status}:${item.id}`}>
                {item.status === 'inactive'
                  ? t('comparison.inactive', { id: item.id })
                  : t('comparison.missing', { id: item.id })}
              </li>
            ))}
          </ul>
        </div>
      )}
      {loaded && loaded.products.length >= 2 && (
        <ComparisonMatrix
          products={loaded.products}
          onRemove={(id) => {
            toggle(id);
            updateIds(removeComparisonId(selectedIds, id));
          }}
        />
      )}
      {loaded && loaded.products.length < 2 && (
        <div className="rounded-2xl border bg-surface-raised p-6 text-center">
          <h2 className="text-xl font-semibold">{t('comparison.notEnoughTitle')}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{t('comparison.notEnoughDetail')}</p>
        </div>
      )}
    </div>
  );
}

function ComparisonMessage({ title, detail }: { title: string; detail: string }) {
  const { translate } = useLocalisation();
  return (
    <div className="rounded-2xl border bg-surface-raised px-6 py-16 text-center">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{detail}</p>
      <Button
        className="mt-6"
        variant="outline"
        nativeButton={false}
        render={<Link to="/catalog" />}
      >
        {translate(discoveryMessages, 'comparison.browse')}
      </Button>
    </div>
  );
}
