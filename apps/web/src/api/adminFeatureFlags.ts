import { SuccessResponse } from '@shop/contracts/common';
import {
  AdminFeatureFlag,
  AdminFeatureFlagListResponse,
  type CreateAdminFeatureFlagBody,
  type UpdateAdminFeatureFlagBody,
} from '@shop/contracts/feature-flags';
import { apiFetch } from './client';

export const getAdminFeatureFlags = () =>
  apiFetch(AdminFeatureFlagListResponse, '/api/admin/feature-flags');
export const getAdminFeatureFlag = (key: string) =>
  apiFetch(AdminFeatureFlag, `/api/admin/feature-flags/${encodeURIComponent(key)}`);
export const createAdminFeatureFlag = (body: CreateAdminFeatureFlagBody) =>
  apiFetch(AdminFeatureFlag, '/api/admin/feature-flags', {
    method: 'POST',
    body: JSON.stringify(body satisfies CreateAdminFeatureFlagBody),
  });
export const updateAdminFeatureFlag = (key: string, body: UpdateAdminFeatureFlagBody) =>
  apiFetch(AdminFeatureFlag, `/api/admin/feature-flags/${encodeURIComponent(key)}`, {
    method: 'PATCH',
    body: JSON.stringify(body satisfies UpdateAdminFeatureFlagBody),
  });
export const deleteAdminFeatureFlag = (key: string) =>
  apiFetch(SuccessResponse, `/api/admin/feature-flags/${encodeURIComponent(key)}`, {
    method: 'DELETE',
  });
