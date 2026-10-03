import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ProductQuery } from '@shop/contracts/products';
import { useProducts } from '@/hooks/useProducts';
import { useCategories } from '@/hooks/useCategories';
import { useProductFilterOptions } from '@/hooks/useProductFilterOptions';
import { useCartContext } from '@/hooks/CartContext';
import { ProductGrid } from '@/components/ProductGrid';
import { ProductCard } from '@/components/ProductCard';
import { ErrorMessage } from '@/components/ErrorMessage';
import { Button } from '@/components/ui/button';
import { CompareProductButton } from '@/features/comparison/CompareProductButton';
import { ComparisonTray } from '@/features/comparison/ComparisonTray';
import { CatalogSidebar } from './CatalogSidebar';
import { CatalogToolbar } from './CatalogToolbar';
import { PAGE_SIZES, SORT_OPTIONS } from './catalogOptions';
import { useCatalogParams } from './useCatalogParams';
import { useLocalisation } from '@/i18n/LocaleContext';
import { discoveryMessages } from '@shop/localisation/messages/discovery';
import { commonMessages } from '@shop/localisation/messages/common';

export function CatalogPage() {
  const { translate, formatCount } = useLocalisation();
  const t = (key: keyof typeof discoveryMessages, params?: Record<string, string | number>) =>
    translate(discoveryMessages, key, params);
  const {
    q,
    category,
    onSale,
    minPriceCents,
    maxPriceCents,
    addedFrom,
    addedTo,
    tag = [],
    spec = [],
    availability,
    sort,
    page,
    pageSize,
    setParam,
    setParams,
    clearFilters,
  } = useCatalogParams();
  const { categories } = useCategories();
  const {
    options: filterOptions,
    isLoading: filterOptionsLoading,
    error: filterOptionsError,
  } = useProductFilterOptions();
  // URL filter values are only safe to send after the server's filter registry
  // has loaded successfully. Until then (or after an error), keep catalogue
  // results usable with the non-metadata query fields alone.
  const hasLoadedFilterOptions = filterOptions !== null && filterOptionsError === null;
  const allowedTagKeys = new Set(filterOptions?.tags.map((option) => option.key));
  const allowedSpecificationTokens = new Set(
    filterOptions?.specificationGroups.flatMap((group) =>
      group.specifications.flatMap((specification) =>
        specification.values.map((value) => `${specification.key}:${value.key}`),
      ),
    ),
  );
  const visibleTags = hasLoadedFilterOptions
    ? tag.filter((value) => allowedTagKeys.has(value))
    : [];
  const visibleSpecs = hasLoadedFilterOptions
    ? spec.filter((value) => allowedSpecificationTokens.has(value))
    : [];
  const normalizeSupportedFilters = (query: ProductQuery): ProductQuery =>
    !hasLoadedFilterOptions
      ? query
      : {
          ...query,
          tag: (query.tag ?? []).filter((value) => allowedTagKeys.has(value)),
          spec: (query.spec ?? []).filter((value) => allowedSpecificationTokens.has(value)),
        };
  const setCatalogParam = (key: keyof ProductQuery, value: string | readonly string[] | null) =>
    setParam(key, value, normalizeSupportedFilters);
  const { products, isLoading, error, total, refetch } = useProducts({
    q,
    category,
    onSale,
    minPriceCents,
    maxPriceCents,
    addedFrom,
    addedTo,
    tag: visibleTags,
    spec: visibleSpecs,
    availability,
    sort,
    page,
    pageSize,
  });
  const {
    error: cartError,
    addItem,
    retryCart,
    isCartAvailable,
    isActionPending,
  } = useCartContext();
  const [localQ, setLocalQ] = useState(q ?? '');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setLocalQ(q ?? ''), [q]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const updateSearch = (value: string) => {
    setLocalQ(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCatalogParam('q', value || null), 300);
  };

  if (error && products.length === 0) {
    return <ErrorMessage message={error} onRetry={() => void refetch()} />;
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasFilters = Boolean(
    q ||
    category ||
    onSale ||
    minPriceCents !== undefined ||
    maxPriceCents !== undefined ||
    addedFrom ||
    addedTo ||
    visibleTags.length > 0 ||
    visibleSpecs.length > 0 ||
    availability,
  );
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  const resultSummary =
    total === 0
      ? t('catalog.noMaterials')
      : t('catalog.materialCount', { count: total, displayCount: formatCount(total) });
  const catalogTitle =
    category ?? (q ? t('catalog.searchTitle', { query: q }) : t('catalog.title'));
  const sortOptions = SORT_OPTIONS.map((option) => ({
    ...option,
    label: t(
      option.value === 'newest'
        ? 'catalog.sort.newest'
        : option.value === 'oldest'
          ? 'catalog.sort.oldest'
          : option.value === 'name_asc'
            ? 'catalog.sort.nameAsc'
            : option.value === 'price_asc'
              ? 'catalog.sort.priceAsc'
              : option.value === 'price_desc'
                ? 'catalog.sort.priceDesc'
                : 'catalog.sort.bestselling',
    ),
  }));

  return (
    <div className="pb-12">
      <header className="mb-7 max-w-3xl">
        <p className="section-eyebrow">{t('catalog.eyebrow')}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{catalogTitle}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t('catalog.description')}</p>
      </header>
      <CatalogToolbar
        localQuery={localQ}
        onQueryChange={updateSearch}
        resultSummary={resultSummary}
        sort={sort}
        sortOptions={sortOptions}
        onSortChange={(value) => setCatalogParam('sort', value ?? null)}
      />
      {cartError && (
        <div
          role="alert"
          className="mb-6 flex items-center justify-between gap-4 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3"
        >
          <p className="text-sm text-destructive">{cartError}</p>
          <Button variant="outline" size="sm" onClick={() => void retryCart()}>
            {translate(commonMessages, 'common.retry')}
          </Button>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-8">
        <CatalogSidebar
          categories={categories}
          category={category}
          onSale={onSale}
          query={q}
          minPriceCents={minPriceCents}
          maxPriceCents={maxPriceCents}
          addedFrom={addedFrom}
          addedTo={addedTo}
          availability={availability}
          tags={visibleTags}
          specs={visibleSpecs}
          filterOptions={filterOptions ?? undefined}
          filterOptionsLoading={filterOptionsLoading}
          filterOptionsError={filterOptionsError ?? undefined}
          hasFilters={hasFilters}
          onCategoryChange={(value) => setCatalogParam('category', value ?? null)}
          onSaleChange={(value) => setCatalogParam('onSale', value ? 'true' : null)}
          onQueryClear={() => setCatalogParam('q', null)}
          onPriceRangeChange={(min, max) =>
            setParams(
              {
                minPriceCents: min === undefined ? null : String(min),
                maxPriceCents: max === undefined ? null : String(max),
              },
              normalizeSupportedFilters,
            )
          }
          onDateRangeChange={(from, to) =>
            setParams({ addedFrom: from ?? null, addedTo: to ?? null }, normalizeSupportedFilters)
          }
          onAvailabilityChange={(value) => setCatalogParam('availability', value ?? null)}
          onTagChange={(value, selected) =>
            setCatalogParam(
              'tag',
              selected ? [...visibleTags, value] : visibleTags.filter((item) => item !== value),
            )
          }
          onSpecChange={(key, value) =>
            setCatalogParam(
              'spec',
              value
                ? [...visibleSpecs.filter((item) => !item.startsWith(`${key}:`)), `${key}:${value}`]
                : visibleSpecs.filter((item) => !item.startsWith(`${key}:`)),
            )
          }
          onClearFilters={clearFilters}
        />
        <div className="min-w-0">
          <ComparisonTray />
          {products.length === 0 && isLoading ? (
            <CatalogSkeleton />
          ) : products.length === 0 ? (
            <CatalogEmptyState hasFilters={hasFilters} onClearFilters={clearFilters} />
          ) : (
            <div className="transition-opacity" aria-busy={isLoading} aria-live="polite">
              <p className="mb-4 text-sm text-muted-foreground">
                {t('catalog.showing', {
                  start: formatCount(start),
                  end: formatCount(end),
                  total: formatCount(total),
                })}
                {isLoading && <span className="ml-2">{t('catalog.updating')}</span>}
              </p>
              <ProductGrid className={isLoading ? 'opacity-60' : undefined}>
                {products.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    isCartAvailable={isCartAvailable}
                    isAdding={isActionPending(product.id, 'add')}
                    onAddToCart={addItem}
                    comparisonControl={
                      <CompareProductButton productId={product.id} productName={product.name} />
                    }
                  />
                ))}
              </ProductGrid>
            </div>
          )}
          {totalPages > 1 && products.length > 0 && (
            <nav
              aria-label={t('catalog.pagination')}
              className="mt-10 flex flex-wrap items-center justify-center gap-2"
            >
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setCatalogParam('page', String(page - 1))}
              >
                {t('catalog.previous')}
              </Button>
              <span className="px-3 text-sm text-muted-foreground">
                {t('catalog.pageOf', {
                  page: formatCount(page),
                  totalPages: formatCount(totalPages),
                })}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setCatalogParam('page', String(page + 1))}
              >
                {t('catalog.next')}
              </Button>
              <label htmlFor="page-size" className="ml-3 text-sm text-muted-foreground">
                {t('catalog.perPage')}
              </label>
              <select
                id="page-size"
                className="rounded-md border bg-background px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={pageSize}
                onChange={(event) => setCatalogParam('pageSize', event.target.value)}
              >
                {PAGE_SIZES.map((size) => (
                  <option key={size}>{size}</option>
                ))}
              </select>
            </nav>
          )}
        </div>
      </div>
    </div>
  );
}

