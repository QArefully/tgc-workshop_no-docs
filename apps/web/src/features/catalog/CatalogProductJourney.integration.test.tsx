import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import type { Cart } from '@shop/contracts/cart';
import type { ProductWithVariants, CategoryFacts } from '@shop/contracts/products';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getProduct, getSimilarProducts } from '@/api/products';
import { validatePromo } from '@/api/promo';
import { useAuth } from '@/hooks/AuthContext';
import { useCartContext } from '@/hooks/CartContext';
import { useCategories } from '@/hooks/useCategories';
import { useProductFilterOptions } from '@/hooks/useProductFilterOptions';
import { useProducts } from '@/hooks/useProducts';
import { CatalogPage } from './CatalogPage';
import { ProductPage } from '../product/ProductPage';
import { CartPage } from '../cart/CartPage';
import { CheckoutPage } from '../checkout/CheckoutPage';
import { ComparisonSelectionProvider } from '@/features/comparison/ComparisonSelectionContext';

vi.mock('@/api/products', () => ({
  getProduct: vi.fn(),
  getSimilarProducts: vi.fn(),
}));
vi.mock('@/hooks/useProducts', () => ({ useProducts: vi.fn() }));
vi.mock('@/hooks/useCategories', () => ({ useCategories: vi.fn() }));
vi.mock('@/hooks/useProductFilterOptions', () => ({ useProductFilterOptions: vi.fn() }));
vi.mock('@/hooks/CartContext', () => ({
  useCartContext: vi.fn(),
}));
vi.mock('@/api/promo', () => ({ validatePromo: vi.fn() }));
vi.mock('@/hooks/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/api/deliverySlots', () => ({ getDeliverySlotOptions: vi.fn() }));
vi.mock('@/api/payments', () => ({ pay: vi.fn() }));
vi.mock('@/components/SaveToListButton', () => ({
  SaveToListButton: () => <button type="button">Save to list</button>,
}));

const cartContext = {
  cart: null as Cart | null,
  cartId: null as string | null,
  cartGeneration: 0,
  isInitializing: false,
  isLoading: false,
  error: null,
  errorCode: null,
  errorState: null,
  isCartAvailable: true,
  pendingActions: {},
  isActionPending: () => false,
  addItem: vi.fn(),
  addBundle: vi.fn(),
  addCustomBlend: vi.fn(),
  replaceCustomBlend: vi.fn(),
  quickOrder: vi.fn(),
  updateQuantity: vi.fn(),
  removeItem: vi.fn(),
  reorder: vi.fn(),
  addSavedListToCart: vi.fn(),
  refreshCart: vi.fn(),
  retryCart: vi.fn(),
  clearCart: vi.fn(),
};

const defaultFacts: CategoryFacts = {
  texture: 'Fine',
  colour: 'White',
  source: 'Test source',
  intendedUse: 'Testing',
  storage: 'Dry cool',
  consumptionClassification: 'non-food',
};

const catalogProduct: ProductWithVariants = {
  id: 'catalog-product',
  name: 'Powdered Water',
  description: 'Just-add-water water powder, 300g. Dry until required.',
  priceCents: 1000,
  imageSetId: 'powdered-water',
  category: 'Impossible',
  stock: 5,
  slug: 'powdered-water',
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
      sku: 'PW-001',
      label: 'Standard',
      weightGrams: 500,
      priceCents: 1000,
      moqSacks: 4,
      perTonneCents: 2_000_000,
      priceTiers: [{ minTonnes: 1, discountPct: 0 }],
      stockCount: 5,
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
};

/**
 * Two canonical Trade & Creative Materials products. Same category, adjacent canonical ids, so the
 * per-category palette must give them different schemes on the catalog surface.
 */
function tradeProduct(id: string, name: string): ProductWithVariants {
  return {
    ...catalogProduct,
    id,
    name,
    slug: name.toLowerCase().replaceAll(' ', '-'),
    imageSetId: name.toLowerCase().replaceAll(' ', '-'),
    category: 'Trade & Creative Materials',
  };
}

function NavigationControls() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="location">{`${location.pathname}${location.search}`}</output>
      <button type="button" onClick={() => navigate(-1)}>
        Back
      </button>
    </>
  );
}

function JourneyControls() {
  return (
    <nav aria-label="Journey controls">
      <Link to="/cart">Review order</Link>
    </nav>
  );
}

const clearanceJourneyProduct: ProductWithVariants = {
  ...catalogProduct,
  id: 'garden-clearance',
  name: 'Lawn Feed',
  category: 'Garden & Outdoors',
  slug: 'lawn-feed',
  hasActiveClearance: true,
  variants: [
    {
      ...catalogProduct.variants[0]!,
      variantId: 1043,
      productId: 1043,
      sku: 'GDN-1043-001',
      label: '10 kg Bag',
      weightGrams: 10_000,
      priceCents: 3_000,
      moqSacks: 2,
      perTonneCents: 300_000,
      clearance: {
        priceCents: 2_400,
        perTonneCents: 240_000,
        startsAt: '2026-07-21T12:00:00.000Z',
        endsAt: '2026-08-04T12:00:00.000Z',
      },
    },
  ],
  defaultVariantId: 1043,
  priceCents: 3_000,
  priceRange: { min: 3_000, max: 3_000 },
};

