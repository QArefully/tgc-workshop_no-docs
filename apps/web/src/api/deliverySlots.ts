import { apiFetch } from './client';
import { DeliverySlotOptionsResponse } from '@shop/contracts/delivery';

/**
 * Delivery slot HTTP client.
 *
 * The offered slot list is cart-scoped and server-derived: lead time follows consignment weight and
 * business days, so the web app never computes dates itself. Unauthenticated — anonymous buyers
 * schedule too.
 */
export interface DeliverySlotOptionsRequestOptions {
  signal?: AbortSignal;
}

export function getDeliverySlotOptions(
  cartId: string,
  options: DeliverySlotOptionsRequestOptions = {},
): Promise<DeliverySlotOptionsResponse> {
  const query = new URLSearchParams({ cartId });
  return apiFetch(DeliverySlotOptionsResponse, `/api/delivery/slots?${query.toString()}`, {
    signal: options.signal,
  });
}
