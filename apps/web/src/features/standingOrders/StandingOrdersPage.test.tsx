import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { StandingOrder } from '@shop/contracts/standing-orders';
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

const order = (changes: Partial<StandingOrder> = {}): StandingOrder => ({
  id: '1',
  name: 'Depot restock',
  source: { kind: 'saved_list', listId: '7' },
  cadence: 'weekly',
  nextRunAt: '2026-08-08T00:00:00.000Z',
  lastRunAt: null,
  active: true,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  ...changes,
});

function setup(orders: StandingOrder[] = []) {
  vi.mocked(standingOrdersApi.getStandingOrders).mockResolvedValue(orders);
  vi.mocked(savedListsApi.getSavedLists).mockResolvedValue([
    {
      listId: '7',
      name: 'Depot restock',
      isDefault: false,
      itemCount: 2,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    },
  ]);
  vi.mocked(ordersApi.getOrders).mockResolvedValue({
    items: [
      {
        id: '11',
        status: 'delivered',
        version: 1,
        totalCents: 1000,
        totalItems: 2,
        hasBackorder: false,
        createdAt: '2026-08-01T00:00:00.000Z',
      },
    ],
    page: 1,
    pageSize: 50,
  });
  return render(<StandingOrdersPage />);
}

describe('StandingOrdersPage', () => {
  beforeEach(() => vi.resetAllMocks());

  it('creates from a saved list and supports past-order source selection', async () => {
    const user = userEvent.setup();
    const created = order({ id: '2', name: 'Weekly cement' });
    vi.mocked(standingOrdersApi.createStandingOrder).mockResolvedValue(created);
    setup();
    await user.type(await screen.findByRole('textbox', { name: 'Name' }), 'Weekly cement');
    await user.click(screen.getByRole('button', { name: 'Create standing order' }));
    await waitFor(() =>
      expect(standingOrdersApi.createStandingOrder).toHaveBeenCalledWith({
        name: 'Weekly cement',
        source: { kind: 'saved_list', listId: '7' },
        cadence: 'weekly',
      }),
    );
    await user.selectOptions(screen.getByLabelText('Repeat from'), 'order');
    expect(screen.getByLabelText('Source')).toHaveValue('11');
  });

  it('shows empty state, retries initial failure, and pauses an order', async () => {
    const user = userEvent.setup();
    vi.mocked(standingOrdersApi.getStandingOrders)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([order()]);
    vi.mocked(standingOrdersApi.updateStandingOrder).mockResolvedValue(order({ active: false }));
    setup();
    await user.click(await screen.findByRole('button', { name: 'Try again' }));
    await user.click(await screen.findByRole('button', { name: 'Pause' }));
    await waitFor(() =>
      expect(standingOrdersApi.updateStandingOrder).toHaveBeenCalledWith('1', { active: false }),
    );
    expect(await screen.findByText('Paused')).toBeInTheDocument();
  });

  it('deletes a standing order from its management card', async () => {
    const user = userEvent.setup();
    vi.mocked(standingOrdersApi.deleteStandingOrder).mockResolvedValue();
    setup([order()]);
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(standingOrdersApi.deleteStandingOrder).toHaveBeenCalledWith('1'));
    expect(await screen.findByText('No standing orders yet.')).toBeInTheDocument();
  });

  it('ignores a stale update completion', async () => {
    const user = userEvent.setup();
    let settleFirst!: (value: StandingOrder) => void;
    vi.mocked(standingOrdersApi.updateStandingOrder)
      .mockImplementationOnce(() => new Promise((resolve) => (settleFirst = resolve)))
      .mockResolvedValueOnce(order({ cadence: 'monthly' }));
    setup([order()]);
    await screen.findByRole('button', { name: 'Pause' });
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    await user.selectOptions(
      screen.getByLabelText('Cadence', { selector: '#cadence-1' }),
      'monthly',
    );
    await waitFor(() => expect(standingOrdersApi.updateStandingOrder).toHaveBeenCalledTimes(2));
    settleFirst(order({ active: false }));
    await waitFor(() =>
      expect(screen.getByLabelText('Cadence', { selector: '#cadence-1' })).toHaveValue('monthly'),
    );
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('does not let a stale reload overwrite a completed update', async () => {
    const user = userEvent.setup();
    let settleReload!: (value: StandingOrder[]) => void;
    vi.mocked(standingOrdersApi.getStandingOrders)
      .mockResolvedValueOnce([order()])
      .mockImplementationOnce(() => new Promise((resolve) => (settleReload = resolve)));
    vi.mocked(savedListsApi.getSavedLists).mockResolvedValue([]);
    vi.mocked(ordersApi.getOrders).mockResolvedValue({ items: [], page: 1, pageSize: 50 });
    vi.mocked(standingOrdersApi.runStandingOrderNow).mockResolvedValue({
      id: 'run-1',
      standingOrderId: '1',
      jobId: null,
      cartId: 'cart-1',
      runAt: '2026-08-02T00:00:00.000Z',
      status: 'completed',
      addedLineCount: 0,
      skippedLineCount: 0,
      failureReason: null,
      outcomes: [],
    });
    vi.mocked(standingOrdersApi.getStandingOrderRuns).mockResolvedValue([]);
    vi.mocked(standingOrdersApi.updateStandingOrder).mockResolvedValue(order({ active: false }));
    render(<StandingOrdersPage />);
    await user.click(await screen.findByRole('button', { name: 'Run now' }));
    await waitFor(() => expect(standingOrdersApi.getStandingOrders).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    expect(await screen.findByText('Paused')).toBeInTheDocument();
    settleReload([order()]);
    await waitFor(() => expect(screen.getByText('Paused')).toBeInTheDocument());
  });
});
