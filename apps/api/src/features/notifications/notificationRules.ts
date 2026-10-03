import type { NotificationKind } from '@shop/contracts/notifications';
import type { UserPreferences } from '@shop/contracts/account-depth';

const NOTIFICATION_EMAIL_PREFERENCE: Record<
  NotificationKind,
  keyof Pick<UserPreferences, 'orderUpdatesEmail' | 'approvalRequestEmail'>
> = {
  'order.placed': 'orderUpdatesEmail',
  'order.shipped': 'orderUpdatesEmail',
  'order.cancelled': 'orderUpdatesEmail',
  'standing_order.run_completed': 'orderUpdatesEmail',
  'standing_order.run_failed': 'orderUpdatesEmail',
  'payment.webhook_settled': 'orderUpdatesEmail',
  'back_in_stock.available': 'orderUpdatesEmail',
};

export function shouldEmailNotification(
  kind: NotificationKind,
  preferences: UserPreferences,
): boolean {
  return preferences[NOTIFICATION_EMAIL_PREFERENCE[kind]];
}

/** Stable event identity shared by notification storage and its delivery job. */
export function notificationDedupeKey(
  userId: number,
  kind: NotificationKind,
  entityType: string | null,
  entityId: string | null,
): string {
  return `${userId}:${kind}:${entityType ?? '-'}:${entityId ?? '-'}`;
}
