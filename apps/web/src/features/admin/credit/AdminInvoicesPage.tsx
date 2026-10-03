import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { AdminInvoiceListQuery, InvoiceLifecycleStatus } from '@shop/contracts/trade-credit';
import { apiErrors } from '@shop/localisation/messages/apiErrors';
import {
  adminCommerceMessages,
  type AdminCommerceMessageKey,
} from '@shop/localisation/messages/adminCommerce';
import {
  adminDiagnosticsMessages,
  type AdminDiagnosticsMessageKey,
} from '@shop/localisation/messages/adminDiagnostics';
import { getAdminInvoices } from '@/api/adminCredit';
import { ErrorMessage } from '@/components/ErrorMessage';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useLocalisation } from '@/i18n/LocaleContext';
import {
  ADMIN_CREDIT_PAGE_SIZE,
  INVOICE_STATUSES,
  invoiceStatusMessageKeys,
  localizeAdminCreditError,
  readCompanyId,
  readInvoiceStatus,
  readPositivePage,
  type TranslateApiError,
} from './creditPresentation';

type InvoiceList = Awaited<ReturnType<typeof getAdminInvoices>>;

function createQuery(
  companyId: string | undefined,
  status: InvoiceLifecycleStatus | undefined,
  page: number,
): AdminInvoiceListQuery {
  const query: AdminInvoiceListQuery = { page, pageSize: ADMIN_CREDIT_PAGE_SIZE };
  if (companyId) query.companyId = companyId;
  if (status) query.status = status;
  return query;
}

