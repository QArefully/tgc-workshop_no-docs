import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Cart } from '@shop/contracts/cart';
import type { QuickOrderResponse } from '@shop/contracts/quick-order';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/client';
import * as cartApi from '@/api/cart';
import * as quickOrderApi from '@/api/quickOrder';
import { CartProvider, useCartContext } from '@/hooks/CartContext';
import { clearCartId, setCartId } from '@/lib/cartStorage';
import { QuickOrderPage } from './QuickOrderPage';

vi.mock('@/api/cart', () => ({
  addToCart: vi.fn(),
  createCart: vi.fn(),
  getCart: vi.fn(),
  removeFromCart: vi.fn(),
  updateCartItem: vi.fn(),
}));
vi.mock('@/api/quickOrder', () => ({ submitQuickOrder: vi.fn() }));

const OLD_CART_ID = '5e6f7a8b-1c2d-4e3f-8a9b-0c1d2e3f4a5b';
const NEW_CART_ID = '6f7a8b9c-2d3e-4f5a-8b9c-1d2e3f4a5b6c';
const PASTE = 'GDN-1043-001, 4\nUNKNOWN-0000-001, 2\nnot a quick-order line';

function cart(id: string, totalItems = 0): Cart {
  return {
    id,
    items: [],
    subtotalCents: 0,
    discountableSubtotalCents: 0,
    blendingFeeTotalCents: 0,
    totalItems,
  };
}

function mixedResponse(activeCart: Cart): QuickOrderResponse {
  return {
    cart: activeCart,
    addedLineCount: 1,
    skippedLineCount: 2,
    outcomes: [
      {
        lineNumber: 1,
        rawLine: 'GDN-1043-001, 4',
        sku: 'GDN-1043-001',
        requestedQuantity: 4,
        submittedQuantity: 4,
        moqAdjusted: false,
        duplicateSku: false,
        variantId: 1043,
        productId: '1043',
        productName: 'Lawn Feed',
        resolvedUnitPriceCents: 2295,
        status: 'added',
        reason: null,
      },
      {
        lineNumber: 2,
        rawLine: 'UNKNOWN-0000-001, 2',
        sku: 'UNKNOWN-0000-001',
        requestedQuantity: 2,
        submittedQuantity: null,
        moqAdjusted: false,
        duplicateSku: false,
        variantId: null,
        productId: null,
        productName: null,
        resolvedUnitPriceCents: null,
        status: 'skipped',
        reason: 'SKU_NOT_FOUND',
      },
      {
        lineNumber: 3,
        rawLine: 'not a quick-order line',
        sku: null,
        requestedQuantity: null,
        submittedQuantity: null,
        moqAdjusted: false,
        duplicateSku: false,
        variantId: null,
        productId: null,
        productName: null,
        resolvedUnitPriceCents: null,
        status: 'skipped',
        reason: 'MALFORMED_LINE',
      },
    ],
  };
}

function CartLanding() {
  const { cart } = useCartContext();
  return <h1>Cart landing: {cart?.totalItems ?? 0} units</h1>;
}

function renderJourney() {
  return render(
    <MemoryRouter
      initialEntries={['/quick-order']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <CartProvider>
        <Routes>
          <Route path="/quick-order" element={<QuickOrderPage />} />
          <Route path="/cart" element={<CartLanding />} />
        </Routes>
      </CartProvider>
    </MemoryRouter>,
  );
}

describe('Quick Order journey', () => {
  beforeEach(() => {
    clearCartId();
    vi.resetAllMocks();
  });

  it('reports a mixed result and takes the buyer to the cart carrying the authoritative result', async () => {
    setCartId(OLD_CART_ID);
    vi.mocked(cartApi.getCart).mockResolvedValueOnce(cart(OLD_CART_ID));
    vi.mocked(quickOrderApi.submitQuickOrder).mockResolvedValueOnce(
      mixedResponse(cart(OLD_CART_ID, 4)),
    );
    const user = userEvent.setup();
    renderJourney();

    const textarea = screen.getByRole('textbox', { name: 'Item codes and amounts' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add to cart' })).toBeDisabled());
    await user.type(textarea, PASTE);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add to cart' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Add to cart' }));

    const result = await screen.findByRole('status', { name: 'Quick Order result' });
    expect(result).toHaveTextContent('1 line added to your cart. 2 lines could not be added.');
    expect(
      within(result).getByRole('list', { name: 'Lines not added from Quick Order' }),
    ).toHaveTextContent('Line 2: Item × 2 We could not find an item matching this line.');
    expect(result).toHaveTextContent(
      'Line 3: Item We could not read this line. Check its format and try again.',
    );
    expect(result).not.toHaveTextContent('SKU_NOT_FOUND');
    expect(result).not.toHaveTextContent('MALFORMED_LINE');
    expect(quickOrderApi.submitQuickOrder).toHaveBeenCalledWith(OLD_CART_ID, PASTE);

    await user.click(within(result).getByRole('link', { name: 'View cart' }));
    expect(
      await screen.findByRole('heading', { name: 'Cart landing: 4 units' }),
    ).toBeInTheDocument();
  });

  it('recovers a missing cart and replays the pasted submission exactly once', async () => {
    setCartId(OLD_CART_ID);
    vi.mocked(cartApi.getCart)
      .mockResolvedValueOnce(cart(OLD_CART_ID))
      .mockResolvedValueOnce(cart(NEW_CART_ID));
    vi.mocked(cartApi.createCart).mockResolvedValueOnce({ cartId: NEW_CART_ID });
    vi.mocked(quickOrderApi.submitQuickOrder)
      .mockRejectedValueOnce(new ApiError('Cart not found', 404))
      .mockResolvedValueOnce(mixedResponse(cart(NEW_CART_ID, 4)));
    const user = userEvent.setup();
    renderJourney();

    const textarea = screen.getByRole('textbox', { name: 'Item codes and amounts' });
    await user.type(textarea, PASTE);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add to cart' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Add to cart' }));

    await screen.findByText('1 line added to your cart. 2 lines could not be added.');
    expect(quickOrderApi.submitQuickOrder).toHaveBeenCalledTimes(2);
    expect(quickOrderApi.submitQuickOrder).toHaveBeenNthCalledWith(1, OLD_CART_ID, PASTE);
    expect(quickOrderApi.submitQuickOrder).toHaveBeenNthCalledWith(2, NEW_CART_ID, PASTE);
    expect(cartApi.createCart).toHaveBeenCalledTimes(1);
    expect(cartApi.getCart).toHaveBeenCalledTimes(2);
  });
});
