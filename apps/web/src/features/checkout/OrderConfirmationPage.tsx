import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { OrderDetailResponse } from '@shop/contracts/orders';
import { getOrder } from '@/api/orders';
import { ApiError } from '@/api/client';
import { ErrorMessage } from '@/components/ErrorMessage';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { Button } from '@/components/ui/button';
import { OrderDetailView } from '@/features/orders/OrderDetailView';
import { useLocalisation } from '@/i18n/LocaleContext';
import { checkoutMessages } from '@shop/localisation/messages/checkout';

/** Confirmation remains usable for exact-order guest capability cookies. */
export function OrderConfirmationPage() {
  const { translate } = useLocalisation();
  const t = (key: keyof typeof checkoutMessages, params?: Record<string, string | number>) =>
    translate(checkoutMessages, key, params);
  const { orderId } = useParams<{ orderId: string }>();
  const [order, setOrder] = useState<OrderDetailResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const fetchOrder = useCallback(async () => {
    if (!orderId) {
      setError(t('checkout.orderReferenceMissing'));
      setIsLoading(false);
      return;
    }
    const currentRequest = ++requestId.current;
    setIsLoading(true);
    setError(null);
    try {
      const response = await getOrder(orderId);
      if (currentRequest === requestId.current) setOrder(response);
    } catch (err) {
      if (currentRequest === requestId.current) {
        setError(
          err instanceof ApiError && err.status === 404
            ? t('checkout.orderNotFound')
            : t('checkout.loadOrderFailed'),
        );
      }
    } finally {
      if (currentRequest === requestId.current) setIsLoading(false);
    }
  }, [orderId, translate]);

  useEffect(() => {
    void fetchOrder();
  }, [fetchOrder]);

  if (isLoading) return <LoadingSpinner />;
  if (error)
    return <ErrorMessage message={error} onRetry={orderId ? () => void fetchOrder() : undefined} />;
  if (!order) return <ErrorMessage message={t('checkout.orderNotFound')} />;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold text-green-700">{t('checkout.confirmed')}</h1>
        <p className="text-muted-foreground">{t('checkout.confirmedDescription')}</p>
      </div>
      {/* This route may be opened with an exact-order guest capability cookie. */}
      <OrderDetailView order={order} showInvoice={false} />
      <div className="mt-6 text-center">
        <Button nativeButton={false} render={<Link to="/catalog" />}>
          {t('checkout.shopMore')}
        </Button>
      </div>
    </div>
  );
}
