import { apiFetch } from './client';
import {
  Company,
  CompanyAccountResponse,
  CompanyInvite,
  CompanyInviteListResponse,
  CompanyMembership,
  CompanyMembershipListResponse,
} from '@shop/contracts/company-accounts';
import type {
  AcceptInviteBody,
  CreateCompanyBody,
  InviteMemberBody,
  UpdateMembershipRoleBody,
  UpdateThresholdBody,
} from '@shop/contracts/company-accounts';
import { SuccessResponse } from '@shop/contracts/common';

export interface CompanyRequestOptions {
  signal?: AbortSignal;
}
const path = '/api/company';

export function getCompany(options: CompanyRequestOptions = {}) {
  return apiFetch(CompanyAccountResponse, path, { signal: options.signal });
}
export function createCompany(body: CreateCompanyBody) {
  return apiFetch(CompanyAccountResponse, path, { method: 'POST', body: JSON.stringify(body) });
}
export function listMembers() {
  return apiFetch(CompanyMembershipListResponse, `${path}/members`);
}
export function updateMemberRole(id: string, body: UpdateMembershipRoleBody) {
  return apiFetch(CompanyMembership, `${path}/members/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}
export function revokeMember(id: string) {
  return apiFetch(SuccessResponse, `${path}/members/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}
export function listInvites() {
  return apiFetch(CompanyInviteListResponse, `${path}/invites`);
}
export function inviteMember(body: InviteMemberBody) {
  return apiFetch(CompanyInvite, `${path}/invites`, { method: 'POST', body: JSON.stringify(body) });
}
export function revokeInvite(id: string) {
  return apiFetch(SuccessResponse, `${path}/invites/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}
export function acceptInvite(body: AcceptInviteBody) {
  return apiFetch(CompanyAccountResponse, `${path}/invites/accept`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
export function updateThreshold(body: UpdateThresholdBody) {
  return apiFetch(Company, `${path}/threshold`, { method: 'PATCH', body: JSON.stringify(body) });
}
