import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { Country } from '@shop/contracts/country';
import type { CreditAccountAdminView } from '@shop/contracts/trade-credit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/i18n/LocaleContext';
import { AdminCreditAccountsPage } from './AdminCreditAccountsPage';

const api = vi.hoisted(() => ({
  getAdminCreditAccounts: vi.fn(),
}));
const countryState: { activeCountry: Country } = vi.hoisted(() => ({ activeCountry: 'US' }));
vi.mock('@/api/adminCredit', () => api);
vi.mock('@/hooks/CountryContext', () => ({
  useCountry: () => ({
    activeCountry: countryState.activeCountry,
    isAccountBound: false,
    selectCountry: vi.fn(),
    countryStorage: null,
  }),
}));

const account = {
  id: '7',
  companyId: '7',
  companyName: 'Example Trading Ltd',
  state: 'on_hold',
  creditLimitCents: 100_000,
  outstandingCents: 25_000,
  heldCents: 5_000,
  exposureCents: 30_000,
  availableCreditCents: 70_000,
  terms: 'net_30',
  holdReason: 'Review required',
  version: 0,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
} satisfies CreditAccountAdminView;

function Location() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

function page(overrides: Partial<{ items: CreditAccountAdminView[]; total: number }> = {}) {
  return { items: [account], total: 1, page: 1, pageSize: 25, ...overrides };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function renderPage(initialEntry = '/admin/credit-accounts') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <LocaleProvider>
        <AdminCreditAccountsPage />
        <Location />
      </LocaleProvider>
    </MemoryRouter>,
  );
}

describe('AdminCreditAccountsPage', () => {
  afterEach(() => {
    countryState.activeCountry = 'US';
    vi.resetAllMocks();
  });

  it('loads URL filters through the strict list client and links to account detail', async () => {
    api.getAdminCreditAccounts.mockResolvedValue(page());
    const user = userEvent.setup();
    renderPage('/admin/credit-accounts?companyId=7&state=on_hold&page=2');

    expect(await screen.findByText('Example Trading Ltd')).toBeInTheDocument();
    expect(api.getAdminCreditAccounts).toHaveBeenCalledWith(
      { companyId: '7', state: 'on_hold', page: 2, pageSize: 25 },
      expect.any(AbortSignal),
    );
    await user.click(screen.getByRole('button', { name: 'View credit account' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/admin/credit-accounts/7');
  });

  it('writes filter edits to the URL and reloads the list', async () => {
    api.getAdminCreditAccounts.mockResolvedValue(page());
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Example Trading Ltd');
    await user.type(screen.getByLabelText('Company ID'), '7');
    await user.selectOptions(screen.getByLabelText('Account state'), 'suspended');
    await user.click(screen.getByRole('button', { name: 'Filter' }));

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('companyId=7&state=suspended'),
    );
    await waitFor(() =>
      expect(api.getAdminCreditAccounts).toHaveBeenLastCalledWith(
        { companyId: '7', state: 'suspended', page: 1, pageSize: 25 },
        expect.any(AbortSignal),
      ),
    );
  });

  it('aborts the prior-country request, clears its list, and keeps only the new response', async () => {
    const firstResponse = deferred<ReturnType<typeof page>>();
    const secondResponse = deferred<ReturnType<typeof page>>();
    api.getAdminCreditAccounts
      .mockReturnValueOnce(firstResponse.promise)
      .mockReturnValueOnce(secondResponse.promise);
    const view = renderPage();
    await waitFor(() => expect(api.getAdminCreditAccounts).toHaveBeenCalledOnce());

    await act(async () => {
      firstResponse.resolve(page());
      await firstResponse.promise;
    });
    await screen.findByText('Example Trading Ltd');
    const oldSignal = api.getAdminCreditAccounts.mock.calls[0]?.[1] as AbortSignal | undefined;

    countryState.activeCountry = 'DE';
    view.rerender(
      <MemoryRouter initialEntries={['/admin/credit-accounts']}>
        <LocaleProvider>
          <AdminCreditAccountsPage />
          <Location />
        </LocaleProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(api.getAdminCreditAccounts).toHaveBeenCalledTimes(2));
    expect(oldSignal?.aborted).toBe(true);
    expect(screen.queryByText('Example Trading Ltd')).not.toBeInTheDocument();

    await act(async () => {
      secondResponse.resolve(page({ items: [{ ...account, companyName: 'DE Trading Ltd' }] }));
      await secondResponse.promise;
    });
    expect(await screen.findByText('DE Trading Ltd')).toBeInTheDocument();

    await act(async () => {
      firstResponse.resolve(page({ items: [{ ...account, companyName: 'US Trading Ltd' }] }));
      await firstResponse.promise;
    });
    expect(screen.queryByText('US Trading Ltd')).not.toBeInTheDocument();
  });
});
