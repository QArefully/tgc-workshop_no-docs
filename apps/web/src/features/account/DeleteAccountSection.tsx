import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { deleteAccount } from '@/api/accountDeletion';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/AuthContext';
import { useLocalisation } from '@/i18n/LocaleContext';
import { identityAccountMessages } from '@shop/localisation/messages/identityAccount';
import { localizeAccountError } from './accountError';

const CONFIRMATION = 'delete my account';

export function DeleteAccountSection() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const { translate } = useLocalisation();
  const [currentPassword, setCurrentPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!currentPassword) {
      setError(translate(identityAccountMessages, 'account.delete.validationPassword'));
      return;
    }
    if (confirmation !== CONFIRMATION) {
      setError(translate(identityAccountMessages, 'account.delete.validationConfirmation'));
      return;
    }
    setSubmitting(true);
    try {
      await deleteAccount({ currentPassword });
    } catch (deleteError) {
      setError(localizeAccountError(deleteError, translate, 'account.delete.error'));
      setSubmitting(false);
      return;
    }

    try {
      await logout();
    } catch {
      // Account deletion already committed. Local auth cleanup and navigation must continue.
    }
    navigate('/', { replace: true });
    setSubmitting(false);
  }

  return (
    <section
      aria-labelledby="delete-account-heading"
      className="mt-6 rounded-lg border border-destructive/40 p-6"
    >
      <h2 id="delete-account-heading" className="text-base font-medium">
        {translate(identityAccountMessages, 'account.delete.title')}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {translate(identityAccountMessages, 'account.delete.description')}
      </p>
      <form className="mt-4 space-y-4" onSubmit={(event) => void submit(event)}>
        {error && (
          <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </p>
        )}
        <div>
          <label htmlFor="delete-account-password" className="block text-sm font-medium">
            {translate(identityAccountMessages, 'account.delete.currentPassword')}
          </label>
          <input
            id="delete-account-password"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            className="mt-1 block w-full rounded-md border px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="delete-account-confirmation" className="block text-sm font-medium">
            {translate(identityAccountMessages, 'account.delete.confirmationLabel')}
          </label>
          <input
            id="delete-account-confirmation"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            className="mt-1 block w-full rounded-md border px-3 py-2 text-sm"
          />
        </div>
        <Button type="submit" variant="destructive" disabled={submitting}>
          {submitting
            ? translate(identityAccountMessages, 'account.delete.submitting')
            : translate(identityAccountMessages, 'account.delete.submit')}
        </Button>
      </form>
    </section>
  );
}
