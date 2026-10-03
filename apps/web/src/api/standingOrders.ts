import { Type } from '@sinclair/typebox';
import {
  CreateStandingOrderBody,
  StandingOrder,
  StandingOrderRun,
  StandingOrderRunListResponse,
  UpdateStandingOrderBody,
  type CreateStandingOrderBody as CreatePayload,
  type StandingOrder as StandingOrderResult,
  type StandingOrderRun as RunResult,
  type StandingOrderRunListResponse as RunListResult,
  type UpdateStandingOrderBody as UpdatePayload,
} from '@shop/contracts/standing-orders';
import { SuccessResponse } from '@shop/contracts/common';
import { apiFetch } from './client';
const path = (id: string) => `/api/standing-orders/${encodeURIComponent(id)}`;
export const getStandingOrders = (): Promise<StandingOrderResult[]> =>
  apiFetch(Type.Array(StandingOrder), '/api/standing-orders');
export const createStandingOrder = (body: CreatePayload): Promise<StandingOrderResult> =>
  apiFetch(StandingOrder, '/api/standing-orders', {
    method: 'POST',
    body: JSON.stringify(body satisfies CreateStandingOrderBody),
  });
export const updateStandingOrder = (
  id: string,
  body: UpdatePayload,
): Promise<StandingOrderResult> =>
  apiFetch(StandingOrder, path(id), {
    method: 'PATCH',
    body: JSON.stringify(body satisfies UpdateStandingOrderBody),
  });
export const deleteStandingOrder = (id: string): Promise<void> =>
  apiFetch(SuccessResponse, path(id), { method: 'DELETE' }).then(() => undefined);
export const getStandingOrderRuns = (id: string): Promise<RunListResult> =>
  apiFetch(StandingOrderRunListResponse, `${path(id)}/runs`);
export const runStandingOrderNow = (id: string): Promise<RunResult> =>
  apiFetch(StandingOrderRun, `${path(id)}/run-now`, { method: 'POST' });
