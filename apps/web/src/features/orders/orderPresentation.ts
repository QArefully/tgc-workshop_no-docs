import { formatPostalAddress, type PostalAddress } from '@shop/contracts/address';
import type { Country } from '@shop/contracts/country';
import type { DeliverySlot, DeliverySlotWindow } from '@shop/contracts/delivery';
import type { OrderStatus, ShipmentStatus } from '@shop/contracts/orders';
import type { BillingEntitySnapshot } from '@shop/contracts/trade-account';
import {
  formatCivilDate,
  formatInstant,
  translate,
  type DateFormatOptions,
  type DatePreset,
  type MessageCatalog,
  type MessageParams,
} from '@shop/localisation';
import { apiErrors } from '@shop/localisation/messages/apiErrors';
import {
  orderLifecycleMessages,
  type OrderLifecycleMessageKey,
} from '@shop/localisation/messages/orderLifecycle';
import type { PublicErrorCode } from '@shop/contracts/public-errors';

/** Locale adapter subset used by order/return presentation helpers. */
export interface OrderPresentationLocale {
  readonly country?: Country;
  readonly translate?: (catalog: MessageCatalog, key: string, params?: MessageParams) => string;
  readonly formatInstant?: (
    value: Date | string | number,
    preset?: DatePreset | DateFormatOptions,
  ) => string;
  readonly formatCivilDate?: (value: string, preset?: DatePreset | DateFormatOptions) => string;
}

export type OrderLocale = Country | OrderPresentationLocale | undefined;

/** Country-neutral UI message state. Store this descriptor, then resolve during render. */
export type OrderMessageState =
  | {
      readonly kind: 'message';
      readonly key: OrderLifecycleMessageKey;
      readonly params?: MessageParams;
    }
  | {
      readonly kind: 'error';
      readonly error: unknown;
      readonly fallback: OrderLifecycleMessageKey;
    };

export function orderMessage(
  key: OrderLifecycleMessageKey,
  params?: MessageParams,
): OrderMessageState {
  return { kind: 'message', key, ...(params ? { params } : {}) };
}

export function orderErrorMessage(
  error: unknown,
  fallback: OrderLifecycleMessageKey = 'order.error.generic',
): OrderMessageState {
  return { kind: 'error', error, fallback };
}

export function resolveOrderMessage(state: OrderMessageState, locale: OrderLocale): string {
  return state.kind === 'message'
    ? orderCopy(locale, state.key, state.params)
    : localizeOrderError(state.error, locale, state.fallback);
}

const DEFAULT_COUNTRY: Country = 'US';

const STATUS_KEYS: Record<OrderStatus | ShipmentStatus, OrderLifecycleMessageKey> = {
  processing: 'order.status.processing',
  packed: 'order.status.packed',
  shipped: 'order.status.shipped',
  delivered: 'order.status.delivered',
  delivery_failed: 'order.status.deliveryFailed',
  cancelled: 'order.status.cancelled',
};

const WINDOW_KEYS: Record<DeliverySlotWindow, OrderLifecycleMessageKey> = {
  am: 'order.window.morning',
  pm: 'order.window.afternoon',
};

/** Buyer-facing label for a booked slot window. */
export function deliverySlotWindowLabel(window: DeliverySlotWindow, locale?: OrderLocale): string {
  return orderCopy(locale, WINDOW_KEYS[window]);
}

/** Resolve one country from either a country code or the web locale adapter. */
function countryOf(locale: OrderLocale): Country {
  return typeof locale === 'string' ? locale : (locale?.country ?? DEFAULT_COUNTRY);
}

/** Resolve translated feature copy without caching country-dependent values. */
export function orderCopy(
  locale: OrderLocale,
  key: OrderLifecycleMessageKey,
  params: MessageParams = {},
): string {
  if (typeof locale === 'object' && locale?.translate) {
    return locale.translate(orderLifecycleMessages, key, params);
  }
  return translate(orderLifecycleMessages, countryOf(locale), key, params);
}

/** Buyer-facing order or shipment status label. */
export function orderStatusLabel(
  status: OrderStatus | ShipmentStatus,
  locale?: OrderLocale,
): string {
  return orderCopy(locale, STATUS_KEYS[status]);
}

/** Safe instant formatter. Invalid transport values produce translated fallback copy. */
export function formatOrderTimestamp(
  value: string,
  locale?: OrderLocale,
  preset: DatePreset | DateFormatOptions = 'long',
  fallbackKey: OrderLifecycleMessageKey = 'order.invalidTimestamp',
): string {
  try {
    if (typeof locale === 'object' && locale?.formatInstant) {
      return locale.formatInstant(value, preset);
    }
    return formatInstant(value, countryOf(locale), preset);
  } catch {
    return orderCopy(locale, fallbackKey);
  }
}

