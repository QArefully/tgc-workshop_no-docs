import { useCallback, useEffect, useRef, useState } from 'react';
import type { CuratedBundle } from '@shop/contracts/bundles';
import { getBundles } from '@/api/bundles';
import { useOptionalCountry } from '@/hooks/CountryContext';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Failed to load bundles';
}

/** Loads current bundle prices and availability independently from cart state. */
export function useBundles(productId?: string) {
  const { activeCountry } = useOptionalCountry();
  const [bundles, setBundles] = useState<readonly CuratedBundle[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(false);

  const load = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const request = ++requestRef.current;
    if (mountedRef.current) {
      setBundles([]);
      setIsLoading(true);
      setError(null);
    }
    try {
      const response = await getBundles(productId, controller.signal);
      if (mountedRef.current && !controller.signal.aborted && request === requestRef.current)
        setBundles(response);
    } catch (error) {
      if (!mountedRef.current || controller.signal.aborted || request !== requestRef.current)
        return;
      setError(errorMessage(error));
    } finally {
      if (mountedRef.current && !controller.signal.aborted && request === requestRef.current)
        setIsLoading(false);
    }
  }, [activeCountry, productId]);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
      requestRef.current += 1;
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, [load]);

  return { bundles, error, isLoading, refetch: load };
}
