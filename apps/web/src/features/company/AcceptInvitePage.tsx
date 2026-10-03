import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { acceptInvite } from '@/api/companyAccounts';
import { ApiError } from '@/api/client';
import { Button } from '@/components/ui/button';
import { useLocalisation } from '@/i18n/LocaleContext';
import { apiErrors } from '@shop/localisation/messages/apiErrors';
import {
  tradeAsyncMessages,
  type TradeAsyncMessageKey,
} from '@shop/localisation/messages/tradeAsync';

export function AcceptInvitePage() {
  const { translate } = useLocalisation();
  const t = <K extends TradeAsyncMessageKey>(
    key: K,
    params?: Record<string, string | number | bigint>,
  ) => translate(tradeAsyncMessages, key, params);
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [error, setError] = useState<string | null>(
    token ? null : t('company.accept.missingToken'),
  );
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  async function accept() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await acceptInvite({ token });
      setAccepted(true);
    } catch (error) {
      if (error instanceof ApiError && error.code !== null) {
        try {
          setError(translate(apiErrors, error.code, {}));
        } catch {
          setError(t('company.accept.error'));
        }
      } else setError(t('company.accept.error'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="mx-auto max-w-xl py-12">
      <h1 className="text-2xl font-bold">{t('company.accept.title')}</h1>
      {accepted ? (
        <div className="mt-5 rounded-lg border p-5">
          <p role="status">{t('company.accept.success')}</p>
          <Link className="mt-3 inline-block underline" to="/account/company">
            {t('company.accept.view')}
          </Link>
        </div>
      ) : (
        <div className="mt-5 rounded-lg border p-5">
          <p>{t('company.accept.description')}</p>
          {error && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {error}
            </p>
          )}
          <Button
            type="button"
            className="mt-4"
            disabled={busy || !token}
            onClick={() => void accept()}
          >
            {busy ? t('company.accept.accepting') : t('company.accept.button')}
          </Button>
        </div>
      )}
    </main>
  );
}
