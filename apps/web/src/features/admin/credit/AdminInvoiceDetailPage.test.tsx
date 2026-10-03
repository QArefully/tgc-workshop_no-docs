/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Country } from '@shop/contracts/country';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Invoice } from '@shop/contracts/trade-credit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/i18n/LocaleContext';
import { AdminInvoiceDetailPage } from './AdminInvoiceDetailPage';

const api = vi.hoisted(() => ({
  getAdminInvoice: vi.fn(),
  settleAdminInvoice: vi.fn(),
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
  version: 1,
  id: '101',
  invoiceNumber: 'QME-2026-000101',
  orderId: '55',
  companyId: '7',
  userId: '3',
  country: 'UK',
  paymentMethod: 'trade_credit',
  currency: 'GBP',
  terms: 'net_30',
  billingEntity: {
    legalName: 'Example Trading Ltd',
    registrationNumber: null,
    vatNumber: null,
    address: {
      line1: '1 Example Street',
      city: 'London',
      postcode: 'EC1A 1BB',
      countryCode: 'GB',
    },
  },
  purchaseOrderReference: 'PO-101',
  lines: [
    {
      lineId: '1',
      description: 'Material sacks',
      quantity: 2,
      unitPriceCents: 5_000,
      netCents: 10_000,
    },
  ],
  netCents: 10_000,
  vatRateBasisPoints: 2_000,
  vatCents: 2_000,
  grossCents: 12_000,
  issuedAt: '2026-09-01T00:00:00.000Z',
  dueAt: '2026-10-01T00:00:00.000Z',
  status: 'open',
  settledAt: null,
  lifecycleVersion: 0,
  lifecycle: {
    invoiceId: '101',
    status: 'open',
    version: 0,
    settledAt: null,
    updatedAt: '2026-09-01T00:00:00.000Z',
  },
  settlement: null,
  events: [{ id: '301', invoiceId: '101', type: 'issued', occurredAt: '2026-09-01T00:00:00.000Z' }],
} satisfies Invoice;

function pageElement() {
  return (
    <MemoryRouter initialEntries={['/admin/invoices/101']}>
      <Routes>
        <Route
          path="/admin/invoices/:invoiceId"
          element={
            <LocaleProvider>
              <AdminInvoiceDetailPage />
            </LocaleProvider>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

function renderPage() {
  return render(pageElement());
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

describe('AdminInvoiceDetailPage', () => {
  afterEach(() => {
    countryState.activeCountry = 'US';
    vi.restoreAllMocks();
    vi.resetAllMocks();
  });

  it('confirms full settlement without a client amount and reloads invoice detail', async () => {
    const settle = deferred<Invoice>();
    const paid = {
      ...invoice,
      status: 'paid' as const,
      settledAt: '2026-09-03T00:00:00.000Z',
      lifecycleVersion: 1,
      lifecycle: {
        ...invoice.lifecycle,
        status: 'paid' as const,
        version: 1,
        settledAt: '2026-09-03T00:00:00.000Z',
        updatedAt: '2026-09-03T00:00:00.000Z',
      },
      settlement: {
        id: '302',
        invoiceId: '101',
        amountCents: invoice.grossCents,
        currency: 'GBP' as const,
        status: 'settled' as const,
        idempotencyKey: '223e4567-e89b-42d3-a456-426614174000',
        settledAt: '2026-09-03T00:00:00.000Z',
        createdAt: '2026-09-03T00:00:00.000Z',
      },
    } satisfies Invoice;
    api.getAdminInvoice.mockResolvedValueOnce(invoice).mockResolvedValueOnce(paid);
    api.settleAdminInvoice.mockReturnValue(settle.promise);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: 'Invoice #101' });
    await user.click(screen.getByRole('button', { name: 'Confirm full settlement' }));
    expect(api.settleAdminInvoice).toHaveBeenCalledWith(
      '101',
      { expectedVersion: 0, idempotencyKey: expect.any(String) as unknown },
      expect.any(AbortSignal),
    );
    const body = api.settleAdminInvoice.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(body).not.toHaveProperty('amountCents');
    await act(async () => {
      settle.resolve(paid);
      await settle.promise;
    });
    expect(await screen.findByText('Invoice settled in full.')).toBeInTheDocument();
    await waitFor(() => expect(api.getAdminInvoice).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('This invoice has already been settled.')).toBeInTheDocument();
  });

  it('preserves settlement idempotency on an unchanged uncertain retry', async () => {
    const first = deferred<Invoice>();
    api.getAdminInvoice.mockResolvedValue(invoice);
    api.settleAdminInvoice.mockReturnValueOnce(first.promise).mockResolvedValue(invoice);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: 'Invoice #101' });
    const button = screen.getByRole('button', { name: 'Confirm full settlement' });
    await user.click(button);
    const firstKey = api.settleAdminInvoice.mock.calls[0]?.[1].idempotencyKey;
    first.reject(new Error('uncertain network result'));
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Confirm full settlement' }));
    const secondKey = api.settleAdminInvoice.mock.calls[1]?.[1].idempotencyKey;
    expect(secondKey).toBe(firstKey);
  });

  it('aborts and ignores a stale prior-country invoice response', async () => {
    const firstResponse = deferred<Invoice>();
    const secondResponse = deferred<Invoice>();
    const deInvoice = {
      ...invoice,
      billingEntity: { ...invoice.billingEntity, legalName: 'DE Trading Ltd' },
    };
    api.getAdminInvoice
      .mockReturnValueOnce(firstResponse.promise)
      .mockReturnValueOnce(secondResponse.promise);
    const view = renderPage();
    await waitFor(() => expect(api.getAdminInvoice).toHaveBeenCalledOnce());
    const oldSignal = api.getAdminInvoice.mock.calls[0]?.[1] as AbortSignal | undefined;

    countryState.activeCountry = 'DE';
    view.rerender(pageElement());
    await waitFor(() => expect(api.getAdminInvoice).toHaveBeenCalledTimes(2));
    expect(oldSignal?.aborted).toBe(true);

    await act(async () => {
      secondResponse.resolve(deInvoice);
      await secondResponse.promise;
    });
    expect(await screen.findAllByText(/DE Trading Ltd/)).not.toHaveLength(0);

    await act(async () => {
      firstResponse.resolve({
        ...invoice,
        billingEntity: { ...invoice.billingEntity, legalName: 'US Trading Ltd' },
      });
      await firstResponse.promise;
    });
    expect(screen.queryByText(/US Trading Ltd/)).not.toBeInTheDocument();
  });

  it('clears the prior-country invoice and suppresses its stale settlement completion', async () => {
    const secondResponse = deferred<Invoice>();
    const firstSettlement = deferred<Invoice>();
    const secondSettlement = deferred<Invoice>();
    const deInvoice = {
      ...invoice,
      billingEntity: { ...invoice.billingEntity, legalName: 'DE Trading Ltd' },
    };
    api.getAdminInvoice
      .mockResolvedValueOnce(invoice)
      .mockReturnValueOnce(secondResponse.promise)
      .mockResolvedValue(deInvoice);
    api.settleAdminInvoice
      .mockReturnValueOnce(firstSettlement.promise)
      .mockReturnValueOnce(secondSettlement.promise);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    const view = renderPage();
    await screen.findByRole('heading', { name: 'Invoice #101' });
    await user.click(screen.getByRole('button', { name: 'Confirm full settlement' }));
    const firstKey = api.settleAdminInvoice.mock.calls[0]?.[1].idempotencyKey;
    const firstSignal = api.settleAdminInvoice.mock.calls[0]?.[2] as AbortSignal | undefined;

    countryState.activeCountry = 'DE';
    view.rerender(pageElement());
    await waitFor(() => expect(api.getAdminInvoice).toHaveBeenCalledTimes(2));
    expect(firstSignal?.aborted).toBe(true);
    expect(screen.queryByText(/Example Trading Ltd/)).not.toBeInTheDocument();

    await act(async () => {
      secondResponse.resolve(deInvoice);
      await secondResponse.promise;
    });
    expect(await screen.findAllByText(/DE Trading Ltd/)).not.toHaveLength(0);
    await user.click(
      screen.getByRole('button', {
        name: /Vollständige Begleichung bestätigen|Confirm full settlement/,
      }),
    );
    const secondKey = api.settleAdminInvoice.mock.calls[1]?.[1].idempotencyKey;
    expect(secondKey).not.toBe(firstKey);

    await act(async () => {
      firstSettlement.resolve(invoice);
      await firstSettlement.promise;
    });
    expect(
      screen.queryByText(/Rechnung vollständig beglichen|Invoice settled in full/),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Wird beglichen|Settling/ })).toBeInTheDocument();

    await act(async () => {
      secondSettlement.resolve(deInvoice);
      await secondSettlement.promise;
    });
    expect(
      await screen.findByText(/Rechnung vollständig beglichen|Invoice settled in full/),
    ).toBeInTheDocument();
  });
});
