import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BackInStockSubscription } from '@shop/contracts/back-in-stock';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BackInStockSection } from './BackInStockSection';

const state = vi.hoisted(() => ({
  subscriptions: [] as BackInStockSubscription[],
  loading: false,
  error: null as string | null,
  cancel: vi.fn(),
}));

vi.mock('@/hooks/useBackInStock', () => ({
  useBackInStock: () => ({
    subscriptions: state.subscriptions,
    pendingVariantIds: new Set<number>(),
    loading: state.loading,
    error: state.error,
    refresh: vi.fn(),
    subscribe: vi.fn(),
    cancel: state.cancel,
  }),
}));

const subscription = (
  overrides: Partial<BackInStockSubscription> = {},
): BackInStockSubscription => ({
  subscriptionId: '11',
  variantId: 3,
  productId: 'cement',
  sku: 'CEM-25',
  productName: 'Rapid-set cement',
  variantLabel: '25 kg sack',
  status: 'pending',
  requestedAt: '2026-07-14T09:30:00.000Z',
  notifiedAt: null,
  minimumOrderQuantity: 4,
  ...overrides,
});

describe('BackInStockSection', () => {
  beforeEach(() => {
    state.subscriptions = [];
    state.loading = false;
    state.error = null;
    state.cancel.mockReset().mockResolvedValue(true);
  });

  it('lists a pending alert with its product, variant, and request date', () => {
    state.subscriptions = [subscription()];
    render(<BackInStockSection />);

    expect(screen.getByRole('heading', { name: 'Back-in-stock alerts' })).toBeInTheDocument();
    const items = screen.getByRole('list', { name: 'Back-in-stock alerts' });
    expect(items).toHaveTextContent('Rapid-set cement');
    expect(items).toHaveTextContent('25 kg sack · requested 7/14/26');
  });

  it('cancels an alert by its string subscription id', async () => {
    state.subscriptions = [subscription()];
    render(<BackInStockSection />);

    await userEvent.setup().click(
      screen.getByRole('button', {
        name: 'Cancel back-in-stock alert for Rapid-set cement 25 kg sack',
      }),
    );
    expect(state.cancel).toHaveBeenCalledWith('11');
  });

  it('omits alerts the server no longer reports as pending', () => {
    state.subscriptions = [
      subscription({ status: 'notified', notifiedAt: '2026-07-20T09:30:00.000Z' }),
    ];
    render(<BackInStockSection />);

    expect(screen.queryByRole('list', { name: 'Back-in-stock alerts' })).not.toBeInTheDocument();
    expect(screen.getByText('You have no back-in-stock alerts.')).toBeInTheDocument();
  });

  it('surfaces the shared failure message as an alert', () => {
    state.error = 'Unable to load your back-in-stock alerts.';
    render(<BackInStockSection />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Unable to load your back-in-stock alerts.',
    );
  });
});
