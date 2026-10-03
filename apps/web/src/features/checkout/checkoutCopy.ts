import type { PublicErrorCode } from '@shop/contracts/public-errors';
import type { MessageCatalog, MessageParams } from '@shop/localisation';
import { apiErrors } from '@shop/localisation/messages/apiErrors';
import { checkoutMessages } from '@shop/localisation/messages/checkout';
import type { CheckoutErrorState, CheckoutMessageKey } from './checkoutState';
import { ApiError } from '@/api/client';

export type CheckoutTranslate = (
  key: CheckoutMessageKey,
  params?: Record<string, string | number>,
) => string;

export function safeMessageParams(meta: CheckoutErrorState['meta']): MessageParams {
  if (meta === null || typeof meta !== 'object') return {};
  const params: Record<string, string | number | bigint> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint')
      params[key] = value;
  }
  return params;
}

/** Convert transport/unknown failures to stable identity; never retain prose. */
export function checkoutErrorState(
  cause: unknown,
  fallback: CheckoutMessageKey,
): CheckoutErrorState {
  if (cause instanceof ApiError && cause.isNetworkError) {
    return { code: null, meta: null, key: 'checkout.error.network' };
  }
  if (cause instanceof ApiError && cause.code !== null) {
    return { code: cause.code, meta: cause.meta, key: fallback };
  }
  return { code: null, meta: null, key: fallback };
}

export function localizeCheckoutError(
  state: CheckoutErrorState | null,
  translate: (catalog: MessageCatalog, key: string, params?: MessageParams) => string,
): string | null {
  if (state === null) return null;
  if (state.code !== null) {
    try {
      return translate(apiErrors, state.code, safeMessageParams(state.meta));
    } catch {
      // Unknown/malformed metadata falls through to safe checkout copy.
    }
  }
  return translate(checkoutMessages, state.key, state.params ?? {});
}

const tradeCreditPaymentErrorKeys: Partial<Record<PublicErrorCode, CheckoutMessageKey>> = {
  CREDIT_LIMIT_EXCEEDED: 'checkout.credit.error.limitExceeded',
  CREDIT_ACCOUNT_ON_HOLD: 'checkout.credit.error.onHold',
  CREDIT_ACCOUNT_SUSPENDED: 'checkout.credit.error.suspended',
  CREDIT_NOT_ELIGIBLE: 'checkout.credit.error',
  CREDIT_PAYMENT_UNAVAILABLE: 'checkout.credit.error',
  COMPANY_REQUIRED: 'checkout.credit.error',
  PAYMENT_METHOD_INVALID: 'checkout.credit.error',
  CARD_FIELDS_FORBIDDEN: 'checkout.credit.error',
};

/** Render payment failures with checkout-specific trade-credit guidance when that branch fails. */
export function localizeTradeCreditError(
  state: CheckoutErrorState | null | undefined,
  translate: (catalog: MessageCatalog, key: string, params?: MessageParams) => string,
): string | null {
  if (state === null || state === undefined) return null;
  const key = state.code === null ? undefined : tradeCreditPaymentErrorKeys[state.code];
  if (key) return translate(checkoutMessages, key, state.params ?? {});
  return localizeCheckoutError(state, translate);
}

export function checkoutCodeToken(state: CheckoutErrorState): string {
  return state.code ?? state.key;
}

/** Map legacy validation prose to stable checkout message keys at the rendering boundary. */
export function translateValidationError(error: string, t: CheckoutTranslate): string {
  switch (error) {
    case 'Name is required':
      return t('checkout.validation.nameRequired');
    case 'Email is required':
      return t('checkout.validation.emailRequired');
    case 'Enter a valid email':
      return t('checkout.validation.emailInvalid');
    case 'Select a delivery site':
      return t('checkout.validation.deliverySite');
    case 'Choose a delivery slot':
      return t('checkout.validation.deliverySlot');
    case 'That slot is no longer offered. Choose another.':
      return t('checkout.validation.deliverySlotGone');
    case 'Select a billing account':
      return t('checkout.validation.billingAccount');
    case 'Legal entity name is required':
      return t('checkout.validation.legalNameRequired');
    case 'Enter a valid card number':
      return t('checkout.validation.cardNumber');
    case 'Enter expiry as MM/YY':
      return t('checkout.validation.cardExpiry');
    case 'Enter a valid CVC':
      return t('checkout.validation.cardCvc');
    default:
      break;
  }
  const max = /^(.*) must be (\d+) characters or fewer$/.exec(error);
  if (max)
    return t('checkout.validation.maxChars', { label: localizeLabel(max[1]!, t), max: max[2]! });
  const markup = /^(.*) cannot contain < or >$/.exec(error);
  if (markup) return t('checkout.validation.noMarkup', { label: localizeLabel(markup[1]!, t) });
  return error;
}

function localizeLabel(label: string, t: CheckoutTranslate): string {
  switch (label) {
    case 'Legal entity name':
      return t('checkout.legalName');
    case 'Registration number':
      return t('checkout.registrationNumber');
    case 'VAT number':
      return t('checkout.vatNumber');
    case 'Purchase order reference':
      return t('checkout.purchaseOrderReference');
    default:
      return label;
  }
}

/** Resolve safe coded payment failures; unknown legacy/network text remains available as fallback. */
export function translatePaymentError(
  code: PublicErrorCode | null | undefined,
  status: number | null | undefined,
  fallback: CheckoutErrorState | string | null | undefined,
  t: CheckoutTranslate,
): string {
  void fallback;
  const tradeCreditKey =
    code === null || code === undefined ? undefined : tradeCreditPaymentErrorKeys[code];
  if (tradeCreditKey) return t(tradeCreditKey);
  if (code === 'CARD_INVALID') return t('checkout.paymentError.invalid');
  if (code === 'CARD_DECLINED' || code === 'DECLINED') return t('checkout.paymentError.declined');
  if (code === 'GATEWAY_TIMEOUT' || code === 'TIMEOUT') return t('checkout.paymentError.timeout');
  if (status === 402) return t('checkout.paymentError.generic');
  return t('checkout.paymentError.generic');
}
