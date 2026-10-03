import { useCallback, useEffect, useRef, useState } from 'react';
import type { DeliverySlotOptionsResponse } from '@shop/contracts/delivery';
import { getDeliverySlotOptions } from '@/api/deliverySlots';
import { useOptionalCountry } from '@/hooks/CountryContext';
import { useLocalisation } from '@/i18n/LocaleContext';
import { checkoutErrorState, localizeCheckoutError } from './checkoutCopy';
import type { CheckoutErrorState } from './checkoutState';

export interface DeliverySlotsState {
  /** Server-offered slots plus the lead-time reason, or `null` before the first success. */
  options: DeliverySlotOptionsResponse | null;
  loading: boolean;
  /** Buyer-facing load failure, cleared by a successful reload. */
  error: string | null;
  /** Stable failure identity for callers that need code/meta branching. */
  errorState: CheckoutErrorState | null;
  reload: () => void;
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/**
 * Loads the bookable delivery slots for the current cart.
 *
 * Lead time follows consignment weight, so a cart edit invalidates the offered list: the hook
 * refetches whenever the cart quote changes. Each request carries a generation number and an
 * `AbortController`, so a slow response for a superseded cart is both aborted and discarded and
 * can never repopulate the picker with slots derived from a stale consignment.
 *
 * @param cartId active cart, `null` while the cart is unavailable
 * @param quoteKey identity of the cart contents; a change re-derives the offered slots
 */
export function useDeliverySlots(cartId: string | null, quoteKey: string | null) {
  const { activeCountry } = useOptionalCountry();
  const { translate } = useLocalisation();
  const [options, setOptions] = useState<DeliverySlotOptionsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorState, setErrorState] = useState<CheckoutErrorState | null>(null);
  const generation = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!cartId) {
      setOptions(null);
      setLoading(false);
      setErrorState(null);
      return;
    }
    const current = ++generation.current;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setLoading(true);
    setErrorState(null);

    void (async () => {
      try {
        const response = await getDeliverySlotOptions(cartId, { signal: controller.signal });
        if (current !== generation.current) return;
        setOptions(response);
        setErrorState(null);
      } catch (caught) {
        if (isAbort(caught) || current !== generation.current) return;
        setOptions(null);
        setErrorState(checkoutErrorState(caught, 'checkout.deliverySlotsUnavailable'));
      } finally {
        if (current === generation.current) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [activeCountry, cartId, quoteKey, reloadToken]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  const error = localizeCheckoutError(errorState, translate);
  return { options, loading, error, errorState, reload } satisfies DeliverySlotsState;
}
