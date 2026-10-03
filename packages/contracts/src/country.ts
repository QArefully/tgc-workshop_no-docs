import { Type, type Static } from '@sinclair/typebox';

/**
 * Identity-axis country for this buyer — which trade region, catalogue, and regulatory
 * profile applies. Distinct from the postal `CountryCode` (`PostalAddress.countryCode`),
 * which is an ISO-3166-1 alpha-2 marker for physical delivery routing.
 *
 * Country ≠ CountryCode. `'GB'` is valid for `PostalAddress.countryCode` and invalid
 * for `Country`. Display, availability, delivery, and currency settings are attached through
 * the checked-in country profile rather than inferred from a postal destination.
 */
export const Country = Type.Union([
  Type.Literal('UK'),
  Type.Literal('US'),
  Type.Literal('CN'),
  Type.Literal('PL'),
  Type.Literal('ES'),
  Type.Literal('DE'),
  Type.Literal('FR'),
]);
export type Country = Static<typeof Country>;

/** Deterministic order for UI lists. Read-only. */
export const SUPPORTED_COUNTRIES = [
  'UK',
  'US',
  'CN',
  'PL',
  'ES',
  'DE',
  'FR',
] as const satisfies readonly Country[];

/** Guest buyer default before explicit selection. */
export const DEFAULT_GUEST_COUNTRY = 'US';

/** Pre-country-profile data assumed to belong to the UK market. */
export const LEGACY_DATA_COUNTRY = 'UK';
