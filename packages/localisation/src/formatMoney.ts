import type { Country } from '@shop/contracts/country';
import { countryProfile, type CountryProfile } from '@shop/contracts/country-profiles';

export type MoneyCountry = Country | CountryProfile;

const currencyFormatters = new Map<string, Intl.NumberFormat>();

function assertInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${name} must be a safe integer`);
}

function resolveProfile(country: MoneyCountry): CountryProfile {
  return typeof country === 'string' ? countryProfile(country) : country;
}

function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new RangeError('Rounding denominator must be positive');
  const sign = numerator < 0n ? -1n : 1n;
  const absolute = numerator < 0n ? -numerator : numerator;
  const quotient = absolute / denominator;
  const remainder = absolute % denominator;
  const rounded = remainder * 2n >= denominator ? quotient + 1n : quotient;
  return sign * rounded;
}

/** Convert authoritative GBP pence to display-currency minor units once. */
export function convertPenceToDisplayMinor(pence: number, country: MoneyCountry): number;
export function convertPenceToDisplayMinor(country: MoneyCountry, pence: number): number;
export function convertPenceToDisplayMinor(
  penceOrCountry: number | MoneyCountry,
  countryOrPence: MoneyCountry | number,
): number {
  const pence = typeof penceOrCountry === 'number' ? penceOrCountry : (countryOrPence as number);
  const country =
    typeof penceOrCountry === 'number' ? (countryOrPence as MoneyCountry) : penceOrCountry;
  assertInteger(pence, 'Pence');
  const profile = resolveProfile(country);
  const { numerator, denominator } = profile.exchangeRate;
  assertInteger(numerator, 'Exchange-rate numerator');
  assertInteger(denominator, 'Exchange-rate denominator');
  if (numerator <= 0 || denominator <= 0) throw new RangeError('Exchange rate must be positive');
  const converted = roundHalfUp(BigInt(pence) * BigInt(numerator), BigInt(denominator));
  const result = Number(converted);
  if (!Number.isSafeInteger(result))
    throw new RangeError('Converted amount exceeds safe integer range');
  return result;
}

function moneyFormatter(locale: string, currency: string): Intl.NumberFormat {
  const key = `${locale}|${currency}`;
  let formatter = currencyFormatters.get(key);
  if (formatter === undefined) {
    formatter = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    currencyFormatters.set(key, formatter);
  }
  return formatter;
}

function formatMinor(minor: number, locale: string, currency: string): string {
  assertInteger(minor, 'Money minor amount');
  // Keep the minor-unit split in bigint space. Converting a safe integer to
  // `number / 100` first can round away the final penny near MAX_SAFE_INTEGER.
  // `Intl.NumberFormat` accepts bigint integer values, so only the exact two
  // digit fraction is stitched into the locale-shaped parts below.
  const magnitude = BigInt(minor < 0 ? -minor : minor);
  const major = magnitude / 100n;
  const fraction = String(magnitude % 100n).padStart(2, '0');
  const formatter = moneyFormatter(locale, currency);
  const signedMajor = minor < 0 ? -major : major;

  // BigInt has no negative zero. For a negative sub-unit amount, format -1
  // as a sign-pattern template and replace its integer part with zero.
  const parts =
    minor < 0 && major === 0n
      ? formatter
          .formatToParts(-1n)
          .map((part) => (part.type === 'integer' ? { ...part, value: '0' } : part))
      : formatter.formatToParts(signedMajor);

  return parts.map((part) => (part.type === 'fraction' ? fraction : part.value)).join('');
}

/** Format pence after deterministic country conversion for buyer display. */
export function formatDisplayMoney(pence: number, country: MoneyCountry): string;
export function formatDisplayMoney(country: MoneyCountry, pence: number): string;
export function formatDisplayMoney(
  penceOrCountry: number | MoneyCountry,
  countryOrPence: MoneyCountry | number,
): string {
  const pence = typeof penceOrCountry === 'number' ? penceOrCountry : (countryOrPence as number);
  const country =
    typeof penceOrCountry === 'number' ? (countryOrPence as MoneyCountry) : penceOrCountry;
  const profile = resolveProfile(country);
  return formatMinor(
    convertPenceToDisplayMinor(pence, profile),
    profile.numberLocale,
    profile.displayCurrency,
  );
}

/** Format authoritative GBP pence for settlement/admin/receipt presentation. */
export function formatSettlementMoney(pence: number): string {
  assertInteger(pence, 'Pence');
  return formatMinor(pence, 'en-GB', 'GBP');
}

export interface DualTotal {
  /** Country-local display total. */
  readonly display: string;
  /** Authoritative GBP settlement total; omitted when it duplicates the UK display. */
  readonly settlement?: string;
}

/** Return local display plus authoritative GBP, suppressing a duplicate UK total. */
export function formatDualTotal(pence: number, country: MoneyCountry): DualTotal;
export function formatDualTotal(country: MoneyCountry, pence: number): DualTotal;
export function formatDualTotal(
  penceOrCountry: number | MoneyCountry,
  countryOrPence: MoneyCountry | number,
): DualTotal {
  const pence = typeof penceOrCountry === 'number' ? penceOrCountry : (countryOrPence as number);
  const country =
    typeof penceOrCountry === 'number' ? (countryOrPence as MoneyCountry) : penceOrCountry;
  const profile = resolveProfile(country);
  const display = formatDisplayMoney(pence, profile);
  if (profile.displayCurrency === 'GBP' && convertPenceToDisplayMinor(pence, profile) === pence) {
    return { display };
  }
  return { display, settlement: formatSettlementMoney(pence) };
}
