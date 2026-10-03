import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { Company, CompanyInvite, CompanyMembership } from '@shop/contracts/company-accounts';
import type { CreditAccountMemberResponse } from '@shop/contracts/trade-credit';
import { ApiError } from '@/api/client';
import {
  createCompany,
  getCompany,
  inviteMember,
  listInvites,
  listMembers,
  revokeInvite,
  revokeMember,
  updateMemberRole,
  updateThreshold,
} from '@/api/companyAccounts';
import { getTradeCreditSummary } from '@/api/tradeCredit';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { useLocalisation } from '@/i18n/LocaleContext';
import { apiErrors } from '@shop/localisation/messages/apiErrors';
import { commonMessages } from '@shop/localisation/messages/common';
import {
  tradeAsyncMessages,
  type TradeAsyncMessageKey,
} from '@shop/localisation/messages/tradeAsync';
import { InvitesSection } from './InvitesSection';
import { MembersSection } from './MembersSection';
import { ThresholdSection } from './ThresholdSection';

type Account = { company: Company; membership: CompanyMembership } | null;

type CreditState =
  | { status: 'loading' }
  | { status: 'loaded'; summary: CreditAccountMemberResponse }
  | { status: 'error' };

function CreditSummary({ state, onRetry }: { state: CreditState; onRetry: () => void }) {
  const { translate, formatSettlementMoney } = useLocalisation();
  const t = <K extends TradeAsyncMessageKey>(
    key: K,
    params?: Record<string, string | number | bigint>,
  ) => translate(tradeAsyncMessages, key, params);

  return (
    <section
      aria-labelledby="company-credit-heading"
      data-testid="company-credit-summary"
      className="mt-8 rounded-lg border p-5"
    >
      <h2 id="company-credit-heading" className="text-lg font-semibold">
        {t('company.credit.heading')}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{t('company.credit.description')}</p>
      {state.status === 'loading' && (
        <p role="status" className="mt-4 text-sm text-muted-foreground">
          {t('company.credit.loading')}
        </p>
      )}
      {state.status === 'error' && (
        <div className="mt-4 space-y-3">
          <p role="alert" className="text-sm text-destructive">
            {t('company.credit.error')}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            {t('company.credit.retry')}
          </Button>
        </div>
      )}
      {state.status === 'loaded' &&
        (state.summary ? (
          <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
            <p>
              {t('company.credit.state')}:{' '}
              {t(`company.credit.state.${state.summary.state}` as TradeAsyncMessageKey)}
            </p>
            <p>{t('company.credit.terms')}</p>
            <p>{t('company.credit.due')}</p>
            <p>
              {t('company.credit.limit', {
                money: formatSettlementMoney(state.summary.creditLimitCents),
              })}
            </p>
            <p>
              {t('company.credit.outstanding', {
                money: formatSettlementMoney(state.summary.outstandingCents),
              })}
            </p>
            <p>
              {t('company.credit.held', {
                money: formatSettlementMoney(state.summary.heldCents),
              })}
            </p>
            <p>
              {t('company.credit.exposure', {
                money: formatSettlementMoney(state.summary.exposureCents),
              })}
            </p>
            <p>
              {t('company.credit.available', {
                money: formatSettlementMoney(state.summary.availableCreditCents),
              })}
            </p>
            {state.summary.holdReason && (
              <p className="sm:col-span-2">
                {t('company.credit.reason', { reason: state.summary.holdReason })}
              </p>
            )}
          </div>
        ) : (
          <p role="status" className="mt-4 text-sm text-muted-foreground">
            {t('company.credit.noCompany')}
          </p>
        ))}
    </section>
  );
}