const clearanceJourneyCart: Cart = {
  id: 'garden-clearance-cart',
  items: [
    {
      productId: 'garden-clearance',
      product: {
        id: 'garden-clearance',
        name: 'Lawn Feed',
        description: clearanceJourneyProduct.description,
        priceCents: 3_000,
        imageSetId: clearanceJourneyProduct.imageSetId,
        category: 'Garden & Outdoors',
        stock: 5,
        availability: 'in_stock',
        backorderable: false,
        backorderLeadDays: null,
        slug: 'lawn-feed',
        salesCount: 0,
        createdAt: '2026-07-14T00:00:00.000Z',
        available: true,
        tags: [],
        specificationGroups: [],
      },
      variantSnap: {
        variantId: 1043,
        sku: 'GDN-1043-001',
        label: '10 kg Bag',
        weightGrams: 10_000,
        deliveryClass: 'parcel',
      },
      perTonneCents: 240_000,
      resolvedUnitPriceCents: 2_400,
      quantity: 5,
      configKey: '',
      materialSubtotalCents: 12_000,
      blendingFeeCents: 0,
      discountableTotalCents: 12_000,
      lineTotalCents: 12_000,
      clearance: clearanceJourneyProduct.variants[0]!.clearance,
    },
  ],
  subtotalCents: 12_000,
  discountableSubtotalCents: 12_000,
  blendingFeeTotalCents: 0,
  totalItems: 5,
  deliveryPreview: {
    mode: 'parcel',
    chargeCents: 999,
    weightGrams: 50_000,
    reason: 'Standard parcel delivery',
  },
};

