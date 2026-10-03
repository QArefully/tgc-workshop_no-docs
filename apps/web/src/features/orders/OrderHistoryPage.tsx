import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getOrders } from '@/api/orders';
import { ErrorMessage } from '@/components/ErrorMessage';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { BuyAgainButton, useBuyAgain } from '@/features/reorder/BuyAgainButton';
import { ReorderOutcomeList } from '@/features/reorder/ReorderOutcomeList';
import { SaveOrderAsListButton } from '@/features/savedLists/SaveOrderAsListButton';
import { useLocalisation } from '@/i18n/LocaleContext';
import {
  orderLifecycleMessages,
  type OrderLifecycleMessageKey,
} from '@shop/localisation/messages/orderLifecycle';
import type { OrderListResponse } from '@shop/contracts/orders';
import {
  formatOrderDate,
  orderErrorMessage,
  formatPurchaseOrderReference,
  orderStatusLabel,
  resolveOrderMessage,
  type OrderMessageState,
} from './orderPresentation';

const pageSize = 10;

export function OrderHistoryPage() {
  const locale = useLocalisation();
  const t = (key: OrderLifecycleMessageKey, params?: Record<string, string | number | bigint>) =>
    locale.translate(orderLifecycleMessages, key, params);
  const [searchParams, setSearchParams] = useSearchParams();
  const pageValue = Number(searchParams.get('page'));
  const page = Number.isInteger(pageValue) && pageValue > 0 ? pageValue : 1;
  const [result, setResult] = useState<OrderListResponse | null>(null);
  const [error, setError] = useState<OrderMessageState | null>(null);
  const [loading, setLoading] = useState(true);
  const requestId = useRef(0);
  const { buyAgain, stateFor } = useBuyAgain();

  const load = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const response = await getOrders(page, pageSize);
      if (currentRequest === requestId.current) setResult(response);
    } catch (err) {
      if (currentRequest === requestId.current) setError(orderErrorMessage(err));
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [locale, page]);

  useEffect(() => {
    void load();
  }, [load]);
  const changePage = (next: number) => setSearchParams(next === 1 ? {} : { page: String(next) });

  if (loading && !result) return <LoadingSpinner />;
  if (error && !result) {
    return (
      <ErrorMessage message={resolveOrderMessage(error, locale)} onRetry={() => void load()} />
    );
  }
  if (!result) return <ErrorMessage message={t('order.error.unavailable')} />;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('order.pageTitle')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('order.pageDescription')}</p>
      </div>
      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 p-3 text-sm text-destructive"
        >
          {resolveOrderMessage(error, locale)}
        </div>
      )}
      {result.items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="font-medium">{t('order.emptyTitle')}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t('order.emptyDescription')}</p>
            <Button className="mt-4" nativeButton={false} render={<Link to="/catalog" />}>
              {t('order.browseMaterials')}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {result.items.map((order) => {
            const purchaseOrderReference = formatPurchaseOrderReference(
              order.purchaseOrderReference,
            );
            const total = locale.formatDualTotal(order.totalCents);
            const buyAgainState = stateFor(order.id);
            return (
              <Card key={order.id}>
                <CardContent className="space-y-3 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <Link
                        className="font-medium underline-offset-4 hover:underline"
                        to={`/orders/${order.id}`}
                      >
                        {t('order.orderNumber', { orderId: order.id })}
                      </Link>
                      <p className="text-sm text-muted-foreground">
                        {t('order.placed', { date: formatOrderDate(order.createdAt, locale) })} ·{' '}
                        {t('order.itemCount', { count: order.totalItems })}
                      </p>
                      {purchaseOrderReference && (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {t('order.poReference')}{' '}
                          <span className="font-medium text-foreground">
                            {purchaseOrderReference}
                          </span>
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-medium">
                        {total.display}
                        {total.settlement && (
                          <span className="ml-2 text-xs font-normal text-muted-foreground">
                            {t('order.settlementTotal', { money: total.settlement })}
                          </span>
                        )}
                      </span>
                      <Badge
                        variant={
                          order.status === 'cancelled' || order.status === 'delivery_failed'
                            ? 'destructive'
                            : 'secondary'
                        }
                      >
                        {orderStatusLabel(order.status, locale)}
                      </Badge>
                      <BuyAgainButton
                        orderId={order.id}
                        isPending={buyAgainState.kind === 'pending'}
                        onActivate={() => void buyAgain(order.id)}
                      />
                    </div>
                  </div>
                  <ReorderOutcomeList orderId={order.id} state={buyAgainState} />
                  <SaveOrderAsListButton orderId={order.id} />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
      <nav className="flex items-center justify-between" aria-label={t('order.pageTitle')}>
        <Button
          variant="outline"
          disabled={page <= 1 || loading}
          onClick={() => changePage(page - 1)}
        >
          {t('order.previous')}
        </Button>
        <span className="text-sm text-muted-foreground">
          {t('order.page', { page: result.page })}
        </span>
        <Button
          variant="outline"
          disabled={result.items.length < result.pageSize || loading}
          onClick={() => changePage(page + 1)}
        >
          {t('order.next')}
        </Button>
      </nav>
    </div>
  );
}
