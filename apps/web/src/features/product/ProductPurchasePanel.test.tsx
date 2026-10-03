import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ProductWithVariants, CatalogVariant, CategoryFacts } from '@shop/contracts/products';
import type { PublicUser } from '@shop/contracts/auth';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ProductPurchasePanel } from './ProductPurchasePanel';
import {
  ComparisonSelectionProvider,
  useComparisonSelection,
} from '@/features/comparison/ComparisonSelectionContext';

const authState = vi.hoisted(() => ({ user: null as PublicUser | null }));
const comparisonStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

vi.mock('@/hooks/AuthContext', () => ({
  useAuth: () => ({ user: authState.user }),
}));

const backInStockState = vi.hoisted(() => ({ subscribe: vi.fn() }));
vi.mock('@/hooks/useBackInStock', () => ({
  useBackInStock: () => ({
    subscriptions: [],
    pendingVariantIds: new Set<number>(),
    loading: false,
    error: null,
    refresh: vi.fn(),
    subscribe: backInStockState.subscribe,
    cancel: vi.fn(),
  }),
}));

vi.mock('@/features/savedLists/AddToListMenu', () => ({
  AddToListMenu: ({ variantId, quantity }: { variantId?: number; quantity?: number }) => (
    <button
      type="button"
      aria-label="Save to list"
      data-variant-id={variantId}
      data-quantity={quantity}
    />
  ),
}));

const defaultVariant: CatalogVariant = {
  variantId: 1,
  productId: 1,
  sku: 'PW-001',
  label: '25 kg Sack',
  weightGrams: 25_000,
  priceCents: 12999,
  moqSacks: 4,
  perTonneCents: 43330,
  priceTiers: [
    { minTonnes: 1, discountPct: 0 },
    { minTonnes: 5, discountPct: 5 },
  ],
  compareAtPriceCents: 16999,
  stockCount: 8,
  backorderable: false,
  backorderLeadDays: null,
  deliveryClass: 'parcel',
  active: true,
  sortOrder: 1,
};

const defaultFacts: CategoryFacts = {
  texture: 'Fine',
  colour: 'White',
  source: 'Test',
  intendedUse: 'Testing',
  storage: 'Dry',
  consumptionClassification: 'non-food',
};

const product = (overrides: Partial<ProductWithVariants> = {}): ProductWithVariants => ({
  id: 'powdered-water',
  name: 'Powdered Water',
  description: 'Just-add-water water powder, 300g. Dry until required.',
  priceCents: 12999,
  compareAtPriceCents: 16999,
  imageSetId: 'powdered-water',
  packaging: {
    labelColor: '#287fa6',
    powderColor: '#b9e2ee',
    mark: 'H2O',
    batchCode: 'IMP-07',
    quantity: '300g',
    consumptionLabel: 'Not for consumption',
  },
  category: 'Impossible',
  stock: 8,
  availability: 'in_stock',
  backorderable: false,
  backorderLeadDays: null,
  slug: 'powdered-water',
  salesCount: 12,
  ...overrides,
  createdAt: overrides.createdAt ?? '2026-07-14T00:00:00.000Z',
  available: overrides.available ?? true,
  tags: overrides.tags ?? [],
  specificationGroups: overrides.specificationGroups ?? [],
  variants: overrides.variants ?? [{ ...defaultVariant }],
  defaultVariantId: overrides.defaultVariantId ?? 1,
  categoryFacts: overrides.categoryFacts ?? defaultFacts,
  consumptionClassification: overrides.consumptionClassification ?? 'non-food',
  mixingGroup: overrides.mixingGroup ?? null,
  priceRange: overrides.priceRange ?? { min: 12999, max: 12999 },
  baseAvailability: overrides.baseAvailability ?? 'in_stock',
});

function renderPanel(overrides: Partial<ComponentProps<typeof ProductPurchasePanel>> = {}) {
  const onAddToCart = vi.fn(async () => {});
  const onRetryCart = vi.fn();
  const result = render(
    <MemoryRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      initialEntries={['/products/powdered-water']}
    >
      <ComparisonSelectionProvider storage={comparisonStorage}>
        <Routes>
          <Route
            path="*"
            element={
              <ProductPurchasePanel
                product={product()}
                isCartAvailable
                isAdding={false}
                actionError={null}
                cartError={null}
                onAddToCart={onAddToCart}
                onRetryCart={onRetryCart}
                {...overrides}
              />
            }
          />
        </Routes>
      </ComparisonSelectionProvider>
    </MemoryRouter>,
  );
  return { ...result, onAddToCart, onRetryCart };
}

