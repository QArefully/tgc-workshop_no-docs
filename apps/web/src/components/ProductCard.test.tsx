import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProductWithVariants, CatalogVariant, CategoryFacts } from '@shop/contracts/products';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { ProductCard } from './ProductCard';
import { ComparisonSelectionProvider } from '@/features/comparison/ComparisonSelectionContext';
import { CompareProductButton } from '@/features/comparison/CompareProductButton';

vi.mock('@/components/SaveToListButton', () => ({
  SaveToListButton: ({ variantId }: { variantId?: number }) => (
    <button type="button" aria-label={`Save variant ${variantId ?? 'none'} to list`} />
  ),
}));

const defaultVariant: CatalogVariant = {
  variantId: 1,
  productId: 1,
  sku: 'PW-001',
  label: '300g Bag',
  weightGrams: 300,
  priceCents: 7999,
  moqSacks: 4,
  perTonneCents: 26_663_333,
  priceTiers: [{ minTonnes: 1, discountPct: 0 }],
  compareAtPriceCents: 9999,
  stockCount: 10,
  backorderable: false,
  backorderLeadDays: null,
  deliveryClass: 'parcel',
  active: true,
  sortOrder: 1,
};

const defaultFacts: CategoryFacts = {
  texture: 'Fine',
  colour: 'Clear',
  source: 'Test source',
  intendedUse: 'Testing',
  storage: 'Cool dry place',
  consumptionClassification: 'non-food',
};

const product = (overrides: Partial<ProductWithVariants> = {}): ProductWithVariants => ({
  id: 'powdered-water-1',
  name: 'Powdered Water',
  description: 'Just-add-water water powder, 300g. Dry until required.',
  priceCents: 7999,
  compareAtPriceCents: 9999,
  imageSetId: 'powdered-water',
  packaging: {
    labelColor: '#287fa6',
    powderColor: '#b9e2ee',
    mark: 'H2O',
    batchCode: 'IMP-07',
    quantity: 'Conceptual quantity',
    consumptionLabel: 'Not for consumption',
  },
  category: 'Impossible',
  stock: 10,
  availability: 'in_stock',
  backorderable: false,
  backorderLeadDays: null,
  slug: 'powdered-water',
  salesCount: 10,
  ...overrides,
  createdAt: overrides.createdAt ?? '2026-07-14T00:00:00.000Z',
  available: overrides.available ?? true,
  tags: overrides.tags ?? [],
  specificationGroups: overrides.specificationGroups ?? [],
  variants: overrides.variants ?? [defaultVariant],
  defaultVariantId: overrides.defaultVariantId ?? 1,
  categoryFacts: overrides.categoryFacts ?? defaultFacts,
  consumptionClassification: overrides.consumptionClassification ?? 'non-food',
  mixingGroup: overrides.mixingGroup ?? null,
  priceRange: overrides.priceRange ?? { min: 7999, max: 7999 },
  baseAvailability: overrides.baseAvailability ?? 'in_stock',
});

function renderCard(
  productOverrides: Partial<ProductWithVariants> = {},
  props: Partial<React.ComponentProps<typeof ProductCard>> = {},
) {
  const onAddToCart = props.onAddToCart ?? vi.fn().mockResolvedValue(true);
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ProductCard
        product={product(productOverrides)}
        onAddToCart={onAddToCart}
        isCartAvailable={true}
        {...props}
      />
    </MemoryRouter>,
  );
  return onAddToCart;
}

