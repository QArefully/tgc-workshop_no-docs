import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_GUEST_COUNTRY,
  LEGACY_DATA_COUNTRY,
  SUPPORTED_COUNTRIES,
} from '@shop/contracts/country';
import { clearCartId, getCartId, setCartId, setCartStorage, type CartStorage } from './cartStorage';

const LEGACY_KEY = 'shop-qarefully-cart-id';

function fakeStorage(
  initial: Record<string, string> = {},
): CartStorage & { store: Map<string, string> } {
  const store = new Map(Object.entries(initial));
  return {
    store,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
  };
}

let storage: ReturnType<typeof fakeStorage>;

beforeEach(() => {
  storage = fakeStorage();
  setCartStorage(storage);
});

afterEach(() => {
  setCartStorage(undefined);
});

describe('cart storage', () => {
  it('defaults country to the guest default when not specified', () => {
    setCartId('cart-guest');
    expect(getCartId()).toBe('cart-guest');
    expect(getCartId(DEFAULT_GUEST_COUNTRY)).toBe('cart-guest');
    // The default is the guest country, never the legacy market.
    expect(getCartId(LEGACY_DATA_COUNTRY)).toBeNull();
  });

  it('isolates cart ids by country', () => {
    setCartId('cart-uk', 'UK');
    setCartId('cart-us', 'US');
    setCartId('cart-de', 'DE');

    expect(getCartId('UK')).toBe('cart-uk');
    expect(getCartId('US')).toBe('cart-us');
    expect(getCartId('DE')).toBe('cart-de');
  });

  it('clears per-country cart id', () => {
    setCartId('cart-uk', 'UK');
    clearCartId('UK');
    expect(getCartId('UK')).toBeNull();
  });

  it('does not leak clear across countries', () => {
    setCartId('cart-uk', 'UK');
    setCartId('cart-us', 'US');
    clearCartId('UK');
    expect(getCartId('UK')).toBeNull();
    expect(getCartId('US')).toBe('cart-us');
  });

  it('setCartId with one argument defaults to the guest default', () => {
    setCartId('guest-cart');
    expect(getCartId(DEFAULT_GUEST_COUNTRY)).toBe('guest-cart');
    expect(getCartId()).toBe('guest-cart');
  });

  it('clearCartId with no arguments defaults to the guest default', () => {
    setCartId('guest-cart');
    clearCartId();
    expect(getCartId(DEFAULT_GUEST_COUNTRY)).toBeNull();
  });

  it('migrates a legacy single-key cart id into the UK slot exactly once', () => {
    const migrated = fakeStorage({ [LEGACY_KEY]: 'legacy-id' });
    setCartStorage(migrated);

    expect(getCartId('UK')).toBe('legacy-id');
    expect(migrated.store.get(LEGACY_KEY)).toBeUndefined();

    // Migration is one-shot per backend: a legacy key written afterwards is left alone.
    migrated.store.set(LEGACY_KEY, 'different-id');
    expect(getCartId('UK')).toBe('legacy-id');
    expect(migrated.store.get(LEGACY_KEY)).toBe('different-id');
  });

  it('skips legacy migration when any per-country key already exists', () => {
    setCartId('existing-de', 'DE');
    // Re-inject the same backend so the migration guard runs again over a populated store.
    storage.store.set(LEGACY_KEY, 'legacy-id');
    setCartStorage(storage);

    expect(getCartId('UK')).toBeNull();
    expect(getCartId('DE')).toBe('existing-de');
    expect(storage.store.get(LEGACY_KEY)).toBe('legacy-id');
  });

  it('guards migration against every supported country, not a hardcoded list', () => {
    for (const country of SUPPORTED_COUNTRIES) {
      const store = fakeStorage({
        [`${LEGACY_KEY}.${country}`]: `cart-${country}`,
        [LEGACY_KEY]: 'legacy-id',
      });
      setCartStorage(store);

      expect(getCartId(country)).toBe(`cart-${country}`);
      expect(store.store.get(LEGACY_KEY)).toBe('legacy-id');
    }
  });

  it('returns null and stays silent when no storage backend is available', () => {
    setCartStorage(null);
    setCartId('cart-uk', 'UK');
    expect(getCartId('UK')).toBeNull();
    expect(() => clearCartId('UK')).not.toThrow();
  });
});
