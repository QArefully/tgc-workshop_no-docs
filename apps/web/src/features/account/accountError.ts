import type { MessageCatalog, MessageParams } from '@shop/localisation';
import { translate } from '@shop/localisation';
import { apiErrors } from '@shop/localisation/messages/apiErrors';
import { countryMessages } from '@shop/localisation/messages/country';
import {
  identityAccountMessages,
  type IdentityAccountMessageKey,
} from '@shop/localisation/messages/identityAccount';
import { ApiError } from '@/api/client';

type Translate = (catalog: MessageCatalog, key: string, params?: MessageParams) => string;
type CountryTranslate = Translate;

/** Render a public API error by stable code; uncoded responses use safe localized fallback copy. */
export function localizeAccountError(
  error: unknown,
  t: Translate,
  fallback: IdentityAccountMessageKey,
  params: MessageParams = {},
): string {
  if (error instanceof ApiError) {
    if (error.code !== null) {
      try {
        return translate(
          apiErrors,
          error.requestCountry,
          error.code,
          (error.meta ?? {}) as MessageParams,
        );
      } catch {
        // A malformed descriptor must not blank the form; use a safe local fallback.
      }
    }
  }
  return t(identityAccountMessages, fallback, params);
}

/** Translate stable validation strings while keeping existing pure validators/test fixtures. */
export function localizeValidationMessage(
  value: string | undefined,
  t: Translate,
  countryTranslate?: CountryTranslate,
): string | undefined {
  if (!value) return value;
  const exact: Partial<Record<string, IdentityAccountMessageKey>> = {
    'Email and password are required': 'auth.signIn.required',
    'Invalid country selection': 'auth.signIn.invalidCountry',
    'Login failed': 'auth.signIn.failed',
    'An unexpected error occurred': 'auth.unexpected',
    'Display name is required': 'auth.validation.displayNameRequired',
    'Email is required': 'auth.validation.emailRequired',
    'Password must be at least 8 characters': 'auth.validation.passwordLength',
    'Signup failed': 'auth.signUp.failed',
    'Reset token is required': 'auth.reset.validationToken',
    'Passwords do not match': 'auth.reset.validationMismatch',
    'Both fields are required': 'account.validation.passwordRequired',
    'Password must be 8-128 characters': 'account.validation.passwordLength',
    'Current password is required': 'account.delete.validationPassword',
    'Unable to save preferences': 'account.preferences.saveError',
    'Unable to load signed-in sessions': 'account.sessions.loadError',
    'Unable to sign out this session': 'account.sessions.revokeError',
    'Unable to download your export': 'account.export.error',
    'Unable to delete your account': 'account.delete.error',
  };
  const key = exact[value];
  if (key) return t(identityAccountMessages, key);

  const labelMap: Record<string, IdentityAccountMessageKey> = {
    'Address line 1': 'account.address.line1',
    'Address line 2': 'account.address.line2',
    City: 'account.address.city',
    'County or region': 'account.address.region',
    'Country code': 'account.address.countryCode',
    'Site name': 'account.trade.siteName',
    'Contact name': 'account.trade.contactName',
    'Contact phone': 'account.trade.contactPhone',
    'Registered company name': 'account.trade.registeredCompanyName',
    'Company registration number': 'account.trade.registrationNumber',
    'VAT number': 'account.trade.vatNumber',
  };
  const localizeLabel = (label: string): string => {
    if (labelMap[label]) return t(identityAccountMessages, labelMap[label]);
    const postcodeLabels = [
      'Postcode',
      'ZIP',
      'ZIP code',
      '邮政编码',
      'Kod pocztowy',
      'Código postal',
      'Postleitzahl',
      'Code postal',
    ];
    if (countryTranslate && postcodeLabels.includes(label)) {
      return countryTranslate(countryMessages, 'postcode.label');
    }
    return label;
  };
  let match = /^(.+) is required$/.exec(value);
  if (match)
    return t(identityAccountMessages, 'account.validation.required', {
      label: localizeLabel(match[1]!),
    });
  match = /^(.+) must be (\d+) characters or fewer$/.exec(value);
  if (match)
    return t(identityAccountMessages, 'account.validation.max', {
      label: localizeLabel(match[1]!),
      max: match[2]!,
    });
  match = /^(.+) cannot contain < or >$/.exec(value);
  if (match)
    return t(identityAccountMessages, 'account.validation.markup', {
      label: localizeLabel(match[1]!),
    });
  match = /^Enter a valid (.+), for example (.+)$/.exec(value);
  if (match) {
    return t(identityAccountMessages, 'account.validation.postcode', {
      label: localizeLabel(match[1]!),
      example: match[2]!,
    });
  }
  match = /^Country code must be two letters, for example (.+)$/.exec(value);
  if (match)
    return t(identityAccountMessages, 'account.validation.countryCode', { example: match[1]! });
  match = /^Delivery is not available to (.+) for this account$/.exec(value);
  if (match)
    return t(identityAccountMessages, 'account.validation.deliveryCountry', { country: match[1]! });
  match = /^Contact phone must be (\d+)-(\d+) characters$/.exec(value);
  if (match)
    return t(identityAccountMessages, 'account.validation.phoneLength', {
      min: match[1]!,
      max: match[2]!,
    });
  if (value === 'Contact phone may use digits, spaces, and + ( ) - only') {
    return t(identityAccountMessages, 'account.validation.phoneChars');
  }
  if (value === 'Contact phone must include at least one digit') {
    return t(identityAccountMessages, 'account.validation.phoneDigit');
  }
  return value;
}

export function localizeValidationErrors<T>(
  errors: T | undefined,
  t: Translate,
  countryTranslate?: CountryTranslate,
): T | undefined {
  if (!errors) return errors;
  return Object.fromEntries(
    Object.entries(errors as Record<string, string | undefined>).map(([key, value]) => [
      key,
      localizeValidationMessage(value, t, countryTranslate),
    ]),
  ) as T;
}

export { identityAccountMessages };
