import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useCountry } from '@/hooks/CountryContext';
import { SUPPORTED_COUNTRIES, type Country } from '@shop/contracts/country';
import { Button } from '@/components/ui/button';
import { forgotPassword } from '@/api/auth';
import { useLocalisation } from '@/i18n/LocaleContext';
import { countryMessages } from '@shop/localisation/messages/country';
import { identityAccountMessages } from '@shop/localisation/messages/identityAccount';

export function ForgotPasswordPage() {
  const { activeCountry } = useCountry();
  const { translate } = useLocalisation();
  const [email, setEmail] = useState('');
  const [country, setCountry] = useState<Country>(activeCountry);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;

    setSubmitting(true);
    try {
      await forgotPassword({ email, country });
    } catch {
      // Always show success — no user enumeration.
    } finally {
      setSubmitting(false);
      setSent(true);
    }
  }

  if (sent) {
    return (
      <div className="mx-auto max-w-sm py-20 text-center">
        <h1 className="text-2xl font-bold">
          {translate(identityAccountMessages, 'auth.forgot.checkEmailTitle')}
        </h1>
        <p className="mt-4 text-muted-foreground">
          {translate(identityAccountMessages, 'auth.forgot.checkEmailBody')}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          {translate(identityAccountMessages, 'auth.forgot.mailboxBefore')}{' '}
          <Link to="/mailbox" className="underline">
            {translate(identityAccountMessages, 'auth.forgot.devMailbox')}
          </Link>{' '}
          {translate(identityAccountMessages, 'auth.forgot.mailboxAfter')}
        </p>
        <p className="mt-4">
          <Link to="/login" className="text-sm underline">
            {translate(identityAccountMessages, 'auth.forgot.backToSignIn')}
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm py-20">
      <h1 className="text-2xl font-bold text-center">
        {translate(identityAccountMessages, 'auth.forgot.title')}
      </h1>

      <form onSubmit={(e) => void handleSubmit(e)} className="mt-8 space-y-4">
        <p className="text-sm text-muted-foreground">
          {translate(identityAccountMessages, 'auth.forgot.description')}
        </p>

        <div>
          <label htmlFor="forgot-email" className="block text-sm font-medium">
            {translate(identityAccountMessages, 'auth.forgot.email')}
          </label>
          <input
            id="forgot-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 block w-full rounded-md border px-3 py-2 text-sm"
            placeholder={translate(identityAccountMessages, 'auth.forgot.emailPlaceholder')}
          />
        </div>

        <div>
          <label htmlFor="forgot-country" className="block text-sm font-medium">
            {translate(identityAccountMessages, 'auth.forgot.country')}
          </label>
          <select
            id="forgot-country"
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

        <Button type="submit" disabled={submitting || !email.trim()} className="w-full">
          {submitting
            ? translate(identityAccountMessages, 'auth.forgot.submitting')
            : translate(identityAccountMessages, 'auth.forgot.submit')}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        <Link to="/login" className="underline">
          {translate(identityAccountMessages, 'auth.forgot.backToSignIn')}
        </Link>
      </p>
    </div>
  );
}
