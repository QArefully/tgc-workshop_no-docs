import { ErrorMessage } from '@/components/ErrorMessage';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { Button } from '@/components/ui/button';
import { useNotifications } from '@/hooks/useNotifications';
import { useLocalisation } from '@/i18n/LocaleContext';
import {
  tradeAsyncMessages,
  type TradeAsyncMessageKey,
} from '@shop/localisation/messages/tradeAsync';
import { NotificationList } from './NotificationList';

export function NotificationsPage() {
  const { translate } = useLocalisation();
  const t = <K extends TradeAsyncMessageKey>(
    key: K,
    params?: Record<string, string | number | bigint>,
  ) => translate(tradeAsyncMessages, key, params);
  const { notifications, unreadCount, loading, error, refresh, markRead, markAllRead } =
    useNotifications();
  if (loading && notifications.length === 0) return <LoadingSpinner />;
  if (error && notifications.length === 0)
    return <ErrorMessage message={error} onRetry={() => void refresh()} />;
  return (
    <section className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="section-eyebrow">{t('notifications.account')}</p>
          <h1 className="section-heading mt-2">{t('notifications.aria')}</h1>
        </div>
        <Button disabled={!unreadCount} onClick={() => void markAllRead()}>
          {t('notifications.markAllRead')}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {notifications.length === 0 ? (
        <p className="rounded-lg border py-12 text-center text-muted-foreground">
          {t('notifications.empty')}
        </p>
      ) : (
        <NotificationList items={notifications} onMarkRead={(id) => void markRead(id)} />
      )}
    </section>
  );
}