/** Compatibility name retained for existing order surfaces. Values are absolute instants. */
export function formatOrderDate(
  value: string,
  locale?: OrderLocale,
  preset: DatePreset | DateFormatOptions = 'long',
): string {
  return formatOrderTimestamp(value, locale, preset);
}

/** Safe civil-date formatter. `YYYY-MM-DD` never shifts through the active time zone. */
function formatCivilOrderDate(value: string, locale?: OrderLocale): string {
  try {
    if (typeof locale === 'object' && locale?.formatCivilDate) {
      return locale.formatCivilDate(value, 'long');
    }
    return formatCivilDate(value, countryOf(locale), 'long');
  } catch {
    return orderCopy(locale, 'order.invalidTimestamp');
  }
}

/** Buyer-facing label for a booked delivery slot. The slot date is a civil calendar day. */
export function formatDeliverySlot(
  slot: DeliverySlot | undefined,
  locale?: OrderLocale,
): string | undefined {
  if (slot === undefined) return undefined;
  const day = formatCivilOrderDate(slot.date, locale);
  return `${day} · ${deliverySlotWindowLabel(slot.window, locale)}`;
}

/** Single-line delivery address. Structured address data remains untranslated. */
export function formatAddressLine(address: PostalAddress | undefined): string | undefined {
  return address === undefined ? undefined : formatPostalAddress(address);
}

/** Registration and VAT identifiers with translated captions. */
export function formatBillingIdentifiers(
  entity: BillingEntitySnapshot | undefined,
  locale?: OrderLocale,
): string | undefined {
  if (entity === undefined) return undefined;
  const parts: string[] = [];
  if (entity.registrationNumber !== null) {
    parts.push(orderCopy(locale, 'order.registration', { value: entity.registrationNumber }));
  }
  if (entity.vatNumber !== null) {
    parts.push(orderCopy(locale, 'order.vat', { value: entity.vatNumber }));
  }
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

/** Buyer-supplied purchase-order reference for display. */
export function formatPurchaseOrderReference(reference: string | undefined): string | undefined {
  if (reference === undefined) return undefined;
  const trimmed = reference.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Fields captured by trade checkout, all optional on legacy orders. */
export type OrderTradeDetails = {
  deliveryAddress?: PostalAddress;
  billingEntity?: BillingEntitySnapshot;
  deliverySlot?: DeliverySlot;
  purchaseOrderReference?: string;
};

export function hasOrderTradeDetails(order: OrderTradeDetails): boolean {
  return (
    formatAddressLine(order.deliveryAddress) !== undefined ||
    order.billingEntity !== undefined ||
    formatDeliverySlot(order.deliverySlot) !== undefined ||
    formatPurchaseOrderReference(order.purchaseOrderReference) !== undefined
  );
}

const RETURN_STATUS_KEYS = {
  requested: 'return.status.requested',
  approved: 'return.status.approved',
  rejected: 'return.status.rejected',
  received: 'return.status.received',
  refunded: 'return.status.refunded',
} as const satisfies Record<string, OrderLifecycleMessageKey>;

const RETURN_REASON_KEYS = {
  damaged: 'return.reason.damaged',
  wrong_item: 'return.reason.wrongItem',
  not_as_expected: 'return.reason.notAsExpected',
  other: 'return.reason.other',
} as const satisfies Record<string, OrderLifecycleMessageKey>;

export function returnStatusLabel(
  status: keyof typeof RETURN_STATUS_KEYS,
  locale?: OrderLocale,
): string {
  return orderCopy(locale, RETURN_STATUS_KEYS[status]);
}

export function returnReasonLabel(
  reason: keyof typeof RETURN_REASON_KEYS,
  locale?: OrderLocale,
): string {
  return orderCopy(locale, RETURN_REASON_KEYS[reason]);
}

/** Keep only primitive public-error metadata accepted by the translator. */
function messageParams(meta: unknown): MessageParams {
  if (meta === null || typeof meta !== 'object') return {};
  const params: Record<string, string | number | bigint> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
      params[key] = value;
    }
  }
  return params;
}

/**
 * Localize a safe API error descriptor. Legacy/network errors intentionally collapse to the
 * feature's generic message; raw server prose is never rendered as shop copy.
 */
export function localizeOrderError(
  error: unknown,
  locale: OrderLocale,
  fallback: OrderLifecycleMessageKey = 'order.error.generic',
): string {
  if (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
  ) {
    const code = (error as { code: string }).code;
    if ((apiErrors as Record<string, unknown>)[code] !== undefined) {
      try {
        const params = messageParams('meta' in error ? (error as { meta?: unknown }).meta : null);
        if (typeof locale === 'object' && locale?.translate) {
          return locale.translate(apiErrors, code, params);
        }
        return translate(apiErrors, countryOf(locale), code as PublicErrorCode, params);
      } catch {
        // Missing metadata or a stale code falls through to feature-safe copy.
      }
    }
  }
  return orderCopy(locale, fallback);
}
