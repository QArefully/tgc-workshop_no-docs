import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { Product } from '@shop/contracts/products';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SimilarProductsSection } from './SimilarProductsSection';

const productsApi = vi.hoisted(() => ({ getSimilarProducts: vi.fn() }));

vi.mock('@/api/products', () => productsApi);
vi.mock('@/components/SaveToListButton', () => ({
  SaveToListButton: () => <button type="button">Save to list</button>,
}));

const product = (id: string, overrides: Partial<Product> = {}): Product => ({
  id,
  name: `Powder ${id}`,
  description: 'A powder.',
  priceCents: 1200,
  imageSetId: 'unknown',
  category: 'Test',
  stock: 8,
  slug: `powder-${id}`,
  salesCount: 0,
  createdAt: '2026-07-14T00:00:00.000Z',
  available: true,
  tags: [],
  specificationGroups: [],
  ...overrides,
  availability: overrides.availability ?? 'in_stock',
  backorderable: overrides.backorderable ?? false,
  backorderLeadDays: overrides.backorderLeadDays ?? null,
});

function renderSection(productId = 'source') {
  const cart = { onAddToCart: vi.fn().mockResolvedValue(true), isAdding: vi.fn(() => false) };
  const view = render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <SimilarProductsSection
        productId={productId}
        isCartAvailable
        isAdding={cart.isAdding}
        onAddToCart={cart.onAddToCart}
      />
    </MemoryRouter>,
  );
  return { ...view, cart };
}

function deferred<T>() {
  let resolve: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve: resolve! };
}

describe('SimilarProductsSection', () => {
  afterEach(() => vi.clearAllMocks());

  it('shows an isolated loading state, then preserves the ranked API order', async () => {
    const response = deferred<Product[]>();
    productsApi.getSimilarProducts.mockReturnValueOnce(response.promise);

    renderSection();
    expect(screen.getByRole('heading', { name: 'Similar materials' })).toBeInTheDocument();
    expect(screen.getByText('Finding similar materials...')).toBeInTheDocument();

    response.resolve([product('third'), product('first')]);
    const cards = await screen.findAllByRole('heading', { level: 3 });
    expect(cards.map((card) => card.textContent)).toEqual(['Powder third', 'Powder first']);
    expect(screen.getByRole('link', { name: 'Browse all materials' })).toHaveAttribute(
      'href',
      '/catalog',
    );
  });

  it('renders an explicit section-local empty state', async () => {
    productsApi.getSimilarProducts.mockResolvedValueOnce([]);
    renderSection();

    expect(await screen.findByRole('heading', { name: 'Similar materials' })).toBeInTheDocument();
    expect(screen.getByText('No similar materials available right now.')).toBeInTheDocument();
  });

  it('keeps failures section-local and retries the request', async () => {
    const user = userEvent.setup();
    productsApi.getSimilarProducts
      .mockRejectedValueOnce(new Error('Network unavailable'))
      .mockResolvedValueOnce([product('retry')]);
    renderSection();

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load similar materials.');
    expect(screen.getByRole('heading', { name: 'Similar materials' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Powder retry' })).toBeInTheDocument();
    expect(productsApi.getSimilarProducts).toHaveBeenCalledTimes(2);
  });

  it('aborts the stale request when the source changes', async () => {
    const first = deferred<Product[]>();
    const second = deferred<Product[]>();
    productsApi.getSimilarProducts
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { rerender } = renderSection('one');

    const firstCall = productsApi.getSimilarProducts.mock.calls[0];
    expect(firstCall).toBeDefined();
    const firstSignal = firstCall![1] as AbortSignal;
    rerender(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <SimilarProductsSection
          productId="two"
          isCartAvailable
          isAdding={() => false}
          onAddToCart={vi.fn().mockResolvedValue(true)}
        />
      </MemoryRouter>,
    );
    expect(firstSignal.aborted).toBe(true);

    first.resolve([product('stale')]);
    second.resolve([product('fresh')]);
    expect(await screen.findByRole('heading', { name: 'Powder fresh' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Powder stale' })).not.toBeInTheDocument();
  });

  it('keeps similar products visible when their cart action fails', async () => {
    const user = userEvent.setup();
    productsApi.getSimilarProducts.mockResolvedValueOnce([product('cart-failure')]);
    const cart = {
      onAddToCart: vi.fn().mockResolvedValue(false),
      isAdding: vi.fn(() => false),
    };
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <SimilarProductsSection
          productId="source"
          isCartAvailable
          isAdding={cart.isAdding}
          onAddToCart={cart.onAddToCart}
        />
      </MemoryRouter>,
    );

    await screen.findByRole('heading', { name: 'Powder cart-failure' });
    await user.click(screen.getByRole('button', { name: 'Add to order' }));

    expect(cart.onAddToCart).toHaveBeenCalledWith('cart-failure', undefined);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not add this item. Try again.',
    );
    expect(screen.getByRole('heading', { name: 'Powder cart-failure' })).toBeInTheDocument();
  });
});
