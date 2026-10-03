import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { Product, ProductComparisonResponse } from '@shop/contracts/products';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ComparisonPage } from './ComparisonPage';
import { ComparisonSelectionProvider, useComparisonSelection } from './ComparisonSelectionContext';

const api = vi.hoisted(() => ({ getProductComparison: vi.fn() }));
const countryState = vi.hoisted(() => ({ activeCountry: 'US' }));
vi.mock('@/api/products', () => api);
vi.mock('@/hooks/CountryContext', () => ({
  useOptionalCountry: () => ({ activeCountry: countryState.activeCountry }),
  useCountry: () => ({ activeCountry: countryState.activeCountry }),
}));

function product(id: string, name = `Powder ${id}`): Product {
  return {
    id,
    name,
    description: '',
    priceCents: 1000,
    imageSetId: 'none',
    category: 'Cooking',
    stock: 1,
    slug: id,
    salesCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    available: true,
    availability: 'in_stock',
    backorderable: false,
    backorderLeadDays: null,
    tags: [],
    specificationGroups: [],
  };
}

function response(...products: Product[]): ProductComparisonResponse {
  return {
    items: products.map((item) => ({ id: item.id, status: 'available' as const, product: item })),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function Location() {
  return <output data-testid="location">{useLocation().search}</output>;
}

function Selection() {
  const { selectedIds } = useComparisonSelection();
  return <output data-testid="selection">{selectedIds.join(',')}</output>;
}

function page(path: string) {
  return (
    <MemoryRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      initialEntries={[path]}
    >
      <Routes>
        <Route
          path="/compare"
          element={
            <ComparisonSelectionProvider>
              <ComparisonPage />
              <Location />
              <Selection />
            </ComparisonSelectionProvider>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

function renderPage(path: string) {
  return render(page(path));
}

describe('ComparisonPage', () => {
  beforeEach(() => {
    api.getProductComparison.mockReset();
    countryState.activeCountry = 'US';
    window.localStorage.clear();
  });

  it('loads the direct URL in its supplied order', async () => {
    api.getProductComparison.mockResolvedValueOnce(response(product('3'), product('1')));
    renderPage('/compare?ids=3,1');

    await screen.findByRole('table', { name: /Product specifications comparison/ });
    expect(api.getProductComparison).toHaveBeenCalledWith(['3', '1'], expect.any(AbortSignal));
    const headers = screen.getAllByRole('columnheader').map((header) => header.textContent);
    expect(headers[1]).toContain('Powder 3');
    expect(headers[2]).toContain('Powder 1');
  });

  it('uses a direct URL instead of a stored provider selection and syncs available response order', async () => {
    window.localStorage.setItem('shop.comparison.product-ids.v1', JSON.stringify(['4', '2']));
    api.getProductComparison.mockResolvedValueOnce(response(product('1'), product('3')));
    renderPage('/compare?ids=3,1');

    await screen.findByRole('table');
    expect(api.getProductComparison).toHaveBeenCalledWith(['3', '1'], expect.any(AbortSignal));
    expect(screen.getByTestId('selection')).toHaveTextContent('1,3');
    expect(window.localStorage.getItem('shop.comparison.product-ids.v1')).toBe(
      JSON.stringify(['1', '3']),
    );
  });

  it('restores a valid stored selection only when the URL omits ids', async () => {
    window.localStorage.setItem('shop.comparison.product-ids.v1', JSON.stringify(['2', '1']));
    api.getProductComparison.mockResolvedValueOnce(response(product('2'), product('1')));
    renderPage('/compare');

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('?ids=2%2C1'));
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });

  it('does not request malformed selections', () => {
    renderPage('/compare?ids=1,1');
    expect(
      screen.getByRole('heading', { name: 'That comparison link is invalid' }),
    ).toBeInTheDocument();
    expect(api.getProductComparison).not.toHaveBeenCalled();
  });

  it('reports unavailable entries without rendering a blank comparison column', async () => {
    api.getProductComparison.mockResolvedValueOnce({
      items: [
        { id: '1', status: 'available', product: product('1') },
        { id: '2', status: 'inactive' },
      ],
    } satisfies ProductComparisonResponse);
    renderPage('/compare?ids=1,2');

    expect(await screen.findByText(/Not enough active products/)).toBeInTheDocument();
    expect(screen.getByText(/no longer active/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('reloads for a country switch and ignores the prior-country response', async () => {
    const oldResponse = deferred<ProductComparisonResponse>();
    const currentResponse = deferred<ProductComparisonResponse>();
    api.getProductComparison
      .mockReturnValueOnce(oldResponse.promise)
      .mockReturnValueOnce(currentResponse.promise);
    const view = renderPage('/compare?ids=1,2');

    await waitFor(() => expect(api.getProductComparison).toHaveBeenCalledOnce());
    const oldSignal = api.getProductComparison.mock.calls[0]?.[1] as AbortSignal | undefined;

    countryState.activeCountry = 'DE';
    view.rerender(page('/compare?ids=1,2'));
    await waitFor(() => expect(api.getProductComparison).toHaveBeenCalledTimes(2));
    expect(oldSignal?.aborted).toBe(true);

    await act(async () => {
      currentResponse.resolve(response(product('1', 'DE one'), product('2', 'DE two')));
      await currentResponse.promise;
    });
    await act(async () => {
      oldResponse.resolve(response(product('1', 'US one'), product('2', 'US two')));
      await oldResponse.promise;
    });

    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /DE one/ })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /US one/ })).not.toBeInTheDocument();
  });

  it('clears the comparison after a removal leaves fewer than two products', async () => {
    const user = userEvent.setup();
    api.getProductComparison.mockResolvedValueOnce(response(product('1'), product('2')));
    renderPage('/compare?ids=1,2');

    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: 'Remove Powder 1' }));

    expect(
      await screen.findByRole('heading', { name: 'Choose products to compare' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('');
  });
});
