import { X } from 'lucide-react';
import type { ProductFilterOptionsResponse } from '@shop/contracts/products';
import { useLocalisation } from '@/i18n/LocaleContext';
import { discoveryMessages } from '@shop/localisation/messages/discovery';
import type { Availability } from './catalogSidebarTypes';

type CatalogActiveFiltersProps = {
  query?: string;
  category?: string;
  onSale?: boolean;
  minPriceCents?: number;
  maxPriceCents?: number;
  addedFrom?: string;
  addedTo?: string;
  availability?: Availability;
  tags: readonly string[];
  specs: readonly string[];
  selectedSpecs: ReadonlyMap<string, string>;
  filterOptions?: ProductFilterOptionsResponse;
  onQueryClear: () => void;
  onCategoryChange: (category: string | undefined) => void;
  onSaleChange: (onSale: boolean) => void;
  onPriceRangeChange: (min: number | undefined, max: number | undefined) => void;
  onDateRangeChange: (from: string | undefined, to: string | undefined) => void;
  onAvailabilityChange: (value: Availability | undefined) => void;
  onTagChange: (tag: string, selected: boolean) => void;
  onSpecChange: (specificationKey: string, valueKey: string | undefined) => void;
};

export function CatalogActiveFilters({
  query,
  category,
  onSale,
  minPriceCents,
  maxPriceCents,
  addedFrom,
  addedTo,
  availability,
  tags,
  specs,
  selectedSpecs,
  filterOptions,
  onQueryClear,
  onCategoryChange,
  onSaleChange,
  onPriceRangeChange,
  onDateRangeChange,
  onAvailabilityChange,
  onTagChange,
  onSpecChange,
}: CatalogActiveFiltersProps) {
  const { translate, formatCivilDate, formatCount } = useLocalisation();
  const t = (key: keyof typeof discoveryMessages, params?: Record<string, string | number>) =>
    translate(discoveryMessages, key, params);
  const tagByKey = new Map(filterOptions?.tags.map((tag) => [tag.key, tag]));
  const knownSpecificationTokens = new Set(
    (filterOptions?.specificationGroups ?? []).flatMap((group) =>
      group.specifications.flatMap((specification) =>
        specification.values.map((value) => `${specification.key}:${value.key}`),
      ),
    ),
  );

  return (
    <div className="flex flex-wrap gap-2" aria-label={t('catalog.activeFilters')}>
      {query && <FilterChip label={t('catalog.searchFilter', { query })} onClick={onQueryClear} />}
      {category && (
        <FilterChip
          label={t('catalog.typeFilter', { category })}
          onClick={() => onCategoryChange(undefined)}
        />
      )}
      {onSale && <FilterChip label={t('catalog.onSale')} onClick={() => onSaleChange(false)} />}
      {minPriceCents !== undefined && (
        <FilterChip
          label={t('catalog.minimumFilter', { value: formatCount(minPriceCents) })}
          onClick={() => onPriceRangeChange(undefined, maxPriceCents)}
        />
      )}
      {maxPriceCents !== undefined && (
        <FilterChip
          label={t('catalog.maximumFilter', { value: formatCount(maxPriceCents) })}
          onClick={() => onPriceRangeChange(minPriceCents, undefined)}
        />
      )}
      {addedFrom && (
        <FilterChip
          label={t('catalog.addedFromFilter', { date: formatCivilDate(addedFrom) })}
          onClick={() => onDateRangeChange(undefined, addedTo)}
        />
      )}
      {addedTo && (
        <FilterChip
          label={t('catalog.addedToFilter', { date: formatCivilDate(addedTo) })}
          onClick={() => onDateRangeChange(addedFrom, undefined)}
        />
      )}
      {availability && (
        <FilterChip
          label={
            availability === 'available'
              ? t('catalog.inStock')
              : availability === 'backorder'
                ? t('catalog.backorder')
                : t('catalog.outOfStock')
          }
          onClick={() => onAvailabilityChange(undefined)}
        />
      )}
      {tags.map((tagKey) => {
        const tag = tagByKey.get(tagKey);
        return (
          <FilterChip
            key={tagKey}
            label={t('catalog.tagFilter', { tag: tag?.label ?? tagKey })}
            onClick={() => onTagChange(tagKey, false)}
          />
        );
      })}
      {filterOptions?.specificationGroups.flatMap((group) =>
        group.specifications.flatMap((specification) => {
          const value = specification.values.find(
            (option) => option.key === selectedSpecs.get(specification.key),
          );
          return value
            ? [
                <FilterChip
                  key={`${specification.key}:${value.key}`}
                  label={`${specification.label}: ${value.label}`}
                  onClick={() => onSpecChange(specification.key, undefined)}
                />,
              ]
            : [];
        }),
      )}
      {specs
        .filter((token) => !knownSpecificationTokens.has(token))
        .map((token) => (
          <FilterChip
            key={token}
            label={t('catalog.specificationFilter', { specification: token })}
            onClick={() => onSpecChange(token.slice(0, token.indexOf(':')), undefined)}
          />
        ))}
    </div>
  );
}

function FilterChip({ label, onClick }: { label: string; onClick: () => void }) {
  const { translate } = useLocalisation();
  const removeLabel = translate(discoveryMessages, 'catalog.removeFilter', { label });
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={removeLabel}
      className="flex items-center gap-1 rounded-full bg-secondary px-3 py-1.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {label}
      <X className="size-3" aria-hidden="true" />
      <span className="sr-only">{removeLabel}</span>
    </button>
  );
}
