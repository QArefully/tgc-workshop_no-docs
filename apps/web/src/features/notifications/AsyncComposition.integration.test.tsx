import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

let user: { id: string; role: 'customer' | 'admin'; displayName: string; email: string } | null =
  null;
vi.mock('@/hooks/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({ user, loading: false, logout: vi.fn() }),
}));
vi.mock('@/api/notifications', () => ({
  getNotifications: vi
    .fn()
    .mockResolvedValue({ items: [], total: 0, unreadTotal: 0, page: 1, pageSize: 25 }),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
}));
vi.mock('@/api/savedLists', () => ({ getSavedLists: vi.fn().mockResolvedValue([]) }));
vi.mock('@/api/cart', () => ({ getCart: vi.fn().mockResolvedValue(null), createCart: vi.fn() }));
vi.mock('@/features/standingOrders/StandingOrdersPage', () => ({
  StandingOrdersPage: () => <h1>Standing orders route</h1>,
}));
vi.mock('@/features/admin/jobs', () => ({
  AdminJobsPage: () => <h1>Jobs route</h1>,
  AdminJobDetailPage: () => <h1>Job detail route</h1>,
}));
vi.mock('@/features/admin/webhooks', () => ({
  AdminWebhooksPage: () => <h1>Webhooks route</h1>,
  AdminWebhookDetailPage: () => <h1>Webhook detail route</h1>,
}));

import App from '@/App';

const renderApp = (path: string) =>
  render(
    <MemoryRouter
      initialEntries={[path]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <App />
    </MemoryRouter>,
  );
const customer = {
  id: '1',
  role: 'customer' as const,
  displayName: 'Buyer',
  email: 'buyer@example.com',
  country: 'US' as const,
};
const admin = { ...customer, role: 'admin' as const };

describe('async composition', () => {
  afterEach(() => {
    user = null;
  });
  it('redirects guests away from both buyer routes and hides the bell', async () => {
    const view = renderApp('/notifications');
    expect(await screen.findByRole('heading', { name: 'Sign In' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/unread notifications/)).not.toBeInTheDocument();
    view.unmount();
    const standingOrders = renderApp('/account/standing-orders');
    expect(await screen.findByRole('heading', { name: 'Sign In' })).toBeInTheDocument();
    standingOrders.unmount();
  });
  it('allows buyers into buyer routes and rejects each admin route', async () => {
    user = customer;
    const view = renderApp('/notifications');
    expect(await screen.findByRole('heading', { name: 'Notifications' })).toBeInTheDocument();
    expect(screen.getByLabelText('0 unread notifications')).toBeInTheDocument();
    view.unmount();
    const standingOrders = renderApp('/account/standing-orders');
    expect(
      await screen.findByRole('heading', { name: 'Standing orders route' }),
    ).toBeInTheDocument();
    standingOrders.unmount();
    const restrictedRoutes: ReadonlyArray<readonly [string, string]> = [
      ['/admin/jobs', 'Jobs route'],
      ['/admin/jobs/1', 'Job detail route'],
      ['/admin/webhooks', 'Webhooks route'],
      ['/admin/webhooks/1', 'Webhook detail route'],
    ];
    for (const [path, blockedHeading] of restrictedRoutes) {
      const restricted = renderApp(path);
      expect(
        restricted.getByRole('link', { name: 'QArefully Materials Exchange' }),
      ).toBeInTheDocument();
      expect(restricted.queryByRole('heading', { name: blockedHeading })).not.toBeInTheDocument();
      restricted.unmount();
    }
  });
  it('allows administrators into all admin async routes', async () => {
    user = admin;
    const routes: ReadonlyArray<readonly [string, string]> = [
      ['/admin/jobs', 'Jobs route'],
      ['/admin/jobs/1', 'Job detail route'],
      ['/admin/webhooks', 'Webhooks route'],
      ['/admin/webhooks/1', 'Webhook detail route'],
    ];
    for (const [path, heading] of routes) {
      const view = renderApp(path);
      expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
      view.unmount();
    }
  });
});
