import type { Notification } from '@shop/contracts/notifications';
import { Button } from '@/components/ui/button';
import { useLocalisation } from '@/i18n/LocaleContext';
import {
  tradeAsyncMessages,
  type TradeAsyncMessageKey,
} from '@shop/localisation/messages/tradeAsync';
import { notificationPresentation } from './notificationsPresentation';

export function NotificationList({
  items,
  onMarkRead,
}: {
  items: Notification[];
  onMarkRead: (id: string) => void;
}) {
  const { translate, formatInstant } = useLocalisation();
  const t = <K extends TradeAsyncMessageKey>(
    key: K,
    params?: Record<string, string | number | bigint>,
  ) => translate(tradeAsyncMessages, key, params);
  return (
    <ul className="space-y-2" aria-label={t('notifications.aria')}>
      {items.map((item) => {
        const detail = notificationPresentation(item.kind, (key) => t(key));
        return (
          <li key={item.id} className="rounded-lg border p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm text-muted-foreground">{detail.label}</p>
                <h2 className="font-semibold">{item.title}</h2>
                <p>{item.body}</p>
                <time className="text-sm text-muted-foreground" dateTime={item.createdAt}>
                  {formatInstant(item.createdAt)}
                </time>
              </div>
              {item.readAt === null && (
                <Button size="sm" variant="outline" onClick={() => onMarkRead(item.id)}>
                  {t('notifications.markRead')}
                </Button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
