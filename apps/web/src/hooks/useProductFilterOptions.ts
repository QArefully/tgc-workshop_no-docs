import { useCallback, useEffect, useRef, useState } from 'react';
import { getProductFilterOptions } from '@/api/products';
import { ApiError } from '@/api/client';
import type { ProductFilterOptionsResponse } from '@shop/contracts/products';
import { useOptionalCountry } from '@/hooks/CountryContext';
import { useLocalisation } from '@/i18n/LocaleContext';
import type { MessageCatalog, MessageParams } from '@shop/localisation';
import { apiErrors } from '@shop/localisation/messages/apiErrors';
import { discoveryMessages } from '@shop/localisation/messages/discovery';

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
  return translate(discoveryMessages, 'catalog.moreFiltersUnavailable');
}

export function useProductFilterOptions() {
  const { activeCountry } = useOptionalCountry();
  const { translate } = useLocalisation();
  const [options, setOptions] = useState<ProductFilterOptionsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const refetch = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setIsLoading(true);
    setError(null);
    try {
      const response = await getProductFilterOptions(controller.signal);
      if (!controller.signal.aborted) setOptions(response);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(localizeLoadError(cause, translate));
      }
    } finally {
      if (!controller.signal.aborted) setIsLoading(false);
    }
  }, [activeCountry, translate]);

  useEffect(() => {
    void refetch();
    return () => controllerRef.current?.abort();
  }, [refetch]);

  return { options, isLoading, error, refetch };
}
