import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Cart } from '@shop/contracts/cart';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as cartApi from '@/api/cart';
import { ApiError } from '@/api/client';
import {
  clearCartId,
  getCartId,
  setCartId,
  setCartStorage,
  type CartStorage,
} from '@/lib/cartStorage';
import { COUNTRY_STORAGE_KEY } from '@/lib/countryStorage';
import { CartProvider, useCartContext } from './CartContext';
import { CountryProvider, useCountry } from './CountryContext';

vi.mock('@/api/cart', () => ({
  addToCart: vi.fn(),
  createCart: vi.fn(),
  getCart: vi.fn(),
  removeFromCart: vi.fn(),
  updateCartItem: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function cart(id: string): Cart {
  return {
    id,
    items: [],
    totalItems: 0,
    subtotalCents: 0,
    discountableSubtotalCents: 0,
    blendingFeeTotalCents: 0,
  };
}

function mapStorage(): CartStorage & { store: Map<string, string> } {
  const store = new Map<string, string>();
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

let countryStore: ReturnType<typeof mapStorage>;

function wrapper({ children }: { children: ReactNode }) {
  return (
    <CountryProvider storage={countryStore}>
      <CartProvider>{children}</CartProvider>
    </CountryProvider>
  );
}

function renderCountryCart() {
  return renderHook(() => ({ cart: useCartContext(), country: useCountry() }), { wrapper });
}

beforeEach(() => {
  vi.resetAllMocks();
  countryStore = mapStorage();
  countryStore.store.set(COUNTRY_STORAGE_KEY, 'US');
  setCartStorage(mapStorage());
  setCartId('cart-us', 'US');
  setCartId('cart-de', 'DE');
});

afterEach(() => {
  setCartStorage(undefined);
});

describe('useCart country switching', () => {
  it('stores error codes and resolves their copy in the active country', async () => {
    vi.mocked(cartApi.getCart).mockImplementation((id: string) => Promise.resolve(cart(id)));
    vi.mocked(cartApi.updateCartItem).mockRejectedValueOnce(
      new ApiError('legacy prose must not become cart state', 400, {
        error: 'legacy prose must not become cart state',
        code: 'BELOW_MOQ',
      } as never),
    );

    const { result } = renderCountryCart();
    await waitFor(() => expect(result.current.cart.cartId).toBe('cart-us'));

    act(() => result.current.country.selectCountry('DE'));
    await waitFor(() => expect(result.current.cart.cartId).toBe('cart-de'));

    await act(async () => {
      await result.current.cart.updateQuantity('cement', 1);
    });
    expect(result.current.cart.errorCode).toBe('BELOW_MOQ');
    expect(result.current.cart.errorState?.key).toBe('cart.errorBelowMoq');
    expect(result.current.cart.error).toContain('Mindestbestellmenge');
  });

  it('re-resolves the cart id from the newly selected country', async () => {
    vi.mocked(cartApi.getCart).mockImplementation((id: string) => Promise.resolve(cart(id)));

    const { result } = renderCountryCart();
    await waitFor(() => expect(result.current.cart.cartId).toBe('cart-us'));

    act(() => result.current.country.selectCountry('DE'));

    await waitFor(() => expect(result.current.cart.cartId).toBe('cart-de'));
    expect(cartApi.getCart).toHaveBeenNthCalledWith(1, 'cart-us');
    expect(cartApi.getCart).toHaveBeenNthCalledWith(2, 'cart-de');
    expect(cartApi.createCart).not.toHaveBeenCalled();
  });

  it('ignores a load that was in flight when the country changed', async () => {
    const staleLoad = deferred<Cart>();
    vi.mocked(cartApi.getCart)
      .mockReturnValueOnce(staleLoad.promise)
      .mockResolvedValueOnce(cart('cart-de'));

    const { result } = renderCountryCart();
    await waitFor(() => expect(cartApi.getCart).toHaveBeenCalledTimes(1));

    act(() => result.current.country.selectCountry('DE'));
    await waitFor(() => expect(result.current.cart.cartId).toBe('cart-de'));

    await act(async () => {
      staleLoad.resolve(cart('cart-us'));
      await staleLoad.promise;
    });

    expect(result.current.cart.cartId).toBe('cart-de');
    expect(result.current.cart.cart?.id).toBe('cart-de');
  });

  it('sends the next mutation to the new country cart, not the previous one', async () => {
    vi.mocked(cartApi.getCart).mockImplementation((id: string) => Promise.resolve(cart(id)));
    vi.mocked(cartApi.addToCart).mockResolvedValue(cart('cart-de'));

    const { result } = renderCountryCart();
    await waitFor(() => expect(result.current.cart.cartId).toBe('cart-us'));

    act(() => result.current.country.selectCountry('DE'));
    await waitFor(() => expect(result.current.cart.cartId).toBe('cart-de'));

    await act(async () => {
      await result.current.cart.addItem('cement');
    });

    expect(cartApi.addToCart).toHaveBeenCalledWith('cart-de', 'cement', undefined);
  });

  it('ignores a mutation that was in flight when the country changed', async () => {
    const staleAdd = deferred<Cart>();
    vi.mocked(cartApi.getCart).mockImplementation((id: string) => Promise.resolve(cart(id)));
    vi.mocked(cartApi.addToCart)
      .mockReturnValueOnce(staleAdd.promise)
      .mockImplementation((cartId: string) => Promise.resolve(cart(cartId)));

    const { result } = renderCountryCart();
    await waitFor(() => expect(result.current.cart.cartId).toBe('cart-us'));

    let stalePending!: Promise<boolean>;
    act(() => {
      stalePending = result.current.cart.addItem('cement');
    });
    await waitFor(() =>
      expect(cartApi.addToCart).toHaveBeenCalledWith('cart-us', 'cement', undefined),
    );

    act(() => result.current.country.selectCountry('DE'));
    await waitFor(() => expect(result.current.cart.cartId).toBe('cart-de'));

    await act(async () => {
      staleAdd.resolve(cart('cart-us'));
      await stalePending;
    });

    // The previous country's add must not re-target the cart: state stays on DE...
    expect(result.current.cart.cartId).toBe('cart-de');
    expect(result.current.cart.cart?.id).toBe('cart-de');

    // ...and the next add, made entirely on DE, must not be written to the US cart.
    await act(async () => {
      await result.current.cart.addItem('sand');
    });
    expect(cartApi.addToCart).toHaveBeenLastCalledWith('cart-de', 'sand', undefined);
  });

  it('does not recover a delayed missing-cart mutation or clear a same-key new-country action', async () => {
    const stale404 = deferred<Cart>();
    const currentAdd = deferred<Cart>();
    vi.mocked(cartApi.getCart).mockImplementation((id: string) => Promise.resolve(cart(id)));
    vi.mocked(cartApi.addToCart)
      .mockReturnValueOnce(stale404.promise)
      .mockReturnValueOnce(currentAdd.promise)
      .mockResolvedValue(cart('cart-de'));

    const { result } = renderCountryCart();
    await waitFor(() => expect(result.current.cart.cartId).toBe('cart-us'));

    let stalePending!: Promise<boolean>;
    act(() => {
      stalePending = result.current.cart.addItem('cement');
    });
    await waitFor(() =>
      expect(cartApi.addToCart).toHaveBeenCalledWith('cart-us', 'cement', undefined),
    );

    act(() => result.current.country.selectCountry('DE'));
    await waitFor(() => expect(result.current.cart.cartId).toBe('cart-de'));

    let currentPending!: Promise<boolean>;
    act(() => {
      currentPending = result.current.cart.addItem('cement');
    });
    await waitFor(() =>
      expect(cartApi.addToCart).toHaveBeenCalledWith('cart-de', 'cement', undefined),
    );
    expect(result.current.cart.isActionPending('cement', 'add')).toBe(true);

    await act(async () => {
      stale404.reject(new ApiError('Cart not found', 404));
      await stalePending;
    });

    expect(result.current.cart.cartId).toBe('cart-de');
    expect(result.current.cart.isActionPending('cement', 'add')).toBe(true);
    expect(cartApi.getCart).toHaveBeenCalledTimes(2);
    expect(cartApi.addToCart).toHaveBeenCalledTimes(2);
    expect(result.current.cart.error).toBeNull();

    await act(async () => {
      currentAdd.resolve(cart('cart-de'));
      await currentPending;
    });

    expect(result.current.cart.isActionPending('cement', 'add')).toBe(false);
    expect(getCartId('US')).toBe('cart-us');
    expect(getCartId('DE')).toBe('cart-de');
  });

  it('creates only one cart when the previous country load settles during a switch', async () => {
    clearCartId('DE');
    const staleLoad = deferred<Cart>();
    const pendingCreate = deferred<{ cartId: string }>();
    let creates = 0;

    vi.mocked(cartApi.getCart).mockImplementation((id: string) =>
      id === 'cart-us' ? staleLoad.promise : Promise.resolve(cart(id)),
    );
    vi.mocked(cartApi.createCart).mockImplementation(() => {
      creates += 1;
      return creates === 1
        ? pendingCreate.promise
        : Promise.resolve({ cartId: `cart-de-${creates}` });
    });
    vi.mocked(cartApi.addToCart).mockImplementation((cartId: string) =>
      Promise.resolve(cart(cartId)),
    );

    const { result } = renderCountryCart();
    await waitFor(() => expect(cartApi.getCart).toHaveBeenCalledWith('cart-us'));

    // DE has no stored cart, so the switch starts a create that is still in flight below.
    act(() => result.current.country.selectCountry('DE'));
    await waitFor(() => expect(cartApi.createCart).toHaveBeenCalledTimes(1));

    // The previous country's load settles while the DE create is still shared and in flight.
    await act(async () => {
      staleLoad.resolve(cart('cart-us'));
      await staleLoad.promise;
    });

    let addPending!: Promise<boolean>;
    act(() => {
      addPending = result.current.cart.addItem('cement');
    });
    // Let a duplicate create surface if the shared request was dropped.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      pendingCreate.resolve({ cartId: 'cart-de-1' });
      await addPending;
    });

    expect(cartApi.createCart).toHaveBeenCalledTimes(1);
    expect(cartApi.addToCart).toHaveBeenCalledWith('cart-de-1', 'cement', undefined);
    expect(result.current.cart.cartId).toBe('cart-de-1');
  });
});
