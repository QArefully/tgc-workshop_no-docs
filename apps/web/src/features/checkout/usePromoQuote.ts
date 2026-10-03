import { useCallback, useRef } from 'react';
import { validatePromo } from '@/api/promo';
import { isMissingCartError } from '@/api/client';
import { useOptionalCountry } from '@/hooks/CountryContext';
import { useLocalisation } from '@/i18n/LocaleContext';
import { checkoutMessages } from '@shop/localisation/messages/checkout';
import type { CheckoutEvent } from './checkoutState';
import { checkoutCodeToken, checkoutErrorState } from './checkoutCopy';
import type { CheckoutErrorState } from './checkoutState';

type UsePromoQuoteArgs = {
  cartId: string | null;
  cartPresent: boolean;
  quoteKey: string | null;
  promoCode: string;
  dispatch: React.Dispatch<CheckoutEvent>;
  retryCart: () => Promise<boolean>;
};

function createPromoRequestToken(
  country: string,
  cartId: string,
  quoteKey: string,
  promoCode: string,
): string {
  return JSON.stringify([country, cartId, quoteKey, promoCode.trim()]);
}

type PromoRequest = { candidate: string; generation: number };

export function usePromoQuote({
  cartId,
  cartPresent,
  quoteKey,
  promoCode,
  dispatch,
  retryCart,
}: UsePromoQuoteArgs) {
  const { activeCountry } = useOptionalCountry();
  const { translate } = useLocalisation();
  const candidateRef = useRef<string | null>(null);
  const generationRef = useRef(0);
  const activeRequest = useRef<PromoRequest | null>(null);
  const normalizedPromoCode = promoCode.trim();
  const currentCandidate =
    cartId && quoteKey && normalizedPromoCode
      ? createPromoRequestToken(activeCountry, cartId, quoteKey, normalizedPromoCode)
      : null;
  if (candidateRef.current !== currentCandidate) {
    candidateRef.current = currentCandidate;
    generationRef.current += 1;
  }

  return useCallback(async () => {
    if (!cartId || !cartPresent || !quoteKey || !normalizedPromoCode || !currentCandidate) return;

    const requestedQuoteKey = quoteKey;
    const requested: PromoRequest = {
      candidate: currentCandidate,
      generation: generationRef.current,
    };
    if (
      activeRequest.current?.candidate === requested.candidate &&
      activeRequest.current.generation === requested.generation
    ) {
      return;
    }
    const isCurrent = () =>
      candidateRef.current === requested.candidate &&
      generationRef.current === requested.generation;

    activeRequest.current = requested;
    if (!isCurrent()) return;
    dispatch({ type: 'promo-started' });
    try {
      const result = await validatePromo(cartId, normalizedPromoCode);
      if (!isCurrent()) return;
      if (
        result.valid &&
        result.promoCode &&
        result.discountCents !== undefined &&
        result.totalCents !== undefined
      ) {
        dispatch({
          type: 'promo-applied',
          promoCode: result.promoCode.code,
          quoteKey: requestedQuoteKey,
          discountCents: result.discountCents,
          discountBaseCents: result.discountBaseCents ?? null,
          promoCategoryScope: result.promoCode.categoryScope ?? null,
          totalCents: result.totalCents,
        });
      } else {
        const failure = promoResultErrorState(result.errorCode, result.minSubtotalCents);
        dispatch({
          type: 'promo-failed',
          error: checkoutCodeToken(failure),
          errorState: failure,
          errorCode: result.errorCode ?? null,
          minSubtotalCents: result.minSubtotalCents ?? null,
        });
      }
    } catch (error) {
      if (!isCurrent()) return;
      if (isMissingCartError(error)) {
        const recovered = await retryCart();
        if (!isCurrent()) return;
        dispatch({
          type: 'cart-recovered',
          message: recovered
            ? translate(checkoutMessages, 'checkout.cartRecovered')
            : translate(checkoutMessages, 'checkout.cartRecoveryFailed'),
        });
      } else {
        const failure = checkoutErrorState(error, 'checkout.promoError.generic');
        dispatch({
          type: 'promo-failed',
          error: checkoutCodeToken(failure),
          errorState: failure,
          errorCode: null,
        });
      }
    } finally {
      if (
        activeRequest.current?.candidate === requested.candidate &&
        activeRequest.current.generation === requested.generation &&
        isCurrent()
      ) {
        activeRequest.current = null;
      }
    }
  }, [
    activeCountry,
    cartId,
    cartPresent,
    currentCandidate,
    dispatch,
    normalizedPromoCode,
    quoteKey,
    retryCart,
    translate,
  ]);
}

function promoResultErrorState(
  code: Awaited<ReturnType<typeof validatePromo>>['errorCode'],
  minSubtotalCents: number | undefined,
): CheckoutErrorState {
  const publicCode =
    code === 'EXPIRED'
      ? 'PROMO_EXPIRED'
      : code === 'NOT_STARTED'
        ? 'PROMO_NOT_STARTED'
        : code === 'MIN_ITEMS'
          ? 'PROMO_MIN_ITEMS'
          : code === 'MIN_SUBTOTAL'
            ? 'PROMO_MIN_SUBTOTAL'
            : code === 'USAGE_LIMIT'
              ? 'PROMO_USAGE_LIMIT'
              : code === 'AUTH_REQUIRED'
                ? 'AUTH_REQUIRED'
                : code === 'CATEGORY_MISMATCH'
                  ? 'PROMO_CATEGORY_MISMATCH'
                  : code === 'INVALID'
                    ? 'PROMO_INVALID'
                    : null;
  return {
    code: publicCode,
    meta:
      publicCode === 'PROMO_MIN_SUBTOTAL' && minSubtotalCents !== undefined
        ? { minSubtotalCents }
        : null,
    key:
      code === 'CATEGORY_MISMATCH'
        ? 'checkout.promoCategoryMismatch'
        : 'checkout.promoError.invalid',
  };
}
