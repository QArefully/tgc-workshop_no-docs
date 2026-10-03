import { apiFetch } from './client';
import {
  ReturnOverviewResponse,
  ReturnRequest,
  type CreateReturnRequestBody as CreateReturnPayload,
} from '@shop/contracts/returns';

export function fetchReturnOverview(orderId: string): Promise<ReturnOverviewResponse> {
  return apiFetch(ReturnOverviewResponse, `/api/orders/${orderId}/returns`);
}

export function createReturnRequest(
  orderId: string,
  body: CreateReturnPayload,
): Promise<ReturnRequest> {
  return apiFetch(ReturnRequest, `/api/orders/${orderId}/returns`, {
    method: 'POST',
    body: JSON.stringify(body satisfies CreateReturnPayload),
  });
}
