import { render, screen, waitFor } from '@testing-library/react';
import type { Product } from '@shop/contracts/products';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getBestsellers, getCategories, getProducts } from '@/api/products';
import { HomePage, withoutProducts } from './HomePage';

vi.mock('@/api/products', () => ({
  getBestsellers: vi.fn(),
  getCategories: vi.fn(),
  getProducts: vi.fn(),
}));

vi.mock('@/hooks/CartContext', () => ({
  useCartContext: () => ({
    addItem: vi.fn().mockResolvedValue(true),
    isActionPending: () => false,
    isCartAvailable: true,
  }),
}));

vi.mock('@/components/SaveToListButton', () => ({
  SaveToListButton: () => <button type="button" aria-label="Save to default list" />,
}));

function product(id: string): Product {
  return {
    id,
    name: `Product ${id}`,
    description: 'Test product',
    priceCents: 1000,
    imageSetId: 'protein-powder',
    category: 'Sports Nutrition',
    stock: 5,
    slug: `product-${id}`,
    salesCount: 0,
    createdAt: '2026-07-14T00:00:00.000Z',
    available: true,
    availability: 'in_stock',
    backorderable: false,
    backorderLeadDays: null,
    tags: [],
    specificationGroups: [],
  };
}

describe('HomePage', () => {
  beforeEach(() => {
    vi.mocked(getBestsellers).mockReset();
    vi.mocked(getCategories).mockReset();
    vi.mocked(getProducts).mockReset();
  });

  it('keeps store assurances while a failed shelf leaves other content available', async () => {
    vi.mocked(getBestsellers).mockRejectedValue(new Error('Bestsellers unavailable'));
    vi.mocked(getCategories).mockResolvedValue(['Sports Nutrition']);
    vi.mocked(getProducts).mockResolvedValue({
      items: [product('new')],
      total: 1,
      page: 1,
      pageSize: 10,
    });

    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <HomePage />
      </MemoryRouter>,
    );

    expect(screen.getByText('Clear product data')).toBeInTheDocument();
    expect(screen.getByText('Supply-ready catalogue')).toBeInTheDocument();
    expect(screen.getByText('Demo ordering')).toBeInTheDocument();
    expect(screen.getByText('No real payment is processed')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Order a whole set, save 10%.' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Bundle sets: browse curated bundles' }),
    ).toHaveAttribute('href', '/bundles');
    const customBlendBanner = screen.getByRole('heading', {
      name: 'Build material to your spec.',
    });
    expect(
      screen.getByRole('link', { name: 'Custom Blend: configure your blend' }),
    ).toHaveAttribute('href', '/custom-blend');
    expect(screen.getByText('Bestsellers')).toBeInTheDocument();
    expect(customBlendBanner.compareDocumentPosition(screen.getByText('Bestsellers'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(screen.getByText('Just in')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Product new')).toBeInTheDocument());
    expect(screen.getByText('This collection is temporarily unavailable.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /browse the catalog/i })).toHaveAttribute(
      'href',
      '/catalog?sort=bestselling',
    );
  });

  it('removes products already shown in an earlier shelf', () => {
    expect(withoutProducts([product('1'), product('2')], new Set(['1']))).toEqual([product('2')]);
  });
});
