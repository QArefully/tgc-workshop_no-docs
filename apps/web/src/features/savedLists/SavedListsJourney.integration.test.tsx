import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Cart } from '@shop/contracts/cart';
import type { SavedListDetail } from '@shop/contracts/saved-lists';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as cartApi from '@/api/cart';
import * as savedListsApi from '@/api/savedLists';
import { CartProvider, useCartContext } from '@/hooks/CartContext';
import { SavedListsProvider } from '@/hooks/SavedListsContext';
import { clearCartId, setCartId } from '@/lib/cartStorage';
import { SavedListDetailPage } from './SavedListDetailPage';
import { SavedListsPage } from './SavedListsPage';

const buyer = { id: 'buyer-1' };
vi.mock('@/hooks/AuthContext', () => ({ useAuth: () => ({ user: buyer }) }));
vi.mock('@/api/cart', () => ({ createCart: vi.fn(), getCart: vi.fn() }));
vi.mock('@/api/savedLists', () => ({
  getSavedLists: vi.fn(),
  getSavedList: vi.fn(),
  createSavedList: vi.fn(),
  addSavedListToCart: vi.fn(),
}));

const CART_ID = '5e6f7a8b-1c2d-4e3f-8a9b-0c1d2e3f4a5b';
const LIST_ID = '7';
const cart = (totalItems = 0): Cart => ({
  id: CART_ID,
  items: [],
  subtotalCents: 0,
  discountableSubtotalCents: 0,
  blendingFeeTotalCents: 0,
  totalItems,
});
const list: SavedListDetail = {
  listId: LIST_ID,
  name: 'Depot restock',
  isDefault: false,
  itemCount: 2,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  items: [
    {
      itemId: '1',
      variantId: 101,
      sku: 'CEM-25',
      label: '25 kg sack',
      productId: 'cement',
      productName: 'Cement',
      quantity: 2,
      weightGrams: 25000,
      moqSacks: 4,
      unitPriceCents: 500,
      perTonneCents: 20000,
      availableToSell: true,
      backorderable: false,
      active: true,
    },
    {
      itemId: '2',
      variantId: 102,
      sku: 'OLD-25',
      label: '25 kg sack',
      productId: 'old-cement',
      productName: 'Old cement',
      quantity: 1,
      weightGrams: 25000,
      moqSacks: 1,
      unitPriceCents: null,
      perTonneCents: null,
      availableToSell: false,
      backorderable: false,
      active: false,
    },
  ],
};

function CartLanding() {
  const { cart: activeCart } = useCartContext();
  return <h1>Cart landing: {activeCart?.totalItems ?? 0} units</h1>;
}

function renderJourney() {
  return render(
    <MemoryRouter
      initialEntries={['/lists']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <CartProvider>
        <SavedListsProvider>
          <Routes>
            <Route path="/lists" element={<SavedListsPage />} />
            <Route path="/lists/:listId" element={<SavedListDetailPage />} />
            <Route path="/cart" element={<CartLanding />} />
          </Routes>
        </SavedListsProvider>
      </CartProvider>
    </MemoryRouter>,
  );
}

describe('Saved lists journey', () => {
  beforeEach(() => {
    clearCartId();
    setCartId(CART_ID);
    vi.resetAllMocks();
    vi.mocked(cartApi.getCart).mockResolvedValue(cart());
    vi.mocked(savedListsApi.getSavedLists).mockResolvedValue([]);
    vi.mocked(savedListsApi.createSavedList).mockResolvedValue(list);
    vi.mocked(savedListsApi.getSavedList).mockResolvedValue(list);
    vi.mocked(savedListsApi.addSavedListToCart).mockResolvedValue({
      cart: cart(4),
      addedLineCount: 1,
      skippedLineCount: 1,
      outcomes: [
        {
          itemId: '1',
          variantId: 101,
          sku: 'CEM-25',
          productId: 'cement',
          productName: 'Cement',
          savedQuantity: 2,
          submittedQuantity: 4,
          moqAdjusted: true,
          resolvedUnitPriceCents: 500,
          status: 'added',
          reason: null,
        },
        {
          itemId: '2',
          variantId: 102,
          sku: 'OLD-25',
          productId: 'old-cement',
          productName: 'Old cement',
          savedQuantity: 1,
          submittedQuantity: null,
          moqAdjusted: false,
          resolvedUnitPriceCents: null,
          status: 'skipped',
          reason: 'VARIANT_RETIRED',
        },
      ],
    });
  });

  it('creates a list then adds it to the cart with its authoritative mixed outcome', async () => {
    const user = userEvent.setup();
    renderJourney();
    const name = await screen.findByRole('textbox', { name: 'New list name' });
    await user.type(name, 'Depot restock');
    await user.click(screen.getByRole('button', { name: 'Create list' }));
    await waitFor(() =>
      expect(savedListsApi.createSavedList).toHaveBeenCalledWith({ name: 'Depot restock' }),
    );
    await user.click(await screen.findByRole('link', { name: 'View list' }));
    await screen.findByRole('heading', { name: 'Depot restock' });
    await user.click(screen.getByRole('button', { name: 'Add to cart' }));

    const result = await screen.findByRole('status', { name: 'Saved list cart result' });
    expect(result).toHaveTextContent('1 item added to your cart. 1 item could not be added.');
    expect(result).toHaveTextContent(
      'Cement × 2 Amount increased from 2 to 4 to meet the smallest order.',
    );
    expect(result).toHaveTextContent('Old cement × 1 We no longer sell this item.');
    expect(savedListsApi.addSavedListToCart).toHaveBeenCalledWith(LIST_ID, { cartId: CART_ID });
    await user.click(screen.getByRole('link', { name: 'View cart' }));
    expect(
      await screen.findByRole('heading', { name: 'Cart landing: 4 units' }),
    ).toBeInTheDocument();
  });
});
