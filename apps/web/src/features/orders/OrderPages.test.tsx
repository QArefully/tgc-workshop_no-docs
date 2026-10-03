import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrderDetailResponse, OrderListResponse } from '@shop/contracts/orders';
import type { InvoiceDetailResponse } from '@shop/contracts/trade-credit';
import type { ResolvedCustomBlendSnapshot } from '@shop/contracts/custom-blends';
import { ApiError } from '@/api/client';
import { cancelOrder, getOrder, getOrderInvoice, getOrders } from '@/api/orders';
import { fetchReturnOverview } from '@/api/returns';
import { useCartContext } from '@/hooks/CartContext';
import { OrderDetailPage } from './OrderDetailPage';
import { OrderHistoryPage } from './OrderHistoryPage';
import { OrderConfirmationPage } from '@/features/checkout/OrderConfirmationPage';
import { formatPostalAddress } from '@shop/contracts/address';
import {
  formatAddressLine,
  formatBillingIdentifiers,
  formatDeliverySlot,
  formatOrderTimestamp,
  formatPurchaseOrderReference,
  hasOrderTradeDetails,
  orderStatusLabel,
} from './orderPresentation';
import { formatDualTotal } from '@shop/localisation';

vi.mock('@/api/orders', () => ({
  getOrders: vi.fn(),
  getOrder: vi.fn(),
  getOrderInvoice: vi.fn(),
  cancelOrder: vi.fn(),
}));
vi.mock('@/api/returns', () => ({ fetchReturnOverview: vi.fn(), createReturnRequest: vi.fn() }));
vi.mock('@/hooks/CartContext', () => ({ useCartContext: vi.fn() }));

/** Minimal cart surface consumed by Buy Again; only the members the reorder UI reads. */
function cartStub(overrides: Record<string, unknown> = {}) {
  return {
    reorder: vi.fn().mockResolvedValue(false),
    isActionPending: vi.fn().mockReturnValue(false),
    error: null,
    ...overrides,
  } as never;
}

const detail: OrderDetailResponse = {
  id: '12',
  status: 'packed',
  version: 2,
  subtotalCents: 2200,
  discountCents: 0,
  totalCents: 2200,
  promoApplied: null,
  createdAt: '2026-07-14T00:00:00.000Z',
  canCancel: true,
  items: [
    {
      lineId: '31',
      productId: 'oat',
      productName: 'Oat powder',
      unitPriceCents: 1000,
      quantity: 1,
      discountableTotalCents: 1000,
      blendingFeeCents: 0,
      lineTotalCents: 1000,
      inventoryStatus: 'partially_backordered',
      allocatedQuantity: 1,
      backorderedQuantity: 0,
    },
    {
      lineId: '32',
      productId: 'pea',
      productName: 'Pea powder',
      unitPriceCents: 1200,
      quantity: 1,
      discountableTotalCents: 1200,
      blendingFeeCents: 0,
      lineTotalCents: 1200,
      inventoryStatus: 'allocated',
      allocatedQuantity: 1,
      backorderedQuantity: 0,
    },
  ],
  shipments: [
    {
      id: '71',
      shipmentNumber: 1,
      status: 'shipped',
      trackingReference: 'SIM-ONE',
      version: 1,
      lines: [{ lineId: '31', quantity: 1 }],
      createdAt: '2026-07-14T01:00:00.000Z',
      updatedAt: '2026-07-14T02:00:00.000Z',
    },
    {
      id: '72',
      shipmentNumber: 2,
      status: 'delivery_failed',
      trackingReference: 'SIM-TWO',
      version: 2,
      lines: [{ lineId: '32', quantity: 1 }],
      createdAt: '2026-07-14T01:00:00.000Z',
      updatedAt: '2026-07-14T03:00:00.000Z',
    },
  ],
  events: [
    {
      id: '91',
      shipmentId: null,
      type: 'order_created',
      code: null,
      title: 'Order created',
      detail: null,
      location: null,
      occurredAt: '2026-07-14T00:00:00.000Z',
    },
  ],
};

const list: OrderListResponse = {
  items: [
    {
      id: '12',
      status: 'packed',
      version: 2,
      totalCents: 2200,
      totalItems: 2,
      hasBackorder: false,
      createdAt: detail.createdAt,
    },
  ],
  page: 1,
  pageSize: 10,
};

