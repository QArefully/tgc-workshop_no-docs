import { describe, expect, it } from 'vitest';
import type { NotificationKind } from '@shop/contracts/notifications';
import { notificationPresentation } from './notificationsPresentation';

describe('notificationPresentation', () => {
  it('labels every notification kind', () => {
    const kinds: NotificationKind[] = [
      'order.placed',
      'order.shipped',
      'order.cancelled',
      'standing_order.run_completed',
      'standing_order.run_failed',
      'payment.webhook_settled',
      'back_in_stock.available',
    ];
    for (const kind of kinds) expect(notificationPresentation(kind).label).not.toBe('');
  });

  it('labels the back-in-stock kind for the notification inbox', () => {
    expect(notificationPresentation('back_in_stock.available').label).toBe('Back in stock');
  });
});
