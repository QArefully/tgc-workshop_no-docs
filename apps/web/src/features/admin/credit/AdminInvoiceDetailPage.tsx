import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiErrors } from '@shop/localisation/messages/apiErrors';
import { adminCommerceMessages } from '@shop/localisation/messages/adminCommerce';
import {
  orderLifecycleMessages,
  type OrderLifecycleMessageKey,
} from '@shop/localisation/messages/orderLifecycle';
import { getAdminInvoice, settleAdminInvoice } from '@/api/adminCredit';
import { ErrorMessage } from '@/components/ErrorMessage';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useLocalisation } from '@/i18n/LocaleContext';
import {
  invoiceStatusMessageKeys,
  localizeAdminCreditError,
  type Translate,
  type TranslateApiError,
} from './creditPresentation';

type Invoice = Awaited<ReturnType<typeof getAdminInvoice>>;
type MutationKey = { fingerprint: string; key: string };

function nextIdempotencyKey(): string {
  return crypto.randomUUID();
}

export function AdminInvoiceDetailPage() {
  const navigate = useNavigate();
  const { invoiceId } = useParams();
  const { country, translate, formatSettlementMoney, formatCount, formatInstant } =
    useLocalisation();
  const t = useCallback<Translate>(
    (key, params = {}) => translate(adminCommerceMessages, key, params),
    [translate],
  );
  const orderT = useCallback(
    (key: OrderLifecycleMessageKey, params: Parameters<Translate>[1] = {}) =>
      translate(orderLifecycleMessages, key, params),
    [translate],
  );
  const translateApiError = useCallback<TranslateApiError>(
    (key, params = {}) => translate(apiErrors, key, params),
    [translate],
  );
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [settling, setSettling] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);
  const settlementKey = useRef<MutationKey | null>(null);
  const settlementGeneration = useRef(0);
  const settlementController = useRef<AbortController | null>(null);
  const currentInvoiceId = useRef(invoiceId);
  const currentInvoiceCountry = useRef(country);
  currentInvoiceId.current = invoiceId;
  currentInvoiceCountry.current = country;

  useEffect(() => {
    settlementKey.current = null;
    settlementGeneration.current += 1;
    settlementController.current?.abort();
    settlementController.current = null;
    setSettling(false);
    setNotice(null);
    setError(null);
    setInvoice(null);
  }, [country, invoiceId]);

  useEffect(() => {
    if (!invoiceId) return;
    const controller = new AbortController();
    let current = true;
    setLoading(true);
    setError(null);
    getAdminInvoice(invoiceId, controller.signal)
      .then((response) => {
        if (current) setInvoice(response);
      })
      .catch((requestError: unknown) => {
        if (current && !controller.signal.aborted)
          setError(
            localizeAdminCreditError(
              requestError,
              'adminCommerce.invoice.error.detail',
              t,
              translateApiError,
            ),
          );
      })
      .finally(() => {
        if (current && !controller.signal.aborted) setLoading(false);
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [country, invoiceId, reloadVersion, t, translateApiError]);

  const settle = useCallback(async () => {
    if (!invoiceId || !invoice || settling) return;
    if (invoice.status === 'paid') {
      setNotice(t('adminCommerce.invoice.settle.alreadyPaid'));
      return;
    }
    if (invoice.status === 'voided') {
      setNotice(t('adminCommerce.invoice.voidedNotice'));
      return;
    }
    if (
      !window.confirm(
        t('adminCommerce.invoice.settle.confirmation', {
          invoiceNumber: invoice.invoiceNumber,
          money: formatSettlementMoney(invoice.grossCents),
        }),
      )
    )
      return;
    const mutationCountry = country;
    const fingerprint = `${mutationCountry}:${invoice.id}:${invoice.lifecycleVersion}`;
    const idempotencyKey =
      settlementKey.current?.fingerprint === fingerprint
        ? settlementKey.current.key
        : nextIdempotencyKey();
    settlementKey.current = { fingerprint, key: idempotencyKey };
    const generation = ++settlementGeneration.current;
    const controller = new AbortController();
    settlementController.current = controller;
    setSettling(true);
    setError(null);
    setNotice(null);
    try {
      await settleAdminInvoice(
        invoiceId,
        { expectedVersion: invoice.lifecycleVersion, idempotencyKey },
        controller.signal,
      );
      if (
        generation !== settlementGeneration.current ||
        currentInvoiceId.current !== invoiceId ||
        currentInvoiceCountry.current !== mutationCountry ||
        controller.signal.aborted
      )
        return;
      setNotice(t('adminCommerce.invoice.settle.success'));
      setReloadVersion((value) => value + 1);
    } catch (requestError: unknown) {
      if (
        generation === settlementGeneration.current &&
        currentInvoiceId.current === invoiceId &&
        currentInvoiceCountry.current === mutationCountry &&
        !controller.signal.aborted
      )
        setError(
          localizeAdminCreditError(
            requestError,
            'adminCommerce.invoice.error.settle',
            t,
            translateApiError,
          ),
        );
    } finally {
      if (
        generation === settlementGeneration.current &&
        currentInvoiceId.current === invoiceId &&
        currentInvoiceCountry.current === mutationCountry
      ) {
        settlementController.current = null;
        setSettling(false);
      }
    }
  }, [country, formatSettlementMoney, invoice, invoiceId, settling, t, translateApiError]);

  if (!invoiceId)
    return (
      <ErrorMessage message={t('adminCommerce.invoice.error.detail')} onRetry={() => undefined} />
    );
  if (loading && !invoice) return <LoadingSpinner />;
  if (error && !invoice)
    return <ErrorMessage message={error} onRetry={() => setReloadVersion((value) => value + 1)} />;
  if (!invoice)
    return (
      <ErrorMessage
        message={t('adminCommerce.invoice.error.detail')}
        onRetry={() => setReloadVersion((value) => value + 1)}
      />
    );

  const statusLabel = t(invoiceStatusMessageKeys[invoice.status]);
  const address = invoice.billingEntity.address;

  return (
    <section className="mx-auto max-w-5xl space-y-6" aria-labelledby="admin-invoice-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="section-eyebrow">{t('adminCommerce.administration')}</p>
          <h1 id="admin-invoice-heading" className="section-heading mt-2">
            {t('adminCommerce.invoice.item', { invoiceId: invoice.id })}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t('adminCommerce.invoice.summary', {
              invoiceNumber: invoice.invoiceNumber,
              status: statusLabel,
              money: formatSettlementMoney(invoice.grossCents),
            })}
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => navigate('/admin/invoices')}>
          {t('adminCommerce.invoice.closeDetail')}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <p aria-live="polite" className="text-sm text-muted-foreground">
        {notice}
      </p>
      <Card>
        <CardContent className="space-y-2 py-5">
          <p>{t('adminCommerce.invoice.number', { invoiceNumber: invoice.invoiceNumber })}</p>
          <p>{t('adminCommerce.invoice.order', { orderId: invoice.orderId })}</p>
          <p>
            {t('adminCommerce.invoice.company', {
              companyName: invoice.billingEntity.legalName,
            })}
          </p>
          <p>{t('adminCommerce.invoice.issued', { date: formatInstant(invoice.issuedAt) })}</p>
          <p>{t('adminCommerce.invoice.due', { date: formatInstant(invoice.dueAt) })}</p>
          <p>{t('adminCommerce.invoice.terms')}</p>
          <p>
            {t('adminCommerce.invoice.status')}: {statusLabel}
          </p>
          <address className="not-italic text-sm text-muted-foreground">
            {invoice.billingEntity.legalName}
            <br />
            {address.line1}
            {address.line2 && (
              <>
                <br />
                {address.line2}
              </>
            )}
            <br />
            {address.city}
            {address.region && `, ${address.region}`}
            <br />
            {address.postcode}, {address.countryCode}
          </address>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-3 py-5">
          <h2 className="font-semibold">{t('adminCommerce.invoice.heading')}</h2>
          <ul className="space-y-2">
            {invoice.lines.map((line) => (
              <li key={line.lineId} className="rounded-md border border-border p-3">
                <p className="font-medium">{line.description}</p>
                <p className="text-sm text-muted-foreground">
                  {orderT('order.invoice.lineQuantity', { quantity: formatCount(line.quantity) })}
                  {' · '}
                  {orderT('order.invoice.lineUnitPrice', {
                    money: formatSettlementMoney(line.unitPriceCents),
                  })}
                  {' · '}
                  {orderT('order.invoice.lineTotal', {
                    money: formatSettlementMoney(line.netCents),
                  })}
                </p>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-2 py-5">
          <p>
            {t('adminCommerce.invoice.net', { money: formatSettlementMoney(invoice.netCents) })}
          </p>
          <p>
            {t('adminCommerce.invoice.vat', { money: formatSettlementMoney(invoice.vatCents) })}
          </p>
          <p>
            {t('adminCommerce.invoice.vatRate', {
              rate: formatVatRate(invoice.vatRateBasisPoints),
            })}
          </p>
          <p className="font-semibold">
            {t('adminCommerce.invoice.gross', {
              money: formatSettlementMoney(invoice.grossCents),
            })}
          </p>
          {invoice.settlement && (
            <p>
              {t('adminCommerce.invoice.settlement', {
                money: formatSettlementMoney(invoice.settlement.amountCents),
              })}
            </p>
          )}
          {invoice.settledAt && (
            <p>{orderT('order.invoice.paidAt', { date: formatInstant(invoice.settledAt) })}</p>
          )}
        </CardContent>
      </Card>
      {invoice.status === 'open' || invoice.status === 'overdue' ? (
        <Card>
          <CardContent className="space-y-3 py-5">
            <h2 className="font-semibold">{t('adminCommerce.invoice.settle.heading')}</h2>
            <p className="text-sm text-muted-foreground">
              {t('adminCommerce.invoice.settle.description')}
            </p>
            <p className="text-sm font-medium">
              {t('adminCommerce.invoice.settlement', {
                money: formatSettlementMoney(invoice.grossCents),
              })}
            </p>
            <Button type="button" disabled={settling} onClick={() => void settle()}>
              {settling
                ? t('adminCommerce.invoice.settle.settling')
                : t('adminCommerce.invoice.settle.confirm')}
            </Button>
          </CardContent>
        </Card>
      ) : invoice.status === 'paid' ? (
        <p>{t('adminCommerce.invoice.settle.alreadyPaid')}</p>
      ) : (
        <p>{t('adminCommerce.invoice.voidedNotice')}</p>
      )}
    </section>
  );
}

function formatVatRate(basisPoints: number): string {
  const digits = String(basisPoints).padStart(3, '0');
  const whole = digits.slice(0, -2).replace(/^0+/, '') || '0';
  const fraction = digits.slice(-2).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

export default AdminInvoiceDetailPage;
