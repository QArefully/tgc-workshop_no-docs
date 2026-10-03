import { describe, expect, it } from 'vitest';
import {
  COUNTRY_STORAGE_KEY,
  clearSelectedCountry,
  readSelectedCountry,
  writeSelectedCountry,
  type CountryStorage,
} from './countryStorage';

function memoryStorage(): CountryStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
}

describe('country storage', () => {
  it('returns the default when storage is null or undefined', () => {
    expect(readSelectedCountry(null)).toBe('US');
    expect(readSelectedCountry(undefined)).toBe('US');
  });

  it('returns the default when no country has been stored', () => {
    const storage = memoryStorage();
    expect(readSelectedCountry(storage)).toBe('US');
  });

  it('round-trips a valid country through write and read', () => {
    const storage = memoryStorage();
    expect(writeSelectedCountry(storage, 'DE')).toBe(true);
    expect(storage.values.get(COUNTRY_STORAGE_KEY)).toBe('DE');
    expect(readSelectedCountry(storage)).toBe('DE');
  });

  it('discards a corrupt or unknown value and falls back to the default', () => {
    const storage = memoryStorage();
    storage.setItem(COUNTRY_STORAGE_KEY, 'GB');
    expect(readSelectedCountry(storage)).toBe('US');
    expect(storage.values.has(COUNTRY_STORAGE_KEY)).toBe(false);

    storage.setItem(COUNTRY_STORAGE_KEY, 'eu');
    expect(readSelectedCountry(storage)).toBe('US');
    expect(storage.values.has(COUNTRY_STORAGE_KEY)).toBe(false);

    storage.setItem(COUNTRY_STORAGE_KEY, '');
    expect(readSelectedCountry(storage)).toBe('US');
    expect(storage.values.has(COUNTRY_STORAGE_KEY)).toBe(false);
  });

  it('clears the stored country', () => {
    const storage = memoryStorage();
    writeSelectedCountry(storage, 'FR');
    expect(clearSelectedCountry(storage)).toBe(true);
    expect(storage.values.has(COUNTRY_STORAGE_KEY)).toBe(false);
    expect(readSelectedCountry(storage)).toBe('US');
  });

  it('contains storage exceptions on every operation', () => {
    const storage: CountryStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readSelectedCountry(storage)).toBe('US');
    expect(writeSelectedCountry(storage, 'DE')).toBe(false);
    expect(clearSelectedCountry(storage)).toBe(false);
  });

  it('returns false for write and clear when storage is null', () => {
    expect(writeSelectedCountry(null, 'DE')).toBe(false);
    expect(clearSelectedCountry(null)).toBe(false);
  });

  it('accepts every supported country through write and read', () => {
    const storage = memoryStorage();
    for (const country of ['UK', 'US', 'CN', 'PL', 'ES', 'DE', 'FR'] as const) {
      writeSelectedCountry(storage, country);
      expect(readSelectedCountry(storage)).toBe(country);
    }
  });
});
