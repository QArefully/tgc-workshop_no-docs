import {
  BackInStockSubscription,
  BackInStockSubscriptionListResponse,
  CreateBackInStockSubscriptionBody,
  type BackInStockSubscription as BackInStockSubscriptionResult,
  type CreateBackInStockSubscriptionBody as CreateBackInStockSubscriptionPayload,
  type BackInStockSubscriptionListResponse as BackInStockSubscriptionListResult,
} from '@shop/contracts/back-in-stock';
import { SuccessResponse } from '@shop/contracts/common';
import { apiFetch } from './client';

const pathForSubscription = (subscriptionId: string) =>
  `/api/back-in-stock/${encodeURIComponent(subscriptionId)}`;

/** Buyer's own back-in-stock subscriptions; the server response is the only source of truth. */
export const getBackInStockSubscriptions = (
  signal?: AbortSignal,
): Promise<BackInStockSubscriptionListResult> =>
  apiFetch(BackInStockSubscriptionListResponse, '/api/back-in-stock', { signal });

export const createBackInStockSubscription = (
  body: CreateBackInStockSubscriptionPayload,
  signal?: AbortSignal,
): Promise<BackInStockSubscriptionResult> =>
  apiFetch(BackInStockSubscription, '/api/back-in-stock', {
    method: 'POST',
    body: JSON.stringify(body satisfies CreateBackInStockSubscriptionBody),
    signal,
  });

export const cancelBackInStockSubscription = (
  subscriptionId: string,
  signal?: AbortSignal,
): Promise<void> =>
  apiFetch(SuccessResponse, pathForSubscription(subscriptionId), {
    method: 'DELETE',
    signal,
  }).then(() => undefined);
