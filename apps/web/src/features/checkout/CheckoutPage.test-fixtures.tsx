import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Cart } from '@shop/contracts/cart';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { vi } from 'vitest';
import type { DeliverySlotOptionsResponse } from '@shop/contracts/delivery';
import type { BillingEntity, DeliverySite } from '@shop/contracts/trade-account';
import type { CreditAccountMemberView } from '@shop/contracts/trade-credit';
import { listBillingEntities, listDeliverySites } from '@/api/tradeAccount';
import { useAuth } from '@/hooks/AuthContext';
import type { useCart } from '@/hooks/useCart';
import { CheckoutPage } from './CheckoutPage';
export const slotOptions: DeliverySlotOptionsResponse = {
  delivery: {
    mode: 'freight',
    chargeCents: 999,
    weightGrams: 25000,
    reason: 'A freight-class item requires freight delivery',
  },
  leadTime: {
    earliestDate: '2026-08-03',
    latestDate: '2026-08-21',
    businessDays: 3,
    reason: 'Freight consignments need 3 business days before the earliest delivery date.',
  },
  slots: [
    { date: '2026-08-03', window: 'am' },
    { date: '2026-08-03', window: 'pm' },
    { date: '2026-08-04', window: 'am' },
  ],
};

export const savedSite: DeliverySite = {
  id: '7',
  label: 'Northgate Yard',
  contactName: 'Site Manager',
  address: {
    line1: '12 Northgate Way',
    city: 'Leeds',
    postcode: 'LS1 4AB',
    countryCode: 'GB',
  },
  isDefault: true,
  active: true,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
};

export const savedBillingEntity: BillingEntity = {
  id: '3',
  legalName: 'Northgate Builders Ltd',
  registrationNumber: '09876543',
  vatNumber: null,
  address: {
    line1: '1 Finance Street',
    city: 'Leeds',
    postcode: 'LS1 9ZZ',
    countryCode: 'GB',
  },
  isDefault: true,
  active: true,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
};

export const signedInUser = {
  id: '1',
  email: 'buyer@example.test',
  displayName: 'Trade Buyer',
  role: 'customer' as const,
  country: 'UK' as const,
};

export const activeCreditSummary: CreditAccountMemberView = {
  companyId: '3',
  state: 'active',
  status: 'active',
  creditLimitCents: 1_000_000,
  outstandingCents: 250_000,
  heldCents: 0,
  exposureCents: 250_000,
  availableCreditCents: 750_000,
  terms: 'net_30',
  termsDays: 30,
  holdReason: null,
  version: 1,
  updatedAt: '2026-07-01T00:00:00.000Z',
};

export const onHoldCreditSummary: CreditAccountMemberView = {
  ...activeCreditSummary,
  state: 'on_hold',
  status: 'on_hold',
  holdReason: 'Credit review in progress',
};

export function mockAnonymous() {
  vi.mocked(useAuth).mockReturnValue({
    user: null,
    loading: false,
    login: vi.fn(),
    signup: vi.fn(),
    logout: vi.fn(),
  });
}

export function mockSignedIn() {
  vi.mocked(useAuth).mockReturnValue({
    user: signedInUser,
    loading: false,
    login: vi.fn(),
    signup: vi.fn(),
    logout: vi.fn(),
  });
  vi.mocked(listDeliverySites).mockResolvedValue([savedSite]);
  vi.mocked(listBillingEntities).mockResolvedValue([savedBillingEntity]);
}

export const cart: Cart = {
  id: '58f1b5ed-3dbf-4c3c-908e-c71d7e7bf912',
  items: [
    {
      productId: '1',
      product: {
        id: '1',
        name: 'Powdered Water',
        description: 'Water in powder form.',
        priceCents: 1000,
        imageSetId: 'powdered-water',
        category: 'Impossible',
        stock: 4,
        availability: 'in_stock',
        backorderable: false,
        backorderLeadDays: null,
        slug: 'powdered-water',
        salesCount: 0,
        createdAt: '2026-07-14T00:00:00.000Z',
        available: true,
        tags: [],
        specificationGroups: [],
      },
      variantSnap: {
        variantId: 1,
        sku: 'H2O-001',
        label: '25kg sack',
        weightGrams: 25000,
        deliveryClass: 'freight',
      },
      perTonneCents: 40000,
      resolvedUnitPriceCents: 1000,
      quantity: 1,
      configKey: '',
      materialSubtotalCents: 1000,
      blendingFeeCents: 0,
      discountableTotalCents: 1000,
      lineTotalCents: 1000,
    },
  ],
  subtotalCents: 1000,
  discountableSubtotalCents: 1000,
  blendingFeeTotalCents: 0,
  totalItems: 1,
  deliveryPreview: {
    mode: 'freight',
    chargeCents: 999,
    weightGrams: 25000,
    reason: 'A freight-class item requires freight delivery',
  },
};

