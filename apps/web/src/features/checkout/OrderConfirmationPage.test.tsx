import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrderDetailResponse } from '@shop/contracts/orders';
import { getOrder, getOrderInvoice } from '@/api/orders';
import { OrderConfirmationPage } from './OrderConfirmationPage';

vi.mock('@/api/orders', () => ({ getOrder: vi.fn(), getOrderInvoice: vi.fn() }));

const order: OrderDetailResponse = {
  id: '12',
  status: 'processing',
  version: 0,
  subtotalCents: 1000,
  discountCents: 0,
  totalCents: 1000,
  promoApplied: null,
  createdAt: '2026-07-14T00:00:00.000Z',
  canCancel: true,
  items: [
    {
      lineId: '31',
      productId: 'cement',
      productName: 'Rapid-set cement',
      unitPriceCents: 1000,
      quantity: 1,
      discountableTotalCents: 1000,
      blendingFeeCents: 0,
      lineTotalCents: 1000,
      inventoryStatus: 'allocated',
      allocatedQuantity: 1,
      backorderedQuantity: 0,
    },
  ],
  shipments: [],
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
  deliveryAddress: {
    line1: '12 Northgate Way',
    city: 'Leeds',
    postcode: 'LS1 4AB',
    countryCode: 'GB',
  },
  billingEntity: {
    legalName: 'Northgate Builders Ltd',
    registrationNumber: '09876543',
    vatNumber: null,
    address: {
      line1: '1 Finance Street',
      city: 'Leeds',
      postcode: 'LS1 9ZZ',
      countryCode: 'GB',
    },
  },
  deliverySlot: { date: '2026-08-03', window: 'am' },
  purchaseOrderReference: 'PO-4417',
};

describe('OrderConfirmationPage', () => {
  beforeEach(() => {
    vi.mocked(getOrder).mockReset();
    vi.mocked(getOrderInvoice).mockReset();
  });

  it('confirms the destination, slot, billing entity, and purchase order reference', async () => {
    vi.mocked(getOrder).mockResolvedValue(order);

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

    expect(await screen.findByText('Your order is confirmed.')).toBeInTheDocument();
    expect(screen.getByText('12 Northgate Way, Leeds, LS1 4AB, GB')).toBeInTheDocument();
    expect(screen.getByText(/August 3, 2026 · Morning/)).toBeInTheDocument();
    expect(screen.getByText('Northgate Builders Ltd')).toBeInTheDocument();
    expect(screen.getByText('PO-4417')).toBeInTheDocument();
  });

  it('does not request an invoice through the guest order capability', async () => {
    vi.mocked(getOrder).mockResolvedValue({
      ...order,
      paymentMethod: 'trade_credit',
      companyId: '1',
      country: 'UK',
      netCents: 1000,
      vatRateBasisPoints: 0,
      vatCents: 0,
      grossCents: 1000,
    });

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

    expect(await screen.findByText('Your order is confirmed.')).toBeInTheDocument();
    expect(getOrderInvoice).not.toHaveBeenCalled();
  });
});
