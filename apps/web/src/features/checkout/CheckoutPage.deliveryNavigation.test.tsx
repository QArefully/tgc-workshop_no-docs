import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/client';
import { pay } from '@/api/payments';
import { validatePromo } from '@/api/promo';
import { getDeliverySlotOptions } from '@/api/deliverySlots';
import { listBillingEntities, listDeliverySites } from '@/api/tradeAccount';
import { useCartContext } from '@/hooks/CartContext';
import {
  cartContext,
  clearCart,
  completeCard,
  completeDeliveryStep,
  completeScheduleStep,
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
  vi.mocked(listDeliverySites).mockReset();
  vi.mocked(listBillingEntities).mockReset();
  vi.mocked(getDeliverySlotOptions).mockResolvedValue(slotOptions);
  vi.mocked(listDeliverySites).mockResolvedValue([]);
  vi.mocked(listBillingEntities).mockResolvedValue([]);
  mockAnonymous();
  clearCart.mockClear();
});

describe('Checkout delivery and navigation', { timeout: 20_000 }, () => {
  it('gates each step on the previous one and keeps browser back in checkout flow', async () => {
    const user = userEvent.setup();
    await renderCheckout();

    await user.click(screen.getByRole('button', { name: 'Continue to schedule' }));
    expect(screen.getByText('Name is required')).toBeInTheDocument();
    expect(screen.getByText('Email is required')).toBeInTheDocument();
    expect(screen.getByText('Address line 1 is required')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/checkout');

    await completeDeliveryStep(user);
    expect(screen.getByTestId('location')).toHaveTextContent('/checkout?step=schedule');
    expect(screen.getByLabelText('Legal entity name')).toHaveValue('Checkout Test');
    expect(screen.getByLabelText('Address line 1')).toHaveValue('1 Test Street');
    expect(screen.getByLabelText('City')).toHaveValue('Testville');
    expect(screen.getByLabelText('Postcode')).toHaveValue('TE1 1ST');

    await user.click(screen.getByRole('button', { name: 'Continue to payment' }));
    expect(screen.getByText('Choose a delivery slot')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/checkout?step=schedule');

    await completeScheduleStep(user);
    expect(screen.getByTestId('location')).toHaveTextContent('/checkout?step=payment');

    await user.click(screen.getByRole('button', { name: 'Back to schedule' }));
    expect(screen.getByRole('heading', { name: 'Schedule and billing' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back to delivery' }));
    expect(screen.getByRole('heading', { name: 'Delivery' })).toBeInTheDocument();
    expect(screen.getByLabelText('Full name')).toHaveValue('Checkout Test');
  });

  it('returns a refreshed later-step URL to delivery because checkout inputs are not persisted', async () => {
    await renderCheckout('/checkout?step=payment');

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/checkout'));
    expect(screen.getByTestId('location')).not.toHaveTextContent('step=');
    expect(screen.getByRole('heading', { name: 'Delivery' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Card number')).not.toBeInTheDocument();
  });

  it('redirects an unknown step value back to the first step', async () => {
    await renderCheckout('/checkout?step=confirm');

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/checkout'));
    expect(screen.getByTestId('location')).not.toHaveTextContent('step=');
    expect(screen.getByRole('heading', { name: 'Delivery' })).toBeInTheDocument();
  });

  it('offers anonymous buyers the ad-hoc address form only', async () => {
    await renderCheckout();

    expect(await screen.findByLabelText('Address line 1')).toBeInTheDocument();
    expect(screen.queryByLabelText('Northgate Yard')).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(listDeliverySites).not.toHaveBeenCalled();
  });

  it('preselects the default saved site for a signed-in buyer and submits it as the destination', async () => {
    mockSignedIn();
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
    const user = userEvent.setup();
    await renderCheckout();

    const savedSiteRadio = await screen.findByLabelText(/Northgate Yard/);
    expect(savedSiteRadio).toBeChecked();
    expect(screen.queryByLabelText('Address line 1')).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('Full name'), 'Checkout Test');
    await user.type(screen.getByLabelText('Email'), 'checkout@example.test');
    await user.click(screen.getByRole('button', { name: 'Continue to schedule' }));

    await screen.findByRole('heading', { name: 'Schedule and billing' });
    expect(await screen.findByLabelText(/Northgate Builders Ltd/)).toBeChecked();
    await user.click(await screen.findByLabelText(/August 3, 2026.*Morning/));
    await user.type(screen.getByLabelText(/Purchase order reference/), 'PO-4417');
    await user.click(screen.getByRole('button', { name: 'Continue to payment' }));

    await screen.findByRole('heading', { name: 'Test card details' });
    expect(screen.getByText('Northgate Yard')).toBeInTheDocument();
    expect(screen.getByText('PO-4417')).toBeInTheDocument();
    expect(screen.getByText(/August 3, 2026.*Morning/)).toBeInTheDocument();

    await completeCard(user, { keyboard: true });
    await user.click(screen.getByRole('button', { name: 'Simulate payment' }));
    await waitFor(() => expect(pay).toHaveBeenCalledTimes(1));
    expect(vi.mocked(pay).mock.calls[0]![0]).toMatchObject({
      deliveryDestination: { kind: 'saved', deliverySiteId: '7' },
      billingSelection: { kind: 'saved', billingEntityId: '3' },
      deliverySlot: { date: '2026-08-03', window: 'am' },
      purchaseOrderReference: 'PO-4417',
    });
  });

  it('sends an ad-hoc destination and billing party when nothing is saved', async () => {
    vi.mocked(pay).mockResolvedValue({
      id: '13',
      status: 'processing',
      version: 0,
      items: [],
      subtotalCents: 1000,
      discountCents: 0,
      totalCents: 1000,
      promoApplied: null,
      createdAt: '2026-07-14T00:00:00.000Z',
    });
    const user = userEvent.setup();
    await renderCheckout();
    await continueToPayment(user);
    await completeCard(user);

    await user.click(screen.getByRole('button', { name: 'Simulate payment' }));
    await waitFor(() => expect(pay).toHaveBeenCalledTimes(1));
    const body = vi.mocked(pay).mock.calls[0]![0];
    expect(body.deliveryDestination).toEqual({
      kind: 'adhoc',
      address: {
        line1: '1 Test Street',
        city: 'Testville',
        postcode: 'TE1 1ST',
        countryCode: 'GB',
      },
    });
    expect(body.billingSelection).toEqual({
      kind: 'adhoc',
      billingEntity: {
        legalName: 'Checkout Test',
        address: {
          line1: '1 Test Street',
          city: 'Testville',
          postcode: 'TE1 1ST',
          countryCode: 'GB',
        },
      },
    });
    expect(body).not.toHaveProperty('purchaseOrderReference');
    expect(body).not.toHaveProperty('shippingAddress');
  });

  it('shows the lead-time reason and recovers from a slot load failure through retry', async () => {
    vi.mocked(getDeliverySlotOptions)
      .mockRejectedValueOnce(new ApiError('Delivery slots are unavailable', 500))
      .mockResolvedValue(slotOptions);
    const user = userEvent.setup();
    await renderCheckout();
    await completeDeliveryStep(user);

    expect(await screen.findByText('Delivery slots are unavailable.')).toBeInTheDocument();
    expect(screen.queryByLabelText(/August 3, 2026.*Morning/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry delivery slots' }));
    expect(await screen.findByLabelText(/August 3, 2026.*Morning/)).toBeInTheDocument();
    expect(screen.getByTestId('lead-time-reason')).toHaveTextContent(
      'Freight consignments need 3 business days',
    );
  });

  it('renders a recoverable alert for an unbookable slot and rotates the key', async () => {
    const user = userEvent.setup();
    vi.mocked(pay).mockRejectedValue(
      new ApiError('Delivery slot unavailable', 409, {
        error: 'DELIVERY_SLOT_UNAVAILABLE',
        earliestDate: '2026-08-06',
      } as never),
    );
    await renderCheckout();
    await continueToPayment(user);
    await completeCard(user);

    await user.click(screen.getByRole('button', { name: 'Simulate payment' }));
    expect(
      await screen.findByText('The delivery slot you chose is no longer bookable.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/earliest delivery date is now August 6, 2026/)).toBeInTheDocument();
    expect(clearCart).not.toHaveBeenCalled();
    const firstKey = vi.mocked(pay).mock.calls[0]![0].idempotencyKey;

    await user.click(screen.getByRole('button', { name: 'Choose another slot' }));
    await screen.findByRole('heading', { name: 'Schedule and billing' });
    await user.click(await screen.findByLabelText(/August 3, 2026.*Afternoon/));
    expect(
      screen.queryByText('The delivery slot you chose is no longer bookable.'),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Continue to payment' }));
    await completeCard(user);
    await user.click(screen.getByRole('button', { name: 'Simulate payment' }));
    await waitFor(() => expect(pay).toHaveBeenCalledTimes(2));
    expect(vi.mocked(pay).mock.calls[1]![0].idempotencyKey).not.toBe(firstKey);
    expect(vi.mocked(pay).mock.calls[1]![0].deliverySlot).toEqual({
      date: '2026-08-03',
      window: 'pm',
    });
  });
});
