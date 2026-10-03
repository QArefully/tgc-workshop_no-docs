import { apiFetch } from './client';
import {
  BillingEntity,
  BillingEntityListResponse,
  DeliverySite,
  DeliverySiteListResponse,
} from '@shop/contracts/trade-account';
import type {
  CreateBillingEntityBody,
  CreateDeliverySiteBody,
  UpdateBillingEntityBody,
  UpdateDeliverySiteBody,
} from '@shop/contracts/trade-account';
import { SuccessResponse } from '@shop/contracts/common';

/**
 * Trade profile HTTP client — saved delivery sites and billing entities for the signed-in buyer.
 *
 * Every response is validated against the shared transport schema inside this module, so callers
 * receive contract-shaped data or an `ApiContractError`; no feature re-validates.
 *
 * All endpoints require authentication. Retirement is a server-side `active = 0` transition, not a
 * hard delete, because orders reference the records.
 */

const DELIVERY_SITES_PATH = '/api/account/delivery-sites';
const BILLING_ENTITIES_PATH = '/api/account/billing-entities';

/** Options accepted by every read so a superseded request can be aborted by its caller. */
export interface TradeAccountRequestOptions {
  signal?: AbortSignal;
}

export function listDeliverySites(
  options: TradeAccountRequestOptions = {},
): Promise<DeliverySiteListResponse> {
  return apiFetch(DeliverySiteListResponse, DELIVERY_SITES_PATH, { signal: options.signal });
}

export function createDeliverySite(
  body: CreateDeliverySiteBody,
  options: TradeAccountRequestOptions = {},
): Promise<DeliverySite> {
  return apiFetch(DeliverySite, DELIVERY_SITES_PATH, {
    method: 'POST',
    body: JSON.stringify(body),
    signal: options.signal,
  });
}

export function updateDeliverySite(
  siteId: string,
  body: UpdateDeliverySiteBody,
  options: TradeAccountRequestOptions = {},
): Promise<DeliverySite> {
  return apiFetch(DeliverySite, `${DELIVERY_SITES_PATH}/${encodeURIComponent(siteId)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    signal: options.signal,
  });
}

/** Retires the site (`active = 0`). The record stays readable by the orders that reference it. */
export function retireDeliverySite(
  siteId: string,
  options: TradeAccountRequestOptions = {},
): Promise<SuccessResponse> {
  return apiFetch(SuccessResponse, `${DELIVERY_SITES_PATH}/${encodeURIComponent(siteId)}`, {
    method: 'DELETE',
    signal: options.signal,
  });
}

export function listBillingEntities(
  options: TradeAccountRequestOptions = {},
): Promise<BillingEntityListResponse> {
  return apiFetch(BillingEntityListResponse, BILLING_ENTITIES_PATH, { signal: options.signal });
}

export function createBillingEntity(
  body: CreateBillingEntityBody,
  options: TradeAccountRequestOptions = {},
): Promise<BillingEntity> {
  return apiFetch(BillingEntity, BILLING_ENTITIES_PATH, {
    method: 'POST',
    body: JSON.stringify(body),
    signal: options.signal,
  });
}

export function updateBillingEntity(
  entityId: string,
  body: UpdateBillingEntityBody,
  options: TradeAccountRequestOptions = {},
): Promise<BillingEntity> {
  return apiFetch(BillingEntity, `${BILLING_ENTITIES_PATH}/${encodeURIComponent(entityId)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    signal: options.signal,
  });
}

/** Retires the billing entity (`active = 0`). Billed history keeps its own frozen snapshot. */
export function retireBillingEntity(
  entityId: string,
  options: TradeAccountRequestOptions = {},
): Promise<SuccessResponse> {
  return apiFetch(SuccessResponse, `${BILLING_ENTITIES_PATH}/${encodeURIComponent(entityId)}`, {
    method: 'DELETE',
    signal: options.signal,
  });
}
