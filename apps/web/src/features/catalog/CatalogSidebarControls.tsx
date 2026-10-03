import type { ReactNode } from 'react';
import type { ProductFilterOptionsResponse } from '@shop/contracts/products';
import { useLocalisation } from '@/i18n/LocaleContext';
import { discoveryMessages } from '@shop/localisation/messages/discovery';
import type { Availability } from './catalogSidebarTypes';

type CatalogSidebarControlsProps = {
  categories: string[];
  category?: string;
  onSale?: boolean;
  minPriceDraft: string;
  maxPriceDraft: string;
  addedFromDraft: string;
  addedToDraft: string;
  availability?: Availability;
  tags: readonly string[];
  selectedSpecs: ReadonlyMap<string, string>;
  filterOptions?: ProductFilterOptionsResponse;
  filterOptionsLoading: boolean;
  filterOptionsError?: string;
  onCategoryChange: (category: string | undefined) => void;
  onSaleChange: (onSale: boolean) => void;
  onPriceDraftChange: (value: string, bound: 'min' | 'max') => void;
  onDateDraftChange: (value: string, bound: 'from' | 'to') => void;
  onAvailabilityChange: (value: Availability | undefined) => void;
  onTagChange: (tag: string, selected: boolean) => void;
  onSpecChange: (specificationKey: string, valueKey: string | undefined) => void;
};

