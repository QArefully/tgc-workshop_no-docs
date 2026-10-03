import { apiFetch } from './client';
import { Cart } from '@shop/contracts/cart';
import type { Country } from '@shop/contracts/country';
import {
  CustomBlendBaseListResponse,
  CustomBlendEvaluationResponse,
  CustomBlendOptionsResponse,
} from '@shop/contracts/custom-blends';
import type {
  CreateCustomBlendBody,
  CustomBlendBaseListQuery,
  CustomBlendEvaluationBody,
  ReplaceCustomBlendBody,
} from '@shop/contracts/custom-blends';

/** Lists only the server-approved base lots for the current country. */
export function getCustomBlendBases(
  query: CustomBlendBaseListQuery = {},
  signal?: AbortSignal,
): Promise<CustomBlendBaseListResponse> {
  const params = new URLSearchParams();
  if (query.q !== undefined) params.set('q', query.q);
  if (query.category !== undefined) params.set('category', query.category);
  if (query.page !== undefined) params.set('page', String(query.page));
  if (query.pageSize !== undefined) params.set('pageSize', String(query.pageSize));
  const suffix = params.size > 0 ? `?${params.toString()}` : '';
  return apiFetch(CustomBlendBaseListResponse, `/api/custom-blends/bases${suffix}`, { signal });
}

/** Evaluates a draft without mutating the cart; quantity and all pricing facts stay server-owned. */
export function evaluateCustomBlend(
  body: CustomBlendEvaluationBody,
  signal?: AbortSignal,
  country?: Country,
): Promise<CustomBlendEvaluationResponse> {
  return apiFetch(CustomBlendEvaluationResponse, '/api/custom-blends/evaluate', {
    method: 'POST',
    body: JSON.stringify(body),
    signal,
    ...(country ? { headers: { 'x-shop-country': country } } : {}),
  });
}

/**
 * Custom Blend API module.
 *
 * Option reads are cancellable: the configurator re-queries whenever the base lot
 * changes, and a superseded request must never repopulate the ingredient picker.
 */

export function getCustomBlendOptions(
  baseVariantId: number,
  signal?: AbortSignal,
): Promise<CustomBlendOptionsResponse> {
  const query = new URLSearchParams({ baseVariantId: String(baseVariantId) });
  return apiFetch(CustomBlendOptionsResponse, `/api/custom-blends/options?${query.toString()}`, {
    signal,
  });
}

export function createCustomBlend(cartId: string, body: CreateCustomBlendBody): Promise<Cart> {
  return apiFetch(Cart, `/api/cart/${cartId}/custom-blends`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** Replaces one configured line's specification atomically; the server keeps its quantity. */
export function replaceCustomBlend(cartId: string, body: ReplaceCustomBlendBody): Promise<Cart> {
  return apiFetch(Cart, `/api/cart/${cartId}/custom-blends`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}
