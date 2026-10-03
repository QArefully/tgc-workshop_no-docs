import { AdminUserView } from '@shop/contracts/auth';
import {
  AdminUserListResponse,
  type AdminUserListQuery,
  type SetAdminUserRoleBody,
  type SuspendAdminUserBody,
  type UpdateAdminUserDisplayNameBody,
} from '@shop/contracts/admin-users';
import { apiFetch } from './client';

export function getAdminUsers(query: AdminUserListQuery = {}) {
  const suffix = query.search ? `?${new URLSearchParams({ search: query.search })}` : '';
  return apiFetch(AdminUserListResponse, `/api/admin/users${suffix}`);
}
export const getAdminUser = (userId: string) =>
  apiFetch(AdminUserView, `/api/admin/users/${userId}`);
export const updateAdminUserDisplayName = (userId: string, body: UpdateAdminUserDisplayNameBody) =>
  apiFetch(AdminUserView, `/api/admin/users/${userId}/display-name`, {
    method: 'PATCH',
    body: JSON.stringify(body satisfies UpdateAdminUserDisplayNameBody),
  });
export const setAdminUserRole = (userId: string, body: SetAdminUserRoleBody) =>
  apiFetch(AdminUserView, `/api/admin/users/${userId}/role`, {
    method: 'PATCH',
    body: JSON.stringify(body satisfies SetAdminUserRoleBody),
  });
export const suspendAdminUser = (userId: string, body: SuspendAdminUserBody) =>
  apiFetch(AdminUserView, `/api/admin/users/${userId}/suspend`, {
    method: 'POST',
    body: JSON.stringify(body satisfies SuspendAdminUserBody),
  });
export const reactivateAdminUser = (userId: string) =>
  apiFetch(AdminUserView, `/api/admin/users/${userId}/reactivate`, { method: 'POST' });
