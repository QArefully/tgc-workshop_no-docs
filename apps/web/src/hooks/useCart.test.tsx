import { act, renderHook, waitFor } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import type { Cart } from '@shop/contracts/cart';
import type { ReorderResponse } from '@shop/contracts/reorder';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/client';
import * as cartApi from '@/api/cart';
import * as bundlesApi from '@/api/bundles';
import * as customBlendsApi from '@/api/customBlends';
import * as quickOrderApi from '@/api/quickOrder';
import * as reorderApi from '@/api/reorder';
import * as savedListsApi from '@/api/savedLists';
import type { QuickOrderResponse } from '@shop/contracts/quick-order';
import type { SavedListAddToCartResponse } from '@shop/contracts/saved-lists';
import { DEFAULT_GUEST_COUNTRY } from '@shop/contracts/country';
import { getCartId, setCartId, setCartStorage } from '@/lib/cartStorage';
import { CartProvider, useCartContext } from './CartContext';

/** No CountryProvider is mounted here, so the hook transacts as the guest default. */
const GUEST_COUNTRY = DEFAULT_GUEST_COUNTRY;

vi.mock('@/api/cart', () => ({
  addToCart: vi.fn(),
  createCart: vi.fn(),
  getCart: vi.fn(),
  removeFromCart: vi.fn(),
  updateCartItem: vi.fn(),
}));
vi.mock('@/api/bundles', () => ({
  addBundleToCart: vi.fn(),
}));
vi.mock('@/api/customBlends', () => ({
  createCustomBlend: vi.fn(),
  replaceCustomBlend: vi.fn(),
}));
vi.mock('@/api/quickOrder', () => ({
  submitQuickOrder: vi.fn(),
}));
vi.mock('@/api/reorder', () => ({
  reorderFromOrder: vi.fn(),
}));
vi.mock('@/api/savedLists', () => ({
  addSavedListToCart: vi.fn(),
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

function cart(id: string, productIds: string[] = []): Cart {
  return {
    id,
    items: productIds.map((productId) => ({
      productId,
      configKey: '' as const,
      quantity: 1,
      product: {
        id: productId,
        name: productId,
        description: '',
        priceCents: 100,
        imageSetId: productId,
        category: 'Pantry',
        stock: 10,
        slug: productId,
        salesCount: 0,
        createdAt: '2026-07-14T00:00:00.000Z',
        available: true,
        availability: 'in_stock',
        backorderable: false,
        backorderLeadDays: null,
        tags: [],
        specificationGroups: [],
      },
      perTonneCents: 4000,
      resolvedUnitPriceCents: 100,
      materialSubtotalCents: 100,
      blendingFeeCents: 0,
      discountableTotalCents: 100,
      lineTotalCents: 100,
    })),
    totalItems: productIds.length,
    subtotalCents: productIds.length * 100,
    discountableSubtotalCents: productIds.length * 100,
    blendingFeeTotalCents: 0,
  };
}

function savedListResponse(nextCart: Cart): SavedListAddToCartResponse {
  return {
    cart: nextCart,
    addedLineCount: 1,
    skippedLineCount: 0,
    outcomes: [
      {
        itemId: '1',
        variantId: 101,
        sku: 'MAT-101',
        productId: 'cement',
        productName: 'Cement',
        savedQuantity: 1,
        submittedQuantity: 1,
        moqAdjusted: false,
        resolvedUnitPriceCents: 100,
        status: 'added',
        reason: null,
      },
    ],
  };
}

function cartWithProductVariants(id: string): Cart {
  const baseLine = cart(id, ['1']).items[0]!;
  const variants = [
    { variantId: 101, label: '25kg sack', weightGrams: 25000, quantity: 4, lineTotalCents: 400 },
    {
      variantId: 102,
      label: '1 tonne pallet',
      weightGrams: 1000000,
      quantity: 1,
      lineTotalCents: 1000,
    },
  ];
  return {
    id,
    items: variants.map((variant) => ({
      ...baseLine,
      variantSnap: {
        variantId: variant.variantId,
        sku: `MAT-${variant.variantId}`,
        label: variant.label,
        weightGrams: variant.weightGrams,
        deliveryClass: 'freight' as const,
      },
      quantity: variant.quantity,
      resolvedUnitPriceCents: variant.lineTotalCents / variant.quantity,
      materialSubtotalCents: variant.lineTotalCents,
      blendingFeeCents: 0,
      discountableTotalCents: variant.lineTotalCents,
      lineTotalCents: variant.lineTotalCents,
    })),
    subtotalCents: 1400,
    discountableSubtotalCents: 1400,
    blendingFeeTotalCents: 0,
    totalItems: 5,
  };
}

function reorderResponse(reorderedCart: Cart): ReorderResponse {
  return {
    cart: reorderedCart,
    addedLineCount: reorderedCart.items.length,
    skippedLineCount: 1,
    outcomes: [
      {
        orderLineItemId: '11',
        productId: 'lime',
        productName: 'Hydrated lime',
        variantId: null,
        sku: null,
        configKey: '',
        quantity: 2,
        status: 'skipped',
        reason: 'VARIANT_RETIRED',
        orderedUnitPriceCents: 900,
        currentUnitPriceCents: null,
        priceChanged: false,
      },
    ],
  };
}

function quickOrderResponse(quickOrderedCart: Cart): QuickOrderResponse {
  return {
    cart: quickOrderedCart,
    addedLineCount: quickOrderedCart.items.length,
    skippedLineCount: 0,
    outcomes: [],
  };
}

function providerWrapper({ children }: { children: ReactNode }) {
  return <CartProvider>{children}</CartProvider>;
}

beforeEach(() => {
  const store = new Map<string, string>();
  setCartStorage({
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
  });
  vi.resetAllMocks();
});

afterEach(() => {
  setCartStorage(undefined);
});

describe('useCart', () => {
  it('initializes a remounted provider independently of an in-flight prior provider', async () => {
    setCartId('saved-cart', GUEST_COUNTRY);
    const first = deferred<Cart>();
    vi.mocked(cartApi.getCart)
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(cart('fresh-cart'));

    const firstProvider = renderHook(() => useCartContext(), { wrapper: providerWrapper });
    await waitFor(() => expect(cartApi.getCart).toHaveBeenCalledTimes(1));
    firstProvider.unmount();

    const secondProvider = renderHook(() => useCartContext(), { wrapper: providerWrapper });
    await waitFor(() => expect(cartApi.getCart).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(secondProvider.result.current.cartId).toBe('fresh-cart'));

    await act(async () => {
      first.resolve(cart('stale-cart'));
      await first.promise;
    });
  });

  it('deduplicates Strict Mode initialization within one provider instance', async () => {
    setCartId('strict-cart', GUEST_COUNTRY);
    const response = deferred<Cart>();
    vi.mocked(cartApi.getCart).mockReturnValue(response.promise);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StrictMode>
        <CartProvider>{children}</CartProvider>
      </StrictMode>
    );

    const { result } = renderHook(() => useCartContext(), { wrapper });
    await waitFor(() => expect(cartApi.getCart).toHaveBeenCalledTimes(1));
    await act(async () => {
      response.resolve(cart('strict-cart'));
      await response.promise;
    });
    expect(result.current.isCartAvailable).toBe(true);
  });

  it('replaces a missing stored cart during initialization', async () => {
    setCartId('missing-cart', GUEST_COUNTRY);
    vi.mocked(cartApi.getCart)
      .mockRejectedValueOnce(new ApiError('Cart not found', 404))
      .mockResolvedValueOnce(cart('replacement-cart'));
    vi.mocked(cartApi.createCart).mockResolvedValueOnce({ cartId: 'replacement-cart' });

    const { result } = renderHook(() => useCartContext(), { wrapper: providerWrapper });
    await waitFor(() => expect(result.current.cartId).toBe('replacement-cart'));
    expect(getCartId(GUEST_COUNTRY)).toBe('replacement-cart');
    expect(result.current.error).toBeNull();
  });

  it('recovers a missing cart before retrying an add action', async () => {
    setCartId('old-cart', GUEST_COUNTRY);
    vi.mocked(cartApi.getCart)
      .mockResolvedValueOnce(cart('old-cart'))
      .mockResolvedValueOnce(cart('new-cart'));
    vi.mocked(cartApi.createCart).mockResolvedValueOnce({ cartId: 'new-cart' });
    vi.mocked(cartApi.addToCart)
      .mockRejectedValueOnce(new ApiError('Cart not found', 404))
      .mockResolvedValueOnce(cart('new-cart', ['powder']));

    const { result } = renderHook(() => useCartContext(), { wrapper: providerWrapper });
    await waitFor(() => expect(result.current.isCartAvailable).toBe(true));
    await act(async () => expect(await result.current.addItem('powder')).toBe(true));

    expect(cartApi.addToCart).toHaveBeenNthCalledWith(1, 'old-cart', 'powder', undefined);
    expect(cartApi.addToCart).toHaveBeenNthCalledWith(2, 'new-cart', 'powder', undefined);
    expect(result.current.cartId).toBe('new-cart');
    expect(result.current.error).toBeNull();
  });

  it('passes an explicit pallet quantity through the add action', async () => {
    setCartId('cart', GUEST_COUNTRY);
    vi.mocked(cartApi.getCart).mockResolvedValueOnce(cart('cart'));
    vi.mocked(cartApi.addToCart).mockResolvedValueOnce(cart('cart', ['powder']));

    const { result } = renderHook(() => useCartContext(), { wrapper: providerWrapper });
    await waitFor(() => expect(result.current.isCartAvailable).toBe(true));

    await act(async () => expect(await result.current.addItem('powder', 42, 8)).toBe(true));

    expect(cartApi.addToCart).toHaveBeenCalledWith('cart', 'powder', 42, 8);
  });

  it('surfaces an MOQ response as a pallet-quantity error', async () => {
    setCartId('cart', GUEST_COUNTRY);
    vi.mocked(cartApi.getCart).mockResolvedValueOnce(cart('cart', ['powder']));
    vi.mocked(cartApi.updateCartItem).mockRejectedValueOnce(
      new ApiError('Quantity does not meet this variant minimum order quantity.', 400, {
        error: 'Quantity does not meet this variant minimum order quantity.',
        code: 'BELOW_MOQ',
      } as never),
    );

    const { result } = renderHook(() => useCartContext(), { wrapper: providerWrapper });
    await waitFor(() => expect(result.current.isCartAvailable).toBe(true));

    await act(async () => expect(await result.current.updateQuantity('powder', 1)).toBe(false));

    expect(result.current.errorCode).toBe('BELOW_MOQ');
    expect(result.current.errorState?.key).toBe('cart.errorBelowMoq');
  });

  it('updates same-product sack and pallet lines by their variant identity', async () => {
    setCartId('cart', GUEST_COUNTRY);
    const first = deferred<Cart>();
    const second = deferred<Cart>();
    vi.mocked(cartApi.getCart).mockResolvedValueOnce(cartWithProductVariants('cart'));
    vi.mocked(cartApi.updateCartItem)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useCartContext(), { wrapper: providerWrapper });
    await waitFor(() => expect(result.current.isCartAvailable).toBe(true));

    let sackUpdate!: Promise<boolean>;
    let palletUpdate!: Promise<boolean>;
    act(() => {
      sackUpdate = result.current.updateQuantity('1', 5, 101);
      palletUpdate = result.current.updateQuantity('1', 2, 102);
    });

    expect(cartApi.updateCartItem).toHaveBeenNthCalledWith(1, 'cart', '1', 5, 101);
    expect(cartApi.updateCartItem).toHaveBeenNthCalledWith(2, 'cart', '1', 2, 102);
    expect(result.current.isActionPending('1', 'update', 101)).toBe(true);
    expect(result.current.isActionPending('1', 'update', 102)).toBe(true);

    await act(async () => {
      first.resolve(cartWithProductVariants('cart'));
      second.resolve(cartWithProductVariants('cart'));
      await Promise.all([first.promise, second.promise]);
    });
    expect(await sackUpdate).toBe(true);
    expect(await palletUpdate).toBe(true);
  });

  it('removes same-product sack and pallet lines by their variant identity', async () => {
    setCartId('cart', GUEST_COUNTRY);
    const first = deferred<Cart>();
    const second = deferred<Cart>();
    vi.mocked(cartApi.getCart).mockResolvedValueOnce(cartWithProductVariants('cart'));
    vi.mocked(cartApi.removeFromCart)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useCartContext(), { wrapper: providerWrapper });
    await waitFor(() => expect(result.current.isCartAvailable).toBe(true));

    let sackRemoval!: Promise<boolean>;
    let palletRemoval!: Promise<boolean>;
    act(() => {
      sackRemoval = result.current.removeItem('1', 101);
      palletRemoval = result.current.removeItem('1', 102);
    });

    expect(cartApi.removeFromCart).toHaveBeenNthCalledWith(1, 'cart', '1', 101);
    expect(cartApi.removeFromCart).toHaveBeenNthCalledWith(2, 'cart', '1', 102);
    expect(result.current.isActionPending('1', 'remove', 101)).toBe(true);
    expect(result.current.isActionPending('1', 'remove', 102)).toBe(true);

    await act(async () => {
      first.resolve(cart('cart'));
      second.resolve(cart('cart'));
      await Promise.all([first.promise, second.promise]);
    });
    expect(await sackRemoval).toBe(true);
    expect(await palletRemoval).toBe(true);
  });

  it('uses a blend-specific pending key when adding a custom blend', async () => {
    setCartId('cart', GUEST_COUNTRY);
    const response = deferred<Cart>();
    vi.mocked(cartApi.getCart).mockResolvedValueOnce(cart('cart'));
    vi.mocked(customBlendsApi.createCustomBlend).mockReturnValueOnce(response.promise);
    const { result } = renderHook(() => useCartContext(), { wrapper: providerWrapper });
    await waitFor(() => expect(result.current.isCartAvailable).toBe(true));

    const body = { baseVariantId: 501, ingredients: [{ variantId: 601, percentage: 30 }] };
    let action!: Promise<Cart | false>;
    act(() => {
      action = result.current.addCustomBlend(body);
    });
    expect(result.current.isActionPending('blend:501', 'blend-add')).toBe(true);
    expect(customBlendsApi.createCustomBlend).toHaveBeenCalledWith('cart', body);

    await act(async () => {
      response.resolve(cart('cart', ['9']));
      await response.promise;
    });
    expect(await action).toEqual(cart('cart', ['9']));
    expect(result.current.isActionPending('blend:501')).toBe(false);
  });

  it('replaces a configured line under a config-key-scoped pending key', async () => {
    setCartId('cart', GUEST_COUNTRY);
    const configKey = 'a'.repeat(64);
    const response = deferred<Cart>();
    vi.mocked(cartApi.getCart).mockResolvedValueOnce(cart('cart'));
    vi.mocked(customBlendsApi.replaceCustomBlend).mockReturnValueOnce(response.promise);
    const { result } = renderHook(() => useCartContext(), { wrapper: providerWrapper });
    await waitFor(() => expect(result.current.isCartAvailable).toBe(true));

    const body = {
      baseVariantId: 501,
      configKey,
      ingredients: [{ variantId: 601, percentage: 30 }],
    };
    let action!: Promise<Cart | false>;
    act(() => {
      action = result.current.replaceCustomBlend(body);
    });
    expect(result.current.isActionPending(`blend:501:${configKey}`, 'blend-replace')).toBe(true);
    expect(customBlendsApi.replaceCustomBlend).toHaveBeenCalledWith('cart', body);

    await act(async () => {
      response.resolve(cart('cart', ['9']));
      await response.promise;
    });
    expect(await action).toEqual(cart('cart', ['9']));
  });

  it('does not retry a blend replace against a recovered replacement cart', async () => {
    setCartId('old-cart', GUEST_COUNTRY);
    vi.mocked(cartApi.getCart)
      .mockResolvedValueOnce(cart('old-cart'))
      .mockResolvedValueOnce(cart('new-cart'));
    vi.mocked(cartApi.createCart).mockResolvedValueOnce({ cartId: 'new-cart' });
    vi.mocked(customBlendsApi.replaceCustomBlend).mockRejectedValueOnce(
      new ApiError('Cart not found', 404),
    );
    const { result } = renderHook(() => useCartContext(), { wrapper: providerWrapper });
    await waitFor(() => expect(result.current.isCartAvailable).toBe(true));

    await act(async () =>
      expect(
        await result.current.replaceCustomBlend({
          baseVariantId: 501,
          configKey: 'a'.repeat(64),
          ingredients: [{ variantId: 601, percentage: 30 }],
        }),
      ).toBe(false),
    );

    expect(customBlendsApi.replaceCustomBlend).toHaveBeenCalledTimes(1);
    expect(result.current.errorCode).toBeNull();
    expect(result.current.errorState?.key).toBe('cart.errorCartNotFound');
  });

  it('tracks a quick order while pending and replaces the cart from its authoritative response', async () => {
    setCartId('cart', GUEST_COUNTRY);
    const response = deferred<QuickOrderResponse>();
    vi.mocked(cartApi.getCart).mockResolvedValueOnce(cart('cart', ['existing']));
    vi.mocked(quickOrderApi.submitQuickOrder).mockReturnValueOnce(response.promise);
    const { result } = renderHook(() => useCartContext(), { wrapper: providerWrapper });
    await waitFor(() => expect(result.current.isCartAvailable).toBe(true));

    let action!: Promise<QuickOrderResponse | false>;
    act(() => {
      action = result.current.quickOrder('CEM-0001-001, 4');
    });

    expect(result.current.isActionPending('quick-order', 'quick-order')).toBe(true);
    expect(quickOrderApi.submitQuickOrder).toHaveBeenCalledWith('cart', 'CEM-0001-001, 4');
    expect(cartApi.getCart).toHaveBeenCalledTimes(1);

    const expected = quickOrderResponse(cart('cart', ['existing', 'cement']));
    await act(async () => {
      response.resolve(expected);
      await response.promise;
    });

    expect(await action).toEqual(expected);
    expect(result.current.cart?.items.map((item) => item.productId)).toEqual([
      'existing',
      'cement',
    ]);
    expect(result.current.isActionPending('quick-order')).toBe(false);
    expect(result.current.error).toBeNull();
    expect(cartApi.getCart).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['NO_INPUT_LINES', 'Enter at least one line before submitting your quick order.'],
    [
      'TOO_MANY_LINES',
      'Your quick order has too many lines. Split it into smaller submissions and try again.',
    ],
  ])('maps the quick-order %s rejection to buyer-facing copy', async (code, message) => {
    setCartId('cart', GUEST_COUNTRY);
    vi.mocked(cartApi.getCart).mockResolvedValueOnce(cart('cart', ['existing']));
    vi.mocked(quickOrderApi.submitQuickOrder).mockRejectedValueOnce(
      new ApiError(message, 400, { error: message, code } as never),
    );
    const { result } = renderHook(() => useCartContext(), { wrapper: providerWrapper });
    await waitFor(() => expect(result.current.isCartAvailable).toBe(true));

    await act(async () => expect(await result.current.quickOrder('CEM-0001-001, 4')).toBe(false));

    expect(result.current.errorCode).toBe(code);
    expect(result.current.errorState?.key).toBe(
      code === 'NO_INPUT_LINES' ? 'cart.errorNoInputLines' : 'cart.errorTooManyLines',
    );
    expect(result.current.cart?.items.map((item) => item.productId)).toEqual(['existing']);
    expect(result.current.isActionPending('quick-order')).toBe(false);
  });

  it('recovers a missing cart and replays a quick order exactly once', async () => {
    setCartId('old-cart', GUEST_COUNTRY);
    vi.mocked(cartApi.getCart)
      .mockResolvedValueOnce(cart('old-cart'))
      .mockResolvedValueOnce(cart('new-cart'));
    vi.mocked(cartApi.createCart).mockResolvedValueOnce({ cartId: 'new-cart' });
    const replayed = quickOrderResponse(cart('new-cart', ['cement']));
    vi.mocked(quickOrderApi.submitQuickOrder)
      .mockRejectedValueOnce(new ApiError('Cart not found', 404))
      .mockResolvedValueOnce(replayed);
    const { result } = renderHook(() => useCartContext(), { wrapper: providerWrapper });
    await waitFor(() => expect(result.current.isCartAvailable).toBe(true));

    await act(async () =>
      expect(await result.current.quickOrder('CEM-0001-001, 4')).toEqual(replayed),
    );

    expect(quickOrderApi.submitQuickOrder).toHaveBeenCalledTimes(2);
    expect(quickOrderApi.submitQuickOrder).toHaveBeenNthCalledWith(
      1,
      'old-cart',
      'CEM-0001-001, 4',
    );
    expect(quickOrderApi.submitQuickOrder).toHaveBeenNthCalledWith(
      2,
      'new-cart',
      'CEM-0001-001, 4',
    );
    expect(result.current.cartId).toBe('new-cart');
    expect(result.current.error).toBeNull();
  });

  it('separates a configured line from its plain counterpart by config key', async () => {
    setCartId('cart', GUEST_COUNTRY);
    const configKey = 'b'.repeat(64);
    const plain = deferred<Cart>();
    const configured = deferred<Cart>();
    vi.mocked(cartApi.getCart).mockResolvedValueOnce(cartWithProductVariants('cart'));
    vi.mocked(cartApi.updateCartItem)
      .mockReturnValueOnce(plain.promise)
      .mockReturnValueOnce(configured.promise);
    const { result } = renderHook(() => useCartContext(), { wrapper: providerWrapper });
    await waitFor(() => expect(result.current.isCartAvailable).toBe(true));

    act(() => {
      void result.current.updateQuantity('1', 5, 101);
      void result.current.updateQuantity('1', 9, 101, configKey);
    });

    expect(cartApi.updateCartItem).toHaveBeenNthCalledWith(1, 'cart', '1', 5, 101);
    expect(cartApi.updateCartItem).toHaveBeenNthCalledWith(2, 'cart', '1', 9, 101, configKey);
    expect(result.current.isActionPending('1', 'update', 101)).toBe(true);
    expect(result.current.isActionPending('1', 'update', 101, configKey)).toBe(true);

    await act(async () => {
      plain.resolve(cartWithProductVariants('cart'));
      configured.resolve(cartWithProductVariants('cart'));
      await Promise.all([plain.promise, configured.promise]);
    });
    expect(result.current.pendingActions).toEqual({});
  });

  it('uses a bundle-specific pending key and adds the bundle to the active cart', async () => {
    setCartId('cart', GUEST_COUNTRY);
    const response = deferred<Cart>();
    vi.mocked(cartApi.getCart).mockResolvedValueOnce(cart('cart'));
    vi.mocked(bundlesApi.addBundleToCart).mockReturnValueOnce(response.promise);
    const { result } = renderHook(() => useCartContext(), { wrapper: providerWrapper });
    await waitFor(() => expect(result.current.isCartAvailable).toBe(true));

    let action!: Promise<boolean>;
    act(() => {
      action = result.current.addBundle('starter');
    });
    expect(result.current.isActionPending('bundle:starter', 'bundle-add')).toBe(true);
    expect(bundlesApi.addBundleToCart).toHaveBeenCalledWith('cart', 'starter');

    await act(async () => {
      response.resolve(cart('cart', ['one', 'two']));
      await response.promise;
    });
    expect(await action).toBe(true);
    expect(result.current.isActionPending('bundle:starter')).toBe(false);
  });

  it('recovers a missing cart before retrying a bundle add', async () => {
    setCartId('old-cart', GUEST_COUNTRY);
    vi.mocked(cartApi.getCart)
      .mockResolvedValueOnce(cart('old-cart'))
      .mockResolvedValueOnce(cart('new-cart'));
    vi.mocked(cartApi.createCart).mockResolvedValueOnce({ cartId: 'new-cart' });
    vi.mocked(bundlesApi.addBundleToCart)
      .mockRejectedValueOnce(new ApiError('Cart not found', 404))
      .mockResolvedValueOnce(cart('new-cart', ['one', 'two']));
    const { result } = renderHook(() => useCartContext(), { wrapper: providerWrapper });
    await waitFor(() => expect(result.current.isCartAvailable).toBe(true));

    await act(async () => expect(await result.current.addBundle('starter')).toBe(true));

    expect(bundlesApi.addBundleToCart).toHaveBeenNthCalledWith(1, 'old-cart', 'starter');
    expect(bundlesApi.addBundleToCart).toHaveBeenNthCalledWith(2, 'new-cart', 'starter');
  });

  it('keeps the prior cart and exposes an error when a bundle add fails', async () => {
    setCartId('cart', GUEST_COUNTRY);
    vi.mocked(cartApi.getCart).mockResolvedValueOnce(cart('cart', ['existing']));
    vi.mocked(bundlesApi.addBundleToCart).mockRejectedValueOnce(new Error('Bundle unavailable'));
    const { result } = renderHook(() => useCartContext(), { wrapper: providerWrapper });
    await waitFor(() => expect(result.current.isCartAvailable).toBe(true));

    await act(async () => expect(await result.current.addBundle('starter')).toBe(false));

    expect(result.current.cart?.items.map((item) => item.productId)).toEqual(['existing']);
    expect(result.current.errorCode).toBeNull();
    expect(result.current.errorState?.key).toBe('cart.errorAction');
  });

  it('does not let an older bundle response overwrite a newer cart response', async () => {
    setCartId('cart', GUEST_COUNTRY);
    const olderResponse = deferred<Cart>();
    const newerResponse = deferred<Cart>();
    vi.mocked(cartApi.getCart).mockResolvedValueOnce(cart('cart'));
    vi.mocked(bundlesApi.addBundleToCart)
      .mockReturnValueOnce(olderResponse.promise)
      .mockReturnValueOnce(newerResponse.promise);
    const { result } = renderHook(() => useCartContext(), { wrapper: providerWrapper });
    await waitFor(() => expect(result.current.isCartAvailable).toBe(true));

    let olderAction!: Promise<boolean>;
    let newerAction!: Promise<boolean>;
    act(() => {
      olderAction = result.current.addBundle('starter');
      newerAction = result.current.addBundle('pantry');
    });

    await act(async () => {
      newerResponse.resolve(cart('cart', ['one', 'two']));
      await newerResponse.promise;
    });
    await act(async () => {
      olderResponse.resolve(cart('cart', ['one']));
      await olderResponse.promise;
    });

    expect(await olderAction).toBe(true);
    expect(await newerAction).toBe(true);
    expect(result.current.cart?.items.map((item) => item.productId)).toEqual(['one', 'two']);
  });

  it('applies the reordered cart and returns the outcome report to the caller', async () => {
    setCartId('cart', GUEST_COUNTRY);
    const response = deferred<ReorderResponse>();
    vi.mocked(cartApi.getCart).mockResolvedValueOnce(cart('cart'));
    vi.mocked(reorderApi.reorderFromOrder).mockReturnValueOnce(response.promise);
    const { result } = renderHook(() => useCartContext(), { wrapper: providerWrapper });
    await waitFor(() => expect(result.current.isCartAvailable).toBe(true));

    let action!: Promise<ReorderResponse | false>;
    act(() => {
      action = result.current.reorder('42');
    });
    expect(result.current.isActionPending('reorder:42', 'reorder')).toBe(true);
    expect(reorderApi.reorderFromOrder).toHaveBeenCalledWith('cart', '42');

    const expected = reorderResponse(cart('cart', ['cement']));
    await act(async () => {
      response.resolve(expected);
      await response.promise;
    });

    expect(await action).toEqual(expected);
    expect(result.current.cart?.items.map((item) => item.productId)).toEqual(['cement']);
    expect(result.current.isActionPending('reorder:42')).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('does not let an older reorder response overwrite a newer cart response', async () => {
    setCartId('cart', GUEST_COUNTRY);
    const olderResponse = deferred<ReorderResponse>();
    const newerResponse = deferred<ReorderResponse>();
    vi.mocked(cartApi.getCart).mockResolvedValueOnce(cart('cart'));
    vi.mocked(reorderApi.reorderFromOrder)
      .mockReturnValueOnce(olderResponse.promise)
      .mockReturnValueOnce(newerResponse.promise);
    const { result } = renderHook(() => useCartContext(), { wrapper: providerWrapper });
    await waitFor(() => expect(result.current.isCartAvailable).toBe(true));

    act(() => {
      void result.current.reorder('41');
      void result.current.reorder('42');
    });

    await act(async () => {
      newerResponse.resolve(reorderResponse(cart('cart', ['one', 'two'])));
      await newerResponse.promise;
    });
    await act(async () => {
      olderResponse.resolve(reorderResponse(cart('cart', ['one'])));
      await olderResponse.promise;
    });

    expect(result.current.cart?.items.map((item) => item.productId)).toEqual(['one', 'two']);
  });

  it('surfaces a reserved cart as a checkout-scoped reorder error', async () => {
    setCartId('cart', GUEST_COUNTRY);
    vi.mocked(cartApi.getCart).mockResolvedValueOnce(cart('cart', ['existing']));
    vi.mocked(reorderApi.reorderFromOrder).mockRejectedValueOnce(
      new ApiError('Cart is reserved for checkout.', 409, {
        error: 'Cart is reserved for checkout.',
        code: 'CART_RESERVED',
      } as never),
    );
    const { result } = renderHook(() => useCartContext(), { wrapper: providerWrapper });
    await waitFor(() => expect(result.current.isCartAvailable).toBe(true));

    await act(async () => expect(await result.current.reorder('42')).toBe(false));

    expect(result.current.errorCode).toBe('CART_RESERVED');
    expect(result.current.errorState?.key).toBe('cart.errorCartReserved');
    expect(result.current.cart?.items.map((item) => item.productId)).toEqual(['existing']);
  });

  it('reports a missing source order distinctly from a reserved cart', async () => {
    setCartId('cart', GUEST_COUNTRY);
    vi.mocked(cartApi.getCart).mockResolvedValueOnce(cart('cart'));
    vi.mocked(reorderApi.reorderFromOrder).mockRejectedValueOnce(
      new ApiError('Order not found', 404, {
        error: 'Order not found',
        code: 'ORDER_NOT_FOUND',
      } as never),
    );
    const { result } = renderHook(() => useCartContext(), { wrapper: providerWrapper });
    await waitFor(() => expect(result.current.isCartAvailable).toBe(true));

    await act(async () => expect(await result.current.reorder('42')).toBe(false));

    expect(result.current.errorCode).toBe('ORDER_NOT_FOUND');
    expect(result.current.errorState?.key).toBe('cart.errorOrderNotFound');
  });

  it('replays a reorder exactly once against a recovered replacement cart', async () => {
    setCartId('old-cart', GUEST_COUNTRY);
    vi.mocked(cartApi.getCart)
      .mockResolvedValueOnce(cart('old-cart'))
      .mockResolvedValueOnce(cart('new-cart'));
    vi.mocked(cartApi.createCart).mockResolvedValueOnce({ cartId: 'new-cart' });
    const replayed = reorderResponse(cart('new-cart', ['cement']));
    vi.mocked(reorderApi.reorderFromOrder)
      .mockRejectedValueOnce(new ApiError('Cart not found', 404))
      .mockResolvedValueOnce(replayed);
    const { result } = renderHook(() => useCartContext(), { wrapper: providerWrapper });
    await waitFor(() => expect(result.current.isCartAvailable).toBe(true));

    await act(async () => expect(await result.current.reorder('42')).toEqual(replayed));

    expect(reorderApi.reorderFromOrder).toHaveBeenCalledTimes(2);
    expect(reorderApi.reorderFromOrder).toHaveBeenNthCalledWith(1, 'old-cart', '42');
    expect(reorderApi.reorderFromOrder).toHaveBeenNthCalledWith(2, 'new-cart', '42');
    expect(result.current.cartId).toBe('new-cart');
    expect(result.current.error).toBeNull();
  });

  it('tracks concurrent actions by product', async () => {
    setCartId('cart', GUEST_COUNTRY);
    const first = deferred<Cart>();
    const second = deferred<Cart>();
    vi.mocked(cartApi.getCart).mockResolvedValueOnce(cart('cart'));
    vi.mocked(cartApi.addToCart)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useCartContext(), { wrapper: providerWrapper });
    await waitFor(() => expect(result.current.isCartAvailable).toBe(true));

    let firstAction!: Promise<boolean>;
    let secondAction!: Promise<boolean>;
    act(() => {
      firstAction = result.current.addItem('one');
      secondAction = result.current.addItem('two');
    });
    expect(result.current.isActionPending('one', 'add')).toBe(true);
    expect(result.current.isActionPending('two', 'add')).toBe(true);

    await act(async () => {
      second.resolve(cart('cart', ['two']));
      await second.promise;
    });
    expect(await secondAction).toBe(true);
    expect(result.current.isActionPending('one')).toBe(true);
    expect(result.current.isActionPending('two')).toBe(false);

    await act(async () => {
      first.resolve(cart('cart', ['one', 'two']));
      await first.promise;
    });
    expect(await firstAction).toBe(true);
    expect(result.current.pendingActions).toEqual({});
  });

  it('does not let an older mutation response overwrite a newer cart response', async () => {
    setCartId('cart', GUEST_COUNTRY);
    const olderResponse = deferred<Cart>();
    const newerResponse = deferred<Cart>();
    vi.mocked(cartApi.getCart).mockResolvedValueOnce(cart('cart'));
    vi.mocked(cartApi.addToCart)
      .mockReturnValueOnce(olderResponse.promise)
      .mockReturnValueOnce(newerResponse.promise);
    const { result } = renderHook(() => useCartContext(), { wrapper: providerWrapper });
    await waitFor(() => expect(result.current.isCartAvailable).toBe(true));

    let olderAction!: Promise<boolean>;
    let newerAction!: Promise<boolean>;
    act(() => {
      olderAction = result.current.addItem('one');
      newerAction = result.current.addItem('two');
    });

    await act(async () => {
      newerResponse.resolve(cart('cart', ['one', 'two']));
      await newerResponse.promise;
    });
    await act(async () => {
      olderResponse.resolve(cart('cart', ['one']));
      await olderResponse.promise;
    });

    expect(await olderAction).toBe(true);
    expect(await newerAction).toBe(true);
    expect(result.current.cart?.items.map((item) => item.productId)).toEqual(['one', 'two']);
  });

  it('shares missing-cart recovery across concurrent provider actions', async () => {
    setCartId('old-cart', GUEST_COUNTRY);
    const replacement = deferred<{ cartId: string }>();
    vi.mocked(cartApi.getCart)
      .mockResolvedValueOnce(cart('old-cart'))
      .mockResolvedValueOnce(cart('new-cart'));
    vi.mocked(cartApi.createCart).mockReturnValueOnce(replacement.promise);
    vi.mocked(cartApi.addToCart)
      .mockRejectedValueOnce(new ApiError('Cart not found', 404))
      .mockRejectedValueOnce(new ApiError('Cart not found', 404))
      .mockResolvedValueOnce(cart('new-cart', ['one']))
      .mockResolvedValueOnce(cart('new-cart', ['one', 'two']));
    const { result } = renderHook(() => useCartContext(), { wrapper: providerWrapper });
    await waitFor(() => expect(result.current.isCartAvailable).toBe(true));

    let firstAction!: Promise<boolean>;
    let secondAction!: Promise<boolean>;
    act(() => {
      firstAction = result.current.addItem('one');
      secondAction = result.current.addItem('two');
    });
    await waitFor(() => expect(cartApi.createCart).toHaveBeenCalledOnce());

    await act(async () => {
      replacement.resolve({ cartId: 'new-cart' });
      await Promise.all([replacement.promise, firstAction, secondAction]);
    });

    expect(cartApi.createCart).toHaveBeenCalledOnce();
    expect(cartApi.addToCart).toHaveBeenNthCalledWith(3, 'new-cart', 'one', undefined);
    expect(cartApi.addToCart).toHaveBeenNthCalledWith(4, 'new-cart', 'two', undefined);
    expect(result.current.cartId).toBe('new-cart');
  });

  it('adds a saved list, returns its report, and tracks its pending action', async () => {
    setCartId('cart', GUEST_COUNTRY);
    const response = deferred<SavedListAddToCartResponse>();
    vi.mocked(cartApi.getCart).mockResolvedValueOnce(cart('cart'));
    vi.mocked(savedListsApi.addSavedListToCart).mockReturnValueOnce(response.promise);
    const { result } = renderHook(() => useCartContext(), { wrapper: providerWrapper });
    await waitFor(() => expect(result.current.isCartAvailable).toBe(true));
    let action!: Promise<SavedListAddToCartResponse | false>;
    act(() => {
      action = result.current.addSavedListToCart('12');
    });
    expect(result.current.isActionPending('saved-list:12', 'saved-list-add')).toBe(true);
    expect(savedListsApi.addSavedListToCart).toHaveBeenCalledWith('12', { cartId: 'cart' });
    const expected = savedListResponse(cart('cart', ['cement']));
    await act(async () => {
      response.resolve(expected);
      await response.promise;
    });
    await expect(action).resolves.toEqual(expected);
    expect(result.current.cart?.items.map((item) => item.productId)).toEqual(['cement']);
    expect(result.current.isActionPending('saved-list:12')).toBe(false);
  });

  it('replays a saved-list add once after missing-cart recovery', async () => {
    setCartId('old-cart', GUEST_COUNTRY);
    vi.mocked(cartApi.getCart)
      .mockResolvedValueOnce(cart('old-cart'))
      .mockResolvedValueOnce(cart('new-cart'));
    vi.mocked(cartApi.createCart).mockResolvedValueOnce({ cartId: 'new-cart' });
    const expected = savedListResponse(cart('new-cart', ['cement']));
    vi.mocked(savedListsApi.addSavedListToCart)
      .mockRejectedValueOnce(new ApiError('Cart not found', 404))
      .mockResolvedValueOnce(expected);
    const { result } = renderHook(() => useCartContext(), { wrapper: providerWrapper });
    await waitFor(() => expect(result.current.isCartAvailable).toBe(true));
    await act(async () => {
      await expect(result.current.addSavedListToCart('12')).resolves.toEqual(expected);
    });
    expect(savedListsApi.addSavedListToCart).toHaveBeenNthCalledWith(1, '12', {
      cartId: 'old-cart',
    });
    expect(savedListsApi.addSavedListToCart).toHaveBeenNthCalledWith(2, '12', {
      cartId: 'new-cart',
    });
    expect(result.current.cartId).toBe('new-cart');
  });
});
