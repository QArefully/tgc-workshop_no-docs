import { CuratedBundleListResponse } from '@shop/contracts/bundles';
import { Cart } from '@shop/contracts/cart';
import { apiFetch } from './client';

/** Curated bundle API calls. Server remains authority for prices and availability. */
export function getBundles(
  productId?: string,
  signal?: AbortSignal,
): Promise<CuratedBundleListResponse> {
  const query = productId ? `?productId=${encodeURIComponent(productId)}` : '';
  return apiFetch(CuratedBundleListResponse, `/api/bundles${query}`, { signal });
}

export function addBundleToCart(cartId: string, bundleId: string): Promise<Cart> {
  return apiFetch(Cart, `/api/cart/${cartId}/bundles`, {
    method: 'POST',
    body: JSON.stringify({ bundleId }),
  });
}
