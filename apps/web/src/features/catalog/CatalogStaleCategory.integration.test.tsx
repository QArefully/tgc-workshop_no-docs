import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { CategoryFacts } from '@shop/contracts/products';
import type { VariantProductList } from '@/api/products';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCategories, getProductFilterOptions, getProducts } from '@/api/products';
import { ComparisonSelectionProvider } from '@/features/comparison/ComparisonSelectionContext';
import { CatalogPage } from './CatalogPage';

vi.mock('@/api/products', () => ({
  getCategories: vi.fn(),
  getProductFilterOptions: vi.fn(),
  getProducts: vi.fn(),
}));
vi.mock('@/hooks/CartContext', () => ({
  useCartContext: () => ({
    error: null,
    addItem: vi.fn().mockResolvedValue(true),
    retryCart: vi.fn().mockResolvedValue(true),
    isCartAvailable: true,
    isActionPending: () => false,
  }),
}));
vi.mock('@/components/SaveToListButton', () => ({
  SaveToListButton: () => <button type="button">Save to list</button>,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

const facts: CategoryFacts = {
  texture: 'Fine',
  colour: 'White',
  source: 'Test source',
  intendedUse: 'Testing',
  storage: 'Dry cool',
  consumptionClassification: 'non-food',
};

function response(name: string, category: string): VariantProductList {
  return {
    items: [
      {
        id: name,
        name,
        description: `${name} description`,
        priceCents: 1000,
        imageSetId: 'powdered-water',
        category,
        stock: 1,
        slug: name.toLowerCase().replaceAll(' ', '-'),
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
        categoryFacts: facts,
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

function Location() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

describe('catalog category transitions', () => {
  beforeEach(() => {
    vi.mocked(getCategories).mockResolvedValue(['Baking & Pantry', 'Trade & Creative Materials']);
    vi.mocked(getProductFilterOptions).mockResolvedValue({ tags: [], specificationGroups: [] });
    vi.mocked(getProducts).mockReset();
  });

  it('uses the decoded Trade category request and hides prior cards while it is pending', async () => {
    const baking = deferred<VariantProductList>();
    const trade = deferred<VariantProductList>();
    vi.mocked(getProducts).mockReturnValueOnce(baking.promise).mockReturnValueOnce(trade.promise);
    const user = userEvent.setup();

    render(
      <MemoryRouter
        initialEntries={['/catalog?category=Baking+%26+Pantry']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <ComparisonSelectionProvider
          storage={{ getItem: () => null, setItem: () => undefined, removeItem: () => undefined }}
        >
          <Location />
          <Routes>
            <Route path="/catalog" element={<CatalogPage />} />
          </Routes>
        </ComparisonSelectionProvider>
      </MemoryRouter>,
    );

    await act(async () => {
      baking.resolve(response('Baking Flour', 'Baking & Pantry'));
      await baking.promise;
    });
    expect(await screen.findByRole('heading', { name: 'Baking Flour' })).toBeVisible();

    await user.click(await screen.findByRole('radio', { name: 'Trade & Creative Materials' }));
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/catalog?category=Trade+%26+Creative+Materials',
    );
    await waitFor(() => expect(getProducts).toHaveBeenCalledTimes(2));
    expect(vi.mocked(getProducts).mock.calls[1]?.[0]).toMatchObject({
      category: 'Trade & Creative Materials',
    });
    expect(screen.queryByRole('heading', { name: 'Baking Flour' })).not.toBeInTheDocument();

    await act(async () => {
      trade.resolve(response('Trade Cement', 'Trade & Creative Materials'));
      await trade.promise;
    });
    expect(await screen.findByRole('heading', { name: 'Trade Cement' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Baking Flour' })).not.toBeInTheDocument();
  });
});
