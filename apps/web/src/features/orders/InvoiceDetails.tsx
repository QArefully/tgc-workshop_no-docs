import { useEffect, useRef, useState } from 'react';
import type { InvoiceDetailResponse, InvoiceLifecycleStatus } from '@shop/contracts/trade-credit';
import { ApiError } from '@/api/client';
import { getOrderInvoice } from '@/api/orders';
import { useLocalisation } from '@/i18n/LocaleContext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  orderLifecycleMessages,
  type OrderLifecycleMessageKey,
} from '@shop/localisation/messages/orderLifecycle';
import { formatAddressLine, formatBillingIdentifiers, formatOrderDate } from './orderPresentation';

export interface InvoiceDetailsProps {
  /** Order facts are only a lookup key; invoice facts are always fetched from the server. */
  order: { id: string; paymentMethod?: string; version?: number };
  /** Guest order-capability pages must pass `false`; they cannot upgrade to invoice access. */
  enabled?: boolean;
}

type InvoiceLoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; invoice: InvoiceDetailResponse }
  | { status: 'error'; notFound: boolean };

const STATUS_KEYS: Record<InvoiceLifecycleStatus, OrderLifecycleMessageKey> = {
  open: 'order.invoice.status.open',
  overdue: 'order.invoice.status.overdue',
  paid: 'order.invoice.status.paid',
  voided: 'order.invoice.status.voided',
};

function statusVariant(status: InvoiceLifecycleStatus): 'default' | 'secondary' | 'destructive' {
  if (status === 'paid') return 'default';
  if (status === 'overdue' || status === 'voided') return 'destructive';
  return 'secondary';
}

function isInvoiceNotFound(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.status === 404 ||
      error.code === 'INVOICE_NOT_FOUND' ||
      error.code === 'INVOICE_FORBIDDEN')
  );
}

/** Invoice labels identify authoritative GBP amounts; local display belongs on the neutral total. */
function formatInvoiceMoney(cents: number, locale: ReturnType<typeof useLocalisation>): string {
  return locale.formatSettlementMoney(cents);
}

function invoiceTerms(invoice: InvoiceDetailResponse): string {
  if (invoice.termsDays === 30 || invoice.terms === 30 || invoice.terms === 'net_30') {
    return 'net_30';
  }
  return '';
}

/**
 * Buyer-facing immutable invoice document. Access is deliberately controlled by the parent
 * surface: authenticated order detail enables it, while guest order confirmation disables it.
 */
