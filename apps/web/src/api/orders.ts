import { apiFetch } from './client';
import {
  OrderDetailResponse,
  OrderListResponse,
  type CancelOrderBody as CancelOrderPayload,
} from '@shop/contracts/orders';
import { InvoiceDetailResponse } from '@shop/contracts/trade-credit';

export interface OrderRequestOptions {
  signal?: AbortSignal;
}

export function getOrder(orderId: string): Promise<OrderDetailResponse> {
  return apiFetch(OrderDetailResponse, `/api/orders/${orderId}`);
}

/** Loads an invoice through the owner-scoped order capability. Invoice identity stays server-owned. */
export function getOrderInvoice(
  orderId: string,
  options: OrderRequestOptions = {},
): Promise<InvoiceDetailResponse> {
  return apiFetch(InvoiceDetailResponse, `/api/orders/${orderId}/invoice`, {
    signal: options.signal,
  });
}

/** Compatibility name for callers that describe this as an invoice-by-order read. */
export const getInvoiceForOrder = getOrderInvoice;

export function getOrders(page = 1, pageSize = 10): Promise<OrderListResponse> {
  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  return apiFetch(OrderListResponse, `/api/orders?${query}`);
}

export function cancelOrder(
  orderId: string,
  body: CancelOrderPayload,
): Promise<OrderDetailResponse> {
  return apiFetch(OrderDetailResponse, `/api/orders/${orderId}/cancel`, {
    method: 'POST',
    body: JSON.stringify(body satisfies CancelOrderPayload),
  });
}
