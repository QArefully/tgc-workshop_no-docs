import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, ApiContractError, apiFetch } from './client';

vi.mock('./client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./client')>();
  return { ...actual, apiFetch: vi.fn() };
});

import {
  cancelBackInStockSubscription,
  createBackInStockSubscription,
  getBackInStockSubscriptions,
} from './backInStock';

describe('back-in-stock API', () => {
  beforeEach(() => vi.mocked(apiFetch).mockReset());

  it('threads an abort signal onto the list request', () => {
    vi.mocked(apiFetch).mockResolvedValue([]);
    const controller = new AbortController();
    void getBackInStockSubscriptions(controller.signal);
    expect(apiFetch).toHaveBeenCalledWith(expect.anything(), '/api/back-in-stock', {
      signal: controller.signal,
    });
  });

  it('posts only the variant id declared by the contract body', () => {
    vi.mocked(apiFetch).mockResolvedValue({});
    void createBackInStockSubscription({ variantId: 101 });
    expect(apiFetch).toHaveBeenCalledWith(expect.anything(), '/api/back-in-stock', {
      method: 'POST',
      body: JSON.stringify({ variantId: 101 }),
      signal: undefined,
    });
  });

  it('encodes the subscription id on cancel and resolves to void', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ success: true });
    await expect(cancelBackInStockSubscription('42 / x')).resolves.toBeUndefined();
    expect(apiFetch).toHaveBeenCalledWith(expect.anything(), '/api/back-in-stock/42%20%2F%20x', {
      method: 'DELETE',
      signal: undefined,
    });
  });

  it('propagates API errors with their server code intact', async () => {
    const error = new ApiError('This item is available', 409, {
      error: 'This item is available',
      code: 'VARIANT_AVAILABLE',
    } as never);
    vi.mocked(apiFetch).mockRejectedValue(error);
    await expect(createBackInStockSubscription({ variantId: 7 })).rejects.toBe(error);
    expect((error.response as { code?: string } | null)?.code).toBe('VARIANT_AVAILABLE');
    vi.mocked(apiFetch).mockResolvedValue([]);
    await expect(getBackInStockSubscriptions()).resolves.toEqual([]);
  });

  it('rejects a contract-violating successful response in the real client', async () => {
    const realClient = await vi.importActual<typeof import('./client')>('./client');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ subscriptionId: '1', variantId: 3 }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { BackInStockSubscriptionListResponse } = await import('@shop/contracts/back-in-stock');
    await expect(
      realClient.apiFetch(BackInStockSubscriptionListResponse, '/api/back-in-stock'),
    ).rejects.toBeInstanceOf(ApiContractError);
    vi.unstubAllGlobals();
  });
});