function CatalogEmptyState({
  hasFilters,
  onClearFilters,
}: {
  hasFilters: boolean;
  onClearFilters: () => void;
}) {
  const { translate } = useLocalisation();
  const t = (key: keyof typeof discoveryMessages) => translate(discoveryMessages, key);
  return (
    <div className="rounded-2xl border bg-surface-raised px-6 py-16 text-center">
      <h2 className="text-xl font-semibold">{t('catalog.noMaterials')}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        {t('catalog.noMaterialsDescription')}
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        {hasFilters && <Button onClick={onClearFilters}>{t('catalog.clearAll')}</Button>}
        <Button variant="outline" nativeButton={false} render={<Link to="/catalog" />}>
          {t('catalog.browseAll')}
        </Button>
      </div>
    </div>
  );
}

function CatalogSkeleton() {
  const { translate } = useLocalisation();
  return (
    <ProductGrid
      aria-label={translate(discoveryMessages, 'catalog.loadingMaterials')}
      aria-busy="true"
    >
      {Array.from({ length: 8 }, (_, index) => (
        <div key={index} className="overflow-hidden rounded-xl border bg-surface-raised p-4 sm:p-5">
          <div className="aspect-4/5 animate-pulse rounded-xl bg-muted" />
          <div className="mt-4 h-3 w-1/3 animate-pulse rounded bg-muted" />
          <div className="mt-3 h-5 w-4/5 animate-pulse rounded bg-muted" />
          <div className="mt-2 h-5 w-3/5 animate-pulse rounded bg-muted" />
          <div className="mt-6 h-8 animate-pulse rounded-lg bg-muted" />
        </div>
      ))}
    </ProductGrid>
  );
}
