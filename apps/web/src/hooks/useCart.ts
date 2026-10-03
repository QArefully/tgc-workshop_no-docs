import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import type { Country } from '@shop/contracts/country';
import type { Cart } from '@shop/contracts/cart';
import type { PublicErrorCode } from '@shop/contracts/public-errors';
import { translateUnchecked, type MessageParams } from '@shop/localisation';
import { cartMessages, type CartMessageKey } from '@shop/localisation/messages/cart';
import * as api from '../api/cart';
import * as bundlesApi from '../api/bundles';
import * as customBlendsApi from '../api/customBlends';
import * as quickOrderApi from '../api/quickOrder';
import * as reorderApi from '../api/reorder';
import * as savedListsApi from '../api/savedLists';
import { ApiError, type ApiErrorMeta } from '../api/client';
import { clearCartId, getCartId } from '../lib/cartStorage';
import { createCartClient } from './cartClient';
import { useOptionalCountry } from './CountryContext';
import type { CreateCustomBlendBody, ReplaceCustomBlendBody } from '@shop/contracts/custom-blends';
import type { ReorderResponse } from '@shop/contracts/reorder';
import type { QuickOrderResponse } from '@shop/contracts/quick-order';
import type { SavedListAddToCartResponse } from '@shop/contracts/saved-lists';

export type CartAction =
  | 'add'
  | 'bundle-add'
  | 'update'
  | 'remove'
  | 'blend-add'
  | 'blend-replace'
  | 'quick-order'
  | 'reorder'
  | 'saved-list-add';

const QUICK_ORDER_PENDING_KEY = 'quick-order';

export type CartClearTarget = {
  readonly country: Country;
  readonly cartId: string;
  readonly generation?: string | number;
};

type CartStatus = 'initializing' | 'ready' | 'refreshing' | 'error';

/** Stable cart failure identity. Copy resolves during render for the active country. */
export type CartErrorState = {
  readonly code: PublicErrorCode | null;
  readonly meta: ApiErrorMeta | null;
  readonly key: CartMessageKey;
  readonly params?: MessageParams;
};

type CartState = {
  cart: Cart | null;
  cartId: string | null;
  error: CartErrorState | null;
  pendingActions: Readonly<Record<string, CartAction>>;
  status: CartStatus;
};

type CartEvent =
  | { type: 'start'; status: 'initializing' | 'refreshing' }
  | { type: 'cart-loaded'; cart: Cart }
  | { type: 'failed'; error: CartErrorState }
  | { type: 'action-started'; pendingKey: string; action: CartAction }
  | { type: 'action-finished'; pendingKey: string }
  | { type: 'country-changed'; cartId: string | null }
  | { type: 'cleared' };

function cartReducer(state: CartState, event: CartEvent): CartState {
  switch (event.type) {
    case 'start':
      return { ...state, error: null, status: event.status };
    case 'cart-loaded':
      return { ...state, cart: event.cart, cartId: event.cart.id, error: null, status: 'ready' };
    case 'failed':
      return { ...state, error: event.error, status: 'error' };
    case 'action-started':
      return {
        ...state,
        error: null,
        pendingActions: { ...state.pendingActions, [event.pendingKey]: event.action },
      };
    case 'action-finished': {
      const pendingActions = { ...state.pendingActions };
      delete pendingActions[event.pendingKey];
      return { ...state, pendingActions };
    }
    case 'country-changed':
      // The previous country's cart must never stay rendered or targeted; only its stored id
      // for the new country survives, and it is re-validated by the initialization that follows.
      return {
        cart: null,
        cartId: event.cartId,
        error: null,
        pendingActions: {},
        status: 'initializing',
      };
    case 'cleared':
      return { cart: null, cartId: null, error: null, pendingActions: {}, status: 'initializing' };
  }
}

const ERROR_MESSAGE_KEY_BY_CODE: Partial<Record<PublicErrorCode, CartMessageKey>> = {
  BELOW_MOQ: 'cart.errorBelowMoq',
  BLOCKED_IN_COUNTRY: 'cart.errorBlockedCountry',
  NO_INPUT_LINES: 'cart.errorNoInputLines',
  ORDER_NOT_FOUND: 'cart.errorOrderNotFound',
  TOO_MANY_LINES: 'cart.errorTooManyLines',
  CART_RESERVED: 'cart.errorCartReserved',
  CART_NOT_FOUND: 'cart.errorCartNotFound',
};

