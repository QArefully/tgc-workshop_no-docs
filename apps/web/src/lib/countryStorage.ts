import { Country, SUPPORTED_COUNTRIES, DEFAULT_GUEST_COUNTRY } from '@shop/contracts/country';

export const COUNTRY_STORAGE_KEY = 'shop.country.selected.v1';

export type CountryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function browserStorage(): CountryStorage {
  return window.localStorage;
}

function isSupportedCountry(value: string): value is Country {
  return (SUPPORTED_COUNTRIES as readonly string[]).includes(value);
}

export function readSelectedCountry(storage: CountryStorage | null | undefined): Country {
  if (!storage) return DEFAULT_GUEST_COUNTRY;

  let raw: string | null;
  try {
    raw = storage.getItem(COUNTRY_STORAGE_KEY);
  } catch {
    return DEFAULT_GUEST_COUNTRY;
  }

  if (raw === null) return DEFAULT_GUEST_COUNTRY;

  if (isSupportedCountry(raw)) return raw;

  try {
    storage.removeItem(COUNTRY_STORAGE_KEY);
  } catch {
    // Best-effort cleanup of a corrupt value; fallback still applies.
  }
  return DEFAULT_GUEST_COUNTRY;
}

export function writeSelectedCountry(
  storage: CountryStorage | null | undefined,
  country: Country,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(COUNTRY_STORAGE_KEY, country);
    return true;
  } catch {
    return false;
  }
}

export function clearSelectedCountry(storage: CountryStorage | null | undefined): boolean {
  if (!storage) return false;
  try {
    storage.removeItem(COUNTRY_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
