import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CuratedBundle } from '@shop/contracts/bundles';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BundlesPage } from './BundlesPage';

const hooks = vi.hoisted(() => ({
  useBundles: vi.fn(),
  useCartContext: vi.fn(),
}));

vi.mock('@/hooks/useBundles', () => ({ useBundles: hooks.useBundles }));
vi.mock('@/hooks/CartContext', () => ({ useCartContext: hooks.useCartContext }));

const bundle: CuratedBundle = {
  id: '1',
  key: 'starter',
  name: 'Starter set',
  description: 'Three fixed powder selections.',
  components: [
    { product: product('1'), quantity: 1, lineTotalCents: 1000 },
    { product: product('2'), quantity: 1, lineTotalCents: 1000 },
  ],
  totalCents: 2000,
  available: true,
};

function product(id: string) {
  return {
    id,
    name: `Powder ${id}`,
    description: '',
    priceCents: 1000,
    imageSetId: id,
    category: 'Pantry',
    stock: 5,
    slug: id,
    salesCount: 0,
    createdAt: '2026-07-14T00:00:00.000Z',
    available: true,
    availability: 'in_stock' as const,
    backorderable: false,
    backorderLeadDays: null,
    tags: [],
    specificationGroups: [],
  };
}

function renderPage() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <BundlesPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  hooks.useCartContext.mockReturnValue({
    addBundle: vi.fn(),
    error: null,
    isActionPending: () => false,
    isCartAvailable: true,
  });
});

describe('BundlesPage', () => {
  it('shows loading and failure states, and retries a failed load', async () => {
    const user = userEvent.setup();
    hooks.useBundles.mockReturnValue({
      bundles: [],
      error: null,
      isLoading: true,
      refetch: vi.fn(),
    });
    const { rerender } = renderPage();
    expect(document.querySelector('[class*="animate-spin"]')).toBeInTheDocument();

    const refetch = vi.fn();
    hooks.useBundles.mockReturnValue({
      bundles: [],
      error: 'Bundles unavailable',
      isLoading: false,
      refetch,
    });
    rerender(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <BundlesPage />
      </MemoryRouter>,
    );
    expect(screen.getByText('Bundles unavailable')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('shows an accessible page heading and an empty state', () => {
    hooks.useBundles.mockReturnValue({
      bundles: [],
      error: null,
      isLoading: false,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByRole('heading', { name: 'Bundle sets' })).toBeInTheDocument();
    expect(screen.getByText('No bundles are available right now.')).toBeInTheDocument();
  });

  it('renders available bundles and delegates a successful add to cart context', async () => {
    const user = userEvent.setup();
    const addBundle = vi.fn();
    hooks.useCartContext.mockReturnValue({
      addBundle,
      error: null,
      isActionPending: () => false,
      isCartAvailable: true,
    });
    hooks.useBundles.mockReturnValue({
      bundles: [bundle],
      error: null,
      isLoading: false,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByRole('heading', { name: 'Starter set' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add bundle' }));
    expect(addBundle).toHaveBeenCalledWith('1');
  });
});
