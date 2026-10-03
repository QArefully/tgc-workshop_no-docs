import { act, renderHook } from '@testing-library/react';
import type {
  CustomBlendEvaluationResponse,
  CustomBlendIngredientInput,
} from '@shop/contracts/custom-blends';
import { ApiError, setActiveApiCountry } from '@/api/client';
import { evaluateCustomBlend } from '@/api/customBlends';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { useCustomBlendEvaluation } from './useCustomBlendEvaluation';

const countryState = vi.hoisted(() => ({ activeCountry: 'US' }));
vi.mock('@/api/customBlends', () => ({ evaluateCustomBlend: vi.fn() }));
vi.mock('@/hooks/CountryContext', () => ({
  useOptionalCountry: () => ({ activeCountry: countryState.activeCountry }),
}));

const ingredients: readonly CustomBlendIngredientInput[] = [
  { variantId: 602, percentage: 25 },
  { variantId: 603, percentage: 25 },
];

function response(quantity = 8): CustomBlendEvaluationResponse {
  return {
    quantity,
    // The hook does not inspect or calculate the resolved snapshot. The API client validates this
    // shape; this fixture only needs an identity-bearing value for stale-result assertions.
    customBlend: {} as CustomBlendEvaluationResponse['customBlend'],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
  });
}

function draft(overrides: Record<string, unknown> = {}) {
  return {
    baseVariantId: 601,
    ingredients,
    quantity: null,
    editConfigKey: null,
    ...overrides,
  } as Parameters<typeof useCustomBlendEvaluation>[0];
}