const tradeDetail: OrderDetailResponse = {
  ...detail,
  deliveryAddress: {
    line1: 'Unit 4 Foundry Park',
    line2: 'Kiln Road',
    city: 'Sheffield',
    region: 'South Yorkshire',
    postcode: 'S9 1TQ',
    countryCode: 'GB',
  },
  billingEntity: {
    legalName: 'Northgate Building Supplies Ltd',
    registrationNumber: '09876543',
    vatNumber: 'GB123456789',
    address: {
      line1: '12 Cathedral Street',
      city: 'Sheffield',
      postcode: 'S1 2LH',
      countryCode: 'GB',
    },
  },
  deliverySlot: { date: '2026-08-07', window: 'am' },
  purchaseOrderReference: 'PO-55120',
};

const creditDetail: OrderDetailResponse = {
  ...tradeDetail,
  paymentMethod: 'trade_credit',
  companyId: '1',
  country: 'UK',
  netCents: 2200,
  vatRateBasisPoints: 0,
  vatCents: 0,
  grossCents: 2200,
};

const invoice: InvoiceDetailResponse = {
  version: 1,
  id: '301',
  invoiceNumber: 'QME-2026-000301',
  orderId: '12',
  companyId: '1',
  userId: '1',
  country: 'UK',
  paymentMethod: 'trade_credit',
  currency: 'GBP',
  terms: 'net_30',
  termsDays: 30,
  billingEntity: tradeDetail.billingEntity!,
  purchaseOrderReference: 'PO-55120',
  lines: [
    {
      lineId: '31',
      description: 'Oat powder',
      productId: 'oat',
      quantity: 1,
      unitPriceCents: 1000,
      netCents: 1000,
    },
  ],
  netCents: 2200,
  vatRateBasisPoints: 0,
  vatCents: 0,
  grossCents: 2200,
  issuedAt: '2026-07-14T00:00:00.000Z',
  dueAt: '2026-08-13T00:00:00.000Z',
  status: 'open',
  lifecycleStatus: 'open',
  lifecycleVersion: 1,
  settledAt: null,
};

const resolvedOrderBlend: ResolvedCustomBlendSnapshot = {
  configKey: 'e'.repeat(64),
  basePercentage: 75,
  mixingGroup: 'mineral',
  basePresentation: {
    category: 'Trade & Creative Materials',
    consumptionClassification: 'non-food',
    categoryFacts: {
      composition: 'Cementitious powder',
      source: 'Mineral',
      intendedUse: 'Construction',
      storage: 'Keep dry',
      colour: 'Grey',
      texture: 'Fine powder',
      consumptionClassification: 'non-food',
    },
  },
  ingredients: [
    {
      variantId: 601,
      productId: '11',
      productName: 'Chalk Filler',
      productDescription: 'Filler',
      mixingGroup: 'mineral',
      percentage: 25,
    },
  ],
  blendingFeeCents: 2_500,
  madeToOrder: true,
  returnable: false,
  ruleVersion: 1,
  resultClassification: 'non-food',
  quantity: 1,
  components: [
    {
      role: 'base',
      variantId: 31,
      productId: '31',
      productName: 'Oat powder',
      productDescription: 'Base powder',
      sku: 'OAT-001',
      variantLabel: '25 kg sack',
      mixingGroup: 'mineral',
      consumptionClassification: 'non-food',
      percentage: 75,
      weightGrams: 18_750,
      sourceUnitPriceCents: 1_000,
      tierDiscountPct: 0,
      unitContributionCents: 750,
      subtotalCents: 750,
    },
    {
      role: 'ingredient',
      variantId: 601,
      productId: '11',
      productName: 'Chalk Filler',
      productDescription: 'Filler',
      sku: 'CHALK-601',
      variantLabel: '25 kg sack',
      mixingGroup: 'mineral',
      consumptionClassification: 'non-food',
      percentage: 25,
      weightGrams: 6_250,
      sourceUnitPriceCents: 1_200,
      tierDiscountPct: 0,
      unitContributionCents: 300,
      subtotalCents: 300,
    },
  ],
  materialUnitPriceCents: 1_050,
  materialSubtotalCents: 1_050,
  discountableTotalCents: 1_050,
  lineTotalCents: 3_550,
};

