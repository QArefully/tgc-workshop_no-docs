import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { BackInStockSubscription } from '@shop/contracts/back-in-stock';
import type { PublicErrorCode } from '@shop/contracts/public-errors';
import type { MessageCatalog, MessageParams } from '@shop/localisation';
import * as backInStockApi from '@/api/backInStock';
import { ApiError, type ApiErrorMeta } from '@/api/client';
import { useAuth } from './AuthContext';
import { apiErrors } from '@shop/localisation/messages/apiErrors';
import { productMessages } from '@shop/localisation/messages/product';
import { useLocalisation } from '@/i18n/LocaleContext';

type BackInStockContextValue = {
  subscriptions: BackInStockSubscription[];
  /** Variants the buyer is currently waiting on, including an in-flight optimistic subscribe. */
  pendingVariantIds: ReadonlySet<number>;
  loading: boolean;
  error: string | null;
  errorState?: BackInStockErrorState | null;
  refresh: () => Promise<boolean>;
  subscribe: (variantId: number) => Promise<BackInStockSubscription | false>;
  cancel: (subscriptionId: string) => Promise<boolean>;
};

const BackInStockContext = createContext<BackInStockContextValue | null>(null);

/**
 * A mutation that settled while a list request was already in flight. The server list is
 * authoritative, but it was requested before these writes existed, so it is replayed over the
 * response instead of either side being discarded.
 */
type MutationEffect =
  | { kind: 'create'; subscription: BackInStockSubscription }
  | { kind: 'cancel'; subscriptionId: string };

const replayEffects = (
  items: BackInStockSubscription[],
  effects: readonly MutationEffect[],
): BackInStockSubscription[] => {
  let next = items;
  for (const effect of effects) {
    if (effect.kind === 'cancel') {
      next = next.filter((item) => item.subscriptionId !== effect.subscriptionId);
      continue;
    }
    next = [
      ...next.filter((item) => item.subscriptionId !== effect.subscription.subscriptionId),
      effect.subscription,
    ];
  }
  return next;
};

type ProductMessageKey = keyof typeof productMessages;
export type BackInStockErrorState = {
  readonly code: PublicErrorCode | null;
  readonly meta: ApiErrorMeta | null;
  readonly key: ProductMessageKey;
  readonly params?: MessageParams;
};

function safeMessageParams(meta: ApiErrorMeta | null): MessageParams {
  if (meta === null || typeof meta !== 'object') return {};
  const params: Record<string, string | number | bigint> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint')
      params[key] = value;
  }
  return params;
}

function localizeBackInStockError(
  state: BackInStockErrorState | null,
  translate: (catalog: MessageCatalog, key: string, params?: MessageParams) => string,
): string | null {
  if (state === null) return null;
  if (state.code !== null) {
    try {
      return translate(apiErrors, state.code, safeMessageParams(state.meta));
    } catch {
      // Stale/malformed descriptors use safe P17 copy.
    }
  }
  return translate(productMessages, state.key, state.params);
}

function errorState(cause: unknown, fallback: ProductMessageKey): BackInStockErrorState {
  if (cause instanceof ApiError && cause.code !== null) {
    return { code: cause.code, meta: cause.meta, key: fallback };
  }
  // Network, contract, legacy, and unknown failures never expose Error.message.
  return { code: null, meta: null, key: fallback };
}

/**
 * Buyer-scoped back-in-stock state. Async results may only update their originating session,
 * and availability/MOQ are never re-derived on the client: every write reconciles to the
 * subscription object the server returned.
 */
