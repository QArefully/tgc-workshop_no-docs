import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/hooks/AuthContext';
import { ApiError, type ApiErrorMeta } from '@/api/client';
import type { Country } from '@shop/contracts/country';
import type { PublicErrorCode } from '@shop/contracts/public-errors';
import type { MessageCatalog, MessageParams } from '@shop/localisation';
import { translateUnchecked } from '@shop/localisation';
import { apiErrors } from '@shop/localisation/messages/apiErrors';
import {
  identityAccountMessages,
  type IdentityAccountMessageKey,
} from '@shop/localisation/messages/identityAccount';
import { useLocalisation } from '@/i18n/LocaleContext';
import {
  createBillingEntity,
  createDeliverySite,
  listBillingEntities,
  listDeliverySites,
  retireBillingEntity,
  retireDeliverySite,
  updateBillingEntity,
  updateDeliverySite,
} from '@/api/tradeAccount';
import type {
  BillingEntity,
  CreateBillingEntityBody,
  CreateDeliverySiteBody,
  DeliverySite,
  UpdateBillingEntityBody,
  UpdateDeliverySiteBody,
} from '@shop/contracts/trade-account';
import { localizeAccountError } from './accountError';

/** Read state for one trade collection. `items` holds only active records. */
export interface TradeCollectionState<T> {
  items: T[];
  loading: boolean;
  /** Buyer-facing load failure. Cleared by a successful reload. */
  error: string | null;
  /** Stable load-failure identity. Copy is resolved from the active country during render. */
  errorState: TradeProfileErrorState | null;
}

export interface TradeProfileErrorState {
  readonly code: PublicErrorCode | null;
  readonly meta: ApiErrorMeta | null;
  readonly key: IdentityAccountMessageKey;
  readonly params?: MessageParams;
  /** Coded API errors retain request country; fallback keys follow active country. */
  readonly country?: Country;
}

export interface UseTradeProfileResult {
  deliverySites: TradeCollectionState<DeliverySite>;
  billingEntities: TradeCollectionState<BillingEntity>;
  reloadDeliverySites: () => void;
  reloadBillingEntities: () => void;
  /** Mutations reject with a buyer-facing `Error` so the calling form can show it inline. */
  addDeliverySite: (body: CreateDeliverySiteBody) => Promise<void>;
  editDeliverySite: (siteId: string, body: UpdateDeliverySiteBody) => Promise<void>;
  retireSite: (siteId: string) => Promise<void>;
  setDefaultDeliverySite: (siteId: string) => Promise<void>;
  addBillingEntity: (body: CreateBillingEntityBody) => Promise<void>;
  editBillingEntity: (entityId: string, body: UpdateBillingEntityBody) => Promise<void>;
  retireEntity: (entityId: string) => Promise<void>;
  setDefaultBillingEntity: (entityId: string) => Promise<void>;
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

const EMPTY_STATE = { items: [], loading: false, error: null, errorState: null } as const;

function safeMessageParams(meta: ApiErrorMeta | null): MessageParams {
  if (meta === null || typeof meta !== 'object') return {};
  const params: Record<string, string | number | bigint> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint')
      params[key] = value;
  }
  return params;
}

function tradeProfileErrorState(
  cause: unknown,
  key: IdentityAccountMessageKey,
): TradeProfileErrorState {
  if (cause instanceof ApiError && cause.code !== null) {
    return { code: cause.code, meta: cause.meta, key, country: cause.requestCountry };
  }
  // Network, legacy, contract, and unknown failures never retain Error.message.
  return { code: null, meta: null, key };
}

function localizeTradeProfileError(
  state: TradeProfileErrorState | null,
  activeCountry: Country,
  translate: (catalog: MessageCatalog, key: string, params?: MessageParams) => string,
): string | null {
  if (state === null) return null;
  if (state.code !== null) {
    try {
      return translateUnchecked(
        apiErrors,
        state.country ?? activeCountry,
        state.code,
        safeMessageParams(state.meta),
      );
    } catch {
      // Malformed/stale coded descriptors use safe account copy.
    }
  }
  return translate(identityAccountMessages, state.key, state.params ?? {});
}

/**
 * Owns the signed-in buyer's saved delivery sites and billing entities.
 *
 * Loads nothing while anonymous. Every list request carries a generation number and an
 * `AbortController`: a superseded response is both aborted and discarded, so a slow first load can
 * never overwrite the result of a later reload or of a mutation that already refreshed the list.
 */
