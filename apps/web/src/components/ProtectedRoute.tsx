import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/AuthContext';
import { LoadingSpinner } from './LoadingSpinner';

/**
 * Wraps a route that requires authentication.
 * Redirects to /login if not authenticated, preserving the intended destination.
 */
export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
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

  return <>{children}</>;
}
