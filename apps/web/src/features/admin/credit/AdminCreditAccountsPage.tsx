import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type {
  AdminCreditAccountListQuery,
  CreditAccountAdminView,
  TradeCreditState,
} from '@shop/contracts/trade-credit';
import { apiErrors } from '@shop/localisation/messages/apiErrors';
import { useLocalisation } from '@/i18n/LocaleContext';
import { getAdminCreditAccounts } from '@/api/adminCredit';
import { ErrorMessage } from '@/components/ErrorMessage';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  ADMIN_CREDIT_PAGE_SIZE,
  CREDIT_STATES,
  creditStateMessageKeys,
  localizeAdminCreditError,
  readCompanyId,
  readCreditState,
  readPositivePage,
  type Translate,
  type TranslateApiError,
} from './creditPresentation';
import {
  adminCommerceMessages,
  type AdminCommerceMessageKey,
} from '@shop/localisation/messages/adminCommerce';
import {
  adminDiagnosticsMessages,
  type AdminDiagnosticsMessageKey,
} from '@shop/localisation/messages/adminDiagnostics';

type AccountList = Awaited<ReturnType<typeof getAdminCreditAccounts>>;

function createQuery(
  companyId: string | undefined,
  state: TradeCreditState | undefined,
  page: number,
): AdminCreditAccountListQuery {
  const query: AdminCreditAccountListQuery = { page, pageSize: ADMIN_CREDIT_PAGE_SIZE };
  if (companyId) query.companyId = companyId;
  if (state) query.state = state;
  return query;
}

export function AdminCreditAccountsPage() {
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
  const state = readCreditState(searchParams.get('state'));
  const page = readPositivePage(searchParams.get('page'));
  const [companyIdInput, setCompanyIdInput] = useState(searchParams.get('companyId') ?? '');
  const [stateInput, setStateInput] = useState<TradeCreditState | ''>(state ?? '');
  const [result, setResult] = useState<AccountList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadVersion, setReloadVersion] = useState(0);

  useEffect(() => {
    setCompanyIdInput(searchParams.get('companyId') ?? '');
    setStateInput(readCreditState(searchParams.get('state')) ?? '');
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
    const query = createQuery(companyId, state, page);
    getAdminCreditAccounts(query, controller.signal)
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
              'adminCommerce.credit.error.load',
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
  }, [companyId, country, page, reloadVersion, searchParams, setSearchParams, state]);

  const updateFilters = () => {
    const nextCompanyId = companyIdInput.trim();
    if (nextCompanyId && !readCompanyId(nextCompanyId)) {
      setError(t('adminCommerce.credit.error.load'));
      return;
    }
    const next = new URLSearchParams();
    if (nextCompanyId) next.set('companyId', nextCompanyId);
    if (stateInput) next.set('state', stateInput);
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
    return <ErrorMessage message={t('adminCommerce.credit.error.load')} onRetry={refresh} />;

  return (
    <section className="mx-auto max-w-5xl space-y-6" aria-labelledby="admin-credit-heading">
      <div>
        <p className="section-eyebrow">{t('adminCommerce.administration')}</p>
        <h1 id="admin-credit-heading" className="section-heading mt-2">
          {t('adminCommerce.credit.heading')}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t('adminCommerce.credit.description')}
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
          {t('adminCommerce.credit.companyId')}
          <input
            aria-label={t('adminCommerce.credit.companyId')}
            inputMode="numeric"
            className="ml-2 rounded-md border border-input px-2 py-1"
            value={companyIdInput}
            onChange={(event) => setCompanyIdInput(event.target.value)}
          />
        </label>
        <label className="text-sm">
          {t('adminCommerce.credit.state')}
          <select
            aria-label={t('adminCommerce.credit.state')}
            className="ml-2 rounded-md border border-input bg-background px-2 py-1"
            value={stateInput}
            onChange={(event) => setStateInput(readCreditState(event.target.value) ?? '')}
          >
            <option value="">{t('adminCommerce.credit.state.all')}</option>
            {CREDIT_STATES.map((value) => (
              <option key={value} value={value}>
                {t(creditStateMessageKeys[value])}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit">{t('adminCommerce.credit.filter')}</Button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {result.items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            {t('adminCommerce.credit.noMatch')}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3" aria-busy={loading}>
          {result.items.map((account) => (
            <CreditAccountCard
              key={account.id}
              account={account}
              onDetail={() => navigate(`/admin/credit-accounts/${account.id}`)}
              formatSettlementMoney={formatSettlementMoney}
              t={t}
            />
          ))}
        </div>
      )}
      <nav
        className="flex items-center justify-between"
        aria-label={t('adminCommerce.credit.heading')}
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

function CreditAccountCard({
  account,
  onDetail,
  formatSettlementMoney,
  t,
}: {
  account: CreditAccountAdminView;
  onDetail: () => void;
  formatSettlementMoney: (pence: number) => string;
  t: Translate;
}) {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
        <div className="min-w-0">
          <h2 className="font-semibold">{account.companyName}</h2>
          <p className="text-sm text-muted-foreground">
            {t('adminCommerce.credit.summary', {
              companyName: account.companyName,
              state: t(creditStateMessageKeys[account.state]),
            })}
          </p>
          <p className="text-sm text-muted-foreground">
            {t('adminCommerce.credit.companyId')}: {account.companyId}
          </p>
          <p className="text-sm text-muted-foreground">
            {t('adminCommerce.credit.limit', {
              money: formatSettlementMoney(account.creditLimitCents),
            })}
          </p>
          <p className="text-sm text-muted-foreground">
            {t('adminCommerce.credit.outstanding', {
              money: formatSettlementMoney(account.outstandingCents),
            })}
          </p>
          <p className="text-sm text-muted-foreground">
            {t('adminCommerce.credit.exposure', {
              money: formatSettlementMoney(account.exposureCents),
            })}
          </p>
          <p className="text-sm text-muted-foreground">
            {t('adminCommerce.credit.available', {
              money: formatSettlementMoney(account.availableCreditCents),
            })}
          </p>
        </div>
        <Button type="button" variant="outline" onClick={onDetail}>
          {t('adminCommerce.credit.viewDetail')}
        </Button>
      </CardContent>
    </Card>
  );
}

export default AdminCreditAccountsPage;
