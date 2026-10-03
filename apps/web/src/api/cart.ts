import type { Country } from '@shop/contracts/country';
import { apiFetch } from './client';
import { Cart, CreateCartResponse } from '@shop/contracts/cart';
import type { AddToCartBody, RemoveFromCartBody, UpdateCartLineBody } from '@shop/contracts/cart';

export function createCart(country?: Country): Promise<CreateCartResponse> {
  const body: { country?: Country } = {};
  if (country) body.country = country;
  return apiFetch(CreateCartResponse, '/api/cart', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function getCart(cartId: string): Promise<Cart> {
  return apiFetch(Cart, `/api/cart/${cartId}`);
}

export function addToCart(
  cartId: string,
  productId: string,
  variantId?: number,
  quantity?: number,
): Promise<Cart> {
  const body: AddToCartBody = {
    productId,
    ...(variantId !== undefined ? { variantId } : {}),
    ...(quantity !== undefined ? { quantity } : {}),
  };
  return apiFetch(Cart, `/api/cart/${cartId}/items`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * `configKey` selects among lines that share a variant: `''` (or omitted) targets the
 * plain line, a blend key targets that one configured line.
 */
export function updateCartItem(
  cartId: string,
  productId: string,
  quantity: number,
  variantId?: number,
  configKey?: string,
): Promise<Cart> {
  const body: UpdateCartLineBody = {
    productId,
    quantity,
    ...(variantId !== undefined ? { variantId } : {}),
    ...(configKey !== undefined ? { configKey } : {}),
  };
  return apiFetch(Cart, `/api/cart/${cartId}/items`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function removeFromCart(
  cartId: string,
  productId: string,
  variantId?: number,
  configKey?: string,
): Promise<Cart> {
  const body: RemoveFromCartBody | undefined =
    variantId === undefined
      ? undefined
      : { productId, variantId, ...(configKey !== undefined ? { configKey } : {}) };
  return apiFetch(Cart, `/api/cart/${cartId}/items/${productId}`, {
    method: 'DELETE',
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
