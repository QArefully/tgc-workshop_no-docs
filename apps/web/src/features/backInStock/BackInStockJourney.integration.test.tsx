import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { PublicUser } from '@shop/contracts/auth';
import type { BackInStockSubscription } from '@shop/contracts/back-in-stock';
import type { CatalogVariant, CategoryFacts, ProductWithVariants } from '@shop/contracts/products';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as backInStockApi from '@/api/backInStock';
import { BackInStockProvider } from '@/hooks/BackInStockContext';
import { ComparisonSelectionProvider } from '@/features/comparison/ComparisonSelectionContext';
import { ProductPurchasePanel } from '@/features/product/ProductPurchasePanel';
import { BackInStockSection } from './BackInStockSection';

const authState = vi.hoisted(() => ({ user: null as PublicUser | null }));
vi.mock('@/hooks/AuthContext', () => ({ useAuth: () => ({ user: authState.user }) }));
vi.mock('@/features/savedLists/AddToListMenu', () => ({
  AddToListMenu: () => <button type="button" aria-label="Save to list" />,
}));
vi.mock('@/api/backInStock', () => ({
  getBackInStockSubscriptions: vi.fn(),
  createBackInStockSubscription: vi.fn(),
  cancelBackInStockSubscription: vi.fn(),
}));

const comparisonStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

const NOTIFY = 'Notify me when this is back in stock';
const NOTIFIED = 'You will be notified when this is back in stock';

const soldOutVariant: CatalogVariant = {
  variantId: 501,
  productId: 1,
  sku: 'CEM-25',
  label: '25 kg Sack',
  weightGrams: 25_000,
  priceCents: 12999,
  moqSacks: 4,
  perTonneCents: 43330,
  priceTiers: [{ minTonnes: 1, discountPct: 0 }],
  stockCount: 0,
  backorderable: false,
  backorderLeadDays: null,
  deliveryClass: 'parcel',
  active: true,
  sortOrder: 1,
};

const facts: CategoryFacts = {
  texture: 'Fine',
  colour: 'Grey',
  source: 'Test',
  intendedUse: 'Testing',
  storage: 'Dry',
  consumptionClassification: 'non-food',
};

const product = (variants: CatalogVariant[]): ProductWithVariants => ({
  id: 'rapid-set-cement',
  name: 'Rapid-set cement',
  description: 'Cement-class powder.',
  priceCents: 12999,
  imageSetId: 'cement',
  category: 'Cement',
  stock: 0,
  availability: 'out_of_stock',
  backorderable: false,
  backorderLeadDays: null,
  slug: 'rapid-set-cement',
  salesCount: 0,
  createdAt: '2026-07-14T00:00:00.000Z',
  available: false,
  tags: [],
  specificationGroups: [],
  variants,
  defaultVariantId: variants[0]!.variantId,
  categoryFacts: facts,
  consumptionClassification: 'non-food',
  mixingGroup: null,
  priceRange: { min: 12999, max: 12999 },
  baseAvailability: 'out_of_stock',
});

const subscription = (
  overrides: Partial<BackInStockSubscription> = {},
): BackInStockSubscription => ({
  subscriptionId: '11',
  variantId: 501,
  productId: 'rapid-set-cement',
  sku: 'CEM-25',
  productName: 'Rapid-set cement',
  variantLabel: '25 kg Sack',
  status: 'pending',
  requestedAt: '2026-07-14T09:30:00.000Z',
  notifiedAt: null,
  minimumOrderQuantity: 4,
  ...overrides,
});

function Path() {
  return <output>{useLocation().pathname}</output>;
}

function renderJourney(variants: CatalogVariant[] = [soldOutVariant]) {
  return render(
    <MemoryRouter
      initialEntries={['/products/rapid-set-cement']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <BackInStockProvider>
        <ComparisonSelectionProvider storage={comparisonStorage}>
          <Routes>
            <Route
              path="/products/:slug"
              element={
                <>
                  <ProductPurchasePanel
                    product={product(variants)}
                    isCartAvailable
                    isAdding={false}
                    actionError={null}
                    cartError={null}
                    onAddToCart={async () => {}}
                  />
                  <BackInStockSection />
                  <Path />
                </>
              }
            />
            <Route path="/login" element={<Path />} />
          </Routes>
        </ComparisonSelectionProvider>
      </BackInStockProvider>
    </MemoryRouter>,
  );
}

describe('Back-in-stock journey', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authState.user = null;
    vi.mocked(backInStockApi.getBackInStockSubscriptions).mockResolvedValue([]);
  });

  it('returns an anonymous buyer to sign-in without touching the API', async () => {
    const user = userEvent.setup();
    renderJourney();

    await user.click(screen.getByRole('radio', { name: /25 kg Sack/i }));
    await user.click(screen.getByRole('button', { name: NOTIFY }));

    expect(screen.getByText('/login')).toBeInTheDocument();
    expect(backInStockApi.createBackInStockSubscription).not.toHaveBeenCalled();
  });

  it('subscribes a signed-in buyer, lists the alert in the account section, then cancels it', async () => {
    authState.user = { id: 'buyer-1' } as PublicUser;
    vi.mocked(backInStockApi.createBackInStockSubscription).mockResolvedValue(subscription());
    vi.mocked(backInStockApi.cancelBackInStockSubscription).mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderJourney();

    await user.click(screen.getByRole('radio', { name: /25 kg Sack/i }));
    await user.click(screen.getByRole('button', { name: NOTIFY }));

    await waitFor(() =>
      expect(backInStockApi.createBackInStockSubscription).toHaveBeenCalledWith({ variantId: 501 }),
    );
    expect(await screen.findByRole('button', { name: NOTIFIED })).toBeDisabled();

    const cancel = await screen.findByRole('button', {
      name: 'Cancel back-in-stock alert for Rapid-set cement 25 kg Sack',
    });
    await user.click(cancel);

    await waitFor(() =>
      expect(backInStockApi.cancelBackInStockSubscription).toHaveBeenCalledWith('11'),
    );
    expect(await screen.findByText('You have no back-in-stock alerts.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: NOTIFY })).toBeEnabled();
  });

  it('never offers the waiting list for a purchasable variant', async () => {
    authState.user = { id: 'buyer-1' } as PublicUser;
    const user = userEvent.setup();
    renderJourney([{ ...soldOutVariant, stockCount: 8 }]);

    await user.click(screen.getByRole('radio', { name: /25 kg Sack/i }));
    expect(screen.queryByRole('button', { name: NOTIFY })).not.toBeInTheDocument();
  });

  it('never offers the waiting list for a backorderable variant', async () => {
    authState.user = { id: 'buyer-1' } as PublicUser;
    const user = userEvent.setup();
    renderJourney([{ ...soldOutVariant, backorderable: true, backorderLeadDays: 14 }]);

    await user.click(screen.getByRole('radio', { name: /25 kg Sack/i }));
    expect(screen.queryByRole('button', { name: NOTIFY })).not.toBeInTheDocument();
  });
});
