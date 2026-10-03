import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cart } from '@shop/contracts/cart';
import type { ReorderResponse } from '@shop/contracts/reorder';
import { useCartContext } from '@/hooks/CartContext';
import { BuyAgainButton, useBuyAgain } from './BuyAgainButton';
import { ReorderOutcomeList } from './ReorderOutcomeList';

vi.mock('@/hooks/CartContext', () => ({ useCartContext: vi.fn() }));

const emptyCart: Cart = {
  id: '5e6f7a8b-1c2d-4e3f-8a9b-0c1d2e3f4a5b',
  items: [],
  subtotalCents: 0,
  discountableSubtotalCents: 0,
  blendingFeeTotalCents: 0,
  totalItems: 0,
};

function reorderResponse(productName: string): ReorderResponse {
  return {
    cart: emptyCart,
    addedLineCount: 1,
    skippedLineCount: 0,
    outcomes: [
      {
        orderLineItemId: '31',
        productId: 'cement',
        productName,
        variantId: 601,
        sku: 'CEM-25',
        configKey: '',
        quantity: 1,
        status: 'added',
        reason: null,
        orderedUnitPriceCents: 900,
        currentUnitPriceCents: 900,
        priceChanged: false,
      },
    ],
  };
}

type CartStub = {
  reorder: ReturnType<typeof vi.fn>;
  isActionPending: ReturnType<typeof vi.fn>;
  error: string | null;
};

function stubCart(overrides: Partial<CartStub> = {}): CartStub {
  return {
    reorder: vi.fn().mockResolvedValue(reorderResponse('Portland cement')),
    isActionPending: vi.fn().mockReturnValue(false),
    error: null,
    ...overrides,
  };
}

/** Two orders sharing one Buy Again hook, mirroring an order-history list. */
function TwoOrders({ orderIds }: { orderIds: string[] }) {
  const { buyAgain, stateFor } = useBuyAgain();
  return (
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      {orderIds.map((orderId) => {
        const state = stateFor(orderId);
        return (
          <div key={orderId}>
            <BuyAgainButton
              orderId={orderId}
              isPending={state.kind === 'pending'}
              onActivate={() => void buyAgain(orderId)}
            />
            <ReorderOutcomeList orderId={orderId} state={state} />
          </div>
        );
      })}
    </MemoryRouter>
  );
}

describe('BuyAgainButton', () => {
  beforeEach(() => {
    vi.mocked(useCartContext).mockReset();
  });

  it('names its own order and stays enabled when idle', () => {
    vi.mocked(useCartContext).mockReturnValue(stubCart() as never);
    render(<TwoOrders orderIds={['12']} />);
    expect(screen.getByRole('button', { name: 'Buy again from order #12' })).toBeEnabled();
  });

  it('disables the control while its reorder is pending', () => {
    const cart = stubCart({
      isActionPending: vi.fn((key: string) => key === 'reorder:12'),
    });
    vi.mocked(useCartContext).mockReturnValue(cart as never);
    render(<TwoOrders orderIds={['12', '13']} />);

    expect(cart.isActionPending).toHaveBeenCalledWith('reorder:12', 'reorder');
    expect(screen.getByRole('button', { name: 'Adding to cart… for order #12' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Buy again from order #13' })).toBeEnabled();
    expect(
      screen.getByRole('status', { name: 'Buy again result for order #12' }),
    ).toHaveTextContent('Adding this order to your cart…');
    expect(
      screen.getByRole('status', { name: 'Buy again result for order #13' }),
    ).toBeEmptyDOMElement();
  });

  it('reorders the activated order only and keeps the report on that order', async () => {
    vi.mocked(useCartContext).mockReturnValue(stubCart() as never);
    const user = userEvent.setup();
    render(<TwoOrders orderIds={['12', '13']} />);

    await user.click(screen.getByRole('button', { name: 'Buy again from order #13' }));

    const region = await screen.findByRole('status', { name: 'Buy again result for order #13' });
    await waitFor(() =>
      expect(region).toHaveTextContent('1 item from this order was added to your cart.'),
    );
    expect(
      screen.getByRole('status', { name: 'Buy again result for order #12' }),
    ).toBeEmptyDOMElement();
  });

  it('keeps each order report when another order is reordered afterwards', async () => {
    vi.mocked(useCartContext).mockReturnValue(
      stubCart({
        reorder: vi
          .fn()
          .mockResolvedValueOnce(reorderResponse('Portland cement'))
          .mockResolvedValueOnce(reorderResponse('Hydrated lime')),
      }) as never,
    );
    const user = userEvent.setup();
    render(<TwoOrders orderIds={['12', '13']} />);

    await user.click(screen.getByRole('button', { name: 'Buy again from order #12' }));
    await waitFor(() =>
      expect(
        screen.getByRole('status', { name: 'Buy again result for order #12' }),
      ).toHaveTextContent('1 item from this order was added to your cart.'),
    );

    await user.click(screen.getByRole('button', { name: 'Buy again from order #13' }));
    await waitFor(() =>
      expect(
        screen.getByRole('status', { name: 'Buy again result for order #13' }),
      ).toHaveTextContent('1 item from this order was added to your cart.'),
    );

    // Order #12's server-committed adds are still explained to the buyer; #13 did not erase them.
    expect(
      screen.getByRole('status', { name: 'Buy again result for order #12' }),
    ).toHaveTextContent('1 item from this order was added to your cart.');
  });

  it('does not render the shared cart error inside the Buy Again region', async () => {
    vi.mocked(useCartContext).mockReturnValue(
      stubCart({
        reorder: vi.fn().mockResolvedValue(false),
        // A message left behind by an unrelated cart action, e.g. a quantity nudge in the header
        // cart sheet. It must never be attributed to this order's Buy Again attempt.
        error: 'Your cart is reserved for checkout and cannot be changed.',
      }) as never,
    );
    const user = userEvent.setup();
    render(<TwoOrders orderIds={['12']} />);

    await user.click(screen.getByRole('button', { name: 'Buy again from order #12' }));

    const region = await screen.findByRole('status', { name: 'Buy again result for order #12' });
    await waitFor(() =>
      expect(region).toHaveTextContent(
        'We could not add this order to your cart. Please try again.',
      ),
    );
    expect(region).not.toHaveTextContent('reserved for checkout');
  });

  it('uses the packet-local failure wording when the cart hook reports no message', async () => {
    vi.mocked(useCartContext).mockReturnValue(
      stubCart({ reorder: vi.fn().mockResolvedValue(false) }) as never,
    );
    const user = userEvent.setup();
    render(<TwoOrders orderIds={['12']} />);

    await user.click(screen.getByRole('button', { name: 'Buy again from order #12' }));

    expect(
      await screen.findByText('We could not add this order to your cart. Please try again.'),
    ).toBeInTheDocument();
  });
});
