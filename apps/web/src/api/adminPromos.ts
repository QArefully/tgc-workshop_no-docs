import {
  AdminPromo,
  AdminPromoListResponse,
  type AdminPromoListQuery,
  type CreateAdminPromoBody,
  type DeactivateAdminPromoBody,
  type UpdateAdminPromoBody,
} from '@shop/contracts/admin-promos';
import { apiFetch } from './client';

export function getAdminPromos(query: AdminPromoListQuery = {}) {
  const params = new URLSearchParams();
  if (query.code) params.set('code', query.code);
  if (query.active !== undefined) params.set('active', String(query.active));
  const suffix = params.size ? `?${params}` : '';
  return apiFetch(AdminPromoListResponse, `/api/admin/promos${suffix}`);
}
export const getAdminPromo = (code: string) =>
  apiFetch(AdminPromo, `/api/admin/promos/${encodeURIComponent(code)}`);
export const createAdminPromo = (body: CreateAdminPromoBody) =>
  apiFetch(AdminPromo, '/api/admin/promos', {
    method: 'POST',
    body: JSON.stringify(body satisfies CreateAdminPromoBody),
  });
export const updateAdminPromo = (code: string, body: UpdateAdminPromoBody) =>
  apiFetch(AdminPromo, `/api/admin/promos/${encodeURIComponent(code)}`, {
    method: 'PUT',
    body: JSON.stringify(body satisfies UpdateAdminPromoBody),
  });
export const deactivateAdminPromo = (code: string, body: DeactivateAdminPromoBody = {}) =>
  apiFetch(AdminPromo, `/api/admin/promos/${encodeURIComponent(code)}/deactivate`, {
    method: 'POST',
    body: JSON.stringify(body satisfies DeactivateAdminPromoBody),
  });
