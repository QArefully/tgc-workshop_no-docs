import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/client';
import { pay } from '@/api/payments';
import { validatePromo } from '@/api/promo';
import { getDeliverySlotOptions } from '@/api/deliverySlots';
import { useCartContext } from '@/hooks/CartContext';
import {
  cart,
  cartContext,
  clearCart,
  completeCard,
  continueToPayment,
  mockAnonymous,
  mockSignedIn,
  renderCheckout,
  slotOptions,
} from './CheckoutPage.test-fixtures';

vi.mock('@/api/payments', () => ({ pay: vi.fn() }));
vi.mock('@/api/promo', () => ({ validatePromo: vi.fn() }));
vi.mock('@/hooks/CartContext', () => ({ useCartContext: vi.fn() }));
vi.mock('@/hooks/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/api/deliverySlots', () => ({ getDeliverySlotOptions: vi.fn() }));
vi.mock('@/api/tradeAccount', () => ({
  listDeliverySites: vi.fn(),
  createDeliverySite: vi.fn(),
  updateDeliverySite: vi.fn(),
  retireDeliverySite: vi.fn(),
  listBillingEntities: vi.fn(),
  createBillingEntity: vi.fn(),
  updateBillingEntity: vi.fn(),
  retireBillingEntity: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(useCartContext).mockReturnValue(cartContext);
  vi.mocked(pay).mockReset();
  vi.mocked(validatePromo).mockReset();
  vi.mocked(getDeliverySlotOptions).mockReset();
  vi.mocked(getDeliverySlotOptions).mockResolvedValue(slotOptions);
  mockAnonymous();
  clearCart.mockClear();
});

describe('Checkout payment, idempotency, and conflicts', { timeout: 20_000 }, () => {
  it('regenerates the idempotency key when a trade checkout field changes', async () => {
    const user = userEvent.setup();
    vi.mocked(pay).mockRejectedValue(new ApiError('Payment failed', 402));
    await renderCheckout();
    await continueToPayment(user);
    await completeCard(user);

    await user.click(screen.getByRole('button', { name: 'Simulate payment' }));
    await waitFor(() => expect(pay).toHaveBeenCalledTimes(1));
    const firstKey = vi.mocked(pay).mock.calls[0]![0].idempotencyKey;

    await user.click(screen.getByRole('button', { name: 'Back to schedule' }));
    await user.type(screen.getByLabelText(/Purchase order reference/), 'PO-9');
    await user.click(screen.getByRole('button', { name: 'Continue to payment' }));
    await user.click(screen.getByRole('button', { name: 'Simulate payment' }));
    await waitFor(() => expect(pay).toHaveBeenCalledTimes(2));
    expect(vi.mocked(pay).mock.calls[1]![0].idempotencyKey).not.toBe(firstKey);
    expect(vi.mocked(pay).mock.calls[1]![0].purchaseOrderReference).toBe('PO-9');
  });

  it('labels every new checkout control and reaches the slot picker by keyboard', async () => {
    mockSignedIn();
    const user = userEvent.setup();
    await renderCheckout();
    await screen.findByLabelText(/Northgate Yard/);

    await user.type(screen.getByLabelText('Full name'), 'Checkout Test');
    await user.type(screen.getByLabelText('Email'), 'checkout@example.test');
    await user.click(screen.getByRole('button', { name: 'Continue to schedule' }));
    await screen.findByRole('heading', { name: 'Schedule and billing' });

    const firstSlot = await screen.findByLabelText(/August 3, 2026.*Morning/);
    firstSlot.focus();
    await user.keyboard('{ }');
    expect(firstSlot).toBeChecked();
    await user.keyboard('{ArrowDown}');
    expect(await screen.findByLabelText(/August 3, 2026.*Afternoon/)).toBeChecked();

    expect(screen.getByLabelText(/Purchase order reference/)).toHaveAccessibleName();
    expect(screen.getByRole('group', { name: 'Delivery slot' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Billing details' })).toBeInTheDocument();
  });

  it('keeps idempotency key across unchanged declined retries and regenerates it after card changes', async () => {
    const user = userEvent.setup();
    vi.mocked(pay).mockRejectedValue(new ApiError('Payment failed', 402));
    await renderCheckout();
    await continueToPayment(user);
    await completeCard(user);

    await user.click(screen.getByRole('button', { name: 'Simulate payment' }));
    await waitFor(() => expect(pay).toHaveBeenCalledTimes(1));
    const firstKey = vi.mocked(pay).mock.calls[0]![0].idempotencyKey;
    expect(screen.getByRole('alert')).toHaveTextContent('Retry keeps this payment attempt safe');

    await user.click(screen.getByRole('button', { name: 'Simulate payment' }));
    await waitFor(() => expect(pay).toHaveBeenCalledTimes(2));
    expect(vi.mocked(pay).mock.calls[1]![0].idempotencyKey).toBe(firstKey);

    await user.clear(screen.getByLabelText('CVC'));
    await user.type(screen.getByLabelText('CVC'), '456');
    await user.click(screen.getByRole('button', { name: 'Simulate payment' }));
    await waitFor(() => expect(pay).toHaveBeenCalledTimes(3));
    expect(vi.mocked(pay).mock.calls[2]![0].idempotencyKey).not.toBe(firstKey);
  });

  it('keeps idempotency key across an unchanged network retry', async () => {
    const user = userEvent.setup();
    vi.mocked(pay).mockRejectedValue(new ApiError('Unable to reach the shop server', null));
    await renderCheckout();
    await continueToPayment(user);
    await completeCard(user);

    await user.click(screen.getByRole('button', { name: 'Simulate payment' }));
    await waitFor(() => expect(pay).toHaveBeenCalledTimes(1));
    const firstKey = vi.mocked(pay).mock.calls[0]![0].idempotencyKey;
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to reach the shop server');

    await user.click(screen.getByRole('button', { name: 'Simulate payment' }));
    await waitFor(() => expect(pay).toHaveBeenCalledTimes(2));
    expect(vi.mocked(pay).mock.calls[1]![0].idempotencyKey).toBe(firstKey);
  });

  it('rotates a terminal stock-conflict key and preserves the cart until refresh', async () => {
    const user = userEvent.setup();
    vi.mocked(pay)
      .mockRejectedValueOnce(
        new ApiError('Insufficient stock', 409, {
          error: 'INSUFFICIENT_STOCK',
          productIds: ['1'],
        } as never),
      )
      .mockRejectedValueOnce(new ApiError('Payment failed', 402));
    await renderCheckout();
    await continueToPayment(user);
    await completeCard(user);

    await user.click(screen.getByRole('button', { name: 'Simulate payment' }));
    await screen.findByRole('alert');
    const firstKey = vi.mocked(pay).mock.calls[0]![0].idempotencyKey;
    expect(
      screen.getByText(
        'Your cart has not been changed. Refresh it, then review quantities before retrying.',
      ),
    ).toBeInTheDocument();
    expect(clearCart).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Simulate payment' }));
    await waitFor(() => expect(pay).toHaveBeenCalledTimes(2));
    expect(vi.mocked(pay).mock.calls[1]![0].idempotencyKey).not.toBe(firstKey);
  });

  it('rotates an expired reservation key and provides a cart refresh action', async () => {
    const user = userEvent.setup();
    vi.mocked(pay).mockRejectedValue(
      new ApiError('Reservation expired', 409, {
        error: 'RESERVATION_EXPIRED',
        reservationExpiresAt: '2026-07-19T12:00:00.000Z',
      } as never),
    );
    await renderCheckout();
    await continueToPayment(user);
    await completeCard(user);

    await user.click(screen.getByRole('button', { name: 'Simulate payment' }));
    expect(
      await screen.findByText('Your checkout reservation expired before payment could complete.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Refresh cart' }));
    expect(cartContext.retryCart).toHaveBeenCalledOnce();
  });

  it('cancels visible validation for edited promo code and applies the new request', async () => {
    let resolveFirst!: (value: Awaited<ReturnType<typeof validatePromo>>) => void;
    let resolveSecond!: (value: Awaited<ReturnType<typeof validatePromo>>) => void;
    const first = new Promise<Awaited<ReturnType<typeof validatePromo>>>((resolve) => {
      resolveFirst = resolve;
    });
    const second = new Promise<Awaited<ReturnType<typeof validatePromo>>>((resolve) => {
      resolveSecond = resolve;
    });
    const eligibleCart = {
      ...cart,
      items: [{ ...cart.items[0]!, quantity: 5, lineTotalCents: 5000 }],
      subtotalCents: 5000,
      totalItems: 5,
    };
    vi.mocked(useCartContext).mockReturnValue({
      ...cartContext,
      cart: eligibleCart,
      cartId: eligibleCart.id,
    });
    vi.mocked(validatePromo).mockReturnValueOnce(first).mockReturnValueOnce(second);
    const user = userEvent.setup();
    await renderCheckout();
    const promoInput = screen.getByLabelText('Order promotion');

    await user.type(promoInput, 'SAVE10');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByRole('button', { name: 'Checking...' })).toBeDisabled();

    await user.clear(promoInput);
    await user.type(promoInput, 'SAVE20');
    expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(validatePromo).toHaveBeenNthCalledWith(2, eligibleCart.id, 'SAVE20');

    await act(async () => {
      resolveFirst({ valid: false, error: 'Old promo invalid' });
      await first;
    });
    expect(screen.getByRole('button', { name: 'Checking...' })).toBeDisabled();
    expect(screen.queryByText('Old promo invalid')).not.toBeInTheDocument();

    await act(async () => {
      resolveSecond({ valid: false, error: 'New promo invalid' });
      await second;
    });
    await screen.findByText('Invalid promo code');
    expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled();
  });

  it('clears cart state and replaces checkout with confirmation after payment success', async () => {
    const user = userEvent.setup();
    vi.mocked(pay).mockResolvedValue({
      id: '12',
      status: 'processing',
      version: 0,
      items: [],
      subtotalCents: 1000,
      discountCents: 0,
      totalCents: 1000,
      promoApplied: null,
      createdAt: '2026-07-14T00:00:00.000Z',
    });
    await renderCheckout();
    await continueToPayment(user, { keyboard: true });
    await completeCard(user, { keyboard: true });

    await user.click(screen.getByRole('button', { name: 'Simulate payment' }));
    await screen.findByText('Order confirmation route');
    expect(clearCart).toHaveBeenCalledOnce();
    expect(screen.getByTestId('location')).toHaveTextContent('/order-confirmation/12');
  });
});
