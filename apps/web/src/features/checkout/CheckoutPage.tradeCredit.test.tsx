import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/client';
import { pay } from '@/api/payments';
import { getTradeCreditSummary } from '@/api/tradeCredit';
import { getDeliverySlotOptions } from '@/api/deliverySlots';
import { useCartContext } from '@/hooks/CartContext';
import {
  activeCreditSummary,
  cartContext,
  clearCart,
  completeTradeCredit,
  continueToPayment,
  mockAnonymous,
  mockSignedIn,
  onHoldCreditSummary,
  renderCheckout,
  slotOptions,
} from './CheckoutPage.test-fixtures';

vi.mock('@/api/payments', () => ({ pay: vi.fn() }));
vi.mock('@/api/tradeCredit', () => ({ getTradeCreditSummary: vi.fn() }));
vi.mock('@/hooks/CartContext', () => ({ useCartContext: vi.fn() }));
vi.mock('@/hooks/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/api/promo', () => ({ validatePromo: vi.fn() }));
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

const suspendedCreditSummary = {
  ...onHoldCreditSummary,
  state: 'suspended' as const,
  status: 'suspended' as const,
  holdReason: 'Account suspended',
};

beforeEach(() => {
  vi.mocked(useCartContext).mockReturnValue(cartContext);
  vi.mocked(pay).mockReset();
  vi.mocked(getTradeCreditSummary).mockReset();
  vi.mocked(getDeliverySlotOptions).mockReset();
  vi.mocked(getDeliverySlotOptions).mockResolvedValue(slotOptions);
  clearCart.mockClear();
  mockAnonymous();
});

describe('Checkout trade-credit payment method', { timeout: 20_000 }, () => {
  it('shows server credit facts, hides card fields, and sends the strict credit body', async () => {
    mockSignedIn();
    vi.mocked(getTradeCreditSummary).mockResolvedValue(activeCreditSummary);
    vi.mocked(pay).mockResolvedValue({ id: 'credit-order' } as never);
    const user = userEvent.setup();

    await renderCheckout();
    await continueToPayment(user);
    await completeTradeCredit(user);

    expect(screen.queryByLabelText('Card number')).not.toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Net 30 terms')).toBeInTheDocument();
    expect(screen.getByText('£7,500.00')).toBeInTheDocument();
    expect(
      screen.getByText('No card payment will be taken. Your company will be invoiced in GBP.'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Simulate payment' }));
    await waitFor(() => expect(pay).toHaveBeenCalledOnce());
    expect(vi.mocked(pay).mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ paymentMethod: 'trade_credit' }),
    );
    expect(vi.mocked(pay).mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(vi.mocked(pay).mock.calls[0]![0]).not.toHaveProperty('cardNumber');
    expect(vi.mocked(pay).mock.calls[0]![0]).not.toHaveProperty('availableCreditCents');
  });

  it('keeps trade credit card-only for anonymous buyers', async () => {
    const user = userEvent.setup();
    await renderCheckout();
    await continueToPayment(user);

    const tradeCredit = screen.getByRole('radio', { name: 'Trade credit' });
    expect(tradeCredit).toBeDisabled();
    expect(
      screen.getByText('Trade credit is not available for your company account.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Card number')).toBeInTheDocument();
    expect(getTradeCreditSummary).not.toHaveBeenCalled();
  });

  it('disables held credit with localized reason while retaining card payment', async () => {
    mockSignedIn();
    vi.mocked(getTradeCreditSummary).mockResolvedValue(onHoldCreditSummary);
    const user = userEvent.setup();

    await renderCheckout();
    await continueToPayment(user);
    await user.click(screen.getByRole('radio', { name: 'Trade credit' }));
    await screen.findByTestId('checkout-credit-summary');

    expect(screen.getByRole('radio', { name: 'Trade credit' })).toBeDisabled();
    expect(
      screen.getByText(
        'Trade credit is on hold. Choose card payment or contact your account administrator.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Account note: Credit review in progress')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Card' }));
    expect(screen.getByLabelText('Card number')).toBeInTheDocument();
  });

  it.each([
    { label: 'null', summary: null },
    { label: 'on-hold', summary: onHoldCreditSummary },
    { label: 'suspended', summary: suspendedCreditSummary },
  ])('keeps $label trade credit disabled after switching to card', async ({ summary }) => {
    mockSignedIn();
    vi.mocked(getTradeCreditSummary).mockResolvedValue(summary);
    const user = userEvent.setup();

    await renderCheckout();
    await continueToPayment(user);
    const tradeCredit = screen.getByRole('radio', { name: 'Trade credit' });
    await user.click(tradeCredit);
    await waitFor(() => expect(getTradeCreditSummary).toHaveBeenCalledOnce());
    await waitFor(() => expect(tradeCredit).toBeDisabled());

    await user.click(screen.getByRole('radio', { name: 'Card' }));
    expect(screen.getByLabelText('Card number')).toBeInTheDocument();
    expect(tradeCredit).toBeDisabled();

    await user.click(tradeCredit);
    expect(getTradeCreditSummary).toHaveBeenCalledOnce();
  });

  it('announces credit loading and offers a retry after a load error', async () => {
    mockSignedIn();
    let rejectFirst!: (error: unknown) => void;
    const first = new Promise<never>((_, reject) => {
      rejectFirst = reject;
    });
    vi.mocked(getTradeCreditSummary)
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce(activeCreditSummary);
    const user = userEvent.setup();

    await renderCheckout();
    await continueToPayment(user);
    await user.click(screen.getByRole('radio', { name: 'Trade credit' }));
    expect(await screen.findByText('Checking trade-credit availability…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Simulate payment' })).toBeDisabled();

    rejectFirst(new ApiError('Credit lookup failed', 500));
    expect(
      await screen.findByText('Trade-credit availability could not be loaded.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry trade-credit check' }));
    await screen.findByTestId('checkout-credit-summary');
    expect(screen.getByText('Active')).toBeInTheDocument();
  });
});
