import { useState } from 'react';
import type { OrderApproval } from '@shop/contracts/order-approvals';
import { Button } from '@/components/ui/button';
import { useLocalisation } from '@/i18n/LocaleContext';
import {
  tradeAsyncMessages,
  type TradeAsyncMessageKey,
} from '@shop/localisation/messages/tradeAsync';
type Props = {
  approvals: OrderApproval[];
  busyId: string | null;
  onDecide: (id: string, action: 'approve' | 'reject', reason?: string) => Promise<void>;
};
export function ApproverInbox({ approvals, busyId, onDecide }: Props) {
  const { translate, formatSettlementMoney } = useLocalisation();
  const t = <K extends TradeAsyncMessageKey>(
    key: K,
    params?: Record<string, string | number | bigint>,
  ) => translate(tradeAsyncMessages, key, params);
  const [reason, setReason] = useState<Record<string, string>>({});
  async function decide(approval: OrderApproval, action: 'approve' | 'reject') {
    if (
      !window.confirm(
        t(action === 'approve' ? 'approvals.confirmApprove' : 'approvals.confirmReject'),
      )
    )
      return;
    await onDecide(approval.id, action, reason[approval.id]?.trim() || undefined);
  }
  return (
    <section className="mt-6 rounded-lg border p-5">
      <h2 className="font-semibold">{t('approvals.pending')}</h2>
      {approvals.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{t('approvals.emptyInbox')}</p>
      ) : (
        <ul className="mt-3 divide-y">
          {approvals.map((approval) => (
            <li key={approval.id} className="py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{formatSettlementMoney(approval.quoteTotalCents)}</p>
                  <p className="text-sm text-muted-foreground">
                    {t('approvals.buyerId', { id: approval.requestedByUserId })} ·{' '}
                    {approval.purchaseOrderReference ?? t('approvals.noPo')}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t('approvals.deliverTo', {
                      line1: approval.deliveryAddress.line1,
                      city: approval.deliveryAddress.city,
                      postcode: approval.deliveryAddress.postcode,
                    })}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={busyId === approval.id}
                    onClick={() => void decide(approval, 'approve')}
                  >
                    {t('approvals.approve')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busyId === approval.id}
                    onClick={() => void decide(approval, 'reject')}
                  >
                    {t('approvals.reject')}
                  </Button>
                </div>
              </div>
              <label className="mt-3 block text-sm">
                {t('approvals.reason')}
                <input
                  aria-label={t('approvals.reasonAria', { id: approval.id })}
                  value={reason[approval.id] ?? ''}
                  onChange={(event) =>
                    setReason((current) => ({ ...current, [approval.id]: event.target.value }))
                  }
                  maxLength={500}
                  className="mt-1 block w-full rounded-md border px-3 py-2"
                />
              </label>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