describe('catalog to product journey', () => {
  beforeEach(() => {
    vi.mocked(useCartContext).mockImplementation(() => cartContext);
    cartContext.cart = null;
    cartContext.cartId = null;
    cartContext.addItem.mockReset();
    cartContext.addItem.mockResolvedValue(true);
    cartContext.retryCart.mockReset();
    cartContext.retryCart.mockResolvedValue(true);
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      loading: false,
      login: vi.fn(),
      signup: vi.fn(),
      logout: vi.fn(),
    });
    vi.mocked(useCategories).mockReturnValue({
      categories: ['Impossible', 'Pantry Staples'],
      isLoading: false,
      error: null,
    });
    vi.mocked(useProducts).mockReturnValue({
      products: [catalogProduct],
      isLoading: false,
      error: null,
      total: 1,
      currentPage: 1,
      currentPageSize: 24,
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    vi.mocked(getProduct).mockResolvedValue(catalogProduct);
    vi.mocked(getSimilarProducts).mockResolvedValue([]);
    vi.mocked(useProductFilterOptions).mockReturnValue({
      options: { tags: [], specificationGroups: [] },
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    });
  });

  it('removes filter values absent from the loaded registry after navigation and browser back', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        initialEntries={[
          '/catalog?q=water&tag=pantry&tag=drink-mix&spec=texture%3Afine&sort=price_desc&page=2&pageSize=24',
        ]}
      >
        <ComparisonSelectionProvider
          storage={{ getItem: () => null, setItem: () => undefined, removeItem: () => undefined }}
        >
          <NavigationControls />
          <Routes>
            <Route path="/catalog" element={<CatalogPage />} />
            <Route path="/products/:id" element={<ProductPage />} />
          </Routes>
        </ComparisonSelectionProvider>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('radio', { name: 'Pantry Staples' }));
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/catalog?q=water&category=Pantry+Staples&sort=price_desc&pageSize=24',
    );

    await user.click(
      within(screen.getByRole('heading', { name: 'Powdered Water' })).getByRole('link'),
    );
    expect(await screen.findByRole('heading', { name: 'Powdered Water', level: 1 })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/catalog?q=water&category=Pantry+Staples&sort=price_desc&pageSize=24',
      ),
    );
    expect(screen.getByRole('heading', { name: 'Pantry Staples' })).toBeVisible();
  });

  it('keeps two same-category products on different schemes and carries the card scheme into the gallery', async () => {
    const user = userEvent.setup();
    const first = tradeProduct('33', 'Portland Cement');
    const second = tradeProduct('34', 'Plaster of Paris');
    vi.mocked(useProducts).mockReturnValue({
      products: [first, second],
      isLoading: false,
      error: null,
      total: 2,
      currentPage: 1,
      currentPageSize: 24,
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    vi.mocked(getProduct).mockResolvedValue(first);

    render(
      <MemoryRouter
        initialEntries={['/catalog']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <ComparisonSelectionProvider
          storage={{ getItem: () => null, setItem: () => undefined, removeItem: () => undefined }}
        >
          <NavigationControls />
          <Routes>
            <Route path="/catalog" element={<CatalogPage />} />
            <Route path="/products/:id" element={<ProductPage />} />
          </Routes>
        </ComparisonSelectionProvider>
      </MemoryRouter>,
    );

    const firstCardScheme = screen
      .getByRole('img', { name: `${first.name} stitched kraft sack` })
      .getAttribute('data-colour-scheme');
    const secondCardScheme = screen
      .getByRole('img', { name: `${second.name} stitched kraft sack` })
      .getAttribute('data-colour-scheme');

    expect(firstCardScheme).toMatch(/^[a-z]+(-[a-z]+)+$/);
    expect(secondCardScheme).toMatch(/^[a-z]+(-[a-z]+)+$/);
    expect(firstCardScheme).not.toBe(secondCardScheme);
    // Exact Trade & Creative Materials rows at index `(Number(id) - 1) % 5`: 33 -> 2, 34 -> 3.
    expect(firstCardScheme).toBe('ultramarine-blue');
    expect(secondCardScheme).toBe('mineral-green');

    await user.click(within(screen.getByRole('heading', { name: first.name })).getByRole('link'));
    expect(await screen.findByRole('heading', { name: first.name, level: 1 })).toBeVisible();

    const gallery = screen.getByRole('region', { name: `${first.name} images` });
    expect(
      within(gallery)
        .getByRole('img', { name: `${first.name} stitched kraft sack` })
        .getAttribute('data-colour-scheme'),
    ).toBe(firstCardScheme);
  });

  it('carries a server-resolved clearance line from catalog through cart into the GARDEN10 checkout quote', async () => {
    const user = userEvent.setup();
    vi.mocked(useProducts).mockReturnValue({
      products: [clearanceJourneyProduct],
      isLoading: false,
      error: null,
      total: 1,
      currentPage: 1,
      currentPageSize: 24,
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    vi.mocked(getProduct).mockResolvedValue(clearanceJourneyProduct);
    cartContext.addItem.mockImplementation(
      (productId: string, variantId?: number, quantity?: number) => {
        expect({ productId, variantId, quantity }).toEqual({
          productId: 'garden-clearance',
          variantId: 1043,
          quantity: 5,
        });
        cartContext.cart = clearanceJourneyCart;
        cartContext.cartId = clearanceJourneyCart.id;
        return Promise.resolve(true);
      },
    );
    vi.mocked(validatePromo).mockResolvedValue({
      valid: true,
      promoCode: {
        code: 'GARDEN10',
        kind: 'percent',
        discountPercent: 10,
        minItemCount: 0,
        categoryScope: 'Garden & Outdoors',
      },
      discountBaseCents: 12_000,
      discountCents: 1_200,
      totalCents: 11_799,
    });

    render(
      <MemoryRouter
        initialEntries={['/catalog']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <ComparisonSelectionProvider
          storage={{ getItem: () => null, setItem: () => undefined, removeItem: () => undefined }}
        >
          <JourneyControls />
          <Routes>
            <Route path="/catalog" element={<CatalogPage />} />
            <Route path="/products/:id" element={<ProductPage />} />
            <Route path="/cart" element={<CartPage />} />
            <Route path="/checkout" element={<CheckoutPage />} />
          </Routes>
        </ComparisonSelectionProvider>
      </MemoryRouter>,
    );

    expect(screen.getByText('Clearance')).toBeVisible();
    await user.click(within(screen.getByRole('heading', { name: 'Lawn Feed' })).getByRole('link'));
    expect(await screen.findByText('Clearance price $30.00')).toBeVisible();

    await user.click(screen.getByRole('radio', { name: /10 kg Bag/ }));
    await user.clear(screen.getByLabelText('Order quantity (10 kg Bag)'));
    await user.type(screen.getByLabelText('Order quantity (10 kg Bag)'), '5');
    await user.click(screen.getByRole('button', { name: 'Add to order' }));

    await user.click(screen.getByRole('link', { name: 'Review order' }));
    expect(await screen.findByText('Clearance price applied: $30.00 per pack')).toBeVisible();
    expect(screen.getByText('Resolved order subtotal (5 units)')).toBeVisible();
    expect(screen.getAllByText('$150.00')).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Continue to checkout' }));
    await user.type(await screen.findByLabelText('Order promotion'), 'GARDEN10');
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() =>
      expect(validatePromo).toHaveBeenCalledWith('garden-clearance-cart', 'GARDEN10'),
    );
    expect(await screen.findByText('Eligible subtotal (Garden & Outdoors)')).toBeVisible();
    expect(screen.getByText(/Discount \(GARDEN10.*Garden & Outdoors\)/)).toBeVisible();
    expect(screen.getByText('−$15.00')).toBeVisible();
    expect(screen.getByText('$147.49')).toBeVisible();
  });
});
