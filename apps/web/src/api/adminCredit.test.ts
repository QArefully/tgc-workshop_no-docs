import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AdminCreditAccountDetailResponse,
  AdminCreditAccountListResponse,
  AdminInvoiceListResponse,
  AdminInvoiceSettlementBody,
  InvoiceDetailResponse,
} from '@shop/contracts/trade-credit';
import { apiFetch } from './client';
import {
  getAdminCreditAccount,
  getAdminCreditAccounts,
  getAdminInvoice,
  getAdminInvoices,
  settleAdminInvoice,
  updateAdminCreditAccount,
} from './adminCredit';

vi.mock('./client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./client')>();
  return { ...actual, apiFetch: vi.fn() };
});

describe('admin credit API', () => {
  beforeEach(() => vi.mocked(apiFetch).mockReset());

  it('uses strict account list/detail schemas and serializes URL filters', () => {
    const signal = new AbortController().signal;
    vi.mocked(apiFetch).mockResolvedValue({});

    void getAdminCreditAccounts(
      { companyId: '7', state: 'on_hold', page: 2, pageSize: 25 },
      signal,
    );
    expect(apiFetch).toHaveBeenLastCalledWith(
      AdminCreditAccountListResponse,
      '/api/admin/credit-accounts?companyId=7&state=on_hold&page=2&pageSize=25',
      { signal },
    );

    void getAdminCreditAccount('7', signal);
    expect(apiFetch).toHaveBeenLastCalledWith(
      AdminCreditAccountDetailResponse,
      '/api/admin/credit-accounts/7',
      { signal },
    );
  });

  it('sends one versioned account mutation without client-side accounting fields', () => {
    const signal = new AbortController().signal;
    vi.mocked(apiFetch).mockResolvedValue({});
    const body = {
      creditLimitCents: 120_000,
      expectedVersion: 3,
      idempotencyKey: '123e4567-e89b-42d3-a456-426614174000',
    } as const;

    void updateAdminCreditAccount('7', body, signal);

    expect(apiFetch).toHaveBeenCalledWith(
      AdminCreditAccountDetailResponse,
      '/api/admin/credit-accounts/7',
      {
        method: 'PATCH',
        body: JSON.stringify(body),
        signal,
      },
    );
    const updateOptions = vi.mocked(apiFetch).mock.calls[0]?.[2];
    expect(updateOptions?.body).toBe(JSON.stringify(body));
  });

  it('uses strict invoice list/detail schemas and sends only full-settlement control fields', () => {
    const signal = new AbortController().signal;
    vi.mocked(apiFetch).mockResolvedValue({});

    void getAdminInvoices({ companyId: '7', status: 'overdue', page: 1, pageSize: 25 }, signal);
    expect(apiFetch).toHaveBeenLastCalledWith(
      AdminInvoiceListResponse,
      '/api/admin/invoices?companyId=7&status=overdue&page=1&pageSize=25',
      { signal },
    );

    void getAdminInvoice('101', signal);
    expect(apiFetch).toHaveBeenLastCalledWith(InvoiceDetailResponse, '/api/admin/invoices/101', {
      signal,
    });

    const body: AdminInvoiceSettlementBody = {
      expectedVersion: 2,
      idempotencyKey: '223e4567-e89b-42d3-a456-426614174000',
    };
    void settleAdminInvoice('101', body, signal);
    expect(apiFetch).toHaveBeenLastCalledWith(
      InvoiceDetailResponse,
      '/api/admin/invoices/101/settle',
      {
        method: 'POST',
        body: JSON.stringify(body),
        signal,
      },
    );
    const settlementOptions = vi.mocked(apiFetch).mock.calls[2]?.[2];
    expect(settlementOptions?.body).toBe(JSON.stringify(body));
  });
});
