import { Bell } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useNotifications } from '@/hooks/useNotifications';
import { useLocalisation } from '@/i18n/LocaleContext';
import { tradeAsyncMessages } from '@shop/localisation/messages/tradeAsync';

export function NotificationBell() {
  const { unreadCount } = useNotifications();
  const { translate } = useLocalisation();
  const label = translate(tradeAsyncMessages, 'notifications.unread', { count: unreadCount });
  return (
    <Link to="/notifications" aria-label={label} className="relative inline-flex p-2">
      <Bell aria-hidden="true" className="h-5 w-5" />
      {unreadCount > 0 && (
        <span
          aria-hidden="true"
          className="absolute right-0 top-0 min-w-4 rounded-full bg-primary px-1 text-center text-xs text-primary-foreground"
        >
          {unreadCount}
        </span>
      )}
    </Link>
  );
}
