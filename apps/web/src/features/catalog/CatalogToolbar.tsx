import { Search } from 'lucide-react';
import type { ProductQuery } from '@shop/contracts/products';
import { Input } from '@/components/ui/input';
import { useLocalisation } from '@/i18n/LocaleContext';
import { discoveryMessages } from '@shop/localisation/messages/discovery';

interface CatalogToolbarProps {
  localQuery: string;
  onQueryChange: (value: string) => void;
  resultSummary: string;
  sort?: ProductQuery['sort'];
  sortOptions: readonly { value: NonNullable<ProductQuery['sort']>; label: string }[];
  onSortChange: (value: ProductQuery['sort'] | undefined) => void;
}

export function CatalogToolbar({
  localQuery,
  onQueryChange,
  resultSummary,
  sort,
  sortOptions,
  onSortChange,
}: CatalogToolbarProps) {
  const { translate } = useLocalisation();
  const t = (key: keyof typeof discoveryMessages) => translate(discoveryMessages, key);
  return (
    <div className="mb-7 grid gap-3 rounded-2xl border border-border/80 bg-surface-raised p-3 shadow-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="relative min-w-0">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          aria-label={t('catalog.searchLabel')}
          placeholder={t('catalog.searchPlaceholder')}
          className="h-10 rounded-full pl-9"
          value={localQuery}
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </div>
      <div className="flex min-w-0 items-center justify-between gap-3 sm:justify-end">
        <p className="text-sm text-muted-foreground">{resultSummary}</p>
        <label
          htmlFor="catalog-sort"
          className="flex shrink-0 items-center gap-2 text-sm font-medium"
        >
          <span className="hidden text-muted-foreground sm:inline">{t('catalog.sort')}</span>
          <select
            id="catalog-sort"
            className="h-10 max-w-44 rounded-lg border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={sort ?? 'newest'}
            onChange={(event) =>
              onSortChange(
                event.target.value === 'newest'
                  ? undefined
                  : (event.target.value as ProductQuery['sort']),
              )
            }
          >
            {sortOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
