import { AdminCapturedWebhook, AdminCapturedWebhookPage } from '@shop/contracts/webhooks';
import type { AdminCapturedWebhookListQuery } from '@shop/contracts/webhooks';
import { apiFetch } from './client';

export const getAdminWebhooks = (params: AdminCapturedWebhookListQuery, signal?: AbortSignal) => {
  const query = new URLSearchParams({
    page: String(params.page ?? 1),
    pageSize: String(params.pageSize ?? 10),
  });
  if (params.status) query.set('status', params.status);
  return apiFetch(AdminCapturedWebhookPage, `/api/admin/webhooks?${query}`, { signal });
};

export const getAdminWebhook = (webhookId: string, signal?: AbortSignal) =>
  apiFetch(AdminCapturedWebhook, `/api/admin/webhooks/${webhookId}`, { signal });