export function CompanyPage() {
  const { translate } = useLocalisation();
  const t = <K extends TradeAsyncMessageKey>(
    key: K,
    params?: Record<string, string | number | bigint>,
  ) => translate(tradeAsyncMessages, key, params);
  const errorText = useCallback(
    (error: unknown, fallback: TradeAsyncMessageKey) => {
      if (error instanceof ApiError && error.code !== null) {
        const params = Object.fromEntries(
          Object.entries(error.meta ?? {}).filter(
            ([, value]) =>
              typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint',
          ),
        ) as Record<string, string | number | bigint>;
        try {
          return translate(apiErrors, error.code, params);
        } catch {
          // Unknown metadata shape falls through to safe feature copy.
        }
      }
      return t(fallback);
    },
    [translate],
  );
  const [account, setAccount] = useState<Account>(null);
  const [members, setMembers] = useState<CompanyMembership[]>([]);
  const [invites, setInvites] = useState<CompanyInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accountLoadError, setAccountLoadError] = useState<string | null>(null);
  const [creditState, setCreditState] = useState<CreditState>({ status: 'loading' });
  const [name, setName] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const loadGeneration = useRef(0);
  const activeController = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    activeController.current?.abort();
    const generation = ++loadGeneration.current;
    const controller = new AbortController();
    activeController.current = controller;
    setLoading(true);
    setAccountLoadError(null);
    setError(null);
    setCreditState({ status: 'loading' });
    try {
      const [companyResult, creditResult] = await Promise.allSettled([
        getCompany({ signal: controller.signal }),
        getTradeCreditSummary({ signal: controller.signal }),
      ]);
      if (controller.signal.aborted || generation !== loadGeneration.current) return;

      if (creditResult.status === 'fulfilled') {
        setCreditState({ status: 'loaded', summary: creditResult.value });
      } else {
        setCreditState({ status: 'error' });
      }

      if (companyResult.status === 'rejected') {
        setAccount(null);
        setMembers([]);
        setInvites([]);
        setAccountLoadError(errorText(companyResult.reason, 'company.error.load'));
        return;
      }

      const next = companyResult.value;
      setAccount(next);
      if (next) {
        try {
          const [nextMembers, nextInvites] = await Promise.all([
            listMembers(),
            next.membership.role === 'owner' ? listInvites() : Promise.resolve([]),
          ]);
          if (generation !== loadGeneration.current) return;
          setMembers(nextMembers);
          setInvites(nextInvites);
        } catch (membersError) {
          if (generation !== loadGeneration.current) return;
          setError(errorText(membersError, 'company.error.load'));
        }
      } else {
        setMembers([]);
        setInvites([]);
      }
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
      if (activeController.current === controller) {
        activeController.current = null;
        controller.abort();
      }
    }
  }, [errorText]);
  useEffect(() => {
    void load();
    return () => {
      loadGeneration.current += 1;
      activeController.current?.abort();
      activeController.current = null;
    };
  }, [load]);
  async function create(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const next = await createCompany({ name: name.trim() });
      setAccount(next);
      setName('');
      await load();
    } catch (error) {
      setError(errorText(error, 'company.error.update'));
    }
  }
  if (loading) return <LoadingSpinner />;
  if (accountLoadError)
    return (
      <main className="mx-auto max-w-xl py-12">
        <h1 className="text-2xl font-bold">{t('company.title')}</h1>
        <p role="alert" className="mt-4 text-sm text-destructive">
          {accountLoadError}
        </p>
        <Button type="button" variant="outline" className="mt-4" onClick={() => void load()}>
          {translate(commonMessages, 'common.retry')}
        </Button>
      </main>
    );
  if (!account)
    return (
      <main className="mx-auto max-w-xl py-12">
        <h1 className="text-2xl font-bold">{t('company.title')}</h1>
        <p className="mt-2 text-muted-foreground">{t('company.createDescription')}</p>
        {error && (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {error}
          </p>
        )}
        <form onSubmit={(event) => void create(event)} className="mt-6 rounded-lg border p-5">
          <label htmlFor="company-name" className="block text-sm font-medium">
            {t('company.name')}
          </label>
          <input
            id="company-name"
            required
            maxLength={160}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-2 w-full rounded-md border px-3 py-2"
          />
          <Button type="submit" className="mt-3">
            {t('company.create')}
          </Button>
        </form>
        <CreditSummary state={creditState} onRetry={() => void load()} />
      </main>
    );
  const isOwner = account.membership.role === 'owner';
  const mutate = async (work: () => Promise<void>) => {
    setError(null);
    try {
      await work();
      await load();
    } catch (error) {
      setError(errorText(error, 'company.error.update'));
    } finally {
      setBusyId(null);
    }
  };
  return (
    <main className="mx-auto max-w-3xl py-12">
      <h1 className="text-2xl font-bold">{account.company.name}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {t('company.role', {
          role: t(`company.role.${account.membership.role}` as TradeAsyncMessageKey),
        })}
      </p>
      <CreditSummary state={creditState} onRetry={() => void load()} />
      {error && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      )}
      <ThresholdSection
        thresholdCents={account.company.approvalThresholdCents}
        isOwner={isOwner}
        onSave={(cents) =>
          mutate(() => updateThreshold({ approvalThresholdCents: cents }).then(() => undefined))
        }
      />
      <MembersSection
        members={members}
        isOwner={isOwner}
        busyId={busyId}
        onRoleChange={(id, role) => {
          setBusyId(id);
          void mutate(() => updateMemberRole(id, { role }).then(() => undefined));
        }}
        onRevoke={(id) => {
          setBusyId(id);
          void mutate(() => revokeMember(id).then(() => undefined));
        }}
      />
      {isOwner && (
        <InvitesSection
          invites={invites}
          onInvite={(email, role) =>
            mutate(() => inviteMember({ email: email.trim(), role }).then(() => undefined))
          }
          onRevoke={(id) => mutate(() => revokeInvite(id).then(() => undefined))}
        />
      )}
    </main>
  );
}
