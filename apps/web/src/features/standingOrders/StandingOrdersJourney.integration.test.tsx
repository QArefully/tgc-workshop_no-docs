import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { StandingOrder, StandingOrderRun } from '@shop/contracts/standing-orders';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as ordersApi from '@/api/orders';
import * as savedListsApi from '@/api/savedLists';
import * as standingOrdersApi from '@/api/standingOrders';
import { StandingOrdersPage } from './StandingOrdersPage';

vi.mock('@/api/orders', () => ({ getOrders: vi.fn() }));
vi.mock('@/api/savedLists', () => ({ getSavedLists: vi.fn() }));
vi.mock('@/api/standingOrders', () => ({
  createStandingOrder: vi.fn(),
  deleteStandingOrder: vi.fn(),
  getStandingOrderRuns: vi.fn(),
  getStandingOrders: vi.fn(),
  runStandingOrderNow: vi.fn(),
  updateStandingOrder: vi.fn(),
}));

const standingOrder: StandingOrder = {
  id: '1',
  name: 'Depot restock',
  source: { kind: 'saved_list', listId: '7' },
  cadence: 'weekly',
  nextRunAt: '2026-08-08T00:00:00.000Z',
  lastRunAt: null,
  active: true,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};
const run: StandingOrderRun = {
  id: '9',
  standingOrderId: '1',
  jobId: null,
  cartId: 'cart-1',
  runAt: '2026-08-02T00:00:00.000Z',
  status: 'completed',
  addedLineCount: 1,
  skippedLineCount: 1,
  failureReason: null,
  outcomes: [
    {
      orderLineItemId: '1',
      productId: 'cement',
      productName: 'Cement',
      variantId: 1,
      sku: 'CEM',
      configKey: '',
      quantity: 4,
      status: 'added',
      reason: null,
      orderedUnitPriceCents: 100,
      currentUnitPriceCents: 100,
      priceChanged: false,
    },
    {
      orderLineItemId: '2',
      productId: 'old',
      productName: 'Old cement',
      variantId: 2,
      sku: 'OLD',
      configKey: '',
      quantity: 4,
      status: 'skipped',
      reason: 'VARIANT_RETIRED',
      orderedUnitPriceCents: 100,
      currentUnitPriceCents: null,
      priceChanged: false,
    },
  ],
};

describe('Standing orders journey', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(standingOrdersApi.getStandingOrders).mockResolvedValue([standingOrder]);
    vi.mocked(savedListsApi.getSavedLists).mockResolvedValue([]);
    vi.mocked(ordersApi.getOrders).mockResolvedValue({ items: [], page: 1, pageSize: 50 });
    vi.mocked(standingOrdersApi.runStandingOrderNow).mockResolvedValue(run);
    vi.mocked(standingOrdersApi.getStandingOrderRuns).mockResolvedValue([run]);
  });

  it('runs once and presents mixed server outcomes in history', async () => {
    const user = userEvent.setup();
    render(<StandingOrdersPage />);
    await user.click(await screen.findByRole('button', { name: 'Run now' }));
    await waitFor(() => expect(standingOrdersApi.runStandingOrderNow).toHaveBeenCalledOnce());
    expect(await screen.findByLabelText('Run history for 1')).toHaveTextContent(
      '1 added; 1 could not be added.',
    );
    expect(screen.getByText('Cement × 4')).toBeInTheDocument();
    expect(screen.getByText('Old cement × 4')).toBeInTheDocument();
    expect(screen.getByText('We no longer sell this item.')).toBeInTheDocument();
  });

  it('releases Run now after history and update requests start during a deferred run', async () => {
    const user = userEvent.setup();
    let settleRun!: (value: StandingOrderRun) => void;
    vi.mocked(standingOrdersApi.runStandingOrderNow).mockImplementationOnce(
      () => new Promise((resolve) => (settleRun = resolve)),
    );
    vi.mocked(standingOrdersApi.updateStandingOrder).mockResolvedValue({
      ...standingOrder,
      active: false,
    });
    render(<StandingOrdersPage />);
    await user.click(await screen.findByRole('button', { name: 'Run now' }));
    await user.click(screen.getByRole('button', { name: 'Show run history' }));
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    settleRun(run);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Run now' })).toBeEnabled());
  });
});
