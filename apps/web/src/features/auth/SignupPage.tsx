import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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

type SignupErrorState = {
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

function signupErrorState(
  cause: unknown,
  key: IdentityAccountMessageKey,
  submittedCountry?: Country,
): SignupErrorState {
  if (cause instanceof ApiError) {
    return { code: cause.code, meta: cause.meta, key, country: submittedCountry };
  }
  // Validation, network, contract, and unknown failures retain only stable fallback identity.
  return { code: null, meta: null, key };
}

function localizeSignupError(
  state: SignupErrorState | null,
  activeCountry: Country,
): string | null {
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
      // Malformed/stale coded descriptors use safe sign-up copy.
    }
  }
  return translateUnchecked(
    identityAccountMessages,
    state.country ?? activeCountry,
    state.key,
    state.params ?? {},
  );
}

export function SignupPage() {
  const { signup } = useAuth();
  const { activeCountry } = useCountry();
  const { translate } = useLocalisation();
  const navigate = useNavigate();

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [country, setCountry] = useState<Country>(activeCountry);
  const [errorState, setErrorState] = useState<SignupErrorState | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErrorState(null);

    if (!displayName.trim()) {
      setErrorState({ code: null, meta: null, key: 'auth.validation.displayNameRequired' });
      return;
    }
    if (!email.trim()) {
      setErrorState({ code: null, meta: null, key: 'auth.validation.emailRequired' });
      return;
    }
    if (password.length < 8) {
      setErrorState({ code: null, meta: null, key: 'auth.validation.passwordLength' });
      return;
    }
    if (!SUPPORTED_COUNTRIES.includes(country)) {
      setErrorState({ code: null, meta: null, key: 'auth.signIn.invalidCountry' });
      return;
    }

    const submittedCountry = country;
    setSubmitting(true);
    try {
      await signup(email, password, displayName, submittedCountry);
      navigate('/', { replace: true });
    } catch (err) {
      setErrorState(
        err instanceof ApiError
          ? signupErrorState(err, 'auth.signUp.failed', submittedCountry)
          : { code: null, meta: null, key: 'auth.unexpected' },
      );
    } finally {
      setSubmitting(false);
    }
  }

  const error = localizeSignupError(errorState, activeCountry);

  return (
    <div className="mx-auto max-w-sm py-20">
      <h1 className="text-2xl font-bold text-center">
        {translate(identityAccountMessages, 'auth.signUp.title')}
      </h1>

      <form onSubmit={(e) => void handleSubmit(e)} className="mt-8 space-y-4">
        {error && <ErrorMessage message={error} />}

        <div>
          <label htmlFor="signup-name" className="block text-sm font-medium">
            {translate(identityAccountMessages, 'auth.signUp.displayName')}
          </label>
          <input
            id="signup-name"
            type="text"
            autoComplete="name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="mt-1 block w-full rounded-md border px-3 py-2 text-sm"
            placeholder={translate(identityAccountMessages, 'auth.signUp.displayNamePlaceholder')}
          />
        </div>

        <div>
          <label htmlFor="signup-email" className="block text-sm font-medium">
            {translate(identityAccountMessages, 'auth.signUp.email')}
          </label>
          <input
            id="signup-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 block w-full rounded-md border px-3 py-2 text-sm"
            placeholder={translate(identityAccountMessages, 'auth.signUp.emailPlaceholder')}
          />
        </div>

        <div>
          <label htmlFor="signup-password" className="block text-sm font-medium">
            {translate(identityAccountMessages, 'auth.signUp.password')}
          </label>
          <input
            id="signup-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 block w-full rounded-md border px-3 py-2 text-sm"
            placeholder={translate(identityAccountMessages, 'auth.signUp.passwordPlaceholder')}
          />
        </div>

        <div>
          <label htmlFor="signup-country" className="block text-sm font-medium">
            {translate(identityAccountMessages, 'auth.signUp.country')}
          </label>
          <select
            id="signup-country"
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
            ? translate(identityAccountMessages, 'auth.signUp.submitting')
            : translate(identityAccountMessages, 'auth.signUp.submit')}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        {translate(identityAccountMessages, 'auth.signUp.haveAccount')}{' '}
        <Link to="/login" className="underline">
          {translate(identityAccountMessages, 'auth.signUp.signIn')}
        </Link>
      </p>
    </div>
  );
}
