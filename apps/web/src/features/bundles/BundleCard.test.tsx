import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CuratedBundle } from '@shop/contracts/bundles';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { BundleCard } from './BundleCard';

const bundle: CuratedBundle = {
  id: '1',
  key: 'starter',
  name: 'Starter set',
  description: 'Three fixed powder selections.',
  components: [
    { product: product('1', 'Protein Powder'), quantity: 1, lineTotalCents: 1000 },
    { product: product('2', 'Powdered Oats'), quantity: 2, lineTotalCents: 4000 },
  ],
  totalCents: 5000,
  available: true,
};

function product(id: string, name: string) {
  return {
    id,
    name,
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

function renderCard(overrides: Partial<React.ComponentProps<typeof BundleCard>> = {}) {
  const onAdd = overrides.onAdd ?? vi.fn();
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <BundleCard bundle={bundle} isCartAvailable isAdding={false} onAdd={onAdd} {...overrides} />
    </MemoryRouter>,
  );
  return onAdd;
}

describe('BundleCard', () => {
  it('shows current total, component quantities, and product links', () => {
    renderCard();
    expect(screen.getByRole('heading', { name: 'Starter set', level: 2 })).toBeInTheDocument();
    expect(screen.getByText('$62.50')).toBeInTheDocument();
    expect(screen.getByText('×2')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Protein Powder' })).toHaveAttribute(
      'href',
      '/products/1',
    );
  });

  it('supports a nested card heading for a parent section', () => {
    renderCard({ headingLevel: 3 });
    expect(screen.getByRole('heading', { name: 'Starter set', level: 3 })).toBeInTheDocument();
  });

  it('disables unavailable bundles and prevents duplicate pending adds', () => {
    const { rerender } = render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <BundleCard
          bundle={{ ...bundle, available: false }}
          isCartAvailable
          isAdding={false}
          onAdd={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: 'Add bundle' })).toBeDisabled();
    expect(screen.getByText('This bundle is currently unavailable.')).toBeInTheDocument();

    rerender(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <BundleCard bundle={bundle} isCartAvailable isAdding onAdd={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: 'Adding…' })).toBeDisabled();
    expect(screen.getByText('Adding Starter set to cart')).toBeInTheDocument();
  });

  it('adds only after an explicit button action', async () => {
    const user = userEvent.setup();
    const onAdd = renderCard();
    await user.click(screen.getByRole('button', { name: 'Add bundle' }));
    expect(onAdd).toHaveBeenCalledWith('1');
  });
});
