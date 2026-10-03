import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Notification } from '@shop/contracts/notifications';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationsPage } from './NotificationsPage';

const state: {
  notifications: Notification[];
  unreadCount: number;
  loading: boolean;
  error: string | null;
  refresh: ReturnType<typeof vi.fn>;
  markRead: ReturnType<typeof vi.fn>;
  markAllRead: ReturnType<typeof vi.fn>;
} = {
  notifications: [],
  unreadCount: 0,
  loading: false,
  error: null,
  refresh: vi.fn(),
  markRead: vi.fn(),
  markAllRead: vi.fn(),
};
vi.mock('@/hooks/useNotifications', () => ({ useNotifications: () => state }));

describe('NotificationsPage', () => {
  beforeEach(() => {
    state.notifications = [];
    state.unreadCount = 0;
    state.loading = false;
    state.error = null;
    vi.clearAllMocks();
  });
  it('renders loading, empty, retryable error, and populated inbox states', async () => {
    const { rerender } = render(<NotificationsPage />);
    expect(screen.getByText('You have no notifications.')).toBeInTheDocument();
    state.loading = true;
    rerender(<NotificationsPage />);
    expect(document.querySelector('.animate-spin')).toBeInTheDocument();
    state.loading = false;
    state.error = 'Inbox unavailable';
    rerender(<NotificationsPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(state.refresh).toHaveBeenCalledOnce();
    state.error = null;
    state.unreadCount = 1;
    state.notifications = [
      {
        id: '9',
        kind: 'order.shipped',
        title: 'On its way',
        body: 'Your pallet has shipped.',
        entityType: 'order',
        entityId: '7',
        createdAt: '2026-08-01T00:00:00.000Z',
        readAt: null,
      },
    ];
    rerender(<NotificationsPage />);
    expect(screen.getByText('On its way')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Mark as read' }));
    expect(state.markRead).toHaveBeenCalledWith('9');
  });

  it('preserves a translated notification snapshot instead of re-translating title/body', () => {
    state.notifications = [
      {
        id: 'de-1',
        kind: 'back_in_stock.available',
        title: 'Wieder auf Lager: Zement',
        body: 'Zement kann wieder bestellt werden.',
        entityType: 'variant',
        entityId: '7',
        createdAt: '2026-08-01T00:00:00.000Z',
        readAt: null,
      },
    ];
    render(<NotificationsPage />);
    expect(screen.getByText('Wieder auf Lager: Zement')).toBeInTheDocument();
    expect(screen.getByText('Zement kann wieder bestellt werden.')).toBeInTheDocument();
  });
});
