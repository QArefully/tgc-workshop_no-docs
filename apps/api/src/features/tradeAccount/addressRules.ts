import type { PostalAddress } from '@shop/contracts/address';
import type { CountryProfile } from '@shop/contracts/country-profiles';

/**
 * The structured address columns. `delivery_sites` and `billing_entities` declare an identical
 * column set (migration `023`), so one row <-> `PostalAddress` mapper serves both tables and no
 * second address-normalisation implementation can drift from this one.
 */
export interface AddressColumns {
  address_line1: string;
  address_line2: string | null;
  address_city: string;
  address_region: string | null;
  address_postcode: string;
  address_country_code: string;
}

/** Trims and collapses internal whitespace runs so stored text compares deterministically. */
export function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/**
 * Optional plain-text field. An absent value, or one that normalises to empty, is stored as SQL
 * NULL rather than an empty string, matching the `IS NULL OR length(...) BETWEEN ...` column CHECKs.
 */
export function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = normalizeText(value);
  return normalized.length > 0 ? normalized : null;
}

/**
 * Canonical form of a postal address: every part trimmed, postcode and country code upper-cased.
 *
 * Casing is normalised because the formatted address is snapshotted onto orders and hashed into the
 * checkout idempotency fingerprint; `sw1a 1aa` and `SW1A 1AA` must not produce two fingerprints for
 * one destination.
 */
export function normalizePostalAddress(address: PostalAddress): PostalAddress {
  const line2 = normalizeOptionalText(address.line2);
  const region = normalizeOptionalText(address.region);
  return {
    line1: normalizeText(address.line1),
    ...(line2 === null ? {} : { line2 }),
    city: normalizeText(address.city),
    ...(region === null ? {} : { region }),
    postcode: normalizeText(address.postcode).toUpperCase(),
    countryCode: normalizeText(address.countryCode).toUpperCase(),
  };
}

/** Checks a normalized postcode against the identity country's checked-in postal rule. */
export function validatePostcodeForCountry(profile: CountryProfile, postcode: string): boolean {
  return new RegExp(profile.postcode.pattern).test(postcode);
}

/**
 * Whether an ISO postal destination is served by this identity country. The profile allowlist is
 * deliberately the only bridge between the two country axes.
 */
export function isDeliverableCountryCode(
  profile: CountryProfile,
  countryCode: PostalAddress['countryCode'],
): boolean {
  return profile.deliveryCountryCodes.includes(countryCode);
}

/** Normalises then flattens a contract address into its persistence columns. */
export function toAddressColumns(address: PostalAddress): AddressColumns {
  const normalized = normalizePostalAddress(address);
  return {
    address_line1: normalized.line1,
    address_line2: normalized.line2 ?? null,
    address_city: normalized.city,
    address_region: normalized.region ?? null,
    address_postcode: normalized.postcode,
    address_country_code: normalized.countryCode,
  };
}

/** Rebuilds the contract address from its persistence columns. Optional parts stay absent when NULL. */
export function toPostalAddress(row: AddressColumns): PostalAddress {
  return {
    line1: row.address_line1,
    ...(row.address_line2 === null ? {} : { line2: row.address_line2 }),
    city: row.address_city,
    ...(row.address_region === null ? {} : { region: row.address_region }),
    postcode: row.address_postcode,
    countryCode: row.address_country_code,
  };
}

const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * Row timestamp -> the 24-character UTC instant the trade-account contracts require.
 *
 * Services always write `Clock`-derived ISO strings, but the column defaults are SQLite's
 * `datetime('now')` (`YYYY-MM-DD HH:MM:SS`), so a row inserted by a seed or by hand must still map
 * to a contract-valid value instead of failing response validation.
 */
export function toIsoInstant(value: string): string {
  if (ISO_INSTANT_PATTERN.test(value)) return value;
  const parsed = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isNaN(parsed.getTime()) ? new Date(0).toISOString() : parsed.toISOString();
}