export function BackInStockProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { translate } = useLocalisation();
  const userId = user?.id ?? null;
  const [subscriptions, setSubscriptions] = useState<BackInStockSubscription[]>([]);
  const [optimisticVariantIds, setOptimisticVariantIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorStateValue, setErrorStateValue] = useState<BackInStockErrorState | null>(null);
  const subscriptionsRef = useRef<BackInStockSubscription[]>([]);
  const optimisticVariantIdsRef = useRef<number[]>([]);
  const stateVersionRef = useRef(0);
  const sessionVersionRef = useRef(0);
  const userIdRef = useRef<string | null>(userId);
  const mutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const refreshInFlightRef = useRef(0);
  const effectsSinceRefreshRef = useRef<readonly MutationEffect[]>([]);
  const controllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  if (userIdRef.current !== userId) {
    userIdRef.current = userId;
    sessionVersionRef.current += 1;
    stateVersionRef.current += 1;
    effectsSinceRefreshRef.current = [];
    controllerRef.current?.abort();
  }

  const applySubscriptions = useCallback((next: BackInStockSubscription[]) => {
    subscriptionsRef.current = next;
    if (mountedRef.current) setSubscriptions(next);
  }, []);
  const applyOptimisticVariantIds = useCallback((next: number[]) => {
    optimisticVariantIdsRef.current = next;
    if (mountedRef.current) setOptimisticVariantIds(next);
  }, []);
  const isCurrentSession = useCallback(
    (sessionVersion: number, expectedUserId: string) =>
      sessionVersion === sessionVersionRef.current && userIdRef.current === expectedUserId,
    [],
  );

  const refresh = useCallback(async (): Promise<boolean> => {
    if (!userId) return false;
    const sessionVersion = sessionVersionRef.current;
    const version = ++stateVersionRef.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setErrorStateValue(null);
    refreshInFlightRef.current += 1;
    effectsSinceRefreshRef.current = [];
    try {
      const items = await backInStockApi.getBackInStockSubscriptions(controller.signal);
      if (isCurrentSession(sessionVersion, userId) && version === stateVersionRef.current) {
        // Writes that settled after this request was issued cannot appear in its response.
        applySubscriptions(replayEffects(items, effectsSinceRefreshRef.current));
        effectsSinceRefreshRef.current = [];
        return true;
      }
      return false;
    } catch (cause) {
      if (
        !isCurrentSession(sessionVersion, userId) ||
        version !== stateVersionRef.current ||
        controller.signal.aborted
      )
        return false;
      setErrorStateValue(errorState(cause, 'product.unableLoadAlerts'));
      return false;
    } finally {
      refreshInFlightRef.current -= 1;
      if (
        isCurrentSession(sessionVersion, userId) &&
        version === stateVersionRef.current &&
        mountedRef.current
      )
        setLoading(false);
    }
  }, [applySubscriptions, isCurrentSession, userId]);

  useEffect(() => {
    mountedRef.current = true;
    if (!userId) {
      controllerRef.current?.abort();
      mutationQueueRef.current = Promise.resolve();
      applySubscriptions([]);
      applyOptimisticVariantIds([]);
      setLoading(false);
      setErrorStateValue(null);
      return;
    }
    void refresh();
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
    };
  }, [applyOptimisticVariantIds, applySubscriptions, refresh, userId]);

  const enqueueMutation = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const queued = mutationQueueRef.current.then(operation, operation);
    mutationQueueRef.current = queued.then(
      () => undefined,
      () => undefined,
    );
    return queued;
  }, []);

  /** Only writes that race an in-flight list request need replaying over its response. */
  const recordEffect = useCallback((effect: MutationEffect) => {
    if (refreshInFlightRef.current > 0)
      effectsSinceRefreshRef.current = [...effectsSinceRefreshRef.current, effect];
  }, []);
  const forgetEffect = useCallback((effect: MutationEffect) => {
    effectsSinceRefreshRef.current = effectsSinceRefreshRef.current.filter(
      (candidate) => candidate !== effect,
    );
  }, []);

  const subscribe = useCallback(
    (variantId: number): Promise<BackInStockSubscription | false> => {
      if (!userId) return Promise.resolve(false);
      const sessionVersion = sessionVersionRef.current;
      return enqueueMutation(async () => {
        if (!isCurrentSession(sessionVersion, userId)) return false;
        const existing = subscriptionsRef.current.find(
          (item) => item.variantId === variantId && item.status === 'pending',
        );
        if (existing) return existing;
        applyOptimisticVariantIds([...optimisticVariantIdsRef.current, variantId]);
        setErrorStateValue(null);
        try {
          const created = await backInStockApi.createBackInStockSubscription({ variantId });
          if (!isCurrentSession(sessionVersion, userId)) return false;
          applySubscriptions([
            ...subscriptionsRef.current.filter(
              (item) => item.subscriptionId !== created.subscriptionId,
            ),
            created,
          ]);
          applyOptimisticVariantIds(
            optimisticVariantIdsRef.current.filter((id) => id !== variantId),
          );
          recordEffect({ kind: 'create', subscription: created });
          return created;
        } catch (cause) {
          if (!isCurrentSession(sessionVersion, userId)) return false;
          // Roll back only this optimistic marker; a refresh may have landed newer state meanwhile.
          applyOptimisticVariantIds(
            optimisticVariantIdsRef.current.filter((id) => id !== variantId),
          );
          setErrorStateValue(errorState(cause, 'product.unableCreateAlert'));
          return false;
        }
      });
    },
    [
      applyOptimisticVariantIds,
      applySubscriptions,
      enqueueMutation,
      isCurrentSession,
      recordEffect,
      userId,
    ],
  );

  const cancel = useCallback(
    (subscriptionId: string): Promise<boolean> => {
      if (!userId) return Promise.resolve(false);
      const sessionVersion = sessionVersionRef.current;
      return enqueueMutation(async () => {
        if (!isCurrentSession(sessionVersion, userId)) return false;
        const removed = subscriptionsRef.current.find(
          (item) => item.subscriptionId === subscriptionId,
        );
        if (!removed) return false;
        const effect: MutationEffect = { kind: 'cancel', subscriptionId };
        applySubscriptions(
          subscriptionsRef.current.filter((item) => item.subscriptionId !== subscriptionId),
        );
        recordEffect(effect);
        setErrorStateValue(null);
        try {
          await backInStockApi.cancelBackInStockSubscription(subscriptionId);
          if (!isCurrentSession(sessionVersion, userId)) return false;
          return true;
        } catch (cause) {
          if (!isCurrentSession(sessionVersion, userId)) return false;
          // Reinstate only this entry; a refresh may have landed newer state meanwhile.
          forgetEffect(effect);
          if (!subscriptionsRef.current.some((item) => item.subscriptionId === subscriptionId))
            applySubscriptions([...subscriptionsRef.current, removed]);
          setErrorStateValue(errorState(cause, 'product.unableCancelAlert'));
          return false;
        }
      });
    },
    [applySubscriptions, enqueueMutation, forgetEffect, isCurrentSession, recordEffect, userId],
  );

  const pendingVariantIds = useMemo(() => {
    const ids = new Set<number>(optimisticVariantIds);
    for (const item of subscriptions) if (item.status === 'pending') ids.add(item.variantId);
    return ids;
  }, [optimisticVariantIds, subscriptions]);

  const error = useMemo(
    () => localizeBackInStockError(errorStateValue, translate),
    [errorStateValue, translate],
  );
  const value = useMemo(
    () => ({
      subscriptions,
      pendingVariantIds,
      loading,
      error,
      errorState: errorStateValue,
      refresh,
      subscribe,
      cancel,
    }),
    [cancel, error, errorStateValue, loading, pendingVariantIds, refresh, subscribe, subscriptions],
  );

  return <BackInStockContext.Provider value={value}>{children}</BackInStockContext.Provider>;
}

export function useBackInStockContext(): BackInStockContextValue {
  const value = useContext(BackInStockContext);
  if (!value) throw new Error('useBackInStockContext must be used within BackInStockProvider');
  return value;
}
