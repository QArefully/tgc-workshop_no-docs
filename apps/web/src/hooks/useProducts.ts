import { useState, useEffect, useCallback, useRef } from 'react';
import { getProducts } from '../api/products';
import { ApiError } from '@/api/client';
import type { VariantProductList } from '../api/products';
import type { GetProductsParams } from '../api/products';
import { serializeCatalogQuery } from '@/catalogQuery';
import { useOptionalCountry } from '@/hooks/CountryContext';
import { useLocalisation } from '@/i18n/LocaleContext';
import type { MessageCatalog, MessageParams } from '@shop/localisation';
import { apiErrors } from '@shop/localisation/messages/apiErrors';
import { productMessages } from '@shop/localisation/messages/product';

function localizeLoadError(
  error: unknown,
  translate: (catalog: MessageCatalog, key: string, params?: MessageParams) => string,
): string {
  if (error instanceof ApiError && error.code !== null) {
    try {
      const params = Object.fromEntries(
        Object.entries(error.meta ?? {}).filter(
          ([, value]) =>
            typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint',
        ),
      ) as MessageParams;
      return translate(apiErrors, error.code, params);
    } catch {
      // Use the feature fallback when a stale code or metadata descriptor is not in the catalog.
    }
  }
  return translate(productMessages, 'product.couldNotLoad');
}

export type UseProductsParams = GetProductsParams;

export function useProducts(params?: UseProductsParams) {
  const { activeCountry } = useOptionalCountry();
  const { translate } = useLocalisation();
  const paramsKey = serializeCatalogQuery(params).toString();
  const requestKey = `${activeCountry}|${paramsKey}`;
  const [products, setProducts] = useState<VariantProductList['items']>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [fulfilledParamsKey, setFulfilledParamsKey] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(params?.page ?? 1);
  const [currentPageSize, setCurrentPageSize] = useState(params?.pageSize ?? 12);

  const mountedRef = useRef(false);
  const requestIdRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchProducts = useCallback(
    async (fetchParams?: GetProductsParams) => {
      if (!mountedRef.current) return;
      const requestId = ++requestIdRef.current;
      abortControllerRef.current?.abort();
      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      const isCurrentRequest = () =>
        mountedRef.current && requestId === requestIdRef.current && !abortController.signal.aborted;

      // A pending query must not be presented with the prior query's cards. This also gives
      // manual refreshes the same unambiguous loading state as query transitions.
      setProducts([]);
      setTotal(0);
      setIsLoading(true);
      setError(null);
      setFulfilledParamsKey(null);
      try {
        const data = await getProducts(fetchParams ?? params, abortController.signal);
        if (!isCurrentRequest()) return;
        setProducts(data.items);
        setTotal(data.total);
        setCurrentPage(data.page);
        setCurrentPageSize(data.pageSize);
        setFulfilledParamsKey(requestKey);
      } catch (err) {
        if (!isCurrentRequest()) return;
        setError(localizeLoadError(err, translate));
      } finally {
        if (isCurrentRequest()) setIsLoading(false);
      }
    },
    [requestKey, translate],
  );

  useEffect(() => {
    mountedRef.current = true;
    void fetchProducts();
    return () => {
      mountedRef.current = false;
      ++requestIdRef.current;
      abortControllerRef.current?.abort();
    };
  }, [fetchProducts]);

  const hasFulfilledCurrentParams = fulfilledParamsKey === requestKey;

  return {
    products: hasFulfilledCurrentParams ? products : [],
    isLoading: isLoading || !hasFulfilledCurrentParams,
    error: hasFulfilledCurrentParams ? error : null,
    total: hasFulfilledCurrentParams ? total : 0,
    currentPage,
    currentPageSize,
    refetch: () => fetchProducts(),
  };
}
