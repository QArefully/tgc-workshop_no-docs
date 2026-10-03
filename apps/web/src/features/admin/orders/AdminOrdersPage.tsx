import { useCallback, useEffect, useRef, useState } from 'react';
import type { AdminOrderDetailResponse } from '@shop/contracts/admin-orders-list';
import type { AdminOrderListQuery, OrderStatus } from '@shop/contracts/orders';
import type { MessageParams } from '@shop/localisation';
import { apiErrors } from '@shop/localisation/messages/apiErrors';
import {
  adminCommerceMessages,
  type AdminCommerceMessageKey,
} from '@shop/localisation/messages/adminCommerce';
import { getAdminOrder, getAdminOrders } from '@/api/adminOrders';
import { createAdminRefund } from '@/api/adminRefunds';
import { ApiError } from '@/api/client';
import { ErrorMessage } from '@/components/ErrorMessage';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useLocalisation } from '@/i18n/LocaleContext';

type Translate = (key: AdminCommerceMessageKey, params?: MessageParams) => string;
type TranslateApiError = (key: string, params?: MessageParams) => string;

const statusMessageKeys: Record<OrderStatus, AdminCommerceMessageKey> = {
  processing: 'adminCommerce.orders.status.processing',
  packed: 'adminCommerce.orders.status.packed',
  shipped: 'adminCommerce.orders.status.shipped',
  delivered: 'adminCommerce.orders.status.delivered',
  delivery_failed: 'adminCommerce.orders.status.delivery_failed',
  cancelled: 'adminCommerce.orders.status.cancelled',
};

function errorParams(error: ApiError): MessageParams {
  if (!error.meta || typeof error.meta !== 'object') return {};
  const params: Record<string, string | number | bigint> = {};
  for (const [key, value] of Object.entries(error.meta)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint')
      params[key] = value;
  }
  return params;
}

function errorMessage(
  error: unknown,
  fallback: AdminCommerceMessageKey,
  t: Translate,
  translateApiError: TranslateApiError,
): string {
  if (error instanceof ApiError) {
    if (error.code && error.code in apiErrors)
      return translateApiError(error.code, errorParams(error));
    return t(fallback);
  }
  return t(fallback);
}

function statusLabel(status: OrderStatus, t: Translate): string {
  return t(statusMessageKeys[status]);
}

