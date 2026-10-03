import { useState, useEffect, useCallback } from 'react';
import { getCategories } from '../api/products';
import { ApiError } from '@/api/client';
import { useOptionalCountry } from '@/hooks/CountryContext';
import { useLocalisation } from '@/i18n/LocaleContext';
import { apiErrors } from '@shop/localisation/messages/apiErrors';
import { webMessages } from '@shop/localisation/messages/webShell';
import type { MessageCatalog, MessageParams } from '@shop/localisation';

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
  return translate(webMessages, 'home.categoriesUnavailable');
}

/**
 * Fetches distinct, sorted category names from the API.
 * Does not include "All" — that label lives in the UI layer.
 */
export function useCategories(): {
  categories: string[];
  isLoading: boolean;
  error: string | null;
} {
  const { activeCountry } = useOptionalCountry();
  const { translate } = useLocalisation();
  const [categories, setCategories] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestNumber] = useState(() => ({ current: 0 }));

  const fetchCategories = useCallback(async () => {
    const request = ++requestNumber.current;
    setIsLoading(true);
    setError(null);
    try {
      const data = await getCategories();
      if (request === requestNumber.current) setCategories(data);
    } catch (err) {
      if (request === requestNumber.current) setError(localizeLoadError(err, translate));
    } finally {
      if (request === requestNumber.current) setIsLoading(false);
    }
  }, [requestNumber, translate]);

  useEffect(() => {
    void fetchCategories();
  }, [activeCountry, fetchCategories]);

  return { categories, isLoading, error };
}
