import { apiFetch } from './client';
import { PaymentSuccessResponse } from '@shop/contracts/payments';
import type {
  CardPaymentBody,
  PaymentBody,
  TradeCreditPaymentBody,
} from '@shop/contracts/payments';

export interface PaymentRequestOptions {
  /** Allows checkout to cancel a request that no longer belongs to the active intent. */
  signal?: AbortSignal;
}

/**
 * Payment API module.
 * Submits a payment through the gateway endpoint.
 *
 * The body carries the destination and billing party as discriminated unions: a `saved` selection
 * sends only an identifier, because the server loads the stored record and ignores any address the
 * client holds. The delivery slot is one the server offered and is re-validated at payment.
 *
 * On success returns the created order. On failure throws with status-based errors:
 * - 400: bad request / promo invalid / delivery site or billing entity not resolvable
 * - 402: card declined or gateway timeout
 * - 409: idempotency conflict (reused key with changed payload), `INSUFFICIENT_STOCK`,
 *   `RESERVATION_EXPIRED`, or `DELIVERY_SLOT_UNAVAILABLE` (slot no longer bookable; the response
 *   carries the current `earliestDate`). No reservation is held and no money moves on a 409.
 */

export function pay(body: PaymentBody, options: PaymentRequestOptions = {}) {
  const requestInit: RequestInit = {
    method: 'POST',
    body: JSON.stringify(body),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  };
  return apiFetch(PaymentSuccessResponse, '/api/payments/pay', {
    ...requestInit,
  });
}

/** Strict branch helpers for callers that already narrowed the checkout discriminator. */
export function payCard(body: CardPaymentBody, options: PaymentRequestOptions = {}) {
  return pay(body, options);
}

export function payTradeCredit(body: TradeCreditPaymentBody, options: PaymentRequestOptions = {}) {
  return pay(body, options);
}