describe('useCustomBlendEvaluation', () => {
  beforeEach(() => {
    vi.mocked(evaluateCustomBlend).mockReset();
    countryState.activeCountry = 'US';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    setActiveApiCountry(null);
  });

  it('waits 150ms before evaluating and exposes the exact server result', async () => {
    const evaluated = response();
    vi.mocked(evaluateCustomBlend).mockResolvedValueOnce(evaluated);
    const { result } = renderHook(() => useCustomBlendEvaluation(draft()));

    expect(evaluateCustomBlend).not.toHaveBeenCalled();
    void act(() => vi.advanceTimersByTime(149));
    expect(evaluateCustomBlend).not.toHaveBeenCalled();
    void act(() => vi.advanceTimersByTime(1));
    expect(evaluateCustomBlend).toHaveBeenCalledOnce();

    expect(evaluateCustomBlend).toHaveBeenCalledWith(
      {
        baseVariantId: 601,
        ingredients: [
          { variantId: 602, percentage: 25 },
          { variantId: 603, percentage: 25 },
        ],
      },
      expect.any(AbortSignal),
      'US',
    );
    await flushMicrotasks();
    expect(result.current.result).toBe(evaluated);
    expect(result.current.quantity).toBe(8);
    expect(result.current.snapshot).toBe(evaluated.customBlend);
  });

  it('does not request a structurally invalid draft', () => {
    const { result } = renderHook(() =>
      useCustomBlendEvaluation({ baseVariantId: null, ingredients: [], quantity: null }),
    );

    void act(() => vi.advanceTimersByTime(1_000));
    expect(evaluateCustomBlend).not.toHaveBeenCalled();
    expect(result.current.isStructurallyValid).toBe(false);
    expect(result.current.loading).toBe(false);
    expect(result.current.result).toBeNull();
  });

  it.each([
    [
      'duplicate ingredient variants',
      [
        { variantId: 602, percentage: 25 },
        { variantId: 602, percentage: 25 },
      ],
    ],
    ['the base variant as an ingredient', [{ variantId: 601, percentage: 25 }]],
  ])('does not request drafts with %s', (_description, invalidIngredients) => {
    const { result } = renderHook(() =>
      useCustomBlendEvaluation(draft({ ingredients: invalidIngredients })),
    );

    void act(() => vi.advanceTimersByTime(1_000));
    expect(evaluateCustomBlend).not.toHaveBeenCalled();
    expect(result.current.isStructurallyValid).toBe(false);
    expect(result.current.loading).toBe(false);
  });

  it('aborts a superseded request and ignores its late response', async () => {
    const stale = deferred<CustomBlendEvaluationResponse>();
    const fresh = deferred<CustomBlendEvaluationResponse>();
    vi.mocked(evaluateCustomBlend)
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(fresh.promise);
    const { result, rerender } = renderHook(
      ({ percentage }: { percentage: number }) =>
        useCustomBlendEvaluation(draft({ ingredients: [{ variantId: 602, percentage }] })),
      { initialProps: { percentage: 50 } },
    );

    void act(() => vi.advanceTimersByTime(150));
    expect(evaluateCustomBlend).toHaveBeenCalledOnce();
    const staleSignal = vi.mocked(evaluateCustomBlend).mock.calls[0]?.[1];

    rerender({ percentage: 45 });
    expect(staleSignal?.aborted).toBe(true);
    void act(() => vi.advanceTimersByTime(150));
    expect(evaluateCustomBlend).toHaveBeenCalledTimes(2);

    const current = response(9);
    await act(async () => {
      fresh.resolve(current);
      await fresh.promise;
    });
    await flushMicrotasks();
    expect(result.current.result).toBe(current);

    await act(async () => {
      stale.resolve(response(3));
      await stale.promise;
    });
    await flushMicrotasks();
    expect(result.current.result).toBe(current);
  });

  it('retains coded error metadata while discarding server prose', async () => {
    const failure = new ApiError('backend secret', 400, {
      error: 'backend secret',
      code: 'CUSTOM_BLEND_PIGMENT_CAP_EXCEEDED',
      meta: { maxPercentage: 10, actualPercentage: 15 },
    });
    vi.mocked(evaluateCustomBlend).mockRejectedValueOnce(failure);
    const { result } = renderHook(() => useCustomBlendEvaluation(draft()));

    void act(() => vi.advanceTimersByTime(150));
    await flushMicrotasks();
    expect(result.current.error).not.toBeNull();
    expect(result.current.error).toEqual({
      code: 'CUSTOM_BLEND_PIGMENT_CAP_EXCEEDED',
      meta: { maxPercentage: 10, actualPercentage: 15 },
    });
    expect(JSON.stringify(result.current.error)).not.toContain('backend secret');
  });

  it('retries the same draft after a coded failure', async () => {
    const failure = new ApiError('backend secret', 400, {
      error: 'backend secret',
      code: 'CUSTOM_BLEND_INCOMPATIBLE',
    });
    const recovered = response(11);
    vi.mocked(evaluateCustomBlend).mockRejectedValueOnce(failure).mockResolvedValueOnce(recovered);
    const { result } = renderHook(() => useCustomBlendEvaluation(draft()));

    void act(() => vi.advanceTimersByTime(150));
    await flushMicrotasks();
    expect(result.current.error?.code).toBe('CUSTOM_BLEND_INCOMPATIBLE');

    void act(() => result.current.retry());
    expect(result.current.error).toBeNull();
    expect(evaluateCustomBlend).toHaveBeenCalledOnce();
    void act(() => vi.advanceTimersByTime(149));
    expect(evaluateCustomBlend).toHaveBeenCalledOnce();
    void act(() => vi.advanceTimersByTime(1));
    expect(evaluateCustomBlend).toHaveBeenCalledTimes(2);
    await flushMicrotasks();
    expect(result.current.quantity).toBe(11);
  });

  it('uses the active country for identity and transport, invalidating synchronously on change', async () => {
    const first = response(8);
    const second = response(12);
    vi.mocked(evaluateCustomBlend).mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const initialProps: { editConfigKey: string | null } = { editConfigKey: null };
    const { result, rerender } = renderHook(
      ({ editConfigKey }: { editConfigKey: string | null }) =>
        useCustomBlendEvaluation(draft({ editConfigKey })),
      { initialProps },
    );

    void act(() => vi.advanceTimersByTime(150));
    await flushMicrotasks();
    expect(result.current.result).toBe(first);
    expect(vi.mocked(evaluateCustomBlend).mock.calls[0]?.[2]).toBe('US');

    countryState.activeCountry = 'DE';
    rerender({ editConfigKey: null });
    expect(result.current.result).toBeNull();
    expect(result.current.quantity).toBeNull();
    void act(() => vi.advanceTimersByTime(150));
    expect(evaluateCustomBlend).toHaveBeenCalledTimes(2);
    expect(vi.mocked(evaluateCustomBlend).mock.calls[1]?.[2]).toBe('DE');

    rerender({ editConfigKey: 'a'.repeat(64) });
    expect(result.current.result).toBeNull();
    expect(result.current.snapshot).toBeNull();
  });

  it('transmits the effective country as x-shop-country', async () => {
    const fetchMock = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(Response.json({}, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    setActiveApiCountry(null);
    const api = await vi.importActual<typeof import('@/api/customBlends')>('@/api/customBlends');

    await expect(
      api.evaluateCustomBlend(
        {
          baseVariantId: 601,
          ingredients: [{ variantId: 602, percentage: 25 }],
        },
        undefined,
        'DE',
      ),
    ).rejects.toThrow(/Response contract violation/);
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('x-shop-country')).toBe('DE');
  });
});
