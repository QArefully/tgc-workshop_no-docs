import type { ProductFilterOptionsResponse, ProductQuery } from '@shop/contracts/products';

export type Availability = NonNullable<ProductQuery['availability']>;

export interface CatalogSidebarProps {
  categories: string[];
  category?: string;
  onSale?: boolean;
  query?: string;
  minPriceCents?: number;
  maxPriceCents?: number;
  addedFrom?: string;
  addedTo?: string;
  availability?: Availability;
  tags?: readonly string[];
  specs?: readonly string[];
  filterOptions?: ProductFilterOptionsResponse;
  filterOptionsLoading?: boolean;
  filterOptionsError?: string;
  hasFilters: boolean;
  onCategoryChange: (category: string | undefined) => void;
  onSaleChange: (onSale: boolean) => void;
  onQueryClear: () => void;
  onPriceRangeChange: (min: number | undefined, max: number | undefined) => void;
  onDateRangeChange: (from: string | undefined, to: string | undefined) => void;
  onAvailabilityChange: (value: Availability | undefined) => void;
  onTagChange: (tag: string, selected: boolean) => void;
  onSpecChange: (specificationKey: string, valueKey: string | undefined) => void;
  onClearFilters: () => void;
}
