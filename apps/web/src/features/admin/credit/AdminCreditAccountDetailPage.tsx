import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { TradeCreditState } from '@shop/contracts/trade-credit';
import { apiErrors } from '@shop/localisation/messages/apiErrors';
import { adminCommerceMessages } from '@shop/localisation/messages/adminCommerce';
import { getAdminCreditAccount, updateAdminCreditAccount } from '@/api/adminCredit';
import { ErrorMessage } from '@/components/ErrorMessage';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useLocalisation } from '@/i18n/LocaleContext';
import {
  CREDIT_STATES,
  creditStateMessageKeys,
  localizeAdminCreditError,
  parseGbpToPence,
  type Translate,
  type TranslateApiError,
} from './creditPresentation';

type Account = Awaited<ReturnType<typeof getAdminCreditAccount>>;
type MutationKey = { fingerprint: string; key: string };
type WorkingMutation = 'limit' | 'state';

function nextIdempotencyKey(): string {
  return crypto.randomUUID();
}

function keyFor(record: MutableRefObject<MutationKey | null>, fingerprint: string): string {
  if (record.current?.fingerprint === fingerprint) return record.current.key;
  const key = nextIdempotencyKey();
  record.current = { fingerprint, key };
  return key;
}

export function AdminCreditAccountDetailPage() {
  const navigate = useNavigate();
  const { creditAccountId } = useParams();
  const { country, translate, formatSettlementMoney, formatInstant } = useLocalisation();
  const t = useCallback<Translate>(
    (key, params = {}) => translate(adminCommerceMessages, key, params),
    [translate],
  );
  const translateApiError = useCallback<TranslateApiError>(
    (key, params = {}) => translate(apiErrors, key, params),
    [translate],
  );
  const [account, setAccount] = useState<Account | null>(null);
  const [limitInput, setLimitInput] = useState('');
  const [stateInput, setStateInput] = useState<TradeCreditState | ''>('');
  const [reasonInput, setReasonInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [working, setWorking] = useState<WorkingMutation | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const limitKey = useRef<MutationKey | null>(null);
  const stateKey = useRef<MutationKey | null>(null);
  const mutationGeneration = useRef(0);
  const mutationController = useRef<AbortController | null>(null);
  const currentAccountId = useRef(creditAccountId);
  const currentAccountCountry = useRef(country);
  currentAccountId.current = creditAccountId;
  currentAccountCountry.current = country;

  useEffect(() => {
    limitKey.current = null;
    stateKey.current = null;
    mutationGeneration.current += 1;
    mutationController.current?.abort();
    mutationController.current = null;
    setWorking(null);
    setNotice(null);
    setError(null);
    setAccount(null);
    setLimitInput('');
    setStateInput('');
    setReasonInput('');
  }, [country, creditAccountId]);

  useEffect(() => {
    if (!creditAccountId) return;
    const controller = new AbortController();
    let current = true;
    setLoading(true);
    setError(null);
    getAdminCreditAccount(creditAccountId, controller.signal)
      .then((response) => {
        if (!current) return;
        setAccount(response);
        setStateInput(response.state);
      })
      .catch((requestError: unknown) => {
        if (current && !controller.signal.aborted)
          setError(
            localizeAdminCreditError(
              requestError,
              'adminCommerce.credit.error.detail',
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
  }, [country, creditAccountId, reloadVersion, t, translateApiError]);

  const invalidateMutation = () => {
    mutationGeneration.current += 1;
    mutationController.current?.abort();
    mutationController.current = null;
    setWorking(null);
    setError(null);
    setNotice(null);
  };

  const submitLimit = useCallback(async () => {
    if (!account || !creditAccountId || working) return;
    const normalized = limitInput.trim();
    const creditLimitCents = parseGbpToPence(normalized);
    if (creditLimitCents === null) {
      setError(t('adminCommerce.credit.limitHint'));
      return;
    }
    const mutationCountry = country;
    const fingerprint = `${mutationCountry}:${account.version}:limit:${normalized}`;
    const idempotencyKey = keyFor(limitKey, fingerprint);
    const generation = ++mutationGeneration.current;
    const controller = new AbortController();
    mutationController.current = controller;
    setWorking('limit');
    setError(null);
    setNotice(null);
    try {
      await updateAdminCreditAccount(
        creditAccountId,
        { creditLimitCents, expectedVersion: account.version, idempotencyKey },
        controller.signal,
      );
      if (
        generation !== mutationGeneration.current ||
        currentAccountId.current !== creditAccountId ||
        currentAccountCountry.current !== mutationCountry ||
        controller.signal.aborted
      )
        return;
      setNotice(t('adminCommerce.credit.updated'));
      setReloadVersion((value) => value + 1);
    } catch (requestError: unknown) {
      if (
        generation === mutationGeneration.current &&
        currentAccountId.current === creditAccountId &&
        currentAccountCountry.current === mutationCountry &&
        !controller.signal.aborted
      )
        setError(
          localizeAdminCreditError(
            requestError,
            'adminCommerce.credit.error.update',
            t,
            translateApiError,
          ),
        );
    } finally {
      if (
        generation === mutationGeneration.current &&
        currentAccountId.current === creditAccountId &&
        currentAccountCountry.current === mutationCountry
      ) {
        mutationController.current = null;
        setWorking(null);
      }
    }
  }, [account, country, creditAccountId, limitInput, t, translateApiError, working]);

  const submitState = useCallback(async () => {
    if (!account || !creditAccountId || !stateInput || working) return;
    const reason = reasonInput.trim();
    const mutationCountry = country;
    const fingerprint = `${mutationCountry}:${account.version}:state:${stateInput}:${reason}`;
    const idempotencyKey = keyFor(stateKey, fingerprint);
    const generation = ++mutationGeneration.current;
    const controller = new AbortController();
    mutationController.current = controller;
    setWorking('state');
    setError(null);
    setNotice(null);
    try {
      await updateAdminCreditAccount(
        creditAccountId,
        {
          state: stateInput,
          expectedVersion: account.version,
          idempotencyKey,
          ...(reason ? { reason } : {}),
        },
        controller.signal,
      );
      if (
        generation !== mutationGeneration.current ||
        currentAccountId.current !== creditAccountId ||
        currentAccountCountry.current !== mutationCountry ||
        controller.signal.aborted
      )
        return;
      setNotice(t('adminCommerce.credit.updated'));
      setReloadVersion((value) => value + 1);
    } catch (requestError: unknown) {
      if (
        generation === mutationGeneration.current &&
        currentAccountId.current === creditAccountId &&
        currentAccountCountry.current === mutationCountry &&
        !controller.signal.aborted
      )
        setError(
          localizeAdminCreditError(
            requestError,
            'adminCommerce.credit.error.update',
            t,
            translateApiError,
          ),
        );
    } finally {
      if (
        generation === mutationGeneration.current &&
        currentAccountId.current === creditAccountId &&
        currentAccountCountry.current === mutationCountry
      ) {
        mutationController.current = null;
        setWorking(null);
      }
    }
  }, [account, country, creditAccountId, reasonInput, stateInput, t, translateApiError, working]);

  if (!creditAccountId)
    return (
      <ErrorMessage message={t('adminCommerce.credit.error.detail')} onRetry={() => undefined} />
    );
  if (loading && !account) return <LoadingSpinner />;
  if (error && !account)
    return <ErrorMessage message={error} onRetry={() => setReloadVersion((value) => value + 1)} />;
  if (!account)
    return (
      <ErrorMessage
        message={t('adminCommerce.credit.error.detail')}
        onRetry={() => setReloadVersion((value) => value + 1)}
      />
    );

  const editLimit = (value: string) => {
    limitKey.current = null;
    invalidateMutation();
    setLimitInput(value);
  };
  const editState = (value: string) => {
    stateKey.current = null;
    invalidateMutation();
    setStateInput(
      CREDIT_STATES.includes(value as TradeCreditState) ? (value as TradeCreditState) : '',
    );
  };
  const editReason = (value: string) => {
    stateKey.current = null;
    invalidateMutation();
    setReasonInput(value);
  };

  return (
    <section className="mx-auto max-w-5xl space-y-6" aria-labelledby="admin-credit-account-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="section-eyebrow">{t('adminCommerce.administration')}</p>
          <h1 id="admin-credit-account-heading" className="section-heading mt-2">
            {t('adminCommerce.credit.account', { creditAccountId: account.id })}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t('adminCommerce.credit.summary', {
              companyName: account.companyName,
              state: t(creditStateMessageKeys[account.state]),
            })}
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => navigate('/admin/credit-accounts')}>
          {t('adminCommerce.credit.closeDetail')}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <p aria-live="polite" className="text-sm text-muted-foreground">
        {notice}
      </p>
      <Card>
        <CardContent className="grid gap-2 py-5 sm:grid-cols-2">
          <p>
            {t('adminCommerce.credit.company')}: {account.companyName}
          </p>
          <p>
            {t('adminCommerce.credit.companyId')}: {account.companyId}
          </p>
          <p>
            {t('adminCommerce.credit.limit', {
              money: formatSettlementMoney(account.creditLimitCents),
            })}
          </p>
          <p>
            {t('adminCommerce.credit.outstanding', {
              money: formatSettlementMoney(account.outstandingCents),
            })}
          </p>
          <p>
            {t('adminCommerce.credit.held', {
              money: formatSettlementMoney(account.heldCents),
            })}
          </p>
          <p>
            {t('adminCommerce.credit.exposure', {
              money: formatSettlementMoney(account.exposureCents),
            })}
          </p>
          <p>
            {t('adminCommerce.credit.available', {
              money: formatSettlementMoney(account.availableCreditCents),
            })}
          </p>
          <p>{t('adminCommerce.credit.terms')}</p>
          {account.holdReason && (
            <p>
              {t('adminCommerce.credit.reason')}: {account.holdReason}
            </p>
          )}
          <p className="text-sm text-muted-foreground sm:col-span-2">
            {formatInstant(account.updatedAt)}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-4 py-5">
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              void submitLimit();
            }}
          >
            <h2 className="font-semibold">{t('adminCommerce.credit.limitLabel')}</h2>
            <label className="block text-sm">
              {t('adminCommerce.credit.limitLabel')}
              <input
                aria-label={t('adminCommerce.credit.limitLabel')}
                inputMode="decimal"
                autoComplete="off"
                className="ml-2 rounded-md border border-input px-2 py-1"
                placeholder={formatSettlementMoney(account.creditLimitCents)}
                value={limitInput}
                onChange={(event) => editLimit(event.target.value)}
              />
            </label>
            <p className="text-xs text-muted-foreground">{t('adminCommerce.credit.limitHint')}</p>
            <Button type="submit" disabled={working !== null}>
              {working === 'limit'
                ? t('adminCommerce.credit.updating')
                : t('adminCommerce.credit.updateLimit')}
            </Button>
          </form>
          <form
            className="space-y-2 border-t border-border pt-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submitState();
            }}
          >
            <h2 className="font-semibold">{t('adminCommerce.credit.updateState')}</h2>
            <label className="block text-sm">
              {t('adminCommerce.credit.state')}
              <select
                aria-label={t('adminCommerce.credit.state')}
                className="ml-2 rounded-md border border-input bg-background px-2 py-1"
                value={stateInput}
                onChange={(event) => editState(event.target.value)}
              >
                {CREDIT_STATES.map((value) => (
                  <option key={value} value={value}>
                    {t(creditStateMessageKeys[value])}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              {t('adminCommerce.credit.reason')}
              <input
                aria-label={t('adminCommerce.credit.reason')}
                className="ml-2 rounded-md border border-input px-2 py-1"
                placeholder={t('adminCommerce.credit.reasonPlaceholder')}
                value={reasonInput}
                onChange={(event) => editReason(event.target.value)}
              />
            </label>
            <Button type="submit" disabled={working !== null || !stateInput}>
              {working === 'state'
                ? t('adminCommerce.credit.updating')
                : t('adminCommerce.credit.updateState')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </section>
  );
}

export { parseGbpToPence } from './creditPresentation';
export default AdminCreditAccountDetailPage;
