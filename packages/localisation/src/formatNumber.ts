import type { Country } from '@shop/contracts/country';
import { countryProfile, type CountryProfile } from '@shop/contracts/country-profiles';

export type NumberCountry = Country | CountryProfile;
export type NumberPreset = 'decimal' | 'count' | 'weight';

const numberFormatters = new Map<string, Intl.NumberFormat>();

function resolveProfile(country: NumberCountry): CountryProfile {
  return typeof country === 'string' ? countryProfile(country) : country;
}

function formatter(profile: CountryProfile, preset: NumberPreset): Intl.NumberFormat {
  const key = `${profile.numberLocale}|${preset}`;
  let result = numberFormatters.get(key);
  if (result === undefined) {
    const options: Intl.NumberFormatOptions =
      preset === 'count'
        ? { maximumFractionDigits: 0, useGrouping: true }
        : { maximumFractionDigits: 3, useGrouping: true };
    result = new Intl.NumberFormat(profile.numberLocale, options);
    numberFormatters.set(key, result);
  }
  return result;
}

function assertNumber(value: number): void {
  if (!Number.isFinite(value)) throw new RangeError('Number value must be finite');
}

/** Format a locale-bound decimal/count/weight value with a fixed semantic preset. */
export function formatNumber(value: number, country: NumberCountry, preset?: NumberPreset): string;
export function formatNumber(country: NumberCountry, value: number, preset?: NumberPreset): string;
export function formatNumber(
  valueOrCountry: number | NumberCountry,
  countryOrValue: NumberCountry | number,
  preset: NumberPreset = 'decimal',
): string {
  const value = typeof valueOrCountry === 'number' ? valueOrCountry : (countryOrValue as number);
  const country =
    typeof valueOrCountry === 'number' ? (countryOrValue as NumberCountry) : valueOrCountry;
  assertNumber(value);
  if (!(preset in { decimal: true, count: true, weight: true })) {
    throw new RangeError(`Unknown number format preset: ${String(preset)}`);
  }
  return formatter(resolveProfile(country), preset).format(value);
}

export function formatDecimal(value: number, country: NumberCountry): string {
  return formatNumber(value, country, 'decimal');
}

export function formatCount(value: number, country: NumberCountry): string {
  return formatNumber(value, country, 'count');
}

/** Format a weight in the supplied unit (the value is not converted). */
export function formatWeight(value: number, country: NumberCountry, unit = 'g'): string {
  return `${formatNumber(value, country, 'weight')} ${unit}`;
}

/** Format integer grams using the shop's tonne/kg/gram display convention. */
export function formatWeightGrams(weightGrams: number, country: NumberCountry): string {
  if (!Number.isSafeInteger(weightGrams) || weightGrams < 0) {
    throw new RangeError('Weight grams must be a non-negative safe integer');
  }
  if (weightGrams >= 1_000_000) return formatWeight(weightGrams / 1_000_000, country, 'tonnes');
  if (weightGrams >= 1_000) return formatWeight(weightGrams / 1_000, country, 'kg');
  return formatWeight(weightGrams, country, 'g');
}
