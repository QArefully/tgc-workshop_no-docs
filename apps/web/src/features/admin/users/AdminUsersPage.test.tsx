import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Country } from '@shop/contracts/country';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/client';
import { LocaleProvider } from '@/i18n/LocaleContext';
import { AdminUsersPage } from './AdminUsersPage';

const countryState: { activeCountry: Country } = vi.hoisted(() => ({ activeCountry: 'US' }));

vi.mock('@/hooks/CountryContext', () => ({
  useCountry: () => ({ activeCountry: countryState.activeCountry }),
}));
const api = vi.hoisted(() => ({
  getAdminUsers: vi.fn(),
  updateAdminUserDisplayName: vi.fn(),
  setAdminUserRole: vi.fn(),
  suspendAdminUser: vi.fn(),
  reactivateAdminUser: vi.fn(),
}));
vi.mock('@/api/adminUsers', () => api);
const user = {
  id: '1',
  email: 'buyer@example.test',
  displayName: 'Buyer',
  role: 'admin' as const,
  suspendedAt: null,
  suspensionReason: null,
  suspendedByUserId: null,
};
describe('AdminUsersPage', () => {
  afterEach(() => {
    countryState.activeCountry = 'US';
    vi.resetAllMocks();
  });
  it('uses localized fallback for uncoded failures without backend prose', async () => {
    api.getAdminUsers.mockResolvedValue({ items: [user] });
    api.setAdminUserRole.mockRejectedValue(new Error('Cannot demote the last administrator.'));
    const events = userEvent.setup();
    render(
      <LocaleProvider>
        <AdminUsersPage />
      </LocaleProvider>,
    );
    expect(await screen.findByText('buyer@example.test')).toBeInTheDocument();
    await events.selectOptions(screen.getByLabelText('Role'), 'customer');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Unable to update user.');
    expect(alert).not.toHaveTextContent('Cannot demote the last administrator.');
    await events.clear(screen.getByLabelText('Search users'));
    await events.type(screen.getByLabelText('Search users'), 'buyer');
    await events.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(api.getAdminUsers).toHaveBeenLastCalledWith({ search: 'buyer' }));
  });

  it('translates role and suspension controls for a non-UK admin locale', async () => {
    countryState.activeCountry = 'DE';
    api.getAdminUsers.mockResolvedValue({ items: [{ ...user, suspendedAt: null }] });
    const events = userEvent.setup();
    render(
      <LocaleProvider>
        <AdminUsersPage />
      </LocaleProvider>,
    );

    expect(await screen.findByText('Administrator', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Namen speichern' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sperren' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Sperrgrund')).toBeInTheDocument();
    await events.selectOptions(screen.getByLabelText('Rolle'), 'customer');
    expect(api.setAdminUserRole).toHaveBeenCalledWith('1', { role: 'customer' });
  });

  it('translates coded API errors and does not surface backend prose', async () => {
    api.getAdminUsers.mockResolvedValue({ items: [user] });
    api.setAdminUserRole.mockRejectedValue(
      new ApiError('backend admin detail', 409, {
        error: 'backend admin detail',
        code: 'LAST_ADMIN',
      }),
    );
    const events = userEvent.setup();
    render(
      <LocaleProvider>
        <AdminUsersPage />
      </LocaleProvider>,
    );
    await screen.findByText('buyer@example.test');
    await events.selectOptions(screen.getByLabelText('Role'), 'customer');
    const alert = await screen.findByRole('alert');
    expect(alert).not.toHaveTextContent('backend admin detail');
    expect(alert).toHaveTextContent('At least one administrator must remain.');
  });
});