export const clearCart = vi.fn();

export const cartContext: ReturnType<typeof useCart> = {
  cart,
  cartId: cart.id,
  cartGeneration: 0,
  isInitializing: false,
  isLoading: false,
  error: null,
  errorCode: null,
  errorState: null,
  isCartAvailable: true,
  pendingActions: {},
  isActionPending: () => false,
  addItem: vi.fn().mockResolvedValue(true),
  addBundle: vi.fn().mockResolvedValue(true),
  addCustomBlend: vi.fn().mockResolvedValue(true),
  replaceCustomBlend: vi.fn().mockResolvedValue(true),
  quickOrder: vi.fn().mockResolvedValue(false),
  updateQuantity: vi.fn().mockResolvedValue(true),
  removeItem: vi.fn().mockResolvedValue(true),
  reorder: vi.fn().mockResolvedValue(false),
  addSavedListToCart: vi.fn().mockResolvedValue(false),
  refreshCart: vi.fn().mockResolvedValue(true),
  retryCart: vi.fn().mockResolvedValue(true),
  clearCart,
};
export function Location() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

export async function renderCheckout(initialEntry = '/checkout') {
  const result = render(
    <MemoryRouter
      initialEntries={[initialEntry]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Location />
      <Routes>
        <Route path="/checkout" element={<CheckoutPage />} />
        <Route path="/order-confirmation/:orderId" element={<p>Order confirmation route</p>} />
      </Routes>
    </MemoryRouter>,
  );
  // useTradeProfile performs a microtask-backed anonymous reset on mount; settle it before tests assert.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return result;
}

function setInputValue(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

export async function completeDeliveryStep(
  user: ReturnType<typeof userEvent.setup>,
  options: { keyboard?: boolean } = {},
) {
  if (options.keyboard) {
    await user.type(screen.getByLabelText('Full name'), 'Checkout Test');
    await user.type(screen.getByLabelText('Email'), 'checkout@example.test');
    if (screen.queryByLabelText('Address line 1')) {
      await user.type(screen.getByLabelText('Address line 1'), '1 Test Street');
      await user.type(screen.getByLabelText('City'), 'Testville');
      await user.type(screen.getByLabelText('Postcode'), 'TE1 1ST');
    }
  } else {
    setInputValue('Full name', 'Checkout Test');
    setInputValue('Email', 'checkout@example.test');
    if (screen.queryByLabelText('Address line 1')) {
      setInputValue('Address line 1', '1 Test Street');
      setInputValue('City', 'Testville');
      setInputValue('Postcode', 'TE1 1ST');
    }
  }
  await user.click(screen.getByRole('button', { name: 'Continue to schedule' }));
  await screen.findByRole('heading', { name: 'Schedule and billing' });
}

export async function completeScheduleStep(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByLabelText(/August 3, 2026 · Morning/));
  await user.click(screen.getByRole('button', { name: 'Continue to payment' }));
  await screen.findByRole('heading', { name: 'Test card details' });
}

export async function continueToPayment(
  user: ReturnType<typeof userEvent.setup>,
  options: { keyboard?: boolean } = {},
) {
  await completeDeliveryStep(user, options);
  await completeScheduleStep(user);
}

export async function completeCard(
  user: ReturnType<typeof userEvent.setup>,
  options: { keyboard?: boolean } = {},
) {
  if (options.keyboard) {
    await user.type(screen.getByLabelText('Card number'), '4242 4242 4242 4242');
    await user.type(screen.getByLabelText('Expiry (MM/YY)'), '12/99');
    await user.type(screen.getByLabelText('CVC'), '123');
  } else {
    setInputValue('Card number', '4242 4242 4242 4242');
    setInputValue('Expiry (MM/YY)', '12/99');
    setInputValue('CVC', '123');
  }
}

export async function completeTradeCredit(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('radio', { name: 'Trade credit' }));
  await screen.findByTestId('checkout-credit-summary');
}

export async function settleCheckoutMount() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}