export function CatalogSidebarControls({
  categories,
  category,
  onSale,
  minPriceDraft,
  maxPriceDraft,
  addedFromDraft,
  addedToDraft,
  availability,
  tags,
  selectedSpecs,
  filterOptions,
  filterOptionsLoading,
  filterOptionsError,
  onCategoryChange,
  onSaleChange,
  onPriceDraftChange,
  onDateDraftChange,
  onAvailabilityChange,
  onTagChange,
  onSpecChange,
}: CatalogSidebarControlsProps) {
  const { translate } = useLocalisation();
  const t = (key: keyof typeof discoveryMessages, params?: Record<string, string | number>) =>
    translate(discoveryMessages, key, params);
  return (
    <>
      <fieldset>
        <legend className="mb-2 text-sm font-semibold">{t('catalog.materialType')}</legend>
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:mx-0 lg:block lg:space-y-1 lg:overflow-visible lg:px-0 lg:pb-0">
          <CategoryChoice checked={!category} onChange={() => onCategoryChange(undefined)}>
            {t('catalog.allMaterials')}
          </CategoryChoice>
          {categories.map((item) => (
            <CategoryChoice
              key={item}
              checked={category === item}
              onChange={() => onCategoryChange(item)}
            >
              {item}
            </CategoryChoice>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-sm font-semibold">{t('catalog.offers')}</legend>
        <label className="flex cursor-pointer items-center gap-3 rounded-xl border bg-background p-3 text-sm font-medium">
          <input
            type="checkbox"
            checked={onSale === true}
            onChange={(event) => onSaleChange(event.target.checked)}
            className="size-4 accent-primary"
          />
          {t('catalog.onSale')}
        </label>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-sm font-semibold">{t('catalog.price')}</legend>
        <div className="grid grid-cols-2 gap-2">
          <DraftInput
            id="catalog-min-price"
            label={t('catalog.minimumCents')}
            type="number"
            value={minPriceDraft}
            onChange={(value) => onPriceDraftChange(value, 'min')}
          />
          <DraftInput
            id="catalog-max-price"
            label={t('catalog.maximumCents')}
            type="number"
            value={maxPriceDraft}
            onChange={(value) => onPriceDraftChange(value, 'max')}
          />
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-sm font-semibold">{t('catalog.dateAdded')}</legend>
        <div className="grid gap-2">
          <DraftInput
            id="catalog-added-from"
            label={t('catalog.from')}
            type="date"
            value={addedFromDraft}
            onChange={(value) => onDateDraftChange(value, 'from')}
          />
          <DraftInput
            id="catalog-added-to"
            label={t('catalog.to')}
            type="date"
            value={addedToDraft}
            onChange={(value) => onDateDraftChange(value, 'to')}
          />
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-sm font-semibold">{t('catalog.availability')}</legend>
        <div className="grid gap-2">
          <AvailabilityChoice
            checked={!availability}
            label={t('catalog.allAvailability')}
            onChange={() => onAvailabilityChange(undefined)}
          />
          <AvailabilityChoice
            checked={availability === 'available'}
            label={t('catalog.inStock')}
            value="available"
            onChange={() => onAvailabilityChange('available')}
          />
          <AvailabilityChoice
            checked={availability === 'backorder'}
            label={t('catalog.backorder')}
            value="backorder"
            onChange={() => onAvailabilityChange('backorder')}
          />
          <AvailabilityChoice
            checked={availability === 'out_of_stock'}
            label={t('catalog.outOfStock')}
            value="out_of_stock"
            onChange={() => onAvailabilityChange('out_of_stock')}
          />
        </div>
      </fieldset>
      {filterOptionsLoading ? (
        <p className="text-sm text-muted-foreground" role="status">
          {t('catalog.loadingMoreFilters')}
        </p>
      ) : filterOptionsError ? (
        <p className="text-sm text-muted-foreground" role="status">
          {t('catalog.moreFiltersUnavailable')}
        </p>
      ) : filterOptions ? (
        <>
          <fieldset>
            <legend className="mb-2 text-sm font-semibold">{t('catalog.tags')}</legend>
            <div className="grid gap-2">
              {filterOptions.tags.map((tag) => (
                <label key={tag.key} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={tags.includes(tag.key)}
                    onChange={(event) => onTagChange(tag.key, event.target.checked)}
                    className="size-4 accent-primary"
                  />
                  {tag.label}
                </label>
              ))}
            </div>
          </fieldset>
          {filterOptions.specificationGroups.map((group) => (
            <fieldset key={group.key}>
              <legend className="mb-2 text-sm font-semibold">{group.label}</legend>
              <div className="grid gap-3">
                {group.specifications.map((specification) => (
                  <label
                    key={specification.key}
                    className="grid gap-1 text-sm font-medium"
                    htmlFor={`catalog-spec-${specification.key}`}
                  >
                    {specification.label}
                    <select
                      id={`catalog-spec-${specification.key}`}
                      value={selectedSpecs.get(specification.key) ?? ''}
                      onChange={(event) =>
                        onSpecChange(specification.key, event.target.value || undefined)
                      }
                      className="h-10 rounded-lg border bg-background px-3 text-sm font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <option value="">
                        {t('catalog.any', { label: specification.label.toLowerCase() })}
                      </option>
                      {specification.values.map((value) => (
                        <option key={value.key} value={value.key}>
                          {value.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </>
      ) : null}
    </>
  );
}

function CategoryChoice({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: () => void;
  children: ReactNode;
}) {
  return (
    <label
      className={`flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${checked ? 'bg-accent font-semibold text-accent-foreground' : 'hover:bg-muted'}`}
    >
      <input
        type="radio"
        name="catalog-category"
        checked={checked}
        onChange={onChange}
        className="size-4 accent-primary"
      />
      {children}
    </label>
  );
}

function AvailabilityChoice({
  checked,
  label,
  value,
  onChange,
}: {
  checked: boolean;
  label: string;
  value?: Availability;
  onChange: () => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input
        type="radio"
        name="catalog-availability"
        value={value ?? ''}
        checked={checked}
        onChange={onChange}
        className="size-4 accent-primary"
      />
      {label}
    </label>
  );
}

function DraftInput({
  id,
  label,
  type,
  value,
  onChange,
}: {
  id: string;
  label: string;
  type: 'number' | 'date';
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid min-w-0 gap-1 text-xs font-medium text-muted-foreground" htmlFor={id}>
      {label}
      <input
        id={id}
        type={type}
        min={type === 'number' ? '0' : undefined}
        step={type === 'number' ? '1' : undefined}
        inputMode={type === 'number' ? 'numeric' : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 min-w-0 w-full rounded-lg border bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </label>
  );
}
