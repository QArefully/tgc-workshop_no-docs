import {
  MarkAllReadResponse,
  Notification as NotificationSchema,
  NotificationPage,
  type Notification,
  type NotificationListQuery,
  type NotificationPage as NotificationPageResult,
} from '@shop/contracts/notifications';
import { apiFetch } from './client';

export const getNotifications = (
  query: NotificationListQuery = {},
  signal?: AbortSignal,
): Promise<NotificationPageResult> => {
  const params = new URLSearchParams();
  if (query.status) params.set('status', query.status);
  if (query.page) params.set('page', String(query.page));
  if (query.pageSize) params.set('pageSize', String(query.pageSize));
  const suffix = params.size ? `?${params}` : '';
  return apiFetch(NotificationPage, `/api/notifications${suffix}`, { signal });
};

export const markNotificationRead = (notificationId: string): Promise<Notification> =>
  apiFetch(NotificationSchema, `/api/notifications/${encodeURIComponent(notificationId)}/read`, {
    method: 'POST',
  });

export const markAllNotificationsRead = () =>
  apiFetch(MarkAllReadResponse, '/api/notifications/read-all', { method: 'POST' });
