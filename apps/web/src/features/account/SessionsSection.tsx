import { useCallback, useEffect, useState } from 'react';
import type { SessionSummary } from '@shop/contracts/account-depth';
import { listAccountSessions, revokeAccountSession } from '@/api/accountSessions';
import { Button } from '@/components/ui/button';
import { useLocalisation } from '@/i18n/LocaleContext';
import { identityAccountMessages } from '@shop/localisation/messages/identityAccount';
import { localizeAccountError } from './accountError';

function describeSession(
  session: SessionSummary,
  translate: ReturnType<typeof useLocalisation>['translate'],
  formatInstant: ReturnType<typeof useLocalisation>['formatInstant'],
): string {
  const agent =
    session.userAgent ?? translate(identityAccountMessages, 'account.sessions.unknownDevice');
  const seen = session.lastSeenAt ?? session.createdAt;
  return translate(identityAccountMessages, 'account.sessions.lastActive', {
    device: agent,
    instant: formatInstant(seen),
  });
}

/** Buyer-owned session list. A successful revoke is reconciled against a fresh server list. */
export function SessionsSection() {
  const { translate, formatInstant } = useLocalisation();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSessions(await listAccountSessions());
    } catch (loadError) {
      setError(localizeAccountError(loadError, translate, 'account.sessions.loadError'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function revoke(session: SessionSummary) {
    const previous = sessions;
    let revokeCommitted = false;
    setError(null);
    setRevoking(true);
    setSessions((items) => items.filter((item) => item.sessionId !== session.sessionId));
    try {
      await revokeAccountSession(session.sessionId);
      revokeCommitted = true;
      await load();
    } catch (revokeError) {
      if (!revokeCommitted) setSessions(previous);
      setError(localizeAccountError(revokeError, translate, 'account.sessions.revokeError'));
    } finally {
      setRevoking(false);
    }
  }

  return (
    <section aria-labelledby="sessions-heading" className="mt-6 rounded-lg border p-6">
      <h2 id="sessions-heading" className="text-base font-medium">
        {translate(identityAccountMessages, 'account.sessions.title')}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {translate(identityAccountMessages, 'account.sessions.description')}
      </p>
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {loading ? (
        <p className="mt-4 text-sm text-muted-foreground">
          {translate(identityAccountMessages, 'account.sessions.loading')}
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {sessions.map((session) => (
            <li
              key={session.sessionId}
              className="flex items-start justify-between gap-4 rounded-lg border p-4"
            >
              <div>
                <p className="font-medium">
                  {session.isCurrent
                    ? translate(identityAccountMessages, 'account.sessions.current')
                    : translate(identityAccountMessages, 'account.sessions.signedIn')}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {describeSession(session, translate, formatInstant)}
                </p>
              </div>
              <div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={session.isCurrent || revoking}
                  aria-describedby={
                    session.isCurrent ? `current-session-${session.sessionId}` : undefined
                  }
                  onClick={() => void revoke(session)}
                >
                  {revoking
                    ? translate(identityAccountMessages, 'account.sessions.signingOut')
                    : translate(identityAccountMessages, 'account.sessions.signOut')}
                </Button>
                {session.isCurrent && (
                  <p id={`current-session-${session.sessionId}`} className="sr-only">
                    {translate(identityAccountMessages, 'account.sessions.currentDescription')}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {!loading && sessions.length === 0 && (
        <p className="mt-4 text-sm text-muted-foreground">
          {translate(identityAccountMessages, 'account.sessions.none')}
        </p>
      )}
    </section>
  );
}
