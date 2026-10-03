import { ReorderResponse } from '@shop/contracts/reorder';
import type { ReorderRequestBody } from '@shop/contracts/reorder';
import { apiFetch } from './client';

/**
 * Buy Again / reorder API module.
 *
 * The server is the sole authority for line eligibility, quantity and price: the client sends only
 * the source order and the target cart, and receives the recalculated cart plus a per-line outcome
 * report. Nothing here mutates cart state locally.
 */
export function reorderFromOrder(cartId: string, orderId: string): Promise<ReorderResponse> {
  const body: ReorderRequestBody = { cartId };
  return apiFetch(ReorderResponse, `/api/orders/${encodeURIComponent(orderId)}/reorder`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
