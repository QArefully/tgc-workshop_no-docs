import type { ProductQuery, ProductSort } from '@shop/contracts/products';

export type CatalogParamKey = keyof ProductQuery;
export type CatalogParamValue = string | readonly string[] | null;

const MAX_REPEATED_FILTERS = 8;
const NORMALIZED_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SORTS = new Set<ProductSort>([
  'newest',
  'oldest',
  'name_asc',
  'price_asc',
  'price_desc',
  'bestselling',
]);
const SUPPORTED_PAGE_SIZES = new Set([12, 24, 48]);

export const CATALOG_DISCOVERY_PARAM_KEYS: readonly CatalogParamKey[] = [
  'q',
  'category',
  'onSale',
  'minPriceCents',
  'maxPriceCents',
  'addedFrom',
  'addedTo',
  'tag',
  'spec',
  'availability',
];

function isNormalizedKey(value: string): boolean {
  return value.length <= 64 && NORMALIZED_KEY.test(value);
}

function parseBoundedInteger(
  value: string | null,
  minimum: number,
  maximum: number,
): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : undefined;
}

function parseDate(value: string | null): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [yearText, monthText, dayText] = value.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
    ? value
    : undefined;
}

function sortedUnique(values: readonly string[], predicate: (value: string) => boolean): string[] {
  return [...new Set(values.filter(predicate))].sort().slice(0, MAX_REPEATED_FILTERS);
}

function normalizedSpecifications(values: readonly string[]): string[] {
  const specifications = sortedUnique(values, (token) => {
    const [key, valueKey, ...extra] = token.split(':');
    return (
      extra.length === 0 && !!key && !!valueKey && isNormalizedKey(key) && isNormalizedKey(valueKey)
    );
  });
  const seenKeys = new Set<string>();
  return specifications.filter((token) => {
    const key = token.slice(0, token.indexOf(':'));
    if (seenKeys.has(key)) return false;
    seenKeys.add(key);
    return true;
  });
}

/** Parses a browser URL into the valid, locally renderable catalog query state. */
export function parseCatalogQuery(searchParams: URLSearchParams): ProductQuery {
  const q = searchParams.get('q');
  const category = searchParams.get('category');
  const minPriceCents = parseBoundedInteger(searchParams.get('minPriceCents'), 0, 1_000_000_000);
  const maxPriceCents = parseBoundedInteger(searchParams.get('maxPriceCents'), 0, 1_000_000_000);
  const addedFrom = parseDate(searchParams.get('addedFrom'));
  const addedTo = parseDate(searchParams.get('addedTo'));
  const sortCandidate = searchParams.get('sort');
  const sort =
    sortCandidate && SORTS.has(sortCandidate as ProductSort)
      ? (sortCandidate as ProductSort)
      : undefined;
  const availabilityCandidate = searchParams.get('availability');
  const availability =
    availabilityCandidate === 'available' ||
    availabilityCandidate === 'backorder' ||
    availabilityCandidate === 'out_of_stock'
      ? availabilityCandidate
      : undefined;
  const page = parseBoundedInteger(searchParams.get('page'), 1, 10_000) ?? 1;
  const pageSizeCandidate = parseBoundedInteger(searchParams.get('pageSize'), 1, 48);
  const pageSize =
    pageSizeCandidate && SUPPORTED_PAGE_SIZES.has(pageSizeCandidate)
      ? pageSizeCandidate
      : undefined;
  const tags = sortedUnique(searchParams.getAll('tag'), isNormalizedKey);
  const specifications = normalizedSpecifications(searchParams.getAll('spec'));

  return {
    ...(q && q.length <= 200 ? { q } : {}),
    ...(category && category.length <= 100 ? { category } : {}),
    ...(searchParams.get('onSale') === 'true' ? { onSale: true } : {}),
    ...(minPriceCents !== undefined &&
    (maxPriceCents === undefined || minPriceCents <= maxPriceCents)
      ? { minPriceCents }
      : {}),
    ...(maxPriceCents !== undefined &&
    (minPriceCents === undefined || minPriceCents <= maxPriceCents)
      ? { maxPriceCents }
      : {}),
    ...(addedFrom && (!addedTo || addedFrom <= addedTo) ? { addedFrom } : {}),
    ...(addedTo && (!addedFrom || addedFrom <= addedTo) ? { addedTo } : {}),
    ...(tags.length > 0 ? { tag: tags } : {}),
    ...(specifications.length > 0 ? { spec: specifications } : {}),
    ...(availability ? { availability } : {}),
    ...(sort && sort !== 'newest' ? { sort } : {}),
    page,
    ...(pageSize ? { pageSize } : {}),
  };
}

/** Serializes a normalized query in a stable form for URLs and API requests. */
export function serializeCatalogQuery(query: ProductQuery = {}): URLSearchParams {
  const searchParams = new URLSearchParams();
  if (query.q) searchParams.set('q', query.q);
  if (query.category) searchParams.set('category', query.category);
  if (query.onSale) searchParams.set('onSale', 'true');
  if (query.minPriceCents !== undefined)
    searchParams.set('minPriceCents', String(query.minPriceCents));
  if (query.maxPriceCents !== undefined)
    searchParams.set('maxPriceCents', String(query.maxPriceCents));
  if (query.addedFrom) searchParams.set('addedFrom', query.addedFrom);
  if (query.addedTo) searchParams.set('addedTo', query.addedTo);
  for (const tag of sortedUnique(query.tag ?? [], isNormalizedKey)) searchParams.append('tag', tag);
  for (const specification of normalizedSpecifications(query.spec ?? [])) {
    searchParams.append('spec', specification);
  }
  if (query.availability) searchParams.set('availability', query.availability);
  if (query.sort && query.sort !== 'newest') searchParams.set('sort', query.sort);
  if (query.page && query.page > 1) searchParams.set('page', String(query.page));
  if (query.pageSize) searchParams.set('pageSize', String(query.pageSize));
  return searchParams;
}