function ComparisonPath() {
  const { comparePath } = useComparisonSelection();
  return <output data-testid="compare-path">{comparePath ?? ''}</output>;
}

function ComparisonCompleter() {
  const { toggle } = useComparisonSelection();
  return (
    <button type="button" onClick={() => toggle('2')}>
      Add catalog comparison item
    </button>
  );
}

describe('ProductPurchasePanel', () => {
  it('renders sale savings and requires variant selection before add', async () => {
    const user = userEvent.setup();
    const onAddToCart = vi.fn(async () => {});
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ComparisonSelectionProvider storage={comparisonStorage}>
          <ProductPurchasePanel
            product={product()}
            isCartAvailable
            isAdding={false}
            actionError={null}
            cartError={null}
            onAddToCart={onAddToCart}
            onRetryCart={() => {}}
          />
        </ComparisonSelectionProvider>
      </MemoryRouter>,
    );

    expect(screen.getAllByText('Sale').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Not for consumption').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('300g')).toBeInTheDocument();
    expect(screen.getByText('Material · Impossible')).toBeInTheDocument();

    const addButton = screen.getByRole('button', { name: 'Choose a bag option' });
    expect(addButton).toBeDisabled();
    await user.click(addButton);
    expect(onAddToCart).not.toHaveBeenCalled();

    const variantRadio = screen.getByRole('radio');
    await user.click(variantRadio);
    expect(screen.getByRole('button', { name: 'Add to order' })).toBeEnabled();
    await user.clear(screen.getByLabelText('Order quantity (25 kg Sack)'));
    await user.type(screen.getByLabelText('Order quantity (25 kg Sack)'), '6');

    await user.click(screen.getByRole('button', { name: 'Add to order' }));
    expect(onAddToCart).toHaveBeenCalledWith(1, 6);
  });

  it('renders regular price without sale metadata', () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ComparisonSelectionProvider storage={comparisonStorage}>
          <ProductPurchasePanel
            product={product({
              compareAtPriceCents: undefined,
              priceRange: { min: 12999, max: 12999 },
              variants: [{ ...defaultVariant, compareAtPriceCents: undefined }],
            })}
            isCartAvailable
            isAdding={false}
            actionError={null}
            cartError={null}
            onAddToCart={async () => {}}
            onRetryCart={() => {}}
          />
        </ComparisonSelectionProvider>
      </MemoryRouter>,
    );
    expect(screen.queryByText('Sale')).not.toBeInTheDocument();
  });

  it('renders an API-supplied clearance price, list price, and end date', async () => {
    const user = userEvent.setup();
    renderPanel({
      product: product({
        variants: [
          {
            ...defaultVariant,
            clearance: {
              priceCents: 9999,
              perTonneCents: 399960,
              startsAt: '2026-07-01T00:00:00.000Z',
              endsAt: '2026-08-01T00:00:00.000Z',
            },
          },
        ],
      }),
    });

    await user.click(screen.getByRole('radio', { name: /25 kg Sack/i }));

    expect(screen.getAllByText('Clearance price $124.99').length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText('Clearance ends 7/31/26').length).toBeGreaterThan(0);
    expect(
      screen.getAllByText('$162.49').some((element) => element.classList.contains('line-through')),
    ).toBe(true);
  });

  it('blocks below-MOQ sack quantities before sending an add request', async () => {
    const user = userEvent.setup();
    const { onAddToCart } = renderPanel();

    await user.click(screen.getByRole('radio', { name: /25 kg Sack/i }));
    const quantity = screen.getByLabelText('Order quantity (25 kg Sack)');
    await user.clear(quantity);
    await user.type(quantity, '1');

    expect(quantity).toHaveAttribute('aria-invalid', 'true');
    await user.click(screen.getByRole('button', { name: 'Add to order' }));

    expect(onAddToCart).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Minimum order is 4 × 25 kg Sack.');
  });

  it('disables unavailable purchases and exposes pending and cart retry states', async () => {
    const user = userEvent.setup();
    const onAddToCart = vi.fn(async () => {});
    const onRetryCart = vi.fn();
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ComparisonSelectionProvider storage={comparisonStorage}>
          <ProductPurchasePanel
            product={product({
              stock: 0,
              availability: 'out_of_stock',
              baseAvailability: 'out_of_stock',
              variants: [{ ...defaultVariant, stockCount: 0, active: false }],
            })}
            isCartAvailable
            isAdding={false}
            actionError={null}
            cartError="Unable to reach cart"
            onAddToCart={onAddToCart}
            onRetryCart={onRetryCart}
          />
        </ComparisonSelectionProvider>
      </MemoryRouter>,
    );

    const addButton = screen.getByRole('button', { name: 'Unavailable' });
    expect(addButton).toBeDisabled();
    await user.click(addButton);
    expect(onAddToCart).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Retry cart' }));
    expect(onRetryCart).toHaveBeenCalledOnce();

    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ComparisonSelectionProvider storage={comparisonStorage}>
          <ProductPurchasePanel
            product={product()}
            isCartAvailable
            isAdding
            actionError={null}
            cartError={null}
            onAddToCart={async () => {}}
            onRetryCart={() => {}}
          />
        </ComparisonSelectionProvider>
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: 'Adding…' })).toBeDisabled();
  });

  it('keeps a backorderable product purchasable without promising an arrival date', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ComparisonSelectionProvider storage={comparisonStorage}>
          <ProductPurchasePanel
            product={product({
              stock: 0,
              availability: 'backorder',
              backorderable: true,
              backorderLeadDays: 14,
              baseAvailability: 'backorder',
              variants: [
                {
                  ...defaultVariant,
                  stockCount: 0,
                  backorderable: true,
                  backorderLeadDays: 14,
                },
              ],
            })}
            isCartAvailable
            isAdding={false}
            actionError={null}
            cartError={null}
            onAddToCart={async () => {}}
            onRetryCart={() => {}}
          />
        </ComparisonSelectionProvider>
      </MemoryRouter>,
    );

    expect(screen.getByText('Available to backorder')).toBeInTheDocument();
    await user.click(screen.getByRole('radio'));
    expect(screen.getByRole('button', { name: 'Add to order' })).toBeEnabled();
  });

  it('passes the selected variant and entered quantity to the list action', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('radio'));
    await user.clear(screen.getByLabelText(/order quantity/i));
    await user.type(screen.getByLabelText(/order quantity/i), '7');
    expect(screen.getByRole('button', { name: 'Save to list' })).toHaveAttribute(
      'data-variant-id',
      '1',
    );
    expect(screen.getByRole('button', { name: 'Save to list' })).toHaveAttribute(
      'data-quantity',
      '7',
    );
  });

  it('adds a secondary comparison action without changing cart availability', async () => {
    const user = userEvent.setup();
    const onAddToCart = vi.fn(async () => {});
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ComparisonSelectionProvider storage={comparisonStorage}>
          <ProductPurchasePanel
            product={product({ id: '1' })}
            isCartAvailable
            isAdding={false}
            actionError={null}
            cartError={null}
            onAddToCart={onAddToCart}
            onRetryCart={() => {}}
          />
          <ComparisonPath />
          <ComparisonCompleter />
        </ComparisonSelectionProvider>
      </MemoryRouter>,
    );

    const compare = screen.getByRole('button', { name: 'Compare Powdered Water' });
    expect(compare).toHaveAttribute('aria-pressed', 'false');
    // Button should be disabled until variant selected
    expect(screen.getByRole('button', { name: 'Choose a bag option' })).toBeDisabled();

    await user.click(compare);
    expect(compare).toHaveAttribute('aria-pressed', 'true');
    expect(onAddToCart).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Add catalog comparison item' }));
    expect(screen.getByTestId('compare-path')).toHaveTextContent('/compare?ids=1,2');
  });

  it('shows variant details when selected including price, SKU, and stock', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ComparisonSelectionProvider storage={comparisonStorage}>
          <ProductPurchasePanel
            product={product()}
            isCartAvailable
            isAdding={false}
            actionError={null}
            cartError={null}
            onAddToCart={async () => {}}
            onRetryCart={() => {}}
          />
        </ComparisonSelectionProvider>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('radio'));
    expect(screen.getAllByText(/SKU: PW-001/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('8 pallets available')).toBeInTheDocument();
    expect(screen.getAllByText('$162.49').length).toBeGreaterThanOrEqual(1);
  });

  it('renders API-supplied pack, tonne, MOQ, tier, and freight details', async () => {
    const user = userEvent.setup();
    renderPanel({
      product: product({
        variants: [
          {
            ...defaultVariant,
            label: '1,000 kg Pallet',
            weightGrams: 1_000_000,
            priceCents: 410000,
            perTonneCents: 410000,
            deliveryClass: 'freight',
            backorderable: true,
            stockCount: 0,
            backorderLeadDays: 7,
          },
        ],
      }),
    });

    await user.click(screen.getByRole('radio', { name: /1,000 kg Pallet/i }));
    expect(screen.getAllByText('Pack price $5,125.00').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('$5,125.00 / tonne')).toBeInTheDocument();
    expect(screen.getByText('Minimum order: 1 × 1,000 kg Pallet.')).toBeInTheDocument();
    expect(screen.getByText('Total weight')).toBeInTheDocument();
    expect(screen.getByLabelText('Volume pricing')).toHaveTextContent('5 tonnes: 5% off');
    expect(screen.getAllByText(/Pallet freight.*lead time 7 days/i).length).toBeGreaterThanOrEqual(
      1,
    );
  });

  it('surfaces a server minimum-order error', () => {
    renderPanel({
      belowMoqError: 'Quantity does not meet this variant minimum order quantity.',
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Quantity does not meet this variant minimum order quantity.',
    );
  });

  it('offers the waiting list only for the selected sold-out, non-backorderable variant', async () => {
    const user = userEvent.setup();
    const notify = 'Notify me when this is back in stock';
    renderPanel({
      product: product({
        stock: 0,
        availability: 'out_of_stock',
        baseAvailability: 'out_of_stock',
        variants: [
          { ...defaultVariant, variantId: 1, label: 'Sold out sack', stockCount: 0 },
          {
            ...defaultVariant,
            variantId: 2,
            label: 'Backorder pallet',
            stockCount: 0,
            backorderable: true,
            backorderLeadDays: 14,
          },
          { ...defaultVariant, variantId: 3, label: 'Stocked sack', stockCount: 8 },
        ],
      }),
    });

    expect(screen.queryByRole('button', { name: notify })).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /Sold out sack/i }));
    expect(screen.getByRole('button', { name: notify })).toBeEnabled();

    await user.click(screen.getByRole('radio', { name: /Backorder pallet/i }));
    expect(screen.queryByRole('button', { name: notify })).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /Stocked sack/i }));
    expect(screen.queryByRole('button', { name: notify })).not.toBeInTheDocument();
  });

  it('derives MOQ units from the shared sack-weight floor for sacks and pallets', async () => {
    const user = userEvent.setup();
    renderPanel({
      product: product({
        variants: [
          { ...defaultVariant, label: '25 kg Sack', weightGrams: 25_000 },
          {
            ...defaultVariant,
            variantId: 2,
            label: '1,000 kg Pallet',
            weightGrams: 1_000_000,
            priceCents: 410000,
            perTonneCents: 410000,
          },
        ],
      }),
    });

    await user.click(screen.getByRole('radio', { name: /25 kg Sack/i }));
    expect(screen.getByLabelText('Order quantity (25 kg Sack)')).toHaveValue(4);
    expect(screen.getByLabelText('Order quantity (25 kg Sack)')).toHaveAttribute('min', '4');
    expect(screen.getByText('Minimum order: 4 × 25 kg Sack.')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /1,000 kg Pallet/i }));
    expect(screen.getByLabelText('Order quantity (1,000 kg Pallet)')).toHaveValue(1);
    expect(screen.getByLabelText('Order quantity (1,000 kg Pallet)')).toHaveAttribute('min', '1');
    expect(screen.getByText('Minimum order: 1 × 1,000 kg Pallet.')).toBeInTheDocument();
  });
});
