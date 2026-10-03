import {
  AdminOrderDetailResponse,
  AdminOrdersListResponse,
} from '@shop/contracts/admin-orders-list';
import { type AdminOrderListQuery } from '@shop/contracts/orders';
import { apiFetch } from './client';

export function getAdminOrders(query: AdminOrderListQuery = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const suffix = params.size ? `?${params}` : '';
  return apiFetch(AdminOrdersListResponse, `/api/admin/orders${suffix}`);
}

export const getAdminOrder = (orderId: string) =>
  apiFetch(AdminOrderDetailResponse, `/api/admin/orders/${orderId}`);
