import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Country } from '@shop/contracts/country';
import type { PublicErrorCode } from '@shop/contracts/public-errors';
import { translateUnchecked, type MessageParams } from '@shop/localisation';
import { apiErrors } from '@shop/localisation/messages/apiErrors';
import { Button } from '@/components/ui/button';
import { ErrorMessage } from '@/components/ErrorMessage';
import { resetPassword } from '@/api/auth';
import { ApiError, type ApiErrorMeta } from '@/api/client';
import { useLocalisation } from '@/i18n/LocaleContext';
import {
  identityAccountMessages,
  type IdentityAccountMessageKey,
} from '@shop/localisation/messages/identityAccount';

type ResetErrorState = {
  readonly code: PublicErrorCode | null;
  readonly meta: ApiErrorMeta | null;
  readonly key: IdentityAccountMessageKey;
  readonly params?: MessageParams;
  /** Coded transport errors retain request country; fallback keys follow active country. */
  readonly country?: Country;
};

function safeMessageParams(meta: ApiErrorMeta | null): MessageParams {
  if (meta === null || typeof meta !== 'object') return {};
  const params: Record<string, string | number | bigint> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint')
      params[key] = value;
  }
  return params;
}

function resetErrorState(cause: unknown, key: IdentityAccountMessageKey): ResetErrorState {
  if (cause instanceof ApiError && cause.code !== null) {
    return { code: cause.code, meta: cause.meta, key, country: cause.requestCountry };
  }
  // Validation, network, legacy, contract, and unknown failures retain only stable fallback key.
  return { code: null, meta: null, key };
}

function localizeResetError(state: ResetErrorState | null, activeCountry: Country): string | null {
  if (state === null) return null;
  if (state.code !== null) {
    try {
      return translateUnchecked(
        apiErrors,
        state.country ?? activeCountry,
        state.code,
        safeMessageParams(state.meta),
      );
    } catch {
      // Malformed/stale coded descriptors use safe reset copy.
    }
  }
  return translateUnchecked(identityAccountMessages, activeCountry, state.key, state.params ?? {});
}

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const tokenFromUrl = searchParams.get('token') ?? '';
  const { activeCountry, translate } = useLocalisation();

  const [token, setToken] = useState(tokenFromUrl);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errorState, setErrorState] = useState<ResetErrorState | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErrorState(null);

    if (!token.trim()) {
      setErrorState({ code: null, meta: null, key: 'auth.reset.validationToken' });
      return;
    }
    if (newPassword.length < 8) {
      setErrorState({ code: null, meta: null, key: 'auth.reset.validationPasswordLength' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorState({ code: null, meta: null, key: 'auth.reset.validationMismatch' });
      return;
    }

    setSubmitting(true);
    try {
      await resetPassword({ token, newPassword });
      setSuccess(true);
    } catch (err) {
      setErrorState(
        err instanceof ApiError
          ? resetErrorState(err, 'auth.reset.failed')
          : { code: null, meta: null, key: 'auth.unexpected' },
      );
    } finally {
      setSubmitting(false);
    }
  }

  const error = localizeResetError(errorState, activeCountry);

  if (success) {
    return (
      <div className="mx-auto max-w-sm py-20 text-center">
        <h1 className="text-2xl font-bold">
          {translate(identityAccountMessages, 'auth.reset.successTitle')}
        </h1>
        <p className="mt-4 text-muted-foreground">
          {translate(identityAccountMessages, 'auth.reset.successBody')}
        </p>
        <p className="mt-4">
          <Link to="/login" className="text-sm underline">
            {translate(identityAccountMessages, 'auth.reset.successLink')}
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm py-20">
      <h1 className="text-2xl font-bold text-center">
        {translate(identityAccountMessages, 'auth.reset.title')}
      </h1>

      <form onSubmit={(e) => void handleSubmit(e)} className="mt-8 space-y-4">
        {error && <ErrorMessage message={error} />}

        {!tokenFromUrl && (
          <div>
            <label htmlFor="reset-token" className="block text-sm font-medium">
              {translate(identityAccountMessages, 'auth.reset.token')}
            </label>
            <input
              id="reset-token"
              type="text"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="mt-1 block w-full rounded-md border px-3 py-2 text-sm font-mono"
              placeholder={translate(identityAccountMessages, 'auth.reset.tokenPlaceholder')}
            />
          </div>
        )}

        <div>
          <label htmlFor="reset-password" className="block text-sm font-medium">
            {translate(identityAccountMessages, 'auth.reset.newPassword')}
          </label>
          <input
            id="reset-password"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="mt-1 block w-full rounded-md border px-3 py-2 text-sm"
            placeholder={translate(identityAccountMessages, 'auth.reset.newPasswordPlaceholder')}
          />
        </div>

        <div>
          <label htmlFor="reset-confirm" className="block text-sm font-medium">
            {translate(identityAccountMessages, 'auth.reset.confirmPassword')}
          </label>
          <input
            id="reset-confirm"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="mt-1 block w-full rounded-md border px-3 py-2 text-sm"
            placeholder={translate(
              identityAccountMessages,
              'auth.reset.confirmPasswordPlaceholder',
            )}
          />
        </div>

        <Button type="submit" disabled={submitting} className="w-full">
          {submitting
            ? translate(identityAccountMessages, 'auth.reset.submitting')
            : translate(identityAccountMessages, 'auth.reset.submit')}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        <Link to="/login" className="underline">
          {translate(identityAccountMessages, 'auth.reset.backToSignIn')}
        </Link>
      </p>
    </div>
  );
}
