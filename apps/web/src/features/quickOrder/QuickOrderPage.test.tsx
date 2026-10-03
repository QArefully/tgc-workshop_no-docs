import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Cart } from '@shop/contracts/cart';
import type { QuickOrderResponse } from '@shop/contracts/quick-order';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '@/App';
import { useCartContext } from '@/hooks/CartContext';
import { QUICK_ORDER_FAILURE_MESSAGE } from './quickOrderPresentation';
import { QuickOrderPage } from './QuickOrderPage';

vi.mock('@/hooks/CartContext', () => ({ useCartContext: vi.fn() }));
vi.mock('@/components/Layout', async () => {
  const { Outlet } = await import('react-router-dom');

  return {
    Layout: () => (
      <div data-testid="layout-shell">
        <Outlet />
      </div>
    ),
  };
});

const cart: Cart = {
  id: '58f1b5ed-3dbf-4c3c-908e-c71d7e7bf912',
  items: [],
  subtotalCents: 0,
  discountableSubtotalCents: 0,
  blendingFeeTotalCents: 0,
  totalItems: 0,
};

const response: QuickOrderResponse = {
  cart,
  addedLineCount: 1,
  skippedLineCount: 0,
  outcomes: [
    {
      lineNumber: 1,
      rawLine: 'BKP-0001-001, 4',
      sku: 'BKP-0001-001',
      requestedQuantity: 4,
      submittedQuantity: 4,
      moqAdjusted: false,
      duplicateSku: false,
      variantId: 1,
      productId: '1',
      productName: 'Baking material',
      resolvedUnitPriceCents: 1000,
      status: 'added',
      reason: null,
    },
  ],
};

type CartStub = {
  isCartAvailable: boolean;
  isActionPending: ReturnType<typeof vi.fn>;
  quickOrder: ReturnType<typeof vi.fn>;
  error: string | null;
};

function stubCart(overrides: Partial<CartStub> = {}): CartStub {
  return {
    isCartAvailable: true,
    isActionPending: vi.fn().mockReturnValue(false),
    quickOrder: vi.fn().mockResolvedValue(response),
    error: null,
    ...overrides,
  };
}

function renderPage(cartStub = stubCart()) {
  vi.mocked(useCartContext).mockReturnValue(cartStub as never);
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <QuickOrderPage />
    </MemoryRouter>,
  );
}

describe('QuickOrderPage', () => {
  beforeEach(() => {
    vi.mocked(useCartContext).mockReset();
  });

  it('labels its textarea, provides two example lines, and blocks an empty submission', () => {
    const cartStub = stubCart();
    renderPage(cartStub);

    const textarea = screen.getByRole('textbox', { name: 'Item codes and amounts' });
    expect(textarea).toHaveAttribute('placeholder', 'BKP-0001-001, 4\nGDN-1043-001, 6');
    expect(screen.getByRole('button', { name: 'Add to cart' })).toBeDisabled();
    expect(cartStub.quickOrder).not.toHaveBeenCalled();
  });

  it('blocks submission while the cart is unavailable', async () => {
    const user = userEvent.setup();
    const cartStub = stubCart({ isCartAvailable: false });
    renderPage(cartStub);

    await user.type(
      screen.getByRole('textbox', { name: 'Item codes and amounts' }),
      'BKP-0001-001, 4',
    );

    expect(screen.getByRole('button', { name: 'Add to cart' })).toBeDisabled();
    expect(cartStub.quickOrder).not.toHaveBeenCalled();
  });

  it('shows the busy label and prevents a second submission while Quick Order is pending', async () => {
    const user = userEvent.setup();
    let resolveRequest: ((value: QuickOrderResponse | false) => void) | undefined;
    const quickOrder = vi.fn(
      () =>
        new Promise<QuickOrderResponse | false>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const cartStub = stubCart({ quickOrder });
    renderPage(cartStub);

    await user.type(
      screen.getByRole('textbox', { name: 'Item codes and amounts' }),
      'BKP-0001-001, 4',
    );
    await user.click(screen.getByRole('button', { name: 'Add to cart' }));
    await user.click(screen.getByRole('button', { name: 'Adding to cart...' }));

    expect(quickOrder).toHaveBeenCalledTimes(1);
    expect(quickOrder).toHaveBeenCalledWith('BKP-0001-001, 4');
    expect(screen.getByRole('button', { name: 'Adding to cart...' })).toBeDisabled();
    resolveRequest?.(response);
    await screen.findByText('1 line was added to your cart.');
  });

  it('renders the delegated outcome and clears its feature error after a later success', async () => {
    const user = userEvent.setup();
    const cartStub = stubCart({
      quickOrder: vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(response),
      error: 'An unrelated cart error must not appear here.',
    });
    renderPage(cartStub);
    const textarea = screen.getByRole('textbox', { name: 'Item codes and amounts' });

    await user.type(textarea, 'BKP-0001-001, 4');
    await user.click(screen.getByRole('button', { name: 'Add to cart' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(QUICK_ORDER_FAILURE_MESSAGE);
    expect(
      screen.queryByText('An unrelated cart error must not appear here.'),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add to cart' }));

    const result = await screen.findByRole('status', { name: 'Quick Order result' });
    expect(result).toHaveTextContent('1 line was added to your cart.');
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('registers the public Quick Order route inside the layout', () => {
    vi.mocked(useCartContext).mockReturnValue(stubCart() as never);
    render(
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        initialEntries={['/quick-order']}
      >
        <App />
      </MemoryRouter>,
    );

    const quickOrderHeading = screen.getByRole('heading', {
      name: 'Add materials by item code',
    });
    expect(quickOrderHeading).toBeInTheDocument();
    expect(screen.getByTestId('layout-shell')).toContainElement(quickOrderHeading);
  });
});
