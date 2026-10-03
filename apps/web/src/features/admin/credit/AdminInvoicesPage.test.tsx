import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Country } from '@shop/contracts/country';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/i18n/LocaleContext';
import { AdminInvoicesPage } from './AdminInvoicesPage';

const api = vi.hoisted(() => ({
  getAdminInvoices: vi.fn(),
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

const invoice = {
  id: '101',
  invoiceNumber: 'QME-2026-000101',
  status: 'open' as const,
  grossCents: 12_000,
  billingEntity: { legalName: 'Example Trading Ltd' },
};

function page(items = [invoice]) {
  return { items, total: items.length, page: 1, pageSize: 25 };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/invoices']}>
      <LocaleProvider>
        <AdminInvoicesPage />
      </LocaleProvider>
    </MemoryRouter>,
  );
}

describe('AdminInvoicesPage', () => {
  afterEach(() => {
    countryState.activeCountry = 'US';
    vi.resetAllMocks();
  });

  it('aborts the prior-country request, clears its list, and keeps only the new response', async () => {
    const firstResponse = deferred<ReturnType<typeof page>>();
    const secondResponse = deferred<ReturnType<typeof page>>();
    api.getAdminInvoices
      .mockReturnValueOnce(firstResponse.promise)
      .mockReturnValueOnce(secondResponse.promise);
    const view = renderPage();
    await waitFor(() => expect(api.getAdminInvoices).toHaveBeenCalledOnce());

    await act(async () => {
      firstResponse.resolve(page());
      await firstResponse.promise;
    });
    expect(await screen.findByText(/Example Trading Ltd/)).toBeInTheDocument();
    const oldSignal = api.getAdminInvoices.mock.calls[0]?.[1] as AbortSignal | undefined;

    countryState.activeCountry = 'DE';
    view.rerender(
      <MemoryRouter initialEntries={['/admin/invoices']}>
        <LocaleProvider>
          <AdminInvoicesPage />
        </LocaleProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(api.getAdminInvoices).toHaveBeenCalledTimes(2));
    expect(oldSignal?.aborted).toBe(true);
    expect(screen.queryByText('Example Trading Ltd')).not.toBeInTheDocument();

    await act(async () => {
      secondResponse.resolve(
        page([{ ...invoice, billingEntity: { legalName: 'DE Trading Ltd' } }]),
      );
      await secondResponse.promise;
    });
    expect(await screen.findByText(/DE Trading Ltd/)).toBeInTheDocument();

    await act(async () => {
      firstResponse.resolve(page([{ ...invoice, billingEntity: { legalName: 'US Trading Ltd' } }]));
      await firstResponse.promise;
    });
    expect(screen.queryByText('US Trading Ltd')).not.toBeInTheDocument();
  });
});