export function AdminOrdersPage() {
  const { translate, formatDisplayMoney, formatSettlementMoney, formatDualTotal, formatCount } =
    useLocalisation();
  const t = useCallback<Translate>(
    (key, params = {}) => translate(adminCommerceMessages, key, params),
    [translate],
  );
  const translateApiError = useCallback<TranslateApiError>(
    (key, params = {}) => translate(apiErrors, key, params),
    [translate],
  );
  const [filters, setFilters] = useState({
    status: '',
    userEmail: '',
    promoCode: '',
    occurredFrom: '',
    occurredTo: '',
  });
  const [items, setItems] = useState<Awaited<ReturnType<typeof getAdminOrders>> | null>(null);
  const [selected, setSelected] = useState<AdminOrderDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const detailRequestVersion = useRef(0);
  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    setError(null);
    try {
      const query = Object.fromEntries(
        Object.entries(filters)
          .filter(([, value]) => value)
          .map(([key, value]) =>
            key === 'occurredFrom'
              ? [key, `${value}T00:00:00.000Z`]
              : key === 'occurredTo'
                ? [key, `${value}T23:59:59.999Z`]
                : [key, value],
          ),
      ) as AdminOrderListQuery;
      const response = await getAdminOrders(query);
      if (version === requestVersion.current) setItems(response);
    } catch (e) {
      if (version === requestVersion.current)
        setError(errorMessage(e, 'adminCommerce.orders.error.load', t, translateApiError));
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [filters, t, translateApiError]);
  useEffect(() => {
    void load();
  }, [load]);
  const detail = async (id: string) => {
    const version = ++detailRequestVersion.current;
    try {
      setError(null);
      const response = await getAdminOrder(id);
      if (version === detailRequestVersion.current) setSelected(response);
    } catch (e) {
      if (version === detailRequestVersion.current) {
        setError(errorMessage(e, 'adminCommerce.orders.error.detail', t, translateApiError));
      }
    }
  };
  if (loading && !items) return <LoadingSpinner />;
  if (error && !items) return <ErrorMessage message={error} onRetry={() => void load()} />;
  return (
    <section className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="section-eyebrow">{t('adminCommerce.administration')}</p>
        <h1 className="section-heading mt-2">{t('adminCommerce.orders.heading')}</h1>
      </div>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
      >
        <label className="text-sm">
          {t('adminCommerce.orders.status')}
          <select
            aria-label={t('adminCommerce.orders.status')}
            className="ml-1 rounded-md border border-input px-2 py-1"
            value={filters.status}
            onChange={(event) => setFilters({ ...filters, status: event.target.value })}
          >
            <option value="">{t('adminCommerce.orders.status.all')}</option>
            {['processing', 'packed', 'shipped', 'delivered', 'delivery_failed', 'cancelled'].map(
              (status) => (
                <option key={status} value={status}>
                  {statusLabel(status as OrderStatus, t)}
                </option>
              ),
            )}
          </select>
        </label>
        {(['userEmail', 'promoCode', 'occurredFrom', 'occurredTo'] as const).map((key) => (
          <label key={key} className="text-sm">
            {key === 'userEmail'
              ? t('adminCommerce.orders.buyerEmail')
              : key === 'promoCode'
                ? t('adminCommerce.orders.promo')
                : key === 'occurredFrom'
                  ? t('adminCommerce.orders.occurredFrom')
                  : t('adminCommerce.orders.occurredTo')}
            <input
              aria-label={
                key === 'userEmail'
                  ? t('adminCommerce.orders.buyerEmail')
                  : key === 'promoCode'
                    ? t('adminCommerce.orders.promo')
                    : key === 'occurredFrom'
                      ? t('adminCommerce.orders.occurredFrom')
                      : t('adminCommerce.orders.occurredTo')
              }
              type={key.startsWith('occurred') ? 'date' : 'text'}
              className="ml-1 rounded-md border border-input px-2 py-1"
              value={filters[key]}
              onChange={(e) => setFilters({ ...filters, [key]: e.target.value })}
            />
          </label>
        ))}
        <Button type="submit">{t('adminCommerce.orders.filter')}</Button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {items?.items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            {t('adminCommerce.orders.noMatch')}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {items?.items.map((order) => (
            <Card key={order.id}>
              <CardContent className="flex items-center justify-between gap-4 py-4">
                <div>
                  <strong>{t('adminCommerce.orders.order', { orderId: order.id })}</strong>
                  <p className="text-sm text-muted-foreground">
                    {t('adminCommerce.orders.summary', {
                      email: order.buyer.email,
                      status: statusLabel(order.status, t),
                      total: formatDisplayMoney(order.totalCents),
                    })}
                  </p>
                </div>
                <Button type="button" variant="outline" onClick={() => void detail(order.id)}>
                  {t('adminCommerce.orders.viewDetail')}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {selected && (
        <OrderDetail
          detail={selected}
          onClose={() => {
            detailRequestVersion.current += 1;
            setSelected(null);
          }}
          onError={setError}
          t={t}
          translateApiError={translateApiError}
          formatDisplayMoney={formatDisplayMoney}
          formatSettlementMoney={formatSettlementMoney}
          formatDualTotal={formatDualTotal}
          formatCount={formatCount}
        />
      )}
    </section>
  );
}
function OrderDetail({
  detail,
  onClose,
  onError,
  t,
  translateApiError,
  formatDisplayMoney,
  formatSettlementMoney,
  formatDualTotal,
  formatCount,
}: {
  detail: AdminOrderDetailResponse;
  onClose: () => void;
  onError: (m: string) => void;
  t: Translate;
  translateApiError: TranslateApiError;
  formatDisplayMoney: (pence: number) => string;
  formatSettlementMoney: (pence: number) => string;
  formatDualTotal: (pence: number) => { display: string; settlement?: string };
  formatCount: (value: number) => string;
}) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const idempotencyKey = useRef<string | null>(null);
  const clearSubmission = () => {
    idempotencyKey.current = null;
    setNotice(null);
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    const amountCents = Math.round(Number(amount) * 100);
    if (!Number.isInteger(amountCents) || amountCents < 1) {
      onError(t('adminCommerce.orders.refund.invalidMinimum'));
      return;
    }
    if (!detail.refundPayment) {
      onError(t('adminCommerce.orders.refund.noPayment'));
      return;
    }
    if (amountCents > detail.refundPayment.remainingRefundableCents) {
      onError(
        t('adminCommerce.orders.refund.exceedsBalance', {
          amount: formatSettlementMoney(detail.refundPayment.remainingRefundableCents),
        }),
      );
      return;
    }
    const key = idempotencyKey.current ?? crypto.randomUUID();
    idempotencyKey.current = key;
    setSubmitting(true);
    try {
      await createAdminRefund({
        orderId: detail.id,
        paymentId: detail.refundPayment.paymentId,
        amountCents,
        reason,
        idempotencyKey: key,
      });
      setNotice(
        t('adminCommerce.orders.refund.success', {
          amount: formatSettlementMoney(amountCents),
        }),
      );
    } catch (error) {
      onError(errorMessage(error, 'adminCommerce.orders.error.refund', t, translateApiError));
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <Card>
      <CardContent className="space-y-4 py-5">
        <div className="flex justify-between">
          <h2 className="font-semibold">
            {t('adminCommerce.orders.order', { orderId: detail.id })}
          </h2>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('adminCommerce.orders.closeDetail')}
          </Button>
        </div>
        <p>
          {t('adminCommerce.orders.total', {
            lineCount: t('adminCommerce.orders.lineCount', {
              count: detail.items.length,
              displayCount: formatCount(detail.items.length),
            }),
            total: formatDisplayMoney(detail.totalCents),
          })}
        </p>
        <form className="space-y-2" onSubmit={(e) => void submit(e)}>
          <h3 className="font-medium">{t('adminCommerce.orders.refund.heading')}</h3>
          {detail.refundPayment ? (
            <div className="text-sm text-muted-foreground">
              {(() => {
                const dual = formatDualTotal(detail.refundPayment.remainingRefundableCents);
                return (
                  <>
                    <p>{t('adminCommerce.orders.refund.balance', { amount: dual.display })}</p>
                    {dual.settlement && (
                      <p>
                        {t('adminCommerce.orders.refund.balanceGbp', { amount: dual.settlement })}
                      </p>
                    )}
                  </>
                );
              })()}
            </div>
          ) : (
            <p className="text-sm text-destructive">{t('adminCommerce.orders.refund.noPayment')}</p>
          )}
          <label className="block text-sm">
            {t('adminCommerce.orders.refund.amount')}
            <input
              aria-label={t('adminCommerce.orders.refund.amount')}
              required
              type="number"
              min="0.01"
              step="0.01"
              className="ml-2 rounded-md border border-input px-2 py-1"
              value={amount}
              onChange={(e) => {
                clearSubmission();
                setAmount(e.target.value);
              }}
            />
          </label>
          <p className="text-xs text-muted-foreground">
            {t('adminCommerce.orders.refund.amountHint')}
          </p>
          <label className="block text-sm">
            {t('adminCommerce.orders.refund.reason')}
            <input
              aria-label={t('adminCommerce.orders.refund.reason')}
              required
              className="ml-2 rounded-md border border-input px-2 py-1"
              value={reason}
              onChange={(e) => {
                clearSubmission();
                setReason(e.target.value);
              }}
            />
          </label>
          <Button type="submit" disabled={submitting || !detail.refundPayment}>
            {submitting
              ? t('adminCommerce.orders.refund.submitting')
              : t('adminCommerce.orders.refund.submit')}
          </Button>
          {notice && <p aria-live="polite">{notice}</p>}
        </form>
      </CardContent>
    </Card>
  );
}
