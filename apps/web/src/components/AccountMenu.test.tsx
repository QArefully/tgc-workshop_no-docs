import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { PublicUser } from '@shop/contracts/auth';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountMenu } from './AccountMenu';

const authState = vi.hoisted(() => ({
  user: null as PublicUser | null,
  logout: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/hooks/AuthContext', () => ({
  useAuth: () => ({ ...authState, loading: false }),
}));

function Location() {
  return <output>{useLocation().pathname}</output>;
}

function renderMenu() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AccountMenu />
      <Location />
    </MemoryRouter>,
  );
}

describe('AccountMenu', () => {
  afterEach(() => {
    cleanup();
    authState.user = null;
    authState.logout.mockReset().mockResolvedValue(undefined);
  });

  it('keeps review moderation out of the customer menu', async () => {
    authState.user = {
      id: 'customer-1',
      email: 'customer@example.test',
      displayName: 'Customer',
      role: 'customer',
      country: 'UK',
    };
    const user = userEvent.setup();
    renderMenu();

    await user.click(screen.getByLabelText('Account'));

    expect(await screen.findByText('My account')).toBeInTheDocument();
    expect(screen.getByText('My lists')).toBeInTheDocument();
    expect(screen.queryByText('Review moderation')).not.toBeInTheDocument();
  });

  it('shows moderation navigation for administrators', async () => {
    authState.user = {
      id: 'admin-1',
      email: 'admin@example.test',
      displayName: 'Admin',
      role: 'admin',
      country: 'UK',
    };
    const user = userEvent.setup();
    renderMenu();

    await user.click(screen.getByLabelText('Account'));
    await user.click(await screen.findByText('Review moderation'));

    expect(screen.getByText('/admin/reviews')).toBeInTheDocument();
  });
});
