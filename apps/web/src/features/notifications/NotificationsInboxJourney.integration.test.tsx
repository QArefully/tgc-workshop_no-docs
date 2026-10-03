import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Notification, NotificationPage } from '@shop/contracts/notifications';
import * as api from '@/api/notifications';
import { NotificationsProvider } from '@/hooks/NotificationsContext';
import { useNotifications } from '@/hooks/useNotifications';
import { NotificationsPage } from './NotificationsPage';

const auth = { user: { id: 'buyer-1' } as { id: string } | null };
vi.mock('@/hooks/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('@/api/notifications', () => ({
  getNotifications: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
}));
const item: Notification = {
  id: '1',
  kind: 'order.placed' as const,
  title: 'Order received',
  body: 'We have received your order.',
  entityType: 'order',
  entityId: '8',
  createdAt: '2026-08-01T00:00:00.000Z',
  readAt: null,
};
const secondItem = { ...item, id: '2', title: 'Order dispatched', entityId: '9' };
const page = (
  items: (typeof item)[],
  unreadTotal = items.filter((entry) => entry.readAt === null).length,
) => ({
  items,
  total: items.length,
  unreadTotal,
  page: 1,
  pageSize: 25,
});
function renderInbox() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <NotificationsProvider>
        <NotificationsPage />
      </NotificationsProvider>
    </MemoryRouter>,
  );
}
function RefreshProbe() {
  const { refresh } = useNotifications();
  return <button onClick={() => void refresh()}>Refresh inbox</button>;
}
function UnreadProbe() {
  const { unreadCount } = useNotifications();
  return <output aria-label="Unread count">{unreadCount}</output>;
}
function renderInboxWithProbe() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <NotificationsProvider>
        <RefreshProbe />
        <UnreadProbe />
        <NotificationsPage />
      </NotificationsProvider>
    </MemoryRouter>,
  );
}
describe('Notifications inbox journey', () => {
  beforeEach(() => {
    auth.user = { id: 'buyer-1' };
    vi.resetAllMocks();
    vi.mocked(api.getNotifications).mockResolvedValue(page([item]));
  });
  it('marks all read and clears state after logout', async () => {
    const { rerender } = renderInbox();
    await screen.findByText('Order received');
    vi.mocked(api.markAllNotificationsRead).mockResolvedValue({ affectedCount: 1 });
    await userEvent.click(screen.getByRole('button', { name: 'Mark all as read' }));
    expect(api.markAllNotificationsRead).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Mark as read' })).not.toBeInTheDocument();
    auth.user = null;
    rerender(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <NotificationsProvider>
          <NotificationsPage />
        </NotificationsProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('You have no notifications.')).toBeInTheDocument());
  });
  it('does not allow a stale list response to overwrite an optimistic read', async () => {
    let resolveList!: (value: NotificationPage) => void;
    vi.mocked(api.getNotifications)
      .mockResolvedValueOnce(page([item]))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveList = resolve;
          }),
      );
    vi.mocked(api.markNotificationRead).mockResolvedValue({
      ...item,
      readAt: '2026-08-01T01:00:00.000Z',
    });
    renderInboxWithProbe();
    await screen.findByRole('button', { name: 'Mark as read' });
    await userEvent.click(screen.getByRole('button', { name: 'Refresh inbox' }));
    await userEvent.click(screen.getByRole('button', { name: 'Mark as read' }));
    resolveList(page([item]));
    expect(screen.queryByRole('button', { name: 'Mark as read' })).not.toBeInTheDocument();
  });
  it('ignores a mark completion after logout', async () => {
    let resolveMark!: (value: typeof item) => void;
    vi.mocked(api.markNotificationRead).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveMark = resolve;
        }),
    );
    const { rerender } = renderInbox();
    await screen.findByRole('button', { name: 'Mark as read' });
    await userEvent.click(screen.getByRole('button', { name: 'Mark as read' }));
    auth.user = null;
    rerender(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <NotificationsProvider>
          <NotificationsPage />
        </NotificationsProvider>
      </MemoryRouter>,
    );
    resolveMark({ ...item, readAt: '2026-08-01T01:00:00.000Z' });
    await waitFor(() => expect(screen.getByText('You have no notifications.')).toBeInTheDocument());
  });
  it('ignores a rejected mark after logout', async () => {
    let rejectMark!: (cause: Error) => void;
    vi.mocked(api.markNotificationRead).mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectMark = reject;
        }),
    );
    const { rerender } = renderInbox();
    await screen.findByRole('button', { name: 'Mark as read' });
    await userEvent.click(screen.getByRole('button', { name: 'Mark as read' }));
    auth.user = null;
    rerender(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <NotificationsProvider>
          <NotificationsPage />
        </NotificationsProvider>
      </MemoryRouter>,
    );
    rejectMark(new Error('Mark request failed'));
    await waitFor(() => expect(screen.getByText('You have no notifications.')).toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('serializes optimistic marks so a failed earlier request cannot restore a later read', async () => {
    let rejectFirst!: (cause: Error) => void;
    vi.mocked(api.getNotifications).mockResolvedValue(page([item, secondItem], 7));
    vi.mocked(api.markNotificationRead)
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectFirst = reject;
          }),
      )
      .mockResolvedValueOnce({ ...secondItem, readAt: '2026-08-01T01:00:00.000Z' });
    renderInboxWithProbe();
    await screen.findAllByRole('button', { name: 'Mark as read' });
    await userEvent.click(screen.getAllByRole('button', { name: 'Mark as read' })[0]!);
    await userEvent.click(screen.getByRole('button', { name: 'Mark as read' }));
    expect(api.markNotificationRead).toHaveBeenCalledTimes(1);
    rejectFirst(new Error('First mark failed'));
    await waitFor(() => expect(api.markNotificationRead).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Mark as read' })).toHaveLength(1),
    );
    expect(screen.getByLabelText('Unread count')).toHaveTextContent('6');
  });
  it('uses server unread total when page contains only one notification', async () => {
    vi.mocked(api.getNotifications).mockResolvedValue(page([item], 9));
    renderInboxWithProbe();
    await screen.findByText('Order received');
    expect(screen.getByLabelText('Unread count')).toHaveTextContent('9');
  });
});
