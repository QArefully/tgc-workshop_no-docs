/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Country } from '@shop/contracts/country';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { CreditAccountAdminView } from '@shop/contracts/trade-credit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/i18n/LocaleContext';
import { AdminCreditAccountDetailPage } from './AdminCreditAccountDetailPage';

const api = vi.hoisted(() => ({
  getAdminCreditAccount: vi.fn(),
  updateAdminCreditAccount: vi.fn(),
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
  state: 'active',
  creditLimitCents: 100_000,
  outstandingCents: 25_000,
  heldCents: 5_000,
  exposureCents: 30_000,
  availableCreditCents: 70_000,
  terms: 'net_30',
  holdReason: null,
  version: 3,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
} satisfies CreditAccountAdminView;

function Location() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

function pageElement(initialEntry = '/admin/credit-accounts/7') {
  return (
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="/admin/credit-accounts/:creditAccountId"
          element={
            <LocaleProvider>
              <AdminCreditAccountDetailPage />
            </LocaleProvider>
          }
        />
      </Routes>
      <Location />
    </MemoryRouter>
  );
}

function renderPage(initialEntry = '/admin/credit-accounts/7') {
  return render(pageElement(initialEntry));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe('AdminCreditAccountDetailPage', () => {
  afterEach(() => {
    countryState.activeCountry = 'US';
    vi.resetAllMocks();
  });

  it('parses GBP exactly, sends one versioned mutation, and reloads account detail', async () => {
    const update = deferred<CreditAccountAdminView>();
    api.getAdminCreditAccount
      .mockResolvedValueOnce(account)
      .mockResolvedValueOnce({ ...account, creditLimitCents: 125_000, version: 4 });
    api.updateAdminCreditAccount.mockReturnValue(update.promise);
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: 'Credit account #7' });
    const input = screen.getByLabelText('New credit limit (GBP)');
    await user.type(input, '1250.05');
    await user.click(
      screen.getByRole('button', { name: /Kreditlimit aktualisieren|Update credit limit/ }),
    );
    expect(api.updateAdminCreditAccount).toHaveBeenCalledWith(
      '7',
      {
        creditLimitCents: 125_005,
        expectedVersion: 3,
        idempotencyKey: expect.any(String) as unknown,
      },
      expect.any(AbortSignal),
    );
    await act(async () => {
      update.resolve({ ...account, creditLimitCents: 125_005, version: 4 });
      await update.promise;
    });
    expect(
      await screen.findByText(/Kreditkonto aktualisiert|Credit account updated/),
    ).toBeInTheDocument();
    await waitFor(() => expect(api.getAdminCreditAccount).toHaveBeenCalledTimes(2));
  });

  it('preserves an idempotency key for an unchanged uncertain retry and rotates after edit', async () => {
    api.getAdminCreditAccount.mockResolvedValue(account);
    const first = deferred<CreditAccountAdminView>();
    api.updateAdminCreditAccount.mockReturnValueOnce(first.promise).mockResolvedValue(account);
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: 'Credit account #7' });
    const input = screen.getByLabelText('New credit limit (GBP)');
    await user.type(input, '1250.05');
    const submit = screen.getByRole('button', { name: 'Update credit limit' });
    await user.click(submit);
    const firstKey = api.updateAdminCreditAccount.mock.calls[0]?.[1].idempotencyKey;
    first.reject(new Error('uncertain network result'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Update credit limit' }));
    const secondKey = api.updateAdminCreditAccount.mock.calls[1]?.[1].idempotencyKey;
    expect(secondKey).toBe(firstKey);
    await user.clear(input);
    await user.type(input, '1300.00');
    await user.click(screen.getByRole('button', { name: 'Update credit limit' }));
    const thirdKey = api.updateAdminCreditAccount.mock.calls[2]?.[1].idempotencyKey;
    expect(thirdKey).not.toBe(secondKey);
  });

  it('aborts and ignores a stale prior-country detail response', async () => {
    const firstResponse = deferred<CreditAccountAdminView>();
    const secondResponse = deferred<CreditAccountAdminView>();
    api.getAdminCreditAccount
      .mockReturnValueOnce(firstResponse.promise)
      .mockReturnValueOnce(secondResponse.promise);
    const view = renderPage();
    await waitFor(() => expect(api.getAdminCreditAccount).toHaveBeenCalledOnce());
    const oldSignal = api.getAdminCreditAccount.mock.calls[0]?.[1] as AbortSignal | undefined;

    countryState.activeCountry = 'DE';
    view.rerender(pageElement());
    await waitFor(() => expect(api.getAdminCreditAccount).toHaveBeenCalledTimes(2));
    expect(oldSignal?.aborted).toBe(true);

    await act(async () => {
      secondResponse.resolve({ ...account, companyName: 'DE Trading Ltd' });
      await secondResponse.promise;
    });
    expect(await screen.findAllByText(/DE Trading Ltd/)).not.toHaveLength(0);

    await act(async () => {
      firstResponse.resolve({ ...account, companyName: 'US Trading Ltd' });
      await firstResponse.promise;
    });
    expect(screen.queryByText('US Trading Ltd')).not.toBeInTheDocument();
  });

  it('clears the prior-country account and suppresses its stale mutation completion', async () => {
    const secondResponse = deferred<CreditAccountAdminView>();
    const firstUpdate = deferred<CreditAccountAdminView>();
    const secondUpdate = deferred<CreditAccountAdminView>();
    const deAccount = { ...account, companyName: 'DE Trading Ltd' };
    api.getAdminCreditAccount
      .mockResolvedValueOnce(account)
      .mockReturnValueOnce(secondResponse.promise)
      .mockResolvedValue(deAccount);
    api.updateAdminCreditAccount
      .mockReturnValueOnce(firstUpdate.promise)
      .mockReturnValueOnce(secondUpdate.promise);
    const user = userEvent.setup();
    const view = renderPage();
    await screen.findByRole('heading', { name: 'Credit account #7' });
    await user.type(screen.getByLabelText('New credit limit (GBP)'), '1250.05');
    await user.click(screen.getByRole('button', { name: 'Update credit limit' }));
    const firstKey = api.updateAdminCreditAccount.mock.calls[0]?.[1].idempotencyKey;
    const firstSignal = api.updateAdminCreditAccount.mock.calls[0]?.[2] as AbortSignal | undefined;

    countryState.activeCountry = 'DE';
    view.rerender(pageElement());
    await waitFor(() => expect(api.getAdminCreditAccount).toHaveBeenCalledTimes(2));
    expect(firstSignal?.aborted).toBe(true);
    expect(screen.queryByText('Example Trading Ltd')).not.toBeInTheDocument();

    await act(async () => {
      secondResponse.resolve(deAccount);
      await secondResponse.promise;
    });
    expect(await screen.findAllByText(/DE Trading Ltd/)).not.toHaveLength(0);
    const newInput = screen.getByLabelText(/Kreditlimit|credit limit/i);
    await user.type(newInput, '1300.00');
    await user.click(
      screen.getByRole('button', { name: /Kreditlimit aktualisieren|Update credit limit/ }),
    );
    const secondKey = api.updateAdminCreditAccount.mock.calls[1]?.[1].idempotencyKey;
    expect(secondKey).not.toBe(firstKey);

    await act(async () => {
      firstUpdate.resolve(account);
      await firstUpdate.promise;
    });
    expect(
      screen.queryByText(/Kreditkonto aktualisiert|Credit account updated/),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Wird aktualisiert|Updating credit limit/ }),
    ).toBeInTheDocument();

    await act(async () => {
      secondUpdate.resolve(deAccount);
      await secondUpdate.promise;
    });
    expect(
      await screen.findByText(/Kreditkonto aktualisiert|Credit account updated/),
    ).toBeInTheDocument();
  });

  it('rotates account mutation identity when the route account changes', async () => {
    api.getAdminCreditAccount.mockResolvedValue(account);
    api.updateAdminCreditAccount.mockResolvedValue(account);
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/admin/credit-accounts/7']}>
        <Routes>
          <Route
            path="/admin/credit-accounts/:creditAccountId"
            element={
              <LocaleProvider>
                <AdminCreditAccountDetailPage />
              </LocaleProvider>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { name: 'Credit account #7' });
    const input = screen.getByLabelText('New credit limit (GBP)');
    await user.type(input, '1250.05');
    await user.click(screen.getByRole('button', { name: 'Update credit limit' }));
    const firstKey = api.updateAdminCreditAccount.mock.calls[0]?.[1].idempotencyKey;
    expect(firstKey).toEqual(expect.any(String));
  });
});