describe('ProductCard', () => {
  it('shows sale pricing and suppresses the compare-at price for regular products', () => {
    const { rerender } = render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ProductCard
          product={product()}
          onAddToCart={vi.fn().mockResolvedValue(true)}
          isCartAvailable={true}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('Sale')).toBeInTheDocument();
    expect(screen.getByText('$99.99')).toBeInTheDocument();
    expect(screen.getByText('$124.99')).toBeInTheDocument();

    rerender(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ProductCard
          product={product({
            compareAtPriceCents: undefined,
            priceRange: { min: 7999, max: 7999 },
          })}
          onAddToCart={vi.fn().mockResolvedValue(true)}
          isCartAvailable={true}
        />
      </MemoryRouter>,
    );

    expect(screen.queryByText('Sale')).not.toBeInTheDocument();
    expect(screen.queryByText('$124.99')).not.toBeInTheDocument();
  });

  it('renders the server-resolved clearance badge only when active', () => {
    const { rerender } = render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ProductCard
          product={product({ hasActiveClearance: true })}
          onAddToCart={vi.fn().mockResolvedValue(true)}
          isCartAvailable={true}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('Clearance')).toBeInTheDocument();

    rerender(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ProductCard
          product={product({ hasActiveClearance: false })}
          onAddToCart={vi.fn().mockResolvedValue(true)}
          isCartAvailable={true}
        />
      </MemoryRouter>,
    );

    expect(screen.queryByText('Clearance')).not.toBeInTheDocument();
  });

  it('links image and title to the product while leaving saved-list and cart actions separate', () => {
    renderCard();

    expect(screen.getByRole('link', { name: 'Powdered Water bag' })).toHaveAttribute(
      'href',
      '/products/powdered-water-1',
    );
    expect(screen.getByRole('link', { name: 'Powdered Water' })).toHaveAttribute(
      'href',
      '/products/powdered-water-1',
    );
    expect(screen.getByRole('button', { name: 'Save variant 1 to list' }).closest('a')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add to order' }).closest('a')).toBeNull();
  });

  it('disables purchase for unavailable stock and labels low stock', () => {
    renderCard({
      stock: 0,
      availability: 'out_of_stock',
      baseAvailability: 'out_of_stock',
      variants: [{ ...defaultVariant, stockCount: 0, active: true }],
      priceRange: { min: 7999, max: 7999 },
    });
    expect(screen.getByText('Out of stock')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unavailable' })).toBeDisabled();

    renderCard({
      id: 'low-stock',
      stock: 2,
      variants: [{ ...defaultVariant, stockCount: 2, productId: 0 }],
      baseAvailability: 'low_stock',
      priceRange: { min: 7999, max: 7999 },
    });
    expect(screen.getByText('Only 2 left')).toBeInTheDocument();
  });

  it('keeps backorderable products purchasable without promising a delivery date', () => {
    renderCard({
      stock: 0,
      availability: 'backorder',
      backorderable: true,
      backorderLeadDays: 14,
      baseAvailability: 'backorder',
      variants: [{ ...defaultVariant, stockCount: 0, backorderable: true, backorderLeadDays: 14 }],
      priceRange: { min: 7999, max: 7999 },
    });

    expect(screen.getByText('Available to backorder')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add to order' })).toBeEnabled();
    expect(screen.queryByText(/14 days/i)).not.toBeInTheDocument();
  });

  it('exposes external pending and failed add-to-cart states', async () => {
    const user = userEvent.setup();
    const onAddToCart = renderCard({}, { onAddToCart: vi.fn().mockResolvedValue(false) });

    await user.click(screen.getByRole('button', { name: 'Add to order' }));

    expect(onAddToCart).toHaveBeenCalledWith('powdered-water-1', 1);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not add this item. Try again.',
    );

    renderCard({ id: 'pending-item' }, { isAdding: true });
    expect(screen.getByRole('button', { name: 'Adding...' })).toBeDisabled();
  });

  it('renders comparison control only when supplied', () => {
    const { rerender } = render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ProductCard
          product={product()}
          onAddToCart={vi.fn().mockResolvedValue(true)}
          isCartAvailable={true}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: 'Compare' })).not.toBeInTheDocument();

    rerender(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ProductCard
          product={product()}
          onAddToCart={vi.fn().mockResolvedValue(true)}
          isCartAvailable={true}
          comparisonControl={<button type="button">Compare</button>}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: 'Compare' })).toBeVisible();
  });

  it('does not add an item when its comparison control is clicked', async () => {
    const user = userEvent.setup();
    const onAddToCart = vi.fn().mockResolvedValue(true);
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ComparisonSelectionProvider
          storage={{ getItem: () => null, setItem: () => undefined, removeItem: () => undefined }}
        >
          <ProductCard
            product={product()}
            onAddToCart={onAddToCart}
            isCartAvailable={true}
            comparisonControl={
              <CompareProductButton productId="powdered-water-1" productName="Powdered Water" />
            }
          />
        </ComparisonSelectionProvider>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Compare Powdered Water' }));
    expect(onAddToCart).not.toHaveBeenCalled();
  });
});
