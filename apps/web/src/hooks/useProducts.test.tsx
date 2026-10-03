import { act, renderHook, waitFor } from '@testing-library/react';
import type { CategoryFacts } from '@shop/contracts/products';
import type { VariantProductList } from '@/api/products';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getProducts } from '@/api/products';
import { useProducts } from './useProducts';

vi.mock('@/api/products', () => ({ getProducts: vi.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const defaultFacts: CategoryFacts = {
  texture: 'Fine',
  colour: 'White',
  source: 'Test source',
  intendedUse: 'Testing',
  storage: 'Dry cool',
  consumptionClassification: 'non-food',
};

function response(name: string): VariantProductList {
  return {
    items: [
      {
        id: name,
        name,
        description: `${name} description`,
        priceCents: 1000,
        imageSetId: 'powdered-water',
        category: 'Impossible',
        stock: 1,
        slug: name,
        salesCount: 0,
        createdAt: '2026-07-14T00:00:00.000Z',
        available: true,
        availability: 'in_stock',
        backorderable: false,
        backorderLeadDays: null,
        tags: [],
        specificationGroups: [],
        variants: [
          {
            variantId: 1,
            productId: 1,
            sku: `${name}-sku`,
            label: 'Standard',
            weightGrams: 500,
            priceCents: 1000,
            moqSacks: 4,
            perTonneCents: 2_000_000,
            priceTiers: [{ minTonnes: 1, discountPct: 0 }],
            stockCount: 10,
            backorderable: false,
            backorderLeadDays: null,
            deliveryClass: 'parcel',
            active: true,
            sortOrder: 1,
          },
        ],
        defaultVariantId: 1,
        categoryFacts: defaultFacts,
        consumptionClassification: 'non-food',
        mixingGroup: null,
        priceRange: { min: 1000, max: 1000 },
        baseAvailability: 'in_stock',
      },
    ],
    total: 1,
    page: 1,
    pageSize: 12,
  };
}

describe('useProducts', () => {
  beforeEach(() => {
    vi.mocked(getProducts).mockReset();
  });

  it('aborts and does not commit an out-of-order expanded-filter response', async () => {
    const first = deferred<VariantProductList>();
    const second = deferred<VariantProductList>();
    vi.mocked(getProducts).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    type ExpandedFilters = {
      tag: string[];
      spec: string[];
      availability: 'available' | 'out_of_stock';
    };
    const initialProps: ExpandedFilters = {
      tag: ['drink-mix'],
      spec: ['texture:fine'],
      availability: 'available',
    };
    const { result, rerender } = renderHook(
      ({ tag, spec, availability }: ExpandedFilters) => useProducts({ tag, spec, availability }),
      { initialProps },
    );
    rerender({
      tag: ['pantry'],
      spec: ['texture:granular'],
      availability: 'out_of_stock',
    });

    await waitFor(() => expect(getProducts).toHaveBeenCalledTimes(2));
    expect(vi.mocked(getProducts).mock.calls[1]?.[0]).toEqual({
      tag: ['pantry'],
      spec: ['texture:granular'],
      availability: 'out_of_stock',
    });
    const firstRequest = vi.mocked(getProducts).mock.calls[0];
    expect(firstRequest?.[1]?.aborted).toBe(true);

    await act(async () => {
      second.resolve(response('second'));
      await second.promise;
    });
    expect(result.current.products[0]?.name).toBe('second');

    await act(async () => {
      first.resolve(response('first'));
      await first.promise;
    });
    expect(result.current.products[0]?.name).toBe('second');
  });

  it('ignores an older rejection while the newer request remains loading', async () => {
    const first = deferred<VariantProductList>();
    const second = deferred<VariantProductList>();
    vi.mocked(getProducts).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const { result, rerender } = renderHook(({ q }) => useProducts({ q }), {
      initialProps: { q: 'first' },
    });
    rerender({ q: 'second' });

    await waitFor(() => expect(getProducts).toHaveBeenCalledTimes(2));
    await act(async () => {
      first.reject(new Error('first request failed'));
      await first.promise.catch(() => undefined);
    });
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(true);

    await act(async () => {
      second.resolve(response('second'));
      await second.promise;
    });
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.products[0]?.name).toBe('second');
  });

  it('clears prior category cards while Trade & Creative Materials is loading', async () => {
    const pantry = deferred<VariantProductList>();
    const trade = deferred<VariantProductList>();
    vi.mocked(getProducts).mockReturnValueOnce(pantry.promise).mockReturnValueOnce(trade.promise);

    const { result, rerender } = renderHook(({ category }) => useProducts({ category }), {
      initialProps: { category: 'Baking & Pantry' },
    });

    await act(async () => {
      pantry.resolve(response('Pantry Flour'));
      await pantry.promise;
    });
    expect(result.current.products[0]?.name).toBe('Pantry Flour');

    rerender({ category: 'Trade & Creative Materials' });
    await waitFor(() => expect(getProducts).toHaveBeenCalledTimes(2));
    expect(vi.mocked(getProducts).mock.calls[1]?.[0]).toEqual({
      category: 'Trade & Creative Materials',
    });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.products).toEqual([]);
    expect(result.current.total).toBe(0);

    await act(async () => {
      trade.resolve(response('Trade Cement'));
      await trade.promise;
    });
    expect(result.current.products.map((product) => product.name)).toEqual(['Trade Cement']);
  });

  it('clears current cards before a manual refetch resolves', async () => {
    const initial = deferred<VariantProductList>();
    const refreshed = deferred<VariantProductList>();
    vi.mocked(getProducts)
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(refreshed.promise);

    const { result } = renderHook(() => useProducts({ category: 'Trade & Creative Materials' }));

    await act(async () => {
      initial.resolve(response('Original Cement'));
      await initial.promise;
    });
    expect(result.current.products[0]?.name).toBe('Original Cement');

    await act(async () => {
      void result.current.refetch();
      await Promise.resolve();
    });
    await waitFor(() => expect(getProducts).toHaveBeenCalledTimes(2));
    expect(result.current.isLoading).toBe(true);
    expect(result.current.products).toEqual([]);
    expect(result.current.total).toBe(0);

    await act(async () => {
      refreshed.resolve(response('Refreshed Cement'));
      await refreshed.promise;
    });
    expect(result.current.products[0]?.name).toBe('Refreshed Cement');
  });
});
