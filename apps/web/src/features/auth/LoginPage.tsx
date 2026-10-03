import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/AuthContext';
import { useCountry } from '@/hooks/CountryContext';
import { SUPPORTED_COUNTRIES, type Country } from '@shop/contracts/country';
import type { PublicErrorCode } from '@shop/contracts/public-errors';
import { translateUnchecked, type MessageParams } from '@shop/localisation';
import { apiErrors } from '@shop/localisation/messages/apiErrors';
import { Button } from '@/components/ui/button';
import { ErrorMessage } from '@/components/ErrorMessage';
import { ApiError, type ApiErrorMeta } from '@/api/client';
import { useLocalisation } from '@/i18n/LocaleContext';
import { countryMessages } from '@shop/localisation/messages/country';
import {
  identityAccountMessages,
  type IdentityAccountMessageKey,
} from '@shop/localisation/messages/identityAccount';
import { resolveLoginReturnPath } from './loginReturnPath';

type LoginErrorState = {
  readonly code: PublicErrorCode | null;
  readonly meta: ApiErrorMeta | null;
  readonly key: IdentityAccountMessageKey;
  readonly params?: MessageParams;
  /** Identity API failures use country submitted with this request. */
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

function loginErrorState(
  cause: unknown,
  key: IdentityAccountMessageKey,
  submittedCountry?: Country,
): LoginErrorState {
  if (cause instanceof ApiError) {
    return {
      code: cause.code,
      meta: cause.meta,
      key,
      country: submittedCountry,
    };
  }
  // Validation, network, contract, and unknown failures retain only stable fallback identity.
  return { code: null, meta: null, key };
}

function localizeLoginError(state: LoginErrorState | null, activeCountry: Country): string | null {
  if (state === null) return null;
  // On the sign-in form, UNAUTHORIZED means the submitted credentials were rejected.
  // The generic API copy is reserved for requests that require an existing session.
  if (state.code === 'UNAUTHORIZED') {
    return translateUnchecked(
      identityAccountMessages,
      state.country ?? activeCountry,
      state.key,
      state.params ?? {},
    );
  }
  if (state.code !== null) {
    try {
      return translateUnchecked(
        apiErrors,
        state.country ?? activeCountry,
        state.code,
        safeMessageParams(state.meta),
      );
    } catch {
      // Malformed/stale coded descriptors use safe sign-in copy.
    }
  }
  return translateUnchecked(
    identityAccountMessages,
    state.country ?? activeCountry,
    state.key,
    state.params ?? {},
  );
}

export function LoginPage() {
  const { login } = useAuth();
  const { activeCountry } = useCountry();
  const { translate } = useLocalisation();
  const location = useLocation();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [country, setCountry] = useState<Country>(activeCountry);
  const [errorState, setErrorState] = useState<LoginErrorState | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErrorState(null);

    if (!email.trim() || !password) {
      setErrorState({ code: null, meta: null, key: 'auth.signIn.required' });
      return;
    }
    if (!SUPPORTED_COUNTRIES.includes(country)) {
      setErrorState({ code: null, meta: null, key: 'auth.signIn.invalidCountry' });
      return;
    }

    const submittedCountry = country;
    setSubmitting(true);
    try {
      await login(email, password, submittedCountry);
      navigate(resolveLoginReturnPath(location.state), { replace: true });
    } catch (err) {
      setErrorState(
        err instanceof ApiError
          ? loginErrorState(err, 'auth.signIn.failed', submittedCountry)
          : { code: null, meta: null, key: 'auth.unexpected' },
      );
    } finally {
      setSubmitting(false);
    }
  }

  const error = localizeLoginError(errorState, activeCountry);

  return (
    <div className="mx-auto max-w-sm py-20">
      <h1 className="text-2xl font-bold text-center">
        {translate(identityAccountMessages, 'auth.signIn.title')}
      </h1>

      <form onSubmit={(e) => void handleSubmit(e)} className="mt-8 space-y-4">
        {error && <ErrorMessage message={error} />}

        <div>
          <label htmlFor="login-email" className="block text-sm font-medium">
            {translate(identityAccountMessages, 'auth.signIn.email')}
          </label>
          <input
            id="login-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 block w-full rounded-md border px-3 py-2 text-sm"
            placeholder={translate(identityAccountMessages, 'auth.signIn.emailPlaceholder')}
          />
        </div>

        <div>
          <label htmlFor="login-password" className="block text-sm font-medium">
            {translate(identityAccountMessages, 'auth.signIn.password')}
          </label>
          <input
            id="login-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 block w-full rounded-md border px-3 py-2 text-sm"
            placeholder={translate(identityAccountMessages, 'auth.signIn.passwordPlaceholder')}
          />
        </div>

        <div>
          <label htmlFor="login-country" className="block text-sm font-medium">
            {translate(identityAccountMessages, 'auth.signIn.country')}
          </label>
          <select
            id="login-country"
            value={country}
            onChange={(e) => setCountry(e.target.value as Country)}
            className="mt-1 block w-full rounded-md border px-3 py-2 text-sm"
          >
            {SUPPORTED_COUNTRIES.map((c) => (
              <option key={c} value={c}>
                {translate(
                  countryMessages,
                  `country.name.${c.toLowerCase()}` as keyof typeof countryMessages,
                )}
              </option>
            ))}
          </select>
        </div>

        <Button type="submit" disabled={submitting} className="w-full">
          {submitting
            ? translate(identityAccountMessages, 'auth.signIn.submitting')
            : translate(identityAccountMessages, 'auth.signIn.submit')}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        {translate(identityAccountMessages, 'auth.signIn.noAccount')}{' '}
        <Link to="/signup" className="underline">
          {translate(identityAccountMessages, 'auth.signIn.signUp')}
        </Link>
      </p>
      <p className="mt-2 text-center text-sm text-muted-foreground">
        <Link to="/forgot-password" className="underline">
          {translate(identityAccountMessages, 'auth.signIn.forgotPassword')}
        </Link>
      </p>
    </div>
  );
}
