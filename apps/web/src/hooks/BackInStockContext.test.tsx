import { act, renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackInStockSubscription } from '@shop/contracts/back-in-stock';
import { BackInStockProvider, useBackInStockContext } from './BackInStockContext';
import { ApiError } from '@/api/client';

const auth = vi.fn<() => { user: { id: string } | null }>();
vi.mock('./AuthContext', () => ({ useAuth: () => auth() }));
vi.mock('@/api/backInStock', () => ({
  getBackInStockSubscriptions: vi.fn(),
  createBackInStockSubscription: vi.fn(),
  cancelBackInStockSubscription: vi.fn(),
}));
import * as api from '@/api/backInStock';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const subscription = (
  overrides: Partial<BackInStockSubscription> = {},
): BackInStockSubscription => ({
  subscriptionId: '1',
  variantId: 101,
  productId: 'product-101',
  sku: 'MAT-101',
  productName: 'Portland Cement',
  variantLabel: '25kg sack',
  status: 'pending',
  requestedAt: '2026-08-01T00:00:00.000Z',
  notifiedAt: null,
  minimumOrderQuantity: 4,
  ...overrides,
});

const wrapper = ({ children }: { children: ReactNode }) => (
  <BackInStockProvider>{children}</BackInStockProvider>
);