/** Internal signal for workflow failures that have no API response but have known copy. */
class CartMessageError extends Error {
  readonly messageKey: CartMessageKey;

  constructor(messageKey: CartMessageKey) {
    super(messageKey);
    this.name = 'CartMessageError';
    this.messageKey = messageKey;
  }
}

function cartErrorState(error: unknown, fallbackKey: CartMessageKey): CartErrorState {
  if (error instanceof CartMessageError) {
    return { code: null, meta: null, key: error.messageKey };
  }
  if (error instanceof ApiError && error.isNetworkError) {
    return { code: null, meta: null, key: 'cart.errorNetwork' };
  }
  if (error instanceof ApiError && error.code !== null) {
    return {
      code: error.code,
      meta: error.meta,
      key: ERROR_MESSAGE_KEY_BY_CODE[error.code] ?? fallbackKey,
    };
  }
  // API prose is deliberately not stored or rendered. A legacy response without a code gets the
  // same safe, country-aware fallback as an unknown exception.
  return { code: null, meta: null, key: fallbackKey };
}

/** Missing-cart recovery keeps legacy message compatibility while rejecting unrelated 404s. */
function isMissingCartFailure(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 404 &&
    (error.code === 'CART_NOT_FOUND' || (error.code === null && error.message === 'Cart not found'))
  );
}

/**
 * Configured lines share a product and variant with their plain counterpart, so pending
 * identity carries the config key. Plain lines keep their historic key shape.
 */
function cartLinePendingKey(productId: string, variantId?: number, configKey?: string): string {
  if (variantId === undefined) return productId;
  const lineKey = `line:${productId}:${variantId}`;
  return configKey ? `${lineKey}:${configKey}` : lineKey;
}

/** Reorder is scoped to a source order, not to a cart line, so it keys on the order. */
function reorderPendingKey(orderId: string): string {
  return `reorder:${orderId}`;
}

function savedListPendingKey(listId: string): string {
  return `saved-list:${listId}`;
}

/**
 * One in-flight cart request shared by every caller that would otherwise duplicate it. The
 * owning country is part of the entry so a request started before a country switch is never
 * reused after it, and the entry identity lets the settling request clear only its own slot.
 */
type SharedCartRequest = { country: Country; promise: Promise<Cart> };

function customBlendPendingKey(baseVariantId: number, configKey?: string): string {
  const blendKey = `blend:${baseVariantId}`;
  return configKey ? `${blendKey}:${configKey}` : blendKey;
}

