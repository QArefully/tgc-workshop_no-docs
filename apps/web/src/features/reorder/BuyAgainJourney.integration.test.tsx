import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cart } from '@shop/contracts/cart';
import type { OrderListResponse } from '@shop/contracts/orders';
import type { ReorderResponse } from '@shop/contracts/reorder';
import * as cartApi from '@/api/cart';
import * as ordersApi from '@/api/orders';
import * as reorderApi from '@/api/reorder';
import { setCartId } from '@/lib/cartStorage';
import { CartProvider, useCartContext } from '@/hooks/CartContext';
import { OrderHistoryPage } from '@/features/orders/OrderHistoryPage';

vi.mock('@/api/cart', () => ({
  addToCart: vi.fn(),
  createCart: vi.fn(),
  getCart: vi.fn(),
  removeFromCart: vi.fn(),
  updateCartItem: vi.fn(),
}));
vi.mock('@/api/reorder', () => ({ reorderFromOrder: vi.fn() }));
vi.mock('@/api/orders', () => ({ getOrders: vi.fn(), getOrder: vi.fn(), cancelOrder: vi.fn() }));

const cartId = '5e6f7a8b-1c2d-4e3f-8a9b-0c1d2e3f4a5b';

function cart(totalItems: number): Cart {
  return {
    id: cartId,
    items: [],
    subtotalCents: 0,
    discountableSubtotalCents: 0,
    blendingFeeTotalCents: 0,
    totalItems,
  };
}

const orders: OrderListResponse = {
  items: [
    {
      id: '12',
      status: 'delivered',
      version: 2,
      totalCents: 2200,
      totalItems: 3,
      hasBackorder: false,
      createdAt: '2026-07-14T00:00:00.000Z',
    },
    {
      id: '13',
      status: 'delivered',
      version: 1,
      totalCents: 900,
      totalItems: 1,
      hasBackorder: false,
      createdAt: '2026-07-15T00:00:00.000Z',
    },
  ],
  page: 1,
  pageSize: 10,
};

const mixedReport: ReorderResponse = {
  cart: cart(4),
  addedLineCount: 1,
  skippedLineCount: 2,
  outcomes: [
    {
      orderLineItemId: '31',
      productId: 'cement',
      productName: 'Portland cement',
      variantId: 601,
      sku: 'CEM-25',
      configKey: '',
      quantity: 4,
      status: 'added',
      reason: null,
      orderedUnitPriceCents: 900,
      currentUnitPriceCents: 1050,
      priceChanged: true,
    },
    {
      orderLineItemId: '32',
      productId: 'lime',
      productName: 'Hydrated lime',
      variantId: null,
      sku: null,
      configKey: '',
      quantity: 2,
      status: 'skipped',
      reason: 'VARIANT_RETIRED',
      orderedUnitPriceCents: 800,
      currentUnitPriceCents: null,
      priceChanged: false,
    },
    {
      orderLineItemId: '33',
      productId: 'sand',
      productName: 'Sharp sand',
      variantId: 602,
      sku: 'SND-25',
      configKey: '',
      quantity: 1,
      status: 'skipped',
      reason: 'BELOW_MOQ',
      orderedUnitPriceCents: 500,
      currentUnitPriceCents: 500,
      priceChanged: false,
    },
  ],
};

function CartStub() {
  const { cart: activeCart } = useCartContext();
  return <p>Cart holds {activeCart?.totalItems ?? 0} items</p>;
}

function renderJourney() {
  return render(
    <MemoryRouter
      initialEntries={['/orders']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <CartProvider>
        <Routes>
          <Route path="/orders" element={<OrderHistoryPage />} />
          <Route path="/cart" element={<CartStub />} />
        </Routes>
      </CartProvider>
    </MemoryRouter>,
  );
}

describe('Buy Again journey from order history', () => {
  beforeEach(() => {
    vi.mocked(cartApi.getCart).mockReset();
    vi.mocked(reorderApi.reorderFromOrder).mockReset();
    vi.mocked(ordersApi.getOrders).mockReset();
    setCartId(cartId);
    vi.mocked(cartApi.getCart).mockResolvedValue(cart(0));
    vi.mocked(ordersApi.getOrders).mockResolvedValue(orders);
  });

  it('carries a past order into the cart and explains every line it could not repeat', async () => {
    let resolveReorder!: (value: ReorderResponse) => void;
    vi.mocked(reorderApi.reorderFromOrder).mockReturnValueOnce(
      new Promise<ReorderResponse>((resolve) => {
        resolveReorder = resolve;
      }),
    );
    const user = userEvent.setup();
    renderJourney();

    await screen.findByRole('link', { name: 'Order #12' });
    await user.click(screen.getByRole('button', { name: 'Buy again from order #12' }));

    // Pending is scoped to the activated order only.
    expect(screen.getByRole('button', { name: 'Adding to cart… for order #12' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Buy again from order #13' })).toBeEnabled();
    expect(reorderApi.reorderFromOrder).toHaveBeenCalledWith(cartId, '12');

    resolveReorder(mixedReport);

    const region = await screen.findByRole('status', { name: 'Buy again result for order #12' });
    await waitFor(() =>
      expect(region).toHaveTextContent('1 item added to your cart. 2 items could not be added.'),
    );
    expect(
      within(region).getByRole('list', { name: 'Price changes on order #12' }),
    ).toHaveTextContent('Portland cement × 4 Price changed from $11.25 to $13.13 per item.');
    const skippedEntries = within(
      within(region).getByRole('list', { name: 'Items not added from order #12' }),
    ).getAllByRole('listitem');
    expect(skippedEntries.map((entry) => entry.textContent)).toEqual([
      'Hydrated lime × 2 We no longer sell this item.',
      'Sharp sand × 1 This amount is below the smallest amount we can deliver for this item.',
    ]);
    expect(region.textContent).not.toMatch(/VARIANT_RETIRED|BELOW_MOQ|MOQ|SKU/);

    // The other order's region never picked up this order's report.
    expect(
      screen.getByRole('status', { name: 'Buy again result for order #13' }),
    ).toBeEmptyDOMElement();

    await user.click(within(region).getByRole('link', { name: 'View cart' }));
    expect(await screen.findByText('Cart holds 4 items')).toBeInTheDocument();
  });

  it('explains an all-skipped reorder without presenting it as a failure', async () => {
    vi.mocked(reorderApi.reorderFromOrder).mockResolvedValueOnce({
      ...mixedReport,
      cart: cart(0),
      addedLineCount: 0,
      skippedLineCount: 2,
      outcomes: mixedReport.outcomes.filter((outcome) => outcome.status === 'skipped'),
    });
    const user = userEvent.setup();
    renderJourney();

    await screen.findByRole('link', { name: 'Order #12' });
    await user.click(screen.getByRole('button', { name: 'Buy again from order #12' }));

    const region = await screen.findByRole('status', { name: 'Buy again result for order #12' });
    await waitFor(() =>
      expect(region).toHaveTextContent(
        'Nothing was added to your cart. 2 items from this order cannot be ordered right now.',
      ),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(within(region).queryByRole('link', { name: 'View cart' })).not.toBeInTheDocument();
  });
});
