import { isNormalizedCatalogKey } from '@shop/catalog';
import {
  catalogSpecificationByKey,
  type CatalogSpecificationKey,
} from './catalogSpecifications.js';
import type { ProductQuery, ProductSort } from '@shop/contracts/products';

export class CatalogQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CatalogQueryError';
  }
}

export interface CatalogSpecificationFilter {
  key: CatalogSpecificationKey;
  valueKey: string;
}

export interface NormalizedCatalogQuery {
  q?: string;
  category?: string;
  onSale?: boolean;
  minPriceCents?: number;
  maxPriceCents?: number;
  addedFrom?: string;
  addedTo?: string;
  tags: readonly string[];
  specifications: readonly CatalogSpecificationFilter[];
  availability?: 'available' | 'backorder' | 'out_of_stock';
  sort: ProductSort;
  page: number;
  pageSize: number;
}

function parseCatalogDate(value: string, field: 'addedFrom' | 'addedTo'): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new CatalogQueryError(`${field} must be a valid YYYY-MM-DD date`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new CatalogQueryError(`${field} must be a valid YYYY-MM-DD date`);
  }
  return value;
}

function parseSpecification(token: string): CatalogSpecificationFilter {
  const separator = token.indexOf(':');
  const key = token.slice(0, separator);
  const valueKey = token.slice(separator + 1);
  const definition = catalogSpecificationByKey.get(key as CatalogSpecificationKey);
  if (!definition || !definition.filterable) {
    throw new CatalogQueryError(`Unsupported specification filter: ${key}`);
  }
  if (!isNormalizedCatalogKey(valueKey)) {
    throw new CatalogQueryError(`Invalid specification filter: ${token}`);
  }
  return { key: definition.key, valueKey };
}

/** Converts transport query values into one safe, cross-field validated domain query. */
export function normalizeCatalogQuery(query: ProductQuery): NormalizedCatalogQuery {
  if (
    query.minPriceCents !== undefined &&
    query.maxPriceCents !== undefined &&
    query.minPriceCents > query.maxPriceCents
  ) {
    throw new CatalogQueryError('minPriceCents must be less than or equal to maxPriceCents');
  }

  const addedFrom = query.addedFrom ? parseCatalogDate(query.addedFrom, 'addedFrom') : undefined;
  const addedTo = query.addedTo ? parseCatalogDate(query.addedTo, 'addedTo') : undefined;
  if (addedFrom && addedTo && addedFrom > addedTo) {
    throw new CatalogQueryError('addedFrom must be on or before addedTo');
  }

  const tags = [...new Set(query.tag ?? [])];
  for (const tag of tags) {
    if (!isNormalizedCatalogKey(tag)) throw new CatalogQueryError(`Invalid tag filter: ${tag}`);
  }

  const specifications = (query.spec ?? []).map(parseSpecification);
  const duplicateSpecification = specifications.find(
    (specification, index) =>
      specifications.findIndex((candidate) => candidate.key === specification.key) !== index,
  );
  if (duplicateSpecification) {
    throw new CatalogQueryError(`Duplicate specification filter: ${duplicateSpecification.key}`);
  }

  return {
    ...(query.q ? { q: query.q } : {}),
    ...(query.category ? { category: query.category } : {}),
    ...(query.onSale === true ? { onSale: true } : {}),
    ...(query.minPriceCents !== undefined ? { minPriceCents: query.minPriceCents } : {}),
    ...(query.maxPriceCents !== undefined ? { maxPriceCents: query.maxPriceCents } : {}),
    ...(addedFrom ? { addedFrom } : {}),
    ...(addedTo ? { addedTo } : {}),
    tags,
    specifications,
    ...(query.availability ? { availability: query.availability } : {}),
    sort: query.sort ?? 'newest',
    page: query.page ?? 1,
    pageSize: query.pageSize ?? 12,
  };
}