export function useTradeProfile(): UseTradeProfileResult {
  const { user } = useAuth();
  const { activeCountry, translate } = useLocalisation();
  const userId = user?.id ?? null;

  const [deliverySites, setDeliverySites] = useState<TradeCollectionState<DeliverySite>>({
    ...EMPTY_STATE,
    items: [],
  });
  const [billingEntities, setBillingEntities] = useState<TradeCollectionState<BillingEntity>>({
    ...EMPTY_STATE,
    items: [],
  });

  const siteGeneration = useRef(0);
  const entityGeneration = useRef(0);
  const siteAbort = useRef<AbortController | null>(null);
  const entityAbort = useRef<AbortController | null>(null);

  const loadDeliverySites = useCallback(async () => {
    if (!userId) {
      setDeliverySites({ items: [], loading: false, error: null, errorState: null });
      return;
    }
    const generation = ++siteGeneration.current;
    siteAbort.current?.abort();
    const controller = new AbortController();
    siteAbort.current = controller;
    setDeliverySites((prev) => ({ ...prev, loading: true, error: null, errorState: null }));
    try {
      const items = await listDeliverySites({ signal: controller.signal });
      if (generation !== siteGeneration.current) return;
      setDeliverySites({ items, loading: false, error: null, errorState: null });
    } catch (error) {
      if (generation !== siteGeneration.current || isAbort(error)) return;
      setDeliverySites({
        items: [],
        loading: false,
        error: null,
        errorState: tradeProfileErrorState(error, 'account.delivery.loadError'),
      });
    }
  }, [userId]);

  const loadBillingEntities = useCallback(async () => {
    if (!userId) {
      setBillingEntities({ items: [], loading: false, error: null, errorState: null });
      return;
    }
    const generation = ++entityGeneration.current;
    entityAbort.current?.abort();
    const controller = new AbortController();
    entityAbort.current = controller;
    setBillingEntities((prev) => ({ ...prev, loading: true, error: null, errorState: null }));
    try {
      const items = await listBillingEntities({ signal: controller.signal });
      if (generation !== entityGeneration.current) return;
      setBillingEntities({ items, loading: false, error: null, errorState: null });
    } catch (error) {
      if (generation !== entityGeneration.current || isAbort(error)) return;
      setBillingEntities({
        items: [],
        loading: false,
        error: null,
        errorState: tradeProfileErrorState(error, 'account.billing.loadError'),
      });
    }
  }, [userId]);

  useEffect(() => {
    void loadDeliverySites();
    void loadBillingEntities();
    return () => {
      // A later mount starts its own generation; abort keeps the stale socket from resolving.
      siteAbort.current?.abort();
      entityAbort.current?.abort();
    };
  }, [loadDeliverySites, loadBillingEntities]);

  const reloadDeliverySites = useCallback(() => void loadDeliverySites(), [loadDeliverySites]);
  const reloadBillingEntities = useCallback(
    () => void loadBillingEntities(),
    [loadBillingEntities],
  );

  async function runSiteMutation(
    action: () => Promise<unknown>,
    fallback: IdentityAccountMessageKey,
  ): Promise<void> {
    try {
      await action();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new Error(localizeAccountError(error, translate, fallback));
    }
    await loadDeliverySites();
  }

  async function runEntityMutation(
    action: () => Promise<unknown>,
    fallback: IdentityAccountMessageKey,
  ): Promise<void> {
    try {
      await action();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new Error(localizeAccountError(error, translate, fallback));
    }
    await loadBillingEntities();
  }

  const deliverySitesView = useMemo<TradeCollectionState<DeliverySite>>(
    () => ({
      ...deliverySites,
      error: localizeTradeProfileError(deliverySites.errorState, activeCountry, translate),
    }),
    [activeCountry, deliverySites, translate],
  );
  const billingEntitiesView = useMemo<TradeCollectionState<BillingEntity>>(
    () => ({
      ...billingEntities,
      error: localizeTradeProfileError(billingEntities.errorState, activeCountry, translate),
    }),
    [activeCountry, billingEntities, translate],
  );

  return {
    deliverySites: deliverySitesView,
    billingEntities: billingEntitiesView,
    reloadDeliverySites,
    reloadBillingEntities,
    addDeliverySite: (body) =>
      runSiteMutation(() => createDeliverySite(body), 'account.common.saveError'),
    editDeliverySite: (siteId, body) =>
      runSiteMutation(() => updateDeliverySite(siteId, body), 'account.common.saveError'),
    retireSite: (siteId) =>
      runSiteMutation(() => retireDeliverySite(siteId), 'account.common.actionFailed'),
    setDefaultDeliverySite: (siteId) =>
      runSiteMutation(
        () => updateDeliverySite(siteId, { isDefault: true }),
        'account.common.actionFailed',
      ),
    addBillingEntity: (body) =>
      runEntityMutation(() => createBillingEntity(body), 'account.common.saveError'),
    editBillingEntity: (entityId, body) =>
      runEntityMutation(() => updateBillingEntity(entityId, body), 'account.common.saveError'),
    retireEntity: (entityId) =>
      runEntityMutation(() => retireBillingEntity(entityId), 'account.common.actionFailed'),
    setDefaultBillingEntity: (entityId) =>
      runEntityMutation(
        () => updateBillingEntity(entityId, { isDefault: true }),
        'account.common.actionFailed',
      ),
  };
}
