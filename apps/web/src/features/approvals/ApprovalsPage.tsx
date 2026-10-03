import { useCallback, useEffect, useRef, useState } from 'react';
import type { OrderApproval } from '@shop/contracts/order-approvals';
import { getCompany } from '@/api/companyAccounts';
import { ApiError } from '@/api/client';
import { decideApproval, listApprovals, listMyApprovalRequests } from '@/api/orderApprovals';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { useLocalisation } from '@/i18n/LocaleContext';
import { apiErrors } from '@shop/localisation/messages/apiErrors';
import {
  tradeAsyncMessages,
  type TradeAsyncMessageKey,
} from '@shop/localisation/messages/tradeAsync';
import { ApproverInbox } from './ApproverInbox';
import { BuyerRequestsList } from './BuyerRequestsList';

export function ApprovalsPage() {
  const { translate } = useLocalisation();
  const t = <K extends TradeAsyncMessageKey>(
    key: K,
    params?: Record<string, string | number | bigint>,
  ) => translate(tradeAsyncMessages, key, params);
  const errorText = (error: unknown) => {
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
        // Safe feature fallback for malformed/legacy metadata.
      }
    }
    return t('approvals.error.load');
  };
  const [mine, setMine] = useState<OrderApproval[]>([]);
  const [inbox, setInbox] = useState<OrderApproval[]>([]);
  const [canApprove, setCanApprove] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const loadSequence = useRef(0);
  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError(null);
    try {
      const company = await getCompany();
      const approver =
        company?.membership.role === 'owner' || company?.membership.role === 'approver';
      const [myRequests, inboxRequests] = await Promise.all([
        listMyApprovalRequests(),
        approver ? listApprovals() : Promise.resolve([]),
      ]);
      if (sequence !== loadSequence.current) return;
      setMine(myRequests);
      setInbox(inboxRequests);
      setCanApprove(approver);
    } catch (error) {
      if (sequence === loadSequence.current) setError(errorText(error));
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function decide(id: string, action: 'approve' | 'reject', reason?: string) {
    setBusyId(id);
    setError(null);
    try {
      await decideApproval(id, { action, ...(reason ? { reason } : {}) });
      await load();
    } catch (error) {
      setError(errorText(error));
      setBusyId(null);
    }
  }
  if (loading) return <LoadingSpinner />;
  return (
    <main className="mx-auto max-w-3xl py-12">
      <h1 className="text-2xl font-bold">{t('approvals.title')}</h1>
      {error && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      )}
      {canApprove && <ApproverInbox approvals={inbox} busyId={busyId} onDecide={decide} />}
      <BuyerRequestsList approvals={mine} />
    </main>
  );
}
