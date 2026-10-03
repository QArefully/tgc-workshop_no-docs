import assert from 'node:assert/strict';
import test from 'node:test';
import { notificationDedupeKey, shouldEmailNotification } from './notificationRules.js';

const defaults = { orderUpdatesEmail: true, marketingEmail: false, approvalRequestEmail: true };
void test('notification email rules gate every current notification kind', () => {
  for (const kind of [
    'order.placed',
    'order.shipped',
    'order.cancelled',
    'standing_order.run_completed',
    'standing_order.run_failed',
    'payment.webhook_settled',
    'back_in_stock.available',
  ] as const) {
    assert.equal(shouldEmailNotification(kind, { ...defaults, orderUpdatesEmail: false }), false);
    assert.equal(shouldEmailNotification(kind, defaults), true);
  }
  assert.equal(notificationDedupeKey(7, 'order.placed', 'order', '42'), '7:order.placed:order:42');
});

void test('back-in-stock dedupe identity is per subscription, so re-subscription stays notifiable', () => {
  assert.equal(
    notificationDedupeKey(7, 'back_in_stock.available', 'back_in_stock_subscription', '11'),
    '7:back_in_stock.available:back_in_stock_subscription:11',
  );
  assert.notEqual(
    notificationDedupeKey(7, 'back_in_stock.available', 'back_in_stock_subscription', '11'),
    notificationDedupeKey(7, 'back_in_stock.available', 'back_in_stock_subscription', '12'),
  );
});
