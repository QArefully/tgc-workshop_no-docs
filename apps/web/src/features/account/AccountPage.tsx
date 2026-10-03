import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/AuthContext';
import { changePassword as changePasswordApi } from '@/api/auth';
import { Button } from '@/components/ui/button';
import { ErrorMessage } from '@/components/ErrorMessage';
import { ApiError } from '@/api/client';
import { CalendarClock, List, LogOut, Package } from 'lucide-react';
import { BackInStockSection } from '@/features/backInStock/BackInStockSection';
import { BillingEntitiesSection } from './BillingEntitiesSection';
import { DataExportSection } from './DataExportSection';
import { DeleteAccountSection } from './DeleteAccountSection';
import { DeliverySitesSection } from './DeliverySitesSection';
import { PreferencesSection } from './PreferencesSection';
import { SessionsSection } from './SessionsSection';
import { useTradeProfile } from './useTradeProfile';
import { useLocalisation } from '@/i18n/LocaleContext';
import { identityAccountMessages } from '@shop/localisation/messages/identityAccount';
import { localizeAccountError } from './accountError';

/**
 * Account page — authenticated user details, password change, trade profile, and actions.
 * Requires auth (guarded by ProtectedRoute).
 *
 * The trade profile sections live here rather than on their own route: they are account settings,
 * and checkout reads the same saved records without the buyer needing a separate destination.
 */
export function AccountPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const tradeProfile = useTradeProfile();
  const { translate } = useLocalisation();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handlePasswordChange(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (!currentPassword || !newPassword) {
      setError(translate(identityAccountMessages, 'account.validation.passwordRequired'));
      return;
    }

    if (newPassword.length < 8 || newPassword.length > 128) {
      setError(translate(identityAccountMessages, 'account.validation.passwordLength'));
      return;
    }

    setSubmitting(true);
    try {
      await changePasswordApi({ currentPassword, newPassword });
      setSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
    } catch (err) {
      if (err instanceof ApiError) {
        setError(localizeAccountError(err, translate, 'account.common.saveError'));
      } else {
        setError(translate(identityAccountMessages, 'auth.unexpected'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLogout() {
    await logout();
    navigate('/', { replace: true });
  }

  return (
    <div className="mx-auto max-w-2xl py-20">
      <h1 className="text-2xl font-bold">{translate(identityAccountMessages, 'account.title')}</h1>

      {/* User details */}
      <div className="mt-8 rounded-lg border p-6">
        <h2 className="text-sm font-medium text-muted-foreground">
          {translate(identityAccountMessages, 'account.details')}
        </h2>
        <dl className="mt-4 space-y-2">
          <div className="flex justify-between">
            <dt className="text-sm text-muted-foreground">
              {translate(identityAccountMessages, 'account.displayName')}
            </dt>
            <dd className="text-sm font-medium">{user?.displayName}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-sm text-muted-foreground">
              {translate(identityAccountMessages, 'account.email')}
            </dt>
            <dd className="text-sm font-medium">{user?.email}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-sm text-muted-foreground">
              {translate(identityAccountMessages, 'account.role')}
            </dt>
            <dd className="text-sm font-medium capitalize">{user?.role}</dd>
          </div>
        </dl>
      </div>

      {/* Password change */}
      <div className="mt-6 rounded-lg border p-6">
        <h2 className="text-sm font-medium text-muted-foreground">
          {translate(identityAccountMessages, 'account.changePassword')}
        </h2>

        <form onSubmit={(e) => void handlePasswordChange(e)} className="mt-4 space-y-4">
          {error && <ErrorMessage message={error} />}
          {success && (
            <div className="rounded-md bg-green-50 p-3 text-sm text-green-700">
              {translate(identityAccountMessages, 'account.passwordSuccess')}
            </div>
          )}

          <div>
            <label htmlFor="current-password" className="block text-sm font-medium">
              {translate(identityAccountMessages, 'account.currentPassword')}
            </label>
            <input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="mt-1 block w-full rounded-md border px-3 py-2 text-sm"
              placeholder={translate(identityAccountMessages, 'account.currentPasswordPlaceholder')}
            />
          </div>

          <div>
            <label htmlFor="new-password" className="block text-sm font-medium">
              {translate(identityAccountMessages, 'account.newPassword')}
            </label>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="mt-1 block w-full rounded-md border px-3 py-2 text-sm"
              placeholder={translate(identityAccountMessages, 'account.newPasswordPlaceholder')}
            />
          </div>

          <Button type="submit" disabled={submitting} className="w-full">
            {submitting
              ? translate(identityAccountMessages, 'account.passwordSubmitting')
              : translate(identityAccountMessages, 'account.passwordSubmit')}
          </Button>
        </form>
      </div>

      {/* Trade profile — saved delivery sites and billing parties reused at checkout */}
      {user && (
        <>
          <DeliverySitesSection profile={tradeProfile} />
          <BillingEntitiesSection profile={tradeProfile} />
          <SessionsSection />
          <PreferencesSection />
          <BackInStockSection />
          <DataExportSection />
          <DeleteAccountSection />
        </>
      )}

      {/* Actions */}
      <div className="mt-6 space-y-3">
        <Link
          to="/orders"
          className="flex w-full items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
        >
          <Package className="h-4 w-4" />
          {translate(identityAccountMessages, 'account.viewOrders')}
        </Link>
        <Link
          to="/lists"
          className="flex w-full items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
        >
          <List className="h-4 w-4" />
          {translate(identityAccountMessages, 'account.viewSavedLists')}
        </Link>
        <Link
          to="/account/standing-orders"
          className="flex w-full items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
        >
          <CalendarClock className="h-4 w-4" />
          {translate(identityAccountMessages, 'account.manageStandingOrders')}
        </Link>

        <Button variant="outline" className="w-full" onClick={() => void handleLogout()}>
          <LogOut className="mr-2 h-4 w-4" />
          {translate(identityAccountMessages, 'account.signOut')}
        </Button>
      </div>
    </div>
  );
}
