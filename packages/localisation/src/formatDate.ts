import type { Country } from '@shop/contracts/country';
import { countryProfile, type CountryProfile } from '@shop/contracts/country-profiles';

export type DateCountry = Country | CountryProfile;
export type DatePreset = 'short' | 'medium' | 'long' | 'date' | 'time';
export interface DateFormatOptions {
  readonly preset?: DatePreset;
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

const PRESET_OPTIONS: Readonly<Record<DatePreset, Intl.DateTimeFormatOptions>> = {
  short: { dateStyle: 'short', timeStyle: 'short' },
  medium: { dateStyle: 'medium', timeStyle: 'short' },
  long: { dateStyle: 'long', timeStyle: 'short' },
  date: { dateStyle: 'short' },
  time: { timeStyle: 'short' },
};

const CIVIL_PRESET_OPTIONS: Readonly<
  Record<Exclude<DatePreset, 'time'>, Intl.DateTimeFormatOptions>
> = {
  short: { dateStyle: 'short' },
  medium: { dateStyle: 'medium' },
  long: { dateStyle: 'long' },
  date: { dateStyle: 'short' },
};

function resolveProfile(country: DateCountry): CountryProfile {
  return typeof country === 'string' ? countryProfile(country) : country;
}

function resolvePreset(preset: DatePreset | DateFormatOptions | undefined): DatePreset {
  if (preset === undefined) return 'short';
  const value = typeof preset === 'string' ? preset : preset.preset;
  if (value === undefined) return 'short';
  if (!(value in PRESET_OPTIONS))
    throw new RangeError(`Unknown date format preset: ${String(value)}`);
  return value;
}

function formatter(
  profile: CountryProfile,
  preset: DatePreset,
  timeZone: string,
  civil = false,
): Intl.DateTimeFormat {
  if (civil && preset === 'time') throw new RangeError('Civil dates cannot use the time preset');
  const options = civil
    ? CIVIL_PRESET_OPTIONS[preset as Exclude<DatePreset, 'time'>]
    : PRESET_OPTIONS[preset];
  const key = `${profile.dateLocale}|${timeZone}|${civil ? 'civil' : 'instant'}|${preset}`;
  let result = dateFormatters.get(key);
  if (result === undefined) {
    result = new Intl.DateTimeFormat(profile.dateLocale, { ...options, timeZone });
    dateFormatters.set(key, result);
  }
  return result;
}

function toDate(value: Date | string | number): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new RangeError('Invalid date value');
  return date;
}

function parseCivilDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RangeError('Civil date must use YYYY-MM-DD');
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month! - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new RangeError('Civil date is not valid');
  }
  return date;
}

/** Format an absolute instant in the profile locale and time zone. */
export function formatInstant(
  value: Date | string | number,
  country: DateCountry,
  preset?: DatePreset | DateFormatOptions,
): string;
export function formatInstant(
  country: DateCountry,
  value: Date | string | number,
  preset?: DatePreset | DateFormatOptions,
): string;
export function formatInstant(
  valueOrCountry: Date | string | number | CountryProfile,
  countryOrValue: CountryProfile | Date | string | number,
  preset?: DatePreset | DateFormatOptions,
): string {
  const value = isCountryRef(valueOrCountry)
    ? (countryOrValue as Date | string | number)
    : valueOrCountry;
  const country = isCountryRef(valueOrCountry) ? valueOrCountry : (countryOrValue as DateCountry);
  const profile = resolveProfile(country);
  return formatter(profile, resolvePreset(preset), profile.timeZone).format(toDate(value));
}

/** Format a civil YYYY-MM-DD date without allowing a time-zone day shift. */
export function formatCivilDate(
  value: string,
  country: DateCountry,
  preset?: DatePreset | DateFormatOptions,
): string;
export function formatCivilDate(
  country: DateCountry,
  value: string,
  preset?: DatePreset | DateFormatOptions,
): string;
export function formatCivilDate(
  valueOrCountry: string | CountryProfile,
  countryOrValue: CountryProfile | string,
  preset?: DatePreset | DateFormatOptions,
): string {
  const value = isCountryRef(valueOrCountry) ? (countryOrValue as string) : valueOrCountry;
  const country = isCountryRef(valueOrCountry) ? valueOrCountry : (countryOrValue as DateCountry);
  const profile = resolveProfile(country);
  const selected = resolvePreset(preset);
  return formatter(profile, selected, 'UTC', true).format(parseCivilDate(value));
}

/** Alias for callers that use the semantic "date" name. */
export const formatDate = formatCivilDate;

function isCountry(value: string): value is Country {
  return (
    value === 'UK' ||
    value === 'US' ||
    value === 'CN' ||
    value === 'PL' ||
    value === 'ES' ||
    value === 'DE' ||
    value === 'FR'
  );
}

function isCountryRef(value: unknown): value is DateCountry {
  return (
    (typeof value === 'string' && isCountry(value)) ||
    (typeof value === 'object' && value !== null && 'dateLocale' in value && 'timeZone' in value)
  );
}
