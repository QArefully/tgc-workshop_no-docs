import { Component, useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { cancelOrder, getOrder } from '@/api/orders';
import { ApiError } from '@/api/client';
import { ErrorMessage } from '@/components/ErrorMessage';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { Button } from '@/components/ui/button';
import type { OrderDetailResponse } from '@shop/contracts/orders';
import { useLocalisation } from '@/i18n/LocaleContext';
import {
  orderLifecycleMessages,
  type OrderLifecycleMessageKey,
} from '@shop/localisation/messages/orderLifecycle';
import { OrderDetailView } from './OrderDetailView';
import { ReturnPanel } from '@/features/returns/ReturnPanel';
import { BuyAgainButton, useBuyAgain } from '@/features/reorder/BuyAgainButton';
import { ReorderOutcomeList } from '@/features/reorder/ReorderOutcomeList';
import { SaveOrderAsListButton } from '@/features/savedLists/SaveOrderAsListButton';
import {
  orderErrorMessage,
  orderMessage,
  resolveOrderMessage,
  type OrderMessageState,
} from './orderPresentation';

export function OrderDetailPage() {
  const locale = useLocalisation();
  const t = (key: OrderLifecycleMessageKey, params?: Record<string, string | number | bigint>) =>
    locale.translate(orderLifecycleMessages, key, params);
  const { orderId } = useParams<{ orderId: string }>();
  const [order, setOrder] = useState<OrderDetailResponse | null>(null);
  const [error, setError] = useState<OrderMessageState | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [announcement, setAnnouncement] = useState<OrderMessageState | null>(null);
  const idempotencyKey = useRef<string | null>(null);
  const requestId = useRef(0);
  const cancelTrigger = useRef<HTMLElement | null>(null);
  const confirmButton = useRef<HTMLElement | null>(null);
  const dialog = useRef<HTMLDivElement | null>(null);
  const wasConfirming = useRef(false);
  const { buyAgain, stateFor } = useBuyAgain();

  const load = useCallback(
    async (clearError = true) => {
      if (!orderId) {
        setError(orderMessage('order.error.missingId'));
        setLoading(false);
        return;
      }
      const currentRequest = ++requestId.current;
      setLoading(true);
      if (clearError) setError(null);
      try {
        const response = await getOrder(orderId);
        if (currentRequest === requestId.current) setOrder(response);
      } catch (err) {
        if (currentRequest === requestId.current) {
          setError(
            err instanceof ApiError && (err.status === 404 || err.code === 'ORDER_NOT_FOUND')
              ? orderMessage('order.error.notFound')
              : orderErrorMessage(err, 'order.error.notFound'),
          );
        }
      } finally {
        if (currentRequest === requestId.current) setLoading(false);
      }
    },
    [locale, orderId],
  );

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (confirming) {
      wasConfirming.current = true;
      confirmButton.current?.focus();
      return;
    }
    if (wasConfirming.current && cancelTrigger.current?.isConnected) cancelTrigger.current.focus();
    wasConfirming.current = false;
  }, [confirming]);

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setConfirming(false);
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = dialog.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable?.length) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const submitCancellation = async () => {
    if (!order || !orderId) return;
    setCancelling(true);
    setError(null);
    idempotencyKey.current ??= crypto.randomUUID();
    try {
      setOrder(
        await cancelOrder(orderId, {
          version: order.version,
          idempotencyKey: idempotencyKey.current,
        }),
      );
      setAnnouncement(orderMessage('order.cancel.success', { orderId }));
      setConfirming(false);
      idempotencyKey.current = null;
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.status === 409 &&
        (err.code === null || err.code === 'STALE_VERSION')
      ) {
        idempotencyKey.current = null;
        setConfirming(false);
        setError(orderMessage('order.cancel.stale'));
        await load(false);
      } else setError(orderErrorMessage(err));
    } finally {
      setCancelling(false);
    }
  };

  if (loading && !order) return <LoadingSpinner />;
  if (error && !order) {
    return (
      <ErrorMessage message={resolveOrderMessage(error, locale)} onRetry={() => void load()} />
    );
  }
  if (!order) return <ErrorMessage message={t('order.error.notFound')} />;
  const isCurrentOrder = order.id === orderId;
  const buyAgainState = stateFor(order.id);
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Button variant="link" nativeButton={false} render={<Link to="/orders" />}>
        {t('order.backToOrders')}
      </Button>
      <p aria-live="polite" className="sr-only">
        {announcement ? resolveOrderMessage(announcement, locale) : ''}
      </p>
      {error && (
        <p
          role="status"
          className="rounded-md border border-destructive/40 p-3 text-sm text-destructive"
        >
          {resolveOrderMessage(error, locale)}
        </p>
      )}
      <OrderDetailView
        order={order}
        showInvoice={isCurrentOrder}
        allowCancellation
        isCancelling={cancelling}
        onRequestCancellation={() => setConfirming(true)}
        cancelTriggerRef={cancelTrigger}
      />
      <section className="space-y-3 rounded-lg border p-4" aria-label={t('order.buyAgainRegion')}>
        <div>
          <h2 className="font-medium">{t('order.buyAgainTitle')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('order.buyAgainDescription')}</p>
        </div>
        <BuyAgainButton
          orderId={order.id}
          isPending={buyAgainState.kind === 'pending'}
          onActivate={() => void buyAgain(order.id)}
        />
        <ReorderOutcomeList orderId={order.id} state={buyAgainState} />
      </section>
      <SaveOrderAsListButton orderId={order.id} />
      {order.paymentMethod !== 'trade_credit' && (
        <ReturnErrorBoundary>{orderId && <ReturnPanel orderId={orderId} />}</ReturnErrorBoundary>
      )}
      {confirming && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="cancel-title"
          ref={dialog}
          onKeyDown={handleDialogKeyDown}
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
        >
          <div className="w-full max-w-md rounded-lg bg-background p-5 shadow-lg">
            <h2 id="cancel-title" className="text-lg font-semibold">
              {t('order.cancel.confirmTitle', { orderId: order.id })}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">{t('order.cancel.description')}</p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" disabled={cancelling} onClick={() => setConfirming(false)}>
                {t('order.cancel.keep')}
              </Button>
              <Button
                ref={confirmButton}
                variant="destructive"
                disabled={cancelling}
                onClick={() => void submitCancellation()}
              >
                {cancelling ? t('order.cancel.cancelling') : t('order.cancel.confirm')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

class ReturnErrorBoundary extends Component<{ children: React.ReactNode }, { hasError: boolean }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return null;
    }
    return this.props.children;
  }
}
