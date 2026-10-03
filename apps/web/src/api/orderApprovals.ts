import { apiFetch } from './client';
import { ApprovalListResponse, OrderApproval } from '@shop/contracts/order-approvals';
import type { ApprovalDecisionBody } from '@shop/contracts/order-approvals';

const path = '/api/approvals';
export function listApprovals() {
  return apiFetch(ApprovalListResponse, path);
}
export function listMyApprovalRequests() {
  return apiFetch(ApprovalListResponse, `${path}/mine`);
}
export function decideApproval(id: string, body: ApprovalDecisionBody) {
  return apiFetch(OrderApproval, `${path}/${encodeURIComponent(id)}/decision`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
