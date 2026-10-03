import type { OrderApproval } from '@shop/contracts/order-approvals';
import { useLocalisation } from '@/i18n/LocaleContext';
import {
  tradeAsyncMessages,
  type TradeAsyncMessageKey,
} from '@shop/localisation/messages/tradeAsync';
export function BuyerRequestsList({ approvals }: { approvals: OrderApproval[] }) {
  const { translate, formatSettlementMoney } = useLocalisation();
  const t = <K extends TradeAsyncMessageKey>(
    key: K,
    params?: Record<string, string | number | bigint>,
  ) => translate(tradeAsyncMessages, key, params);
  return (
    <section className="mt-6 rounded-lg border p-5">
      <h2 className="font-semibold">{t('approvals.mine')}</h2>
      {approvals.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{t('approvals.emptyMine')}</p>
      ) : (
        <ul className="mt-3 divide-y">
          {approvals.map((approval) => (
            <li key={approval.id} className="flex items-center justify-between gap-3 py-3">
              <div>
                <p className="font-medium">{formatSettlementMoney(approval.quoteTotalCents)}</p>
                <p className="text-sm text-muted-foreground">
                  {approval.purchaseOrderReference ?? t('approvals.noPurchaseOrder')}
                </p>
              </div>
              <span className="text-sm">
                {t(`approvals.status.${approval.status}` as TradeAsyncMessageKey)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
