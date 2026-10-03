import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useBackInStock } from '@/hooks/useBackInStock';
import { productMessages } from '@shop/localisation/messages/product';
import { useLocalisation } from '@/i18n/LocaleContext';

/** Account view of the buyer's outstanding back-in-stock alerts. */
export function BackInStockSection() {
  const { subscriptions, loading, error, cancel } = useBackInStock();
  const { translate, formatInstant } = useLocalisation();
  const t = <K extends keyof typeof productMessages>(
    key: K,
    params?: Record<string, string | number>,
  ) => translate(productMessages, key, params);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const pending = subscriptions.filter((item) => item.status === 'pending');

  const onCancel = async (subscriptionId: string) => {
    if (cancelling) return;
    setCancelling(subscriptionId);
    await cancel(subscriptionId);
    setCancelling(null);
  };

  return (
    <section aria-labelledby="back-in-stock-heading" className="mt-6 rounded-lg border p-6">
      <h2 id="back-in-stock-heading" className="text-base font-medium">
        {t('product.backInStockAlerts')}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{t('product.backInStockDescription')}</p>
      {error && (
        <p role="alert" className="mt-3 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {loading && pending.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">{t('product.loadingAlerts')}</p>
      ) : pending.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">{t('product.noAlerts')}</p>
      ) : (
        <ul aria-label={t('product.backInStockAlerts')} className="mt-4 space-y-3">
          {pending.map((item) => (
            <li
              key={item.subscriptionId}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm"
            >
              <div className="min-w-0">
                <p className="font-medium">{item.productName}</p>
                <p className="text-muted-foreground">
                  {item.variantLabel} ·{' '}
                  {t('product.requestedAt', {
                    date: formatInstant(item.requestedAt, 'date'),
                  })}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={cancelling === item.subscriptionId}
                onClick={() => void onCancel(item.subscriptionId)}
                aria-label={t('product.cancelAlertFor', {
                  name: item.productName,
                  variant: item.variantLabel,
                })}
              >
                {t('product.cancelAlert')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
