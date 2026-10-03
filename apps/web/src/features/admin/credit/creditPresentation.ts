import type { InvoiceLifecycleStatus, TradeCreditState } from '@shop/contracts/trade-credit';
import type { MessageParams } from '@shop/localisation';
import { apiErrors } from '@shop/localisation/messages/apiErrors';
import {
  adminCommerceMessages,
  type AdminCommerceMessageKey,
} from '@shop/localisation/messages/adminCommerce';
import { ApiError } from '@/api/client';

export const ADMIN_CREDIT_PAGE_SIZE = 25;

export const CREDIT_STATES = [
  'active',
  'on_hold',
  'suspended',
] as const satisfies readonly TradeCreditState[];
export const INVOICE_STATUSES = [
  'open',
  'overdue',
  'paid',
  'voided',
] as const satisfies readonly InvoiceLifecycleStatus[];

export type Translate = (key: AdminCommerceMessageKey, params?: MessageParams) => string;
export type TranslateApiError = (key: string, params?: MessageParams) => string;

export const creditStateMessageKeys: Record<TradeCreditState, AdminCommerceMessageKey> = {
  active: 'adminCommerce.credit.state.active',
  on_hold: 'adminCommerce.credit.state.on_hold',
  suspended: 'adminCommerce.credit.state.suspended',
};

export const invoiceStatusMessageKeys: Record<InvoiceLifecycleStatus, AdminCommerceMessageKey> = {
  open: 'adminCommerce.invoice.status.open',
  overdue: 'adminCommerce.invoice.status.overdue',
  paid: 'adminCommerce.invoice.status.paid',
  voided: 'adminCommerce.invoice.status.voided',
};

export function messageTranslator(translate: TranslateApiError) {
  return (key: AdminCommerceMessageKey, params: MessageParams = {}) => translate(key, params);
}

function errorParams(error: ApiError): MessageParams {
  if (!error.meta || typeof error.meta !== 'object') return {};
  const params: Record<string, string | number | bigint> = {};
  for (const [key, value] of Object.entries(error.meta)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint')
      params[key] = value;
  }
  return params;
}

/** Presents only localized copy for request failures; server diagnostics never cross the UI. */
export function localizeAdminCreditError(
  error: unknown,
  fallback: AdminCommerceMessageKey,
  t: Translate,
  translateApiError: TranslateApiError,
): string {
  if (error instanceof ApiError && error.code && error.code in apiErrors)
    return translateApiError(error.code, errorParams(error));
  return t(fallback);
}

/** Parses a GBP decimal without floating-point rounding or locale ambiguity. */
export function parseGbpToPence(value: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const [pounds = '', pennies = ''] = value.split('.');
  const digits = `${pounds}${pennies.padEnd(2, '0')}`;
  try {
    const pence = BigInt(digits);
    const maximum = BigInt(Number.MAX_SAFE_INTEGER);
    return pence <= maximum ? Number(pence) : null;
  } catch {
    return null;
  }
}

// Naming aliases keep the exact parser easy to find from amount-oriented callers.
export const parseGbpPence = parseGbpToPence;
export const parseGbpAmountToPence = parseGbpToPence;

export function readPositivePage(value: string | null): number {
  const page = Number(value);
  return Number.isSafeInteger(page) && page >= 1 && page <= 10_000 ? page : 1;
}

export function readCreditState(value: string | null): TradeCreditState | undefined {
  return CREDIT_STATES.includes(value as TradeCreditState)
    ? (value as TradeCreditState)
    : undefined;
}

export function readInvoiceStatus(value: string | null): InvoiceLifecycleStatus | undefined {
  return INVOICE_STATUSES.includes(value as InvoiceLifecycleStatus)
    ? (value as InvoiceLifecycleStatus)
    : undefined;
}

export function readCompanyId(value: string | null): string | undefined {
  return value && /^[1-9][0-9]*$/.test(value) ? value : undefined;
}

export function buildAdminSearchParams(
  values: Record<string, string | number | undefined>,
): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  return params;
}

export { adminCommerceMessages };
