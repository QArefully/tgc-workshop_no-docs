import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CuratedBundle } from '@shop/contracts/bundles';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductBundlesSection } from './ProductBundlesSection';

const hooks = vi.hoisted(() => ({
  useBundles: vi.fn(),
  useCartContext: vi.fn(),
}));

vi.mock('@/hooks/useBundles', () => ({ useBundles: hooks.useBundles }));
vi.mock('@/hooks/CartContext', () => ({ useCartContext: hooks.useCartContext }));

const bundle: CuratedBundle = {
  id: 'starter',
  key: 'starter',
  name: 'Starter set',
  description: 'Fixed powder selection.',
  components: [{ product: product('1', 'Protein Powder'), quantity: 2, lineTotalCents: 5000 }],
  totalCents: 5000,
  available: true,
};

function product(id: string, name: string) {
  return {
    id,
    name,
    description: '',
    priceCents: 2500,
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

function renderSection(productId = 'product-1') {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ProductBundlesSection productId={productId} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  hooks.useBundles.mockReturnValue({
    bundles: [],
    error: null,
    isLoading: false,
    refetch: vi.fn(),
  });
  hooks.useCartContext.mockReturnValue({
    addBundle: vi.fn().mockResolvedValue(true),
    isActionPending: () => false,
    isCartAvailable: true,
  });
});

describe('ProductBundlesSection', () => {
  it('loads bundles for its product only', () => {
    renderSection('42');
    expect(hooks.useBundles).toHaveBeenCalledWith('42');
  });

  it('keeps loading, empty, failure, and retry states inside section', async () => {
    const user = userEvent.setup();
    hooks.useBundles.mockReturnValue({
      bundles: [],
      error: null,
      isLoading: true,
      refetch: vi.fn(),
    });
    const { rerender } = renderSection();
    expect(screen.getByRole('heading', { name: 'Complete your selection' })).toBeInTheDocument();
    expect(document.querySelector('[class*="animate-spin"]')).toBeInTheDocument();

    hooks.useBundles.mockReturnValue({
      bundles: [],
      error: null,
      isLoading: false,
      refetch: vi.fn(),
    });
    rerender(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ProductBundlesSection productId="product-1" />
      </MemoryRouter>,
    );
    expect(
      screen.getByText('No curated bundles are available for this product right now.'),
    ).toBeInTheDocument();

    const refetch = vi.fn();
    hooks.useBundles.mockReturnValue({
      bundles: [],
      error: 'Bundles unavailable',
      isLoading: false,
      refetch,
    });
    rerender(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ProductBundlesSection productId="product-1" />
      </MemoryRouter>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Bundles unavailable');
    await user.click(screen.getByRole('button', { name: 'Retry bundles' }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('renders server totals and component product links', () => {
    hooks.useBundles.mockReturnValue({
      bundles: [bundle],
      error: null,
      isLoading: false,
      refetch: vi.fn(),
    });
    renderSection();
    expect(screen.getByText('$62.50')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Protein Powder' })).toHaveAttribute(
      'href',
      '/products/1',
    );
  });

  it('delegates one atomic bundle add and scopes its failure to that bundle', async () => {
    const user = userEvent.setup();
    const addBundle = vi.fn().mockResolvedValue(false);
    hooks.useCartContext.mockReturnValue({
      addBundle,
      isActionPending: () => false,
      isCartAvailable: true,
    });
    hooks.useBundles.mockReturnValue({
      bundles: [bundle, { ...bundle, id: 'other', name: 'Other set' }],
      error: null,
      isLoading: false,
      refetch: vi.fn(),
    });
    renderSection();

    await user.click(screen.getAllByRole('button', { name: 'Add bundle' })[0]!);
    expect(addBundle).toHaveBeenCalledTimes(1);
    expect(addBundle).toHaveBeenCalledWith('starter');
    expect(screen.getByRole('alert')).toHaveTextContent('Could not add this bundle. Try again.');
    expect(
      screen.getByRole('heading', { name: 'Other set' }).closest('article'),
    ).not.toHaveTextContent('Could not add this bundle. Try again.');
  });

  it('disables unavailable bundles', () => {
    hooks.useBundles.mockReturnValue({
      bundles: [{ ...bundle, available: false }],
      error: null,
      isLoading: false,
      refetch: vi.fn(),
    });
    renderSection();
    expect(screen.getByRole('button', { name: 'Add bundle' })).toBeDisabled();
  });
});
