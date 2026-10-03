import {
  AdminCreditAccountDetailResponse,
  AdminCreditAccountListResponse,
  AdminInvoiceListResponse,
  InvoiceDetailResponse,
  AdminInvoiceSettlementBody,
  type AdminCreditAccountListQuery,
  type AdminCreditAccountUpdateBody,
  type AdminInvoiceListQuery,
} from '@shop/contracts/trade-credit';
import { apiFetch } from './client';

function queryString(query: AdminCreditAccountListQuery | AdminInvoiceListQuery): string {
  const params = new URLSearchParams();
  if (query.companyId !== undefined) params.set('companyId', query.companyId);
  if ('state' in query && query.state !== undefined) params.set('state', query.state);
  if ('status' in query && query.status !== undefined) params.set('status', query.status);
  if (query.page !== undefined) params.set('page', String(query.page));
  if (query.pageSize !== undefined) params.set('pageSize', String(query.pageSize));
  return params.size ? `?${params.toString()}` : '';
}

/** Loads the country-scoped administrator credit-account page. */
export function getAdminCreditAccounts(
  query: AdminCreditAccountListQuery = {},
  signal?: AbortSignal,
) {
  return apiFetch(
    AdminCreditAccountListResponse,
    `/api/admin/credit-accounts${queryString(query)}`,
    { signal },
  );
}

/** Loads one country-scoped administrator credit-account detail. */
export function getAdminCreditAccount(creditAccountId: string, signal?: AbortSignal) {
  return apiFetch(
    AdminCreditAccountDetailResponse,
    `/api/admin/credit-accounts/${encodeURIComponent(creditAccountId)}`,
    { signal },
  );
}

/** Sends one optimistic-versioned, idempotent administrator account mutation. */
export function updateAdminCreditAccount(
  creditAccountId: string,
  body: AdminCreditAccountUpdateBody,
  signal?: AbortSignal,
) {
  return apiFetch(
    AdminCreditAccountDetailResponse,
    `/api/admin/credit-accounts/${encodeURIComponent(creditAccountId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(body satisfies AdminCreditAccountUpdateBody),
      signal,
    },
  );
}

/** Loads the country-scoped administrator invoice page. */
export function getAdminInvoices(query: AdminInvoiceListQuery = {}, signal?: AbortSignal) {
  return apiFetch(AdminInvoiceListResponse, `/api/admin/invoices${queryString(query)}`, { signal });
}

/** Loads one country-scoped administrator invoice detail. */
export function getAdminInvoice(invoiceId: string, signal?: AbortSignal) {
  return apiFetch(InvoiceDetailResponse, `/api/admin/invoices/${encodeURIComponent(invoiceId)}`, {
    signal,
  });
}

/** Records the immutable invoice gross as a full GBP settlement. */
export function settleAdminInvoice(
  invoiceId: string,
  body: AdminInvoiceSettlementBody,
  signal?: AbortSignal,
) {
  return apiFetch(
    InvoiceDetailResponse,
    `/api/admin/invoices/${encodeURIComponent(invoiceId)}/settle`,
    {
      method: 'POST',
      body: JSON.stringify(body satisfies AdminInvoiceSettlementBody),
      signal,
    },
  );
}

// Explicit aliases keep the transport names discoverable to callers that use list/detail wording.
export const getAdminCreditAccountList = getAdminCreditAccounts;
export const getAdminCreditAccountDetail = getAdminCreditAccount;
export const getAdminInvoiceList = getAdminInvoices;
export const getAdminInvoiceDetail = getAdminInvoice;
export const settleAdminInvoiceInFull = settleAdminInvoice;
