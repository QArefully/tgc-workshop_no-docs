import { QuickOrderResponse } from '@shop/contracts/quick-order';
import type { QuickOrderRequestBody } from '@shop/contracts/quick-order';
import { apiFetch } from './client';

/** Submits buyer-entered SKU and quantity lines to the authoritative cart workflow. */
export function submitQuickOrder(cartId: string, text: string): Promise<QuickOrderResponse> {
  const body: QuickOrderRequestBody = { text };
  return apiFetch(QuickOrderResponse, `/api/cart/${encodeURIComponent(cartId)}/quick-order`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
