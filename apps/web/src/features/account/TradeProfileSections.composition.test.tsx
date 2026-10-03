import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listBillingEntities, listDeliverySites } from '@/api/tradeAccount';
import { AccountPage } from './AccountPage';
import { site } from './TradeProfileSections.test-fixtures';

interface MockUser {
  id: string;
  email: string;
  displayName: string;
  role: string;
}

const authState = vi.hoisted(() => {
  const state: { user: MockUser | null } = { user: null };
  return state;
});

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
vi.mock('@/api/auth', () => ({
  changePassword: vi.fn(),
  getMe: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  signup: vi.fn(),
}));
vi.mock('@/hooks/AuthContext', () => ({
  useAuth: () => ({
    user: authState.user,
    loading: false,
    login: vi.fn(),
    signup: vi.fn(),
    logout: vi.fn(),
  }),
}));
vi.mock('@/hooks/useBackInStock', () => ({
  useBackInStock: () => ({
    subscriptions: [],
    pendingVariantIds: new Set<number>(),
    loading: false,
    error: null,
    refresh: vi.fn(),
    subscribe: vi.fn(),
    cancel: vi.fn(),
  }),
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listDeliverySites).mockResolvedValue([site()]);
  vi.mocked(listBillingEntities).mockResolvedValue([]);
  authState.user = {
    id: '7',
    email: 'buyer@trade.test',
    displayName: 'Buyer',
    role: 'customer',
  };
});

describe('AccountPage trade profile composition', () => {
  it('renders both trade sections for a signed-in buyer', async () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AccountPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: /Delivery sites/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Billing details/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Main yard')).toBeInTheDocument());
  });

  it('renders no trade sections and reads nothing while anonymous', async () => {
    authState.user = null;

    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AccountPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'My Account' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Delivery sites/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Billing details/ })).not.toBeInTheDocument();
    expect(listDeliverySites).not.toHaveBeenCalled();
    expect(listBillingEntities).not.toHaveBeenCalled();
  });
});
