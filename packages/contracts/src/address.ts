import { Type, type Static } from '@sinclair/typebox';
import { REQUIRED_PLAIN_TEXT_PATTERN } from './common.js';

/**
 * Plain-text address line. Markup delimiters are excluded so a rendered address can never carry
 * injected markup into mail bodies or stored order snapshots. Whitespace-only values are rejected:
 * `formatPostalAddress` trims each part, so such a line would silently vanish from the rendered
 * address instead of failing at the boundary.
 */
const AddressLine = Type.String({
  minLength: 1,
  maxLength: 120,
  pattern: REQUIRED_PLAIN_TEXT_PATTERN,
});
const AddressLocality = Type.String({
  minLength: 1,
  maxLength: 80,
  pattern: REQUIRED_PLAIN_TEXT_PATTERN,
});

/** Postcode / ZIP. Casing is normalized by the backend, so transport accepts either case. */
export const Postcode = Type.String({
  minLength: 1,
  maxLength: 16,
  pattern: '^[A-Za-z0-9][A-Za-z0-9 -]*$',
});
export type Postcode = Static<typeof Postcode>;

/**
 * ISO-3166-1 alpha-2, upper case. Postal routing only — this is the physical destination
 * country for a delivery. The buyer's identity/locale country lives on the `Country` axis
 * and is never derived from the postal address.
 */
export const CountryCode = Type.String({ pattern: '^[A-Z]{2}$' });
export type CountryCode = Static<typeof CountryCode>;

/**
 * Structured postal address. Field bounds are chosen so `formatPostalAddress` output can never
 * exceed 500 characters (120 + 120 + 80 + 80 + 16 + 2 fields plus five ", " separators = 428),
 * keeping the rendered value valid for the legacy `orders.shipping_address` column.
 */
export const PostalAddress = Type.Object(
  {
    line1: AddressLine,
    line2: Type.Optional(AddressLine),
    city: AddressLocality,
    region: Type.Optional(AddressLocality),
    postcode: Postcode,
    countryCode: CountryCode,
  },
  { additionalProperties: false },
);
export type PostalAddress = Static<typeof PostalAddress>;

/** Upper bound on `formatPostalAddress` output, matching the legacy free-text address column. */
export const FORMATTED_ADDRESS_MAX_LENGTH = 500;

/**
 * Deterministic single-line rendering of a postal address. The only address formatter in the
 * repository: persistence, mail, and idempotency fingerprints all read this one output so no
 * second implementation can drift from it.
 *
 * Pure. Parts are emitted in a fixed order, trimmed, and blank parts dropped.
 */
export function formatPostalAddress(address: PostalAddress): string {
  const parts = [
    address.line1,
    address.line2,
    address.city,
    address.region,
    address.postcode,
    address.countryCode,
  ];
  return parts
    .map((part) => (part ?? '').trim())
    .filter((part) => part.length > 0)
    .join(', ');
}
