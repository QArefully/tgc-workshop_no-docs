import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/AuthContext';
import { LoadingSpinner } from './LoadingSpinner';
import { useLocalisation } from '@/i18n/LocaleContext';
import { webMessages } from '@shop/localisation/messages/webShell';

/** Presentation guard only; API handlers remain permission authority. */
export function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  const { translate } = useLocalisation();

  if (loading) {
    return (
      <div
        className="flex items-center justify-center py-20"
        aria-label={translate(webMessages, 'shell.checkingAccess')}
      >
        <LoadingSpinner />
      </div>
    );
  }

  if (!user) {
    return (
      <Navigate
        to="/login"
        state={{ from: `${location.pathname}${location.search}${location.hash}` }}
        replace
      />
    );
  }

  if (user.role !== 'admin') return <Navigate to="/" replace />;

  return <>{children}</>;
}
