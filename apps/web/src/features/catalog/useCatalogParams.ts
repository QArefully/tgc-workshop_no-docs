import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  CATALOG_DISCOVERY_PARAM_KEYS,
  type CatalogParamKey,
  type CatalogParamValue,
  parseCatalogQuery,
  serializeCatalogQuery,
} from '@/catalogQuery';
import type { ProductQuery } from '@shop/contracts/products';

export function useCatalogParams() {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = parseCatalogQuery(searchParams);

  const setParams = useCallback(
    (
      values: Partial<Record<CatalogParamKey, CatalogParamValue>>,
      normalize?: (query: ProductQuery) => ProductQuery,
    ) =>
      setSearchParams((previous) => {
        const next = new URLSearchParams(previous);
        for (const [key, value] of Object.entries(values) as [
          CatalogParamKey,
          CatalogParamValue,
        ][]) {
          next.delete(key);
          if (value !== null) {
            const entries: readonly string[] = typeof value === 'string' ? [value] : value;
            for (const item of entries) next.append(key, item);
          }
        }
        if (Object.keys(values).some((key) => key !== 'page')) next.delete('page');
        return serializeCatalogQuery(
          normalize?.(parseCatalogQuery(next)) ?? parseCatalogQuery(next),
        );
      }),
    [setSearchParams],
  );
  const setParam = useCallback(
    (
      key: CatalogParamKey,
      value: CatalogParamValue,
      normalize?: (query: ProductQuery) => ProductQuery,
    ) => setParams({ [key]: value }, normalize),
    [setParams],
  );
  const clearFilters = useCallback(
    () =>
      setSearchParams((previous) => {
        const next = new URLSearchParams(previous);
        [...CATALOG_DISCOVERY_PARAM_KEYS, 'page'].forEach((key) => next.delete(key));
        return serializeCatalogQuery(parseCatalogQuery(next));
      }),
    [setSearchParams],
  );

  return {
    ...query,
    page: query.page ?? 1,
    pageSize: query.pageSize ?? 12,
    setParam,
    setParams,
    clearFilters,
  };
}