export function InvoiceDetails({ order, enabled = true }: InvoiceDetailsProps) {
  const locale = useLocalisation();
  const t = (key: OrderLifecycleMessageKey, params?: Record<string, string | number | bigint>) =>
    locale.translate(orderLifecycleMessages, key, params);
  const [state, setState] = useState<InvoiceLoadState>({ status: 'idle' });
  const [reloadToken, setReloadToken] = useState(0);
  const generation = useRef(0);

  const shouldLoad = enabled && order.paymentMethod === 'trade_credit';

  useEffect(() => {
    if (!shouldLoad) {
      generation.current += 1;
      setState({ status: 'idle' });
      return;
    }

    const currentGeneration = ++generation.current;
    const controller = new AbortController();
    setState({ status: 'loading' });

    void getOrderInvoice(order.id, { signal: controller.signal })
      .then((invoice) => {
        if (controller.signal.aborted || currentGeneration !== generation.current) return;
        setState({ status: 'loaded', invoice });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || currentGeneration !== generation.current) return;
        setState({ status: 'error', notFound: isInvoiceNotFound(error) });
      });

    return () => {
      controller.abort();
      if (currentGeneration === generation.current) generation.current += 1;
    };
  }, [order.id, order.paymentMethod, order.version, reloadToken, shouldLoad]);

  if (!shouldLoad || state.status === 'idle') return null;

  if (state.status === 'loading') {
    return (
      <Card data-testid="invoice-details" aria-label={t('order.invoice.heading')}>
        <CardContent className="py-6">
          <p role="status" className="text-sm text-muted-foreground">
            {t('order.invoice.loading')}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (state.status === 'error') {
    return (
      <Card data-testid="invoice-details" aria-label={t('order.invoice.heading')}>
        <CardContent className="space-y-3 py-6">
          <p role="alert" className="text-sm text-destructive">
            {state.notFound ? t('order.invoice.notFound') : t('order.invoice.error')}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setReloadToken((token) => token + 1)}
          >
            {t('order.invoice.retry')}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const { invoice } = state;
  const statusLabel = t(STATUS_KEYS[invoice.status]);
  const issuedDate = formatOrderDate(invoice.issuedAt, locale);
  const dueDate = formatOrderDate(invoice.dueAt, locale);
  const billingAddress = formatAddressLine(invoice.billingEntity.address);
  const billingIdentifiers = formatBillingIdentifiers(invoice.billingEntity, locale);
  const terms = invoiceTerms(invoice);
  const vatRate = locale.number.decimal(invoice.vatRateBasisPoints / 100);
  const total = locale.formatDualTotal(invoice.grossCents);

  return (
    <Card data-testid="invoice-details" aria-label={t('order.invoice.heading')}>
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>{t('order.invoice.heading')}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('order.invoice.number', { invoiceNumber: invoice.invoiceNumber })}
          </p>
          <p className="text-sm text-muted-foreground">
            {t('order.invoice.order', { orderId: invoice.orderId })}
          </p>
        </div>
        <Badge
          data-testid="invoice-status"
          variant={statusVariant(invoice.status)}
          aria-label={`${t('order.invoice.status')}: ${statusLabel}`}
        >
          {statusLabel}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-2 text-sm sm:grid-cols-2">
          <p>{t('order.invoice.company', { companyName: invoice.billingEntity.legalName })}</p>
          <p>{t('order.invoice.paymentMethod')}</p>
          <p className="font-medium">{t('order.invoice.tradeCredit')}</p>
          <p>{t('order.invoice.currency')}</p>
          <p>{t('order.invoice.issued', { date: issuedDate })}</p>
          <p>{t('order.invoice.due', { date: dueDate })}</p>
          {terms && <p>{t('order.invoice.terms')}</p>}
          {terms && <p>{t('order.invoice.termsDue', { date: dueDate })}</p>}
        </div>

        <div className="rounded-lg border p-4 text-sm">
          <h3 className="font-medium">{t('order.invoice.billing')}</h3>
          <p className="mt-1 font-medium">{invoice.billingEntity.legalName}</p>
          {billingAddress && <p className="text-muted-foreground">{billingAddress}</p>}
          {billingIdentifiers && (
            <p className="text-xs text-muted-foreground">{billingIdentifiers}</p>
          )}
          {invoice.purchaseOrderReference && (
            <p className="mt-2 text-muted-foreground">
              {t('order.invoice.purchaseOrder', { reference: invoice.purchaseOrderReference })}
            </p>
          )}
        </div>

        <div className="space-y-3" aria-label={t('order.invoice.heading')}>
          {invoice.lines.map((line) => (
            <article key={line.lineId} className="rounded-lg border p-3 text-sm">
              <div className="flex items-start justify-between gap-4">
                <p className="font-medium">{line.description}</p>
                <p className="shrink-0">{formatInvoiceMoney(line.netCents, locale)}</p>
              </div>
              <div className="mt-1 grid gap-1 text-xs text-muted-foreground sm:grid-cols-3">
                <p>{t('order.invoice.lineQuantity', { quantity: line.quantity })}</p>
                <p>
                  {t('order.invoice.lineUnitPrice', {
                    money: formatInvoiceMoney(line.unitPriceCents, locale),
                  })}
                </p>
                <p>
                  {t('order.invoice.lineTotal', {
                    money: formatInvoiceMoney(line.netCents, locale),
                  })}
                </p>
              </div>
            </article>
          ))}
        </div>

        <div className="space-y-2 border-t pt-4 text-sm">
          <p>{t('order.invoice.net', { money: formatInvoiceMoney(invoice.netCents, locale) })}</p>
          <p>
            {t('order.invoice.vat', { money: formatInvoiceMoney(invoice.vatCents, locale) })}{' '}
            <span className="text-muted-foreground">
              {t('order.invoice.vatRate', { rate: vatRate })}
            </span>
          </p>
          <div className="flex items-center justify-between text-base font-bold">
            <span>{t('order.total')}</span>
            <span>
              {total.display}
              {total.settlement && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {t('order.settlementTotal', { money: total.settlement })}
                </span>
              )}
            </span>
          </div>
          {invoice.settlement && (
            <p>
              {t('order.invoice.settlement', {
                money: formatInvoiceMoney(invoice.settlement.amountCents, locale),
              })}
            </p>
          )}
          {invoice.settledAt && (
            <p>{t('order.invoice.paidAt', { date: formatOrderDate(invoice.settledAt, locale) })}</p>
          )}
        </div>

        <p
          role="status"
          className={`rounded-md px-3 py-2 text-sm ${
            invoice.status === 'overdue' || invoice.status === 'voided'
              ? 'bg-destructive/10 text-destructive'
              : 'bg-muted text-muted-foreground'
          }`}
        >
          {invoice.status === 'open' && t('order.invoice.openNotice', { date: dueDate })}
          {invoice.status === 'overdue' && t('order.invoice.overdueNotice')}
          {invoice.status === 'paid' && t('order.invoice.paidNotice')}
          {invoice.status === 'voided' && t('order.invoice.voidedNotice')}
        </p>
      </CardContent>
    </Card>
  );
}