export function useCart() {
  const { activeCountry } = useOptionalCountry();
  const countryRef = useRef<Country>(activeCountry);
  countryRef.current = activeCountry;

  const [state, dispatch] = useReducer(cartReducer, {
    cart: null,
    cartId: getCartId(activeCountry),
    error: null,
    pendingActions: {},
    status: 'initializing',
  });

  // Errors retain only a stable code/key. Resolve copy against active country on every render so
  // a country switch never leaves stale wording in cart state.
  const localizedError = useMemo(
    () =>
      state.error === null
        ? null
        : translateUnchecked(cartMessages, activeCountry, state.error.key, state.error.params),
    [activeCountry, state.error],
  );

  const cartClient = useMemo(() => createCartClient(activeCountry), [activeCountry]);
  const cartClientRef = useRef(cartClient);
  cartClientRef.current = cartClient;

  const initializationRef = useRef<SharedCartRequest | null>(null);
  const recoveryRef = useRef<SharedCartRequest | null>(null);
  const mutationSequenceRef = useRef(0);
  const committedMutationSequenceRef = useRef(0);
  const mountedRef = useRef(false);
  const cartIdRef = useRef<string | null>(getCartId(activeCountry));
  const cartGenerationRef = useRef(0);
  const renderedCountryRef = useRef<Country>(activeCountry);

  if (renderedCountryRef.current !== activeCountry) {
    // Re-seed synchronously: a mutation dispatched between this render and the initialization
    // effect must already target the new country's stored cart, never the previous one.
    renderedCountryRef.current = activeCountry;
    cartIdRef.current = getCartId(activeCountry);
    cartGenerationRef.current += 1;
    // The previous country's shared in-flight requests are not cleared here: they own a
    // `finally` that would then clear the new country's slot and defeat the dedupe. They carry
    // their owning country instead, so `loadCart`/`recoverCart` below ignore them.
    dispatch({ type: 'country-changed', cartId: cartIdRef.current });
  }

  const applyCart = useCallback((cart: Cart) => {
    cartIdRef.current = cart.id;
    cartGenerationRef.current += 1;
    if (mountedRef.current) dispatch({ type: 'cart-loaded', cart });
  }, []);

  /**
   * Shares one in-flight request per slot, scoped to the country that started it. A settling
   * request clears the slot only while it still owns it, so a request belonging to the previous
   * country can never evict the current country's in-flight one and let a duplicate be created.
   */
  const shareCartRequest = useCallback(
    (slot: { current: SharedCartRequest | null }, start: () => Promise<Cart>): Promise<Cart> => {
      const country = countryRef.current;
      const shared = slot.current;
      if (shared && shared.country === country) return shared.promise;

      // `entry` is only read inside the callback, which cannot run before this binding is
      // initialized, so the self-reference is safe.
      const entry: SharedCartRequest = {
        country,
        promise: start().finally(() => {
          if (slot.current === entry) slot.current = null;
        }),
      };
      slot.current = entry;
      return entry.promise;
    },
    [],
  );

  const loadCart = useCallback(
    (): Promise<Cart> =>
      shareCartRequest(initializationRef, () => cartClientRef.current.loadOrCreate()),
    [shareCartRequest],
  );

  const recoverCart = useCallback(
    (missingCartId: string): Promise<Cart> =>
      shareCartRequest(recoveryRef, () => cartClientRef.current.recoverMissingCart(missingCartId)),
    [shareCartRequest],
  );

  const applyMutationCart = useCallback(
    (cart: Cart, mutationSequence: number) => {
      if (mutationSequence < committedMutationSequenceRef.current) return;
      committedMutationSequenceRef.current = mutationSequence;
      applyCart(cart);
    },
    [applyCart],
  );

  const initializeCart = useCallback(
    async (
      status: 'initializing' | 'refreshing',
      fallbackKey: CartMessageKey,
    ): Promise<boolean> => {
      const requestCountry = countryRef.current;
      if (mountedRef.current) dispatch({ type: 'start', status });
      try {
        const cart = await loadCart();
        // Stale completion: the buyer switched country while this load was in flight, so the
        // resolved cart belongs to the previous country and must not land in state.
        if (countryRef.current !== requestCountry) return false;
        applyCart(cart);
        return true;
      } catch (error) {
        if (countryRef.current !== requestCountry) return false;
        if (mountedRef.current)
          dispatch({ type: 'failed', error: cartErrorState(error, fallbackKey) });
        return false;
      }
    },
    [applyCart, loadCart],
  );

  useEffect(() => {
    mountedRef.current = true;
    void initializeCart('initializing', 'cart.errorInitialize');
    return () => {
      mountedRef.current = false;
    };
    // activeCountry is a dependency, not an unused value: each country owns its own cart, so a
    // switch must re-resolve the cart rather than keep the previous country's one.
  }, [activeCountry, initializeCart]);

  const retryCart = useCallback(
    () => initializeCart(cartIdRef.current ? 'refreshing' : 'initializing', 'cart.errorLoad'),
    [initializeCart],
  );

  const refreshCart = useCallback(
    () => initializeCart('refreshing', 'cart.errorRefresh'),
    [initializeCart],
  );

  /**
   * Runs one cart mutation with pending tracking, missing-cart recovery and the stale-response
   * guard. The operation result is opaque: `selectCart` names the cart inside it, so an action
   * such as reorder can carry a report back to its caller while the cart still lands in state.
   */
  const runCartMutation = useCallback(
    async <TResult>(
      action: CartAction,
      pendingKey: string,
      operation: (activeCartId: string) => Promise<TResult>,
      selectCart: (result: TResult) => Cart,
      retryAfterRecovery: boolean,
    ): Promise<TResult | false> => {
      const mutationSequence = ++mutationSequenceRef.current;
      const mutationCountry = countryRef.current;
      if (mountedRef.current) dispatch({ type: 'action-started', pendingKey, action });

      try {
        let activeCartId = cartIdRef.current;
        if (!activeCartId) {
          const cart = await loadCart();
          if (countryRef.current !== mutationCountry) return false;
          activeCartId = cart.id;
          applyCart(cart);
        }

        try {
          const result = await operation(activeCartId);
          const cart = selectCart(result);
          // Stale completion: the buyer switched country while this mutation was in flight, so
          // the returned cart belongs to the previous country and must not become the target.
          if (countryRef.current === mutationCountry) applyMutationCart(cart, mutationSequence);
          return result;
        } catch (error) {
          if (!isMissingCartFailure(error)) throw error;
          // A country switch owns the replacement workflow for its new cart. Do not recover or
          // replay a stale mutation against that country.
          if (countryRef.current !== mutationCountry) return false;

          const replacementCart = await recoverCart(activeCartId);
          if (countryRef.current !== mutationCountry) return false;
          applyCart(replacementCart);
          if (!retryAfterRecovery) {
            throw new CartMessageError('cart.errorCartNotFound');
          }

          if (countryRef.current !== mutationCountry) return false;
          const result = await operation(replacementCart.id);
          const cart = selectCart(result);
          if (countryRef.current === mutationCountry) applyMutationCart(cart, mutationSequence);
          return result;
        }
      } catch (error) {
        if (mountedRef.current && countryRef.current === mutationCountry) {
          dispatch({
            type: 'failed',
            error: cartErrorState(error, 'cart.errorAction'),
          });
        }
        return false;
      } finally {
        if (mountedRef.current && countryRef.current === mutationCountry) {
          dispatch({ type: 'action-finished', pendingKey });
        }
      }
    },
    [applyCart, applyMutationCart, loadCart, recoverCart],
  );

  const runCartAction = useCallback(
    (
      action: CartAction,
      pendingKey: string,
      operation: (activeCartId: string) => Promise<Cart>,
      retryAfterRecovery: boolean,
    ): Promise<Cart | false> =>
      runCartMutation(action, pendingKey, operation, (cart) => cart, retryAfterRecovery),
    [runCartMutation],
  );

  // Most callers only need success/failure. Custom Blend also needs the server-returned line so
  // its recap cannot reuse the pre-edit key.
  const runCartActionSucceeded = useCallback(
    async (
      action: CartAction,
      pendingKey: string,
      operation: (activeCartId: string) => Promise<Cart>,
      retryAfterRecovery: boolean,
    ) => Boolean(await runCartAction(action, pendingKey, operation, retryAfterRecovery)),
    [runCartAction],
  );

  const addItem = useCallback(
    (productId: string, variantId?: number, quantity?: number) =>
      runCartActionSucceeded(
        'add',
        productId,
        (cartId) =>
          quantity === undefined
            ? api.addToCart(cartId, productId, variantId)
            : api.addToCart(cartId, productId, variantId, quantity),
        true,
      ),
    [runCartActionSucceeded],
  );
  const addBundle = useCallback(
    (bundleId: string) =>
      runCartActionSucceeded(
        'bundle-add',
        `bundle:${bundleId}`,
        (cartId) => bundlesApi.addBundleToCart(cartId, bundleId),
        true,
      ),
    [runCartActionSucceeded],
  );
  const updateQuantity = useCallback(
    (productId: string, quantity: number, variantId?: number, configKey?: string) =>
      runCartActionSucceeded(
        'update',
        cartLinePendingKey(productId, variantId, configKey),
        (cartId) => {
          if (variantId === undefined) return api.updateCartItem(cartId, productId, quantity);
          if (configKey === undefined)
            return api.updateCartItem(cartId, productId, quantity, variantId);
          return api.updateCartItem(cartId, productId, quantity, variantId, configKey);
        },
        false,
      ),
    [runCartActionSucceeded],
  );
  const removeItem = useCallback(
    (productId: string, variantId?: number, configKey?: string) =>
      runCartActionSucceeded(
        'remove',
        cartLinePendingKey(productId, variantId, configKey),
        (cartId) => {
          if (variantId === undefined) return api.removeFromCart(cartId, productId);
          if (configKey === undefined) return api.removeFromCart(cartId, productId, variantId);
          return api.removeFromCart(cartId, productId, variantId, configKey);
        },
        false,
      ),
    [runCartActionSucceeded],
  );
  const addCustomBlend = useCallback(
    (body: CreateCustomBlendBody) =>
      runCartAction(
        'blend-add',
        customBlendPendingKey(body.baseVariantId),
        (cartId) => customBlendsApi.createCustomBlend(cartId, body),
        true,
      ),
    [runCartAction],
  );
  // A replace targets one existing configured line, so a recovered empty cart has
  // nothing to retry against; the caller is told the line is gone instead.
  const replaceCustomBlend = useCallback(
    (body: ReplaceCustomBlendBody) =>
      runCartAction(
        'blend-replace',
        customBlendPendingKey(body.baseVariantId, body.configKey),
        (cartId) => customBlendsApi.replaceCustomBlend(cartId, body),
        false,
      ),
    [runCartAction],
  );

  const quickOrder = useCallback(
    (text: string): Promise<QuickOrderResponse | false> =>
      runCartMutation(
        'quick-order',
        QUICK_ORDER_PENDING_KEY,
        (cartId) => quickOrderApi.submitQuickOrder(cartId, text),
        (response) => response.cart,
        true,
      ),
    [runCartMutation],
  );

  /**
   * Re-adds a past order's lines to the active cart. The per-line outcome report is returned to the
   * caller rather than stored: it describes one reorder attempt, not cart state.
   */
  const reorder = useCallback(
    (orderId: string): Promise<ReorderResponse | false> =>
      runCartMutation(
        'reorder',
        reorderPendingKey(orderId),
        (cartId) => reorderApi.reorderFromOrder(cartId, orderId),
        (response) => response.cart,
        true,
      ),
    [runCartMutation],
  );

  const addSavedListToCart = useCallback(
    (listId: string): Promise<SavedListAddToCartResponse | false> =>
      runCartMutation(
        'saved-list-add',
        savedListPendingKey(listId),
        (cartId) => savedListsApi.addSavedListToCart(listId, { cartId }),
        (response) => response.cart,
        true,
      ),
    [runCartMutation],
  );

  const clearCart = useCallback(
    (target?: CartClearTarget): boolean => {
      const country = countryRef.current;
      if (target) {
        if (target.country !== country || target.cartId !== cartIdRef.current) return false;
        if (target.generation !== undefined && target.generation !== cartGenerationRef.current)
          return false;
        // Storage can be replaced by a newer cart while payment was pending. Never remove it.
        if (getCartId(target.country) !== target.cartId) return false;
      }
      clearCartId(target?.country ?? country);
      cartIdRef.current = null;
      cartGenerationRef.current += 1;
      if (!mountedRef.current) return true;
      dispatch({ type: 'cleared' });
      void initializeCart('initializing', 'cart.errorInitialize');
      return true;
    },
    [initializeCart],
  );

  const isActionPending = useCallback(
    (productId: string, action?: CartAction, variantId?: number, configKey?: string) => {
      const pendingAction =
        state.pendingActions[cartLinePendingKey(productId, variantId, configKey)];
      return action ? pendingAction === action : pendingAction !== undefined;
    },
    [state.pendingActions],
  );

  return {
    cart: state.cart,
    cartId: state.cartId,
    cartGeneration: cartGenerationRef.current,
    isCartAvailable:
      state.cart !== null && state.cartId !== null && state.status !== 'initializing',
    isLoading: state.status === 'refreshing',
    isInitializing: state.status === 'initializing',
    error: localizedError,
    /** Stable identity for callers that need code-based branching without prose matching. */
    errorCode: state.error?.code ?? null,
    errorState: state.error,
    pendingActions: state.pendingActions,
    isActionPending,
    addItem,
    addBundle,
    addCustomBlend,
    replaceCustomBlend,
    quickOrder,
    updateQuantity,
    removeItem,
    reorder,
    addSavedListToCart,
    refreshCart,
    retryCart,
    clearCart,
  };
}