function ConfirmationRoutes() {
  const navigate = useNavigate();
  return (
    <>
      <button onClick={() => navigate('/order-confirmation/13')}>Open order 13</button>
      <Routes>
        <Route path="/order-confirmation/:orderId" element={<OrderConfirmationPage />} />
      </Routes>
    </>
  );
}

function OrderNavigationRoutes() {
  const navigate = useNavigate();
  return (
    <>
      <button onClick={() => navigate('/orders/13')}>Open order 13</button>
      <Routes>
        <Route path="/orders/:orderId" element={<OrderDetailPage />} />
      </Routes>
    </>
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe('customer order UI', () => {
  beforeEach(() => {
    vi.mocked(getOrders).mockReset();
    vi.mocked(getOrder).mockReset();
    vi.mocked(getOrderInvoice).mockReset();
    vi.mocked(cancelOrder).mockReset();
    vi.mocked(fetchReturnOverview).mockReset();
    vi.mocked(useCartContext).mockReset();
    vi.mocked(useCartContext).mockReturnValue(cartStub());
    vi.mocked(fetchReturnOverview).mockResolvedValue({
      windowDays: 30,
      eligibleLines: [],
      requests: [],
    });
  });

  it('renders list results and advances the URL-owned page', async () => {
    const fullPage = {
      ...list,
      items: Array.from({ length: 10 }, (_, index) => ({
        ...list.items[0]!,
        id: String(index + 12),
      })),
    };
    vi.mocked(getOrders)
      .mockResolvedValueOnce(fullPage)
      .mockResolvedValueOnce({ ...list, items: [], page: 2 });
    const user = userEvent.setup();
    render(
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        initialEntries={['/orders']}
      >
        <Routes>
          <Route path="/orders" element={<OrderHistoryPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('link', { name: 'Order #12' })).toHaveAttribute(
      'href',
      '/orders/12',
    );
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(getOrders).toHaveBeenLastCalledWith(2, 10));
    expect(await screen.findByText('No orders yet')).toBeInTheDocument();
  });

  it('shows list errors with retry', async () => {
    vi.mocked(getOrders)
      .mockRejectedValueOnce(new Error('Network unavailable'))
      .mockResolvedValueOnce(list);
    const user = userEvent.setup();
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <OrderHistoryPage />
      </MemoryRouter>,
    );
    expect(
      await screen.findByText('Unable to complete this order request. Try again.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: 'Order #12' })).toBeInTheDocument();
  });

  it('shows the purchase order reference on a history row that carries one', async () => {
    vi.mocked(getOrders).mockResolvedValue({
      ...list,
      items: [{ ...list.items[0]!, purchaseOrderReference: 'PO-55120' }],
    });
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <OrderHistoryPage />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('link', { name: 'Order #12' })).toBeInTheDocument();
    expect(screen.getByText('PO-55120')).toBeInTheDocument();
    expect(screen.getByText(/PO reference/)).toBeInTheDocument();
  });

  it('renders a legacy history row with no purchase order reference markup', async () => {
    vi.mocked(getOrders).mockResolvedValue(list);
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <OrderHistoryPage />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('link', { name: 'Order #12' })).toBeInTheDocument();
    expect(screen.queryByText(/PO reference/)).not.toBeInTheDocument();
  });

  it('renders split shipments and requires a second cancellation confirmation', async () => {
    vi.mocked(getOrder).mockResolvedValue(detail);
    vi.mocked(cancelOrder).mockResolvedValue({
      ...detail,
      status: 'cancelled',
      version: 3,
      canCancel: false,
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        initialEntries={['/orders/12']}
      >
        <Routes>
          <Route path="/orders/:orderId" element={<OrderDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Tracking reference: SIM-ONE')).toBeInTheDocument();
    expect(screen.getByText('Delivery failed')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel order' }));
    expect(screen.getByRole('dialog', { name: 'Cancel order #12?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm cancellation' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Confirm cancellation' }));
    await waitFor(() => expect(cancelOrder).toHaveBeenCalledOnce());
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Order #12 was cancelled. Simulated fulfilment has stopped; unshipped allocated stock was released and no refund was issued.',
      ),
    ).toBeInTheDocument();
  });

  it('keeps blend composition, the fee split, and the made-to-order terms on the order record', async () => {
    const configKey = 'c'.repeat(64);
    vi.mocked(getOrder).mockResolvedValue({
      ...detail,
      items: [
        {
          ...detail.items[0]!,
          discountableTotalCents: 1000,
          blendingFeeCents: 2500,
          lineTotalCents: 3500,
          customBlend: {
            configKey,
            basePercentage: 75,
            mixingGroup: 'mineral',
            basePresentation: {
              category: 'Trade & Creative Materials',
              consumptionClassification: 'non-food',
              categoryFacts: {
                texture: 'Fine powder',
                colour: 'White',
                source: 'Mineral',
                intendedUse: 'Construction',
                storage: 'Cool dry',
                consumptionClassification: 'non-food',
              },
            },
            ingredients: [
              {
                variantId: 601,
                productId: '11',
                productName: 'Chalk Filler',
                productDescription: 'Filler',
                mixingGroup: 'mineral',
                percentage: 25,
              },
            ],
            blendingFeeCents: 2500,
            madeToOrder: true,
            returnable: false,
          },
        },
      ],
    });
    render(
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        initialEntries={['/orders/12']}
      >
        <Routes>
          <Route path="/orders/:orderId" element={<OrderDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/75% Oat powder — 25% Chalk Filler/)).toBeInTheDocument();
    expect(screen.getByText('Custom blend')).toBeInTheDocument();
    expect(screen.getByTestId('custom-blend-livery')).toBeInTheDocument();
    expect(screen.getByTestId('custom-blend-livery')).toHaveAttribute('data-vessel', 'neutral');
    expect(screen.getByTestId('custom-blend-livery')).toHaveAttribute(
      'data-colour-scheme',
      'neutral',
    );
    expect(screen.queryByText('Not for consumption')).not.toBeInTheDocument();
    expect(screen.getByText(/Base material: \$12.50.*Blending fee: \$31.25/)).toBeInTheDocument();
    expect(
      screen.getByText(/Made to order\. Custom blends cannot be returned/),
    ).toBeInTheDocument();
  });

  it('renders resolved result safety and frozen component totals on the order record', async () => {
    vi.mocked(getOrder).mockResolvedValue({
      ...detail,
      items: [
        {
          ...detail.items[0]!,
          productId: '31',
          unitPriceCents: resolvedOrderBlend.materialUnitPriceCents,
          discountableTotalCents: resolvedOrderBlend.discountableTotalCents,
          blendingFeeCents: resolvedOrderBlend.blendingFeeCents,
          lineTotalCents: resolvedOrderBlend.lineTotalCents,
          variantSnapshot: {
            variantId: 31,
            sku: 'OAT-001',
            label: '25 kg sack',
            unitPriceCents: 1000,
            weightGrams: 25_000,
            consumptionClassification: 'non-food',
            deliveryClass: 'freight',
          },
          customBlend: resolvedOrderBlend,
        },
      ],
    });
    render(
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        initialEntries={['/orders/12']}
      >
        <Routes>
          <Route path="/orders/:orderId" element={<OrderDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('order-blend-result')).toHaveTextContent('Non-food blend');
    expect(screen.getByTestId('order-blend-safety')).toHaveTextContent('Not for consumption');
    expect(screen.getByText('Component weight: 18.75 kg')).toBeInTheDocument();
    expect(screen.getByText('Source price: $12.50 per sack')).toBeInTheDocument();
    expect(screen.getByText('Unit contribution: $9.38')).toBeInTheDocument();
    expect(screen.getByText('Material price per sack: $13.13')).toBeInTheDocument();
    expect(screen.getByText('Material total: $13.13')).toBeInTheDocument();
    expect(screen.getByText('Blending fee: $31.25')).toBeInTheDocument();
    expect(screen.getByText('Blend total: $44.38')).toBeInTheDocument();
    expect(screen.getByTestId('custom-blend-livery')).toHaveAttribute(
      'data-result-classification',
      'non-food',
    );
  });

  it('uses a neutral Custom Blend presentation for legacy order snapshots', async () => {
    vi.mocked(getOrder).mockResolvedValue({
      ...detail,
      items: [
        {
          ...detail.items[0]!,
          blendingFeeCents: 2500,
          lineTotalCents: 3500,
          customBlend: {
            configKey: 'd'.repeat(64),
            basePercentage: 75,
            mixingGroup: 'mineral',
            basePresentation: resolvedOrderBlend.basePresentation,
            ingredients: [
              {
                variantId: 601,
                productId: '11',
                productName: 'Chalk Filler',
                productDescription: 'Filler',
                mixingGroup: 'mineral',
                percentage: 25,
              },
            ],
            blendingFeeCents: 2500,
            madeToOrder: true,
            returnable: false,
          },
        },
      ],
    });
    render(
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        initialEntries={['/orders/12']}
      >
        <Routes>
          <Route path="/orders/:orderId" element={<OrderDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('custom-blend-livery')).toHaveAttribute(
      'data-vessel',
      'neutral',
    );
    expect(screen.getByTestId('custom-blend-livery')).not.toHaveAttribute(
      'data-vessel',
      'food-bag',
    );
    expect(screen.getByTestId('custom-blend-livery')).toHaveAttribute(
      'data-colour-scheme',
      'neutral',
    );
    expect(screen.queryByText('Not for consumption')).not.toBeInTheDocument();
    expect(screen.getByTestId('order-blend-legacy')).toHaveTextContent(
      'Pricing and safety details are unavailable for this historic blend.',
    );
    expect(screen.queryByTestId('order-blend-result')).not.toBeInTheDocument();
  });

  it('shows order allocation state without an estimated delivery date', async () => {
    vi.mocked(getOrder).mockResolvedValue({
      ...detail,
      items: [
        {
          ...detail.items[0]!,
          inventoryStatus: 'partially_backordered',
          allocatedQuantity: 1,
          backorderedQuantity: 2,
          quantity: 3,
        },
      ],
    });
    render(
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        initialEntries={['/orders/12']}
      >
        <Routes>
          <Route path="/orders/:orderId" element={<OrderDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('1 allocated; 2 awaiting stock')).toBeInTheDocument();
    expect(screen.queryByText(/estimated|days/i)).not.toBeInTheDocument();
  });

  it('refreshes rather than claiming cancellation when server reports stale state', async () => {
    vi.mocked(getOrder)
      .mockResolvedValueOnce(detail)
      .mockResolvedValueOnce({ ...detail, status: 'shipped', canCancel: false, version: 3 });
    vi.mocked(cancelOrder).mockRejectedValue(new ApiError('Stale version', 409));
    const user = userEvent.setup();
    render(
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        initialEntries={['/orders/12']}
      >
        <Routes>
          <Route path="/orders/:orderId" element={<OrderDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByRole('button', { name: 'Cancel order' });
    await user.click(screen.getByRole('button', { name: 'Cancel order' }));
    await user.click(screen.getByRole('button', { name: 'Confirm cancellation' }));
    // Name filter disambiguates from the Buy Again region, which is also role=status but is
    // aria-labelled; the cancel-conflict paragraph has no accessible name.
    expect(await screen.findByRole('status', { name: '' })).toHaveTextContent(
      /This order changed before cancellation/,
    );
    expect(screen.getByLabelText('Order status: Shipped')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel order' })).not.toBeInTheDocument();
  });

  it('keeps keyboard focus in cancellation confirmation and restores it after Escape', async () => {
    vi.mocked(getOrder).mockResolvedValue(detail);
    const user = userEvent.setup();
    render(
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        initialEntries={['/orders/12']}
      >
        <Routes>
          <Route path="/orders/:orderId" element={<OrderDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    const trigger = await screen.findByRole('button', { name: 'Cancel order' });
    await user.click(trigger);
    const confirm = screen.getByRole('button', { name: 'Confirm cancellation' });
    expect(confirm).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Keep order' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('keeps guest confirmation failures safe and ignores stale detail responses', async () => {
    let resolveFirst!: (value: OrderDetailResponse) => void;
    vi.mocked(getOrder)
      .mockImplementationOnce(
        () =>
          new Promise<OrderDetailResponse>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({ ...detail, id: '13' });
    const user = userEvent.setup();
    render(
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        initialEntries={['/order-confirmation/12']}
      >
        <ConfirmationRoutes />
      </MemoryRouter>,
    );
    await waitFor(() => expect(getOrder).toHaveBeenCalledWith('12'));
    await user.click(screen.getByRole('button', { name: 'Open order 13' }));
    expect(await screen.findByText('Order #13')).toBeInTheDocument();
    await act(async () => {
      resolveFirst(detail);
      await Promise.resolve();
    });
    expect(screen.queryByText('Order #12')).not.toBeInTheDocument();
  });

  it('shows foreign or expired guest confirmation as safe not-found', async () => {
    vi.mocked(getOrder).mockRejectedValue(new ApiError('Order', 404));
    render(
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        initialEntries={['/order-confirmation/12']}
      >
        <Routes>
          <Route path="/order-confirmation/:orderId" element={<OrderConfirmationPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Order not found.')).toBeInTheDocument();
  });

  it('renders ReturnPanel below order detail on delivered orders', async () => {
    const deliveredDetail: OrderDetailResponse = {
      ...detail,
      status: 'delivered',
      canCancel: false,
      shipments: [
        {
          ...detail.shipments[0]!,
          status: 'delivered',
        },
      ],
    };
    vi.mocked(getOrder).mockResolvedValue(deliveredDetail);
    vi.mocked(fetchReturnOverview).mockResolvedValue({
      windowDays: 30,
      eligibleLines: [
        {
          shipmentId: '71',
          shipmentNumber: 1,
          orderLineItemId: '31',
          productName: 'Oat powder',
          deliveredQuantity: 3,
          reservedQuantity: 0,
          availableQuantity: 3,
          deliveredAt: '2026-07-01T12:00:00.000Z',
          windowClosesAt: '2026-07-31T12:00:00.000Z',
        },
      ],
      requests: [],
    });

    render(
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        initialEntries={['/orders/12']}
      >
        <Routes>
          <Route path="/orders/:orderId" element={<OrderDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    // Core order content renders
    expect(await screen.findByText('Order #12')).toBeInTheDocument();
    // Return panel renders
    expect(await screen.findByText('Return items')).toBeInTheDocument();
    expect(await screen.findByText('(3 of 3 available)')).toBeInTheDocument();
    // Oat powder appears in both order detail and return panel
    expect(screen.getAllByText('Oat powder')).toHaveLength(2);
  });

  it('shows delivery address, booked slot, billing entity, and PO reference on a trade order', async () => {
    vi.mocked(getOrder).mockResolvedValue(tradeDetail);
    render(
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        initialEntries={['/orders/12']}
      >
        <Routes>
          <Route path="/orders/:orderId" element={<OrderDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Delivery and billing')).toBeInTheDocument();
    expect(
      screen.getByText('Unit 4 Foundry Park, Kiln Road, Sheffield, South Yorkshire, S9 1TQ, GB'),
    ).toBeInTheDocument();
    expect(screen.getByText(formatDeliverySlot(tradeDetail.deliverySlot)!)).toBeInTheDocument();
    expect(screen.getByText('Northgate Building Supplies Ltd')).toBeInTheDocument();
    expect(screen.getByText('12 Cathedral Street, Sheffield, S1 2LH, GB')).toBeInTheDocument();
    expect(screen.getByText('Reg. 09876543 · VAT GB123456789')).toBeInTheDocument();
    expect(screen.getByText('PO-55120')).toBeInTheDocument();
  });

  it('loads an immutable credit invoice for an owned order and hides returns', async () => {
    vi.mocked(getOrder).mockResolvedValue({ ...creditDetail, status: 'delivered' });
    vi.mocked(getOrderInvoice).mockResolvedValue(invoice);

    render(
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        initialEntries={['/orders/12']}
      >
        <Routes>
          <Route path="/orders/:orderId" element={<OrderDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(getOrderInvoice).toHaveBeenCalled());
    expect(await screen.findByText(/Invoice number: QME-2026-000301/)).toBeInTheDocument();
    expect(screen.getByText('Trade credit')).toBeInTheDocument();
    expect(screen.getByTestId('invoice-status')).toHaveAttribute(
      'aria-label',
      'Invoice status: Open',
    );
    expect(screen.getByText('Payment terms: net 30 days')).toBeInTheDocument();
    expect(screen.queryByText('Return items')).not.toBeInTheDocument();
  });

  it('keeps a non-UK invoice total local and qualifies its GBP settlement separately', async () => {
    vi.mocked(getOrder).mockResolvedValue({ ...creditDetail, status: 'delivered' });
    vi.mocked(getOrderInvoice).mockResolvedValue(invoice);

    render(
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        initialEntries={['/orders/12']}
      >
        <Routes>
          <Route path="/orders/:orderId" element={<OrderDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const invoiceCard = await screen.findByTestId('invoice-details');
    expect(within(invoiceCard).getByText('$27.50')).toBeInTheDocument();
    expect(within(invoiceCard).getByText('GBP settlement: £22.00')).toBeInTheDocument();
    expect(within(invoiceCard).getByText('Net (GBP): £22.00')).toBeInTheDocument();
    expect(within(invoiceCard).queryByText(/Net \(GBP\): \$27\.50/)).not.toBeInTheDocument();
  });

  it('does not carry the previous invoice across deferred order navigation', async () => {
    const nextOrder = deferred<OrderDetailResponse>();
    vi.mocked(getOrder)
      .mockResolvedValueOnce({ ...creditDetail, status: 'delivered' })
      .mockReturnValueOnce(nextOrder.promise);
    vi.mocked(getOrderInvoice).mockImplementation((id) =>
      Promise.resolve(
        id === '13'
          ? { ...invoice, id: '302', invoiceNumber: 'QME-2026-000302', orderId: '13' }
          : invoice,
      ),
    );
    const user = userEvent.setup();

    render(
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        initialEntries={['/orders/12']}
      >
        <OrderNavigationRoutes />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/Invoice number: QME-2026-000301/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open order 13' }));
    await waitFor(() => expect(getOrder).toHaveBeenCalledWith('13'));
    expect(screen.queryByText(/Invoice number: QME-2026-000301/)).not.toBeInTheDocument();
    expect(getOrderInvoice).toHaveBeenCalledTimes(1);

    await act(async () => {
      nextOrder.resolve({ ...creditDetail, id: '13', status: 'delivered' });
      await nextOrder.promise;
    });
    expect(await screen.findByText(/Invoice number: QME-2026-000302/)).toBeInTheDocument();
    expect(getOrderInvoice).toHaveBeenCalledWith('13', expect.anything());
  });

  it('omits the delivery and billing section entirely for a legacy order', async () => {
    vi.mocked(getOrder).mockResolvedValue(detail);
    render(
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        initialEntries={['/orders/12']}
      >
        <Routes>
          <Route path="/orders/:orderId" element={<OrderDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Order #12')).toBeInTheDocument();
    expect(screen.queryByText('Delivery and billing')).not.toBeInTheDocument();
    expect(screen.queryByText('Delivery address')).not.toBeInTheDocument();
    expect(screen.queryByText('Delivery slot')).not.toBeInTheDocument();
    expect(screen.queryByText('Billing details')).not.toBeInTheDocument();
    expect(screen.queryByText('Purchase order reference')).not.toBeInTheDocument();
  });

  it('renders only the captured fields when a trade order is partially populated', async () => {
    vi.mocked(getOrder).mockResolvedValue({
      ...detail,
      deliverySlot: { date: '2026-08-08', window: 'pm' },
      purchaseOrderReference: 'PO-77',
    });
    render(
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        initialEntries={['/orders/12']}
      >
        <Routes>
          <Route path="/orders/:orderId" element={<OrderDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Delivery and billing')).toBeInTheDocument();
    expect(
      screen.getByText(formatDeliverySlot({ date: '2026-08-08', window: 'pm' })!),
    ).toBeInTheDocument();
    expect(screen.getByText('PO-77')).toBeInTheDocument();
    expect(screen.queryByText('Delivery address')).not.toBeInTheDocument();
    expect(screen.queryByText('Billing details')).not.toBeInTheDocument();
  });
});

describe('Buy Again placement on the order surfaces', () => {
  beforeEach(() => {
    vi.mocked(getOrders).mockReset();
    vi.mocked(getOrder).mockReset();
    vi.mocked(getOrderInvoice).mockReset();
    vi.mocked(useCartContext).mockReset();
    vi.mocked(useCartContext).mockReturnValue(cartStub());
    vi.mocked(fetchReturnOverview).mockReset();
    vi.mocked(fetchReturnOverview).mockResolvedValue({
      windowDays: 30,
      eligibleLines: [],
      requests: [],
    });
  });

  it('offers Buy again on every order-history row', async () => {
    vi.mocked(getOrders).mockResolvedValue({
      ...list,
      items: [list.items[0]!, { ...list.items[0]!, id: '13' }],
    });
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <OrderHistoryPage />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole('button', { name: 'Buy again from order #12' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Buy again from order #13' })).toBeInTheDocument();
    expect(
      screen.getByRole('status', { name: 'Buy again result for order #12' }),
    ).toBeEmptyDOMElement();
  });

  it('runs the reorder for the row that was activated', async () => {
    const reorder = vi.fn().mockResolvedValue(false);
    vi.mocked(useCartContext).mockReturnValue(cartStub({ reorder }));
    vi.mocked(getOrders).mockResolvedValue({
      ...list,
      items: [list.items[0]!, { ...list.items[0]!, id: '13' }],
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <OrderHistoryPage />
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole('button', { name: 'Buy again from order #13' }));
    await waitFor(() => expect(reorder).toHaveBeenCalledWith('13'));
    expect(reorder).toHaveBeenCalledOnce();
  });

  it('offers Buy again on order detail alongside the existing cancel surface', async () => {
    vi.mocked(getOrder).mockResolvedValue(detail);
    render(
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        initialEntries={['/orders/12']}
      >
        <Routes>
          <Route path="/orders/:orderId" element={<OrderDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole('button', { name: 'Buy again from order #12' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Buy again' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel order' })).toBeInTheDocument();
  });
});

describe('order trade detail presentation', () => {
  it('delegates address rendering to the shared contracts formatter', () => {
    expect(formatAddressLine(undefined)).toBeUndefined();
    expect(formatAddressLine(tradeDetail.deliveryAddress)).toBe(
      formatPostalAddress(tradeDetail.deliveryAddress!),
    );
  });

  it('renders a booked slot on its calendar day regardless of host timezone', () => {
    expect(formatDeliverySlot(undefined)).toBeUndefined();
    expect(formatDeliverySlot({ date: '2026-08-07', window: 'am' })).toBe(
      'August 7, 2026 · Morning',
    );
    expect(formatDeliverySlot({ date: '2026-08-07', window: 'pm' })).toBe(
      'August 7, 2026 · Afternoon',
    );
  });

  it('keeps civil delivery dates stable across country zones and midnight boundaries', () => {
    const us = formatDeliverySlot({ date: '2026-03-29', window: 'am' }, 'US');
    const de = formatDeliverySlot({ date: '2026-03-29', window: 'am' }, 'DE');
    expect(us).toContain('March 29, 2026');
    expect(de).toContain('29. März 2026');
    expect(us).not.toContain('March 28');
    expect(de).not.toContain('28. März');
  });

  it('formats instants in country zones through DST transitions', () => {
    expect(formatOrderTimestamp('2026-03-29T00:30:00.000Z', 'DE')).toMatch(/01:30/);
    expect(formatOrderTimestamp('2026-03-29T01:30:00.000Z', 'DE')).toMatch(/03:30/);
  });

  it('uses a translated fallback for invalid timestamps', () => {
    const value = formatOrderTimestamp('not-a-timestamp', 'DE');
    expect(value).toBe('Datum nicht verfügbar');
    expect(value).not.toContain('Invalid Date');
  });

  it('localizes lifecycle status labels and keeps order totals dual', () => {
    expect(orderStatusLabel('shipped', 'DE')).toBe('Versandt');
    expect(formatDualTotal(2200, 'US')).toEqual({ display: '$27.50', settlement: '£22.00' });
    expect(formatDualTotal(2200, 'UK')).toEqual({ display: '£22.00' });
  });

  it('drops billing identifiers that were never recorded', () => {
    expect(formatBillingIdentifiers(undefined)).toBeUndefined();
    const base = tradeDetail.billingEntity!;
    expect(formatBillingIdentifiers(base)).toBe('Reg. 09876543 · VAT GB123456789');
    expect(formatBillingIdentifiers({ ...base, registrationNumber: null })).toBe('VAT GB123456789');
    expect(formatBillingIdentifiers({ ...base, vatNumber: null })).toBe('Reg. 09876543');
    expect(
      formatBillingIdentifiers({ ...base, registrationNumber: null, vatNumber: null }),
    ).toBeUndefined();
  });

  it('treats a blank purchase order reference as absent', () => {
    expect(formatPurchaseOrderReference(undefined)).toBeUndefined();
    expect(formatPurchaseOrderReference('   ')).toBeUndefined();
    expect(formatPurchaseOrderReference('  PO-55120 ')).toBe('PO-55120');
  });

  it('reports no trade details for a legacy order', () => {
    expect(hasOrderTradeDetails(detail)).toBe(false);
    expect(hasOrderTradeDetails(tradeDetail)).toBe(true);
    expect(hasOrderTradeDetails({ purchaseOrderReference: '   ' })).toBe(false);
  });
});
