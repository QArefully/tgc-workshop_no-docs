import type { NotificationKind } from '@shop/contracts/notifications';
import {
  translateTradeAsync,
  type TradeAsyncMessageKey,
} from '@shop/localisation/messages/tradeAsync';

const presentation: Record<NotificationKind, { key: TradeAsyncMessageKey; icon: string }> = {
  'order.placed': { key: 'notifications.kind.orderPlaced', icon: 'Receipt' },
  'order.shipped': { key: 'notifications.kind.orderShipped', icon: 'Truck' },
  'order.cancelled': { key: 'notifications.kind.orderCancelled', icon: 'CircleX' },
  'standing_order.run_completed': {
    key: 'notifications.kind.standingCompleted',
    icon: 'CalendarCheck',
  },
  'standing_order.run_failed': { key: 'notifications.kind.standingFailed', icon: 'CalendarX' },
  'payment.webhook_settled': { key: 'notifications.kind.paymentSettled', icon: 'CreditCard' },
  'back_in_stock.available': { key: 'notifications.kind.backInStock', icon: 'BellRing' },
};

export type NotificationTranslator = (key: TradeAsyncMessageKey) => string;

const defaultTranslate: NotificationTranslator = (key) => translateTradeAsync('UK', key);

export const notificationPresentation = (
  kind: NotificationKind,
  translate: NotificationTranslator = defaultTranslate,
) => {
  const item = presentation[kind];
  return { label: translate(item.key), icon: item.icon };
};