describe('BackInStockContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.mockReturnValue({ user: null });
  });

  it('keeps anonymous state empty without requesting subscriptions', () => {
    const { result } = renderHook(() => useBackInStockContext(), { wrapper });
    expect(result.current.subscriptions).toEqual([]);
    expect([...result.current.pendingVariantIds]).toEqual([]);
    expect(api.getBackInStockSubscriptions).not.toHaveBeenCalled();
  });

  it('derives pendingVariantIds from pending subscriptions only', async () => {
    auth.mockReturnValue({ user: { id: '1' } });
    vi.mocked(api.getBackInStockSubscriptions).mockResolvedValue([
      subscription(),
      subscription({ subscriptionId: '2', variantId: 202, status: 'notified' }),
    ]);
    const { result } = renderHook(() => useBackInStockContext(), { wrapper });
    await waitFor(() => expect(result.current.subscriptions).toHaveLength(2));
    expect([...result.current.pendingVariantIds]).toEqual([101]);
    expect(result.current.loading).toBe(false);
  });

  it('clears data and aborts the in-flight request when the buyer logs out', async () => {
    auth.mockReturnValue({ user: { id: '1' } });
    const pending = deferred<BackInStockSubscription[]>();
    let capturedSignal: AbortSignal | undefined;
    vi.mocked(api.getBackInStockSubscriptions).mockImplementation((signal) => {
      capturedSignal = signal;
      return pending.promise;
    });
    const { result, rerender } = renderHook(() => useBackInStockContext(), { wrapper });
    await waitFor(() => expect(api.getBackInStockSubscriptions).toHaveBeenCalled());

    auth.mockReturnValue({ user: null });
    rerender();
    expect(capturedSignal?.aborted).toBe(true);

    await act(async () => {
      pending.resolve([subscription()]);
      await pending.promise;
    });
    expect(result.current.subscriptions).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('keeps the server list and clears loading when a subscribe races the initial load', async () => {
    auth.mockReturnValue({ user: { id: '1' } });
    const first = deferred<BackInStockSubscription[]>();
    vi.mocked(api.getBackInStockSubscriptions).mockReturnValueOnce(first.promise);
    const created = subscription({ subscriptionId: '9', variantId: 303 });
    vi.mocked(api.createBackInStockSubscription).mockResolvedValue(created);
    const existing = subscription({ subscriptionId: '1', variantId: 101 });

    const { result } = renderHook(() => useBackInStockContext(), { wrapper });
    await waitFor(() => expect(api.getBackInStockSubscriptions).toHaveBeenCalled());
    expect(result.current.loading).toBe(true);

    await act(async () => {
      await result.current.subscribe(303);
    });
    expect(result.current.subscriptions).toEqual([created]);

    await act(async () => {
      first.resolve([existing]);
      await first.promise;
    });
    // The list request predates the create, so the server list is authoritative for everything
    // except the write that raced it.
    expect(result.current.subscriptions).toEqual([existing, created]);
    expect([...result.current.pendingVariantIds].sort()).toEqual([101, 303]);
    expect(result.current.loading).toBe(false);
  });

  it('does not discard a refresh that landed while a failing mutation was in flight', async () => {
    auth.mockReturnValue({ user: { id: '1' } });
    const initial = subscription();
    vi.mocked(api.getBackInStockSubscriptions).mockResolvedValue([initial]);
    const create = deferred<BackInStockSubscription>();
    vi.mocked(api.createBackInStockSubscription).mockReturnValue(create.promise);

    const { result } = renderHook(() => useBackInStockContext(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let subscribing!: Promise<unknown>;
    await act(async () => {
      subscribing = result.current.subscribe(303);
      await Promise.resolve();
    });
    expect(api.createBackInStockSubscription).toHaveBeenCalled();

    const newer = subscription({ subscriptionId: '2', variantId: 202 });
    vi.mocked(api.getBackInStockSubscriptions).mockResolvedValue([initial, newer]);
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.subscriptions).toEqual([initial, newer]);

    await act(async () => {
      create.reject(new ApiError('Variant is available', 409));
      await subscribing;
    });
    expect(result.current.subscriptions).toEqual([initial, newer]);
    expect([...result.current.pendingVariantIds].sort()).toEqual([101, 202]);
    vi.mocked(api.createBackInStockSubscription).mockResolvedValue(
      subscription({ subscriptionId: '3', variantId: 303 }),
    );
  });

  it('serialises mutations and reconciles each against the server object', async () => {
    auth.mockReturnValue({ user: { id: '1' } });
    vi.mocked(api.getBackInStockSubscriptions).mockResolvedValue([]);
    const order: string[] = [];
    const firstCreate = deferred<BackInStockSubscription>();
    vi.mocked(api.createBackInStockSubscription).mockImplementation((body) => {
      order.push(`start-${body.variantId}`);
      if (body.variantId === 101) return firstCreate.promise;
      return Promise.resolve(subscription({ subscriptionId: '2', variantId: body.variantId }));
    });

    const { result } = renderHook(() => useBackInStockContext(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let both!: Promise<unknown>;
    await act(async () => {
      both = Promise.all([result.current.subscribe(101), result.current.subscribe(202)]);
      await Promise.resolve();
    });
    expect(order).toEqual(['start-101']);

    await act(async () => {
      firstCreate.resolve(subscription({ subscriptionId: '1', variantId: 101 }));
      await both;
    });
    expect(order).toEqual(['start-101', 'start-202']);
    expect(result.current.subscriptions.map((item) => item.subscriptionId)).toEqual(['1', '2']);
    expect([...result.current.pendingVariantIds].sort()).toEqual([101, 202]);
  });

  it('rolls back a rejected subscribe and surfaces the mapped server message', async () => {
    auth.mockReturnValue({ user: { id: '1' } });
    vi.mocked(api.getBackInStockSubscriptions).mockResolvedValue([]);
    vi.mocked(api.createBackInStockSubscription).mockRejectedValue(
      new ApiError('Variant is available', 409, {
        error: 'Variant is available',
        code: 'VARIANT_AVAILABLE',
      } as never),
    );
    const { result } = renderHook(() => useBackInStockContext(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await expect(result.current.subscribe(101)).resolves.toBe(false);
    });
    expect(result.current.subscriptions).toEqual([]);
    expect([...result.current.pendingVariantIds]).toEqual([]);
    expect(result.current.error).toBe('The request could not be completed.');
  });

  it('rolls back a rejected cancel to the confirmed subscription list', async () => {
    auth.mockReturnValue({ user: { id: '1' } });
    const confirmed = subscription();
    vi.mocked(api.getBackInStockSubscriptions).mockResolvedValue([confirmed]);
    vi.mocked(api.cancelBackInStockSubscription).mockRejectedValue(
      new ApiError('Subscription not found', 404),
    );
    const { result } = renderHook(() => useBackInStockContext(), { wrapper });
    await waitFor(() => expect(result.current.subscriptions).toHaveLength(1));

    await act(async () => {
      await expect(result.current.cancel('1')).resolves.toBe(false);
    });
    expect(result.current.subscriptions).toEqual([confirmed]);
    expect(result.current.error).toBe('Unable to cancel this back-in-stock alert.');
  });

  it('removes a cancelled subscription on success', async () => {
    auth.mockReturnValue({ user: { id: '1' } });
    vi.mocked(api.getBackInStockSubscriptions).mockResolvedValue([subscription()]);
    vi.mocked(api.cancelBackInStockSubscription).mockResolvedValue(undefined);
    const { result } = renderHook(() => useBackInStockContext(), { wrapper });
    await waitFor(() => expect(result.current.subscriptions).toHaveLength(1));

    await act(async () => {
      await expect(result.current.cancel('1')).resolves.toBe(true);
    });
    expect(result.current.subscriptions).toEqual([]);
    expect([...result.current.pendingVariantIds]).toEqual([]);
  });

  it('does not surface an error when a refresh is aborted', async () => {
    auth.mockReturnValue({ user: { id: '1' } });
    let capturedSignal: AbortSignal | undefined;
    vi.mocked(api.getBackInStockSubscriptions).mockImplementation(
      (signal) =>
        new Promise((_resolve, reject) => {
          capturedSignal = signal;
          signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    const { result } = renderHook(() => useBackInStockContext(), { wrapper });
    await waitFor(() => expect(api.getBackInStockSubscriptions).toHaveBeenCalled());

    vi.mocked(api.getBackInStockSubscriptions).mockResolvedValue([]);
    await act(async () => {
      await result.current.refresh();
    });
    expect(capturedSignal?.aborted).toBe(true);
    expect(result.current.error).toBeNull();
  });
});
