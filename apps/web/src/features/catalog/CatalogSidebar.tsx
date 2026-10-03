import { useEffect, useState } from 'react';
import { useLocalisation } from '@/i18n/LocaleContext';
import { discoveryMessages } from '@shop/localisation/messages/discovery';
import { CatalogActiveFilters } from './CatalogActiveFilters';
import { CatalogSidebarControls } from './CatalogSidebarControls';
import type { CatalogSidebarProps } from './catalogSidebarTypes';

export function CatalogSidebar({
  categories,
  category,
  onSale,
  query,
  minPriceCents,
  maxPriceCents,
  addedFrom,
  addedTo,
  availability,
  tags = [],
  specs = [],
  filterOptions,
  filterOptionsLoading = false,
  filterOptionsError,
  hasFilters,
  onCategoryChange,
  onSaleChange,
  onQueryClear,
  onPriceRangeChange,
  onDateRangeChange,
  onAvailabilityChange,
  onTagChange,
  onSpecChange,
  onClearFilters,
}: CatalogSidebarProps) {
  const { translate } = useLocalisation();
  const t = (key: keyof typeof discoveryMessages) => translate(discoveryMessages, key);
  const [minPriceDraft, setMinPriceDraft] = useState(minPriceCents?.toString() ?? '');
  const [maxPriceDraft, setMaxPriceDraft] = useState(maxPriceCents?.toString() ?? '');
  const [addedFromDraft, setAddedFromDraft] = useState(addedFrom ?? '');
  const [addedToDraft, setAddedToDraft] = useState(addedTo ?? '');

  useEffect(() => setMinPriceDraft(minPriceCents?.toString() ?? ''), [minPriceCents]);
  useEffect(() => setMaxPriceDraft(maxPriceCents?.toString() ?? ''), [maxPriceCents]);
  useEffect(() => setAddedFromDraft(addedFrom ?? ''), [addedFrom]);
  useEffect(() => setAddedToDraft(addedTo ?? ''), [addedTo]);

  const commitPriceRange = (minDraft: string, maxDraft: string) => {
    const min = readNonNegativeInteger(minDraft);
    const max = readNonNegativeInteger(maxDraft);
    if (
      (minDraft === '' || min !== undefined) &&
      (maxDraft === '' || max !== undefined) &&
      (min === undefined || max === undefined || min <= max)
    )
      onPriceRangeChange(min, max);
  };
  const commitDateRange = (fromDraft: string, toDraft: string) => {
    const from = fromDraft || undefined;
    const to = toDraft || undefined;
    if (!from || !to || from <= to) onDateRangeChange(from, to);
  };
  const selectedSpecs = new Map<string, string>();
  for (const token of specs) {
    const [key, value] = token.split(':', 2);
    if (key && value) selectedSpecs.set(key, value);
  }

  return (
    <aside
      aria-label={t('catalog.filtersAria')}
      className="space-y-5 rounded-2xl border border-border/80 bg-surface-raised p-4 lg:sticky lg:top-32 lg:self-start"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">{t('catalog.filters')}</h2>
        {hasFilters && (
          <button
            type="button"
            onClick={onClearFilters}
            className="rounded-sm text-xs font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t('catalog.clearAll')}
          </button>
        )}
      </div>
      <CatalogSidebarControls
        categories={categories}
        category={category}
        onSale={onSale}
        minPriceDraft={minPriceDraft}
        maxPriceDraft={maxPriceDraft}
        addedFromDraft={addedFromDraft}
        addedToDraft={addedToDraft}
        availability={availability}
        tags={tags}
        selectedSpecs={selectedSpecs}
        filterOptions={filterOptions}
        filterOptionsLoading={filterOptionsLoading}
        filterOptionsError={filterOptionsError}
        onCategoryChange={onCategoryChange}
        onSaleChange={onSaleChange}
        onPriceDraftChange={(value, bound) => {
          if (bound === 'min') {
            setMinPriceDraft(value);
            commitPriceRange(value, maxPriceDraft);
          } else {
            setMaxPriceDraft(value);
            commitPriceRange(minPriceDraft, value);
          }
        }}
        onDateDraftChange={(value, bound) => {
          if (bound === 'from') {
            setAddedFromDraft(value);
            commitDateRange(value, addedToDraft);
          } else {
            setAddedToDraft(value);
            commitDateRange(addedFromDraft, value);
          }
        }}
        onAvailabilityChange={onAvailabilityChange}
        onTagChange={onTagChange}
        onSpecChange={onSpecChange}
      />
      {hasFilters && (
        <CatalogActiveFilters
          query={query}
          category={category}
          onSale={onSale}
          minPriceCents={minPriceCents}
          maxPriceCents={maxPriceCents}
          addedFrom={addedFrom}
          addedTo={addedTo}
          availability={availability}
          tags={tags}
          specs={specs}
          selectedSpecs={selectedSpecs}
          filterOptions={filterOptions}
          onQueryClear={onQueryClear}
          onCategoryChange={onCategoryChange}
          onSaleChange={onSaleChange}
          onPriceRangeChange={onPriceRangeChange}
          onDateRangeChange={onDateRangeChange}
          onAvailabilityChange={onAvailabilityChange}
          onTagChange={onTagChange}
          onSpecChange={onSpecChange}
        />
      )}
    </aside>
  );
}

function readNonNegativeInteger(value: string): number | undefined {
  if (value === '') return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}
