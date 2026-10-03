import {
  DEFAULT_GUEST_COUNTRY,
  LEGACY_DATA_COUNTRY,
  SUPPORTED_COUNTRIES,
  type Country,
} from '@shop/contracts/country';

const KEY_PREFIX = 'shop-qarefully-cart-id';
const LEGACY_KEY = 'shop-qarefully-cart-id';

export type CartStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Browser backend; absent or blocked storage resolves to `null` rather than throwing. */
export function browserCartStorage(): CartStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

let injectedStorage: CartStorage | null | undefined;
let legacyMigrationDone = false;

/**
 * Overrides the storage backend for this module. Cart accessors keep their `(id, country)`
 * shape because every caller carries a country, not a storage handle, so injection happens
 * here instead of per call. Passing `undefined` restores browser storage. Either way the
 * one-shot legacy-migration guard is reset, so a test never needs `vi.resetModules()`.
 */
export function setCartStorage(storage: CartStorage | null | undefined): void {
  injectedStorage = storage;
  legacyMigrationDone = false;
}

function resolveStorage(): CartStorage | null {
  return injectedStorage === undefined ? browserCartStorage() : injectedStorage;
}

function cartKey(country: string): string {
  return `${KEY_PREFIX}.${country}`;
}

/**
 * Moves a pre-country cart id into the legacy market's slot, once per storage backend, and
 * only while no per-country slot exists. The guard iterates `SUPPORTED_COUNTRIES` so adding
 * a country cannot let an already-migrated store be migrated a second time.
 */
function maybeMigrateLegacyCart(storage: CartStorage): void {
  if (legacyMigrationDone) return;
  legacyMigrationDone = true;

  try {
    for (const country of SUPPORTED_COUNTRIES) {
      if (storage.getItem(cartKey(country)) !== null) return;
    }
    const legacyId = storage.getItem(LEGACY_KEY);
    if (legacyId !== null) {
      storage.setItem(cartKey(LEGACY_DATA_COUNTRY), legacyId);
      storage.removeItem(LEGACY_KEY);
    }
  } catch {
    // Best-effort migration; any failure leaves the legacy key untouched.
  }
}

/**
 * Reads the cart id for a country. An omitted country resolves to `DEFAULT_GUEST_COUNTRY` —
 * the same default a tree without `CountryProvider` transacts under — so a country-less call
 * can never address a different market's cart than the hook that made it.
 */
export function getCartId(country?: Country): string | null {
  const storage = resolveStorage();
  if (!storage) return null;
  const resolvedCountry = country ?? DEFAULT_GUEST_COUNTRY;
  try {
    maybeMigrateLegacyCart(storage);
    return storage.getItem(cartKey(resolvedCountry));
  } catch {
    return null;
  }
}

export function setCartId(id: string, country?: Country): void {
  const storage = resolveStorage();
  if (!storage) return;
  const resolvedCountry = country ?? DEFAULT_GUEST_COUNTRY;
  try {
    maybeMigrateLegacyCart(storage);
    storage.setItem(cartKey(resolvedCountry), id);
  } catch {
    // Best-effort; quota or privacy failures must not throw.
  }
}

export function clearCartId(country?: Country): void {
  const storage = resolveStorage();
  if (!storage) return;
  const resolvedCountry = country ?? DEFAULT_GUEST_COUNTRY;
  try {
    maybeMigrateLegacyCart(storage);
    storage.removeItem(cartKey(resolvedCountry));
  } catch {
    // Best-effort.
  }
}