export function AdminInvoicesPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { country, translate, formatSettlementMoney, formatCount } = useLocalisation();
  const t = (key: AdminCommerceMessageKey, params = {}) =>
    translate(adminCommerceMessages, key, params);
  const adminT = (key: AdminDiagnosticsMessageKey, params = {}) =>
    translate(adminDiagnosticsMessages, key, params);
  const translateApiError: TranslateApiError = (key, params = {}) =>
    translate(apiErrors, key, params);
  const companyId = readCompanyId(searchParams.get('companyId'));
  const status = readInvoiceStatus(searchParams.get('status'));
  const page = readPositivePage(searchParams.get('page'));
  const [companyIdInput, setCompanyIdInput] = useState(searchParams.get('companyId') ?? '');
  const [statusInput, setStatusInput] = useState<InvoiceLifecycleStatus | ''>(status ?? '');
  const [result, setResult] = useState<InvoiceList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadVersion, setReloadVersion] = useState(0);

  useEffect(() => {
    setCompanyIdInput(searchParams.get('companyId') ?? '');
    setStatusInput(readInvoiceStatus(searchParams.get('status')) ?? '');
  }, [searchParams]);

  useEffect(() => {
    // Country is part of the server scope. Do not leave the prior-country list actionable while
    // the replacement request is in flight.
    setResult(null);
    setError(null);
  }, [country]);

  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setLoading(true);
    setError(null);
    const query = createQuery(companyId, status, page);
    getAdminInvoices(query, controller.signal)
      .then((response) => {
        if (!current) return;
        setResult(response);
        const maximumPage = Math.max(1, Math.ceil(response.total / response.pageSize));
        if (page > maximumPage) {
          const next = new URLSearchParams(searchParams);
          if (maximumPage > 1) next.set('page', String(maximumPage));
          else next.delete('page');
          setSearchParams(next, { replace: true });
        }
      })
      .catch((requestError: unknown) => {
        if (current && !controller.signal.aborted)
          setError(
            localizeAdminCreditError(
              requestError,
              'adminCommerce.invoice.error.load',
              t,
              translateApiError,
            ),
          );
      })
      .finally(() => {
        if (current && !controller.signal.aborted) setLoading(false);
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [companyId, country, page, reloadVersion, searchParams, setSearchParams, status]);

  const updateFilters = () => {
    const nextCompanyId = companyIdInput.trim();
    if (nextCompanyId && !readCompanyId(nextCompanyId)) {
      setError(t('adminCommerce.invoice.error.load'));
      return;
    }
    const next = new URLSearchParams();
    if (nextCompanyId) next.set('companyId', nextCompanyId);
    if (statusInput) next.set('status', statusInput);
    setSearchParams(next, { replace: true });
  };

  const refresh = () => setReloadVersion((value) => value + 1);
  const totalPages = useMemo(
    () => (result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1),
    [result],
  );

  if (loading && !result) return <LoadingSpinner />;
  if (error && !result) return <ErrorMessage message={error} onRetry={refresh} />;
  if (!result)
    return <ErrorMessage message={t('adminCommerce.invoice.error.load')} onRetry={refresh} />;

  return (
    <section className="mx-auto max-w-5xl space-y-6" aria-labelledby="admin-invoices-heading">
      <div>
        <p className="section-eyebrow">{t('adminCommerce.administration')}</p>
        <h1 id="admin-invoices-heading" className="section-heading mt-2">
          {t('adminCommerce.invoice.heading')}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t('adminCommerce.invoice.description')}
        </p>
      </div>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          updateFilters();
        }}
      >
        <label className="text-sm">
          {t('adminCommerce.invoice.companyId')}
          <input
            aria-label={t('adminCommerce.invoice.companyId')}
            inputMode="numeric"
            className="ml-2 rounded-md border border-input px-2 py-1"
            value={companyIdInput}
            onChange={(event) => setCompanyIdInput(event.target.value)}
          />
        </label>
        <label className="text-sm">
          {t('adminCommerce.invoice.status')}
          <select
            aria-label={t('adminCommerce.invoice.status')}
            className="ml-2 rounded-md border border-input bg-background px-2 py-1"
            value={statusInput}
            onChange={(event) => setStatusInput(readInvoiceStatus(event.target.value) ?? '')}
          >
            <option value="">{t('adminCommerce.invoice.status.all')}</option>
            {INVOICE_STATUSES.map((value) => (
              <option key={value} value={value}>
                {t(invoiceStatusMessageKeys[value])}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit">{t('adminCommerce.invoice.filter')}</Button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {result.items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            {t('adminCommerce.invoice.noMatch')}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3" aria-busy={loading}>
          {result.items.map((invoice) => (
            <Card key={invoice.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
                <div className="min-w-0">
                  <h2 className="font-semibold">{invoice.invoiceNumber}</h2>
                  <p className="text-sm text-muted-foreground">
                    {t('adminCommerce.invoice.summary', {
                      invoiceNumber: invoice.invoiceNumber,
                      status: t(invoiceStatusMessageKeys[invoice.status]),
                      money: formatSettlementMoney(invoice.grossCents),
                    })}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {t('adminCommerce.invoice.company', {
                      companyName: invoice.billingEntity.legalName,
                    })}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => navigate(`/admin/invoices/${invoice.id}`)}
                >
                  {t('adminCommerce.invoice.viewDetail')}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <nav
        className="flex items-center justify-between"
        aria-label={t('adminCommerce.invoice.heading')}
      >
        <Button
          type="button"
          variant="outline"
          disabled={page <= 1 || loading}
          onClick={() => {
            const next = new URLSearchParams(searchParams);
            if (page <= 2) next.delete('page');
            else next.set('page', String(page - 1));
            setSearchParams(next, { replace: true });
          }}
        >
          {adminT('admin.common.previous')}
        </Button>
        <span className="text-sm text-muted-foreground">
          {adminT('admin.common.page', {
            page: formatCount(result.page),
            totalPages: formatCount(totalPages),
          })}
        </span>
        <Button
          type="button"
          variant="outline"
          disabled={page >= totalPages || loading}
          onClick={() => {
            const next = new URLSearchParams(searchParams);
            next.set('page', String(page + 1));
            setSearchParams(next, { replace: true });
          }}
        >
          {adminT('admin.common.next')}
        </Button>
      </nav>
    </section>
  );
}

export default AdminInvoicesPage;
