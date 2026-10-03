import { AdminRefund, type CreateAdminRefundBody } from '@shop/contracts/admin-refunds';
import { apiFetch } from './client';

export const createAdminRefund = (body: CreateAdminRefundBody) =>
  apiFetch(AdminRefund, '/api/admin/refunds', {
    method: 'POST',
    body: JSON.stringify(body satisfies CreateAdminRefundBody),
  });
