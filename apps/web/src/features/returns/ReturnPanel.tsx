import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ApiError } from '@/api/client';
import { fetchReturnOverview, createReturnRequest } from '@/api/returns';
import { useLocalisation } from '@/i18n/LocaleContext';
import {
  formatOrderTimestamp,
  orderErrorMessage,
  orderMessage,
  returnReasonLabel,
  returnStatusLabel,
  resolveOrderMessage,
  type OrderMessageState,
} from '@/features/orders/orderPresentation';
import {
  orderLifecycleMessages,
  type OrderLifecycleMessageKey,
} from '@shop/localisation/messages/orderLifecycle';
import type {
  ReturnOverviewResponse,
  ReturnEligibilityLine,
  ReturnRequest,
  ReturnReasonCode,
} from '@shop/contracts/returns';

const REASON_OPTIONS: readonly ReturnReasonCode[] = [
  'damaged',
  'wrong_item',
  'not_as_expected',
  'other',
];

function statusVariant(
  status: ReturnRequest['status'],
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'rejected') return 'destructive';
  if (status === 'refunded' || status === 'approved') return 'default';
  return 'secondary';
}

const MARKUP_PATTERN = /[<>]/;

interface ReturnPanelProps {
  orderId: string;
}

export function ReturnPanel({ orderId }: ReturnPanelProps) {
  const locale = useLocalisation();
  const t = (key: OrderLifecycleMessageKey, params?: Record<string, string | number | bigint>) =>
    locale.translate(orderLifecycleMessages, key, params);
  const [overview, setOverview] = useState<ReturnOverviewResponse | null>(null);
  const [error, setError] = useState<OrderMessageState | null>(null);
  const [loading, setLoading] = useState(true);

  // form state
  const [reason, setReason] = useState<ReturnReasonCode>('damaged');
  const [note, setNote] = useState('');
  const [selections, setSelections] = useState<Map<string, number>>(new Map());
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<OrderMessageState | null>(null);
  const [announcement, setAnnouncement] = useState<OrderMessageState | null>(null);

  const idempotencyKey = useRef<string | null>(null);
  const requestId = useRef(0);
  const overviewOrderId = useRef<string | null>(null);
  const committedOrderId = useRef(orderId);
  const activeOrderId = useRef(orderId);
  activeOrderId.current = orderId;
  const formRef = useRef<HTMLFormElement | null>(null);
  const noteErrorId = 'return-note-error';
  const selectionErrorId = 'return-selection-error';

  // Invalidate all prior order state before the next order's overview can render. The request
  // sequence guard below still rejects a late response from the previous order.
  useLayoutEffect(() => {
    const orderChanged = committedOrderId.current !== orderId;
    committedOrderId.current = orderId;
    if (orderChanged) {
      overviewOrderId.current = null;
      setOverview(null);
      setError(null);
      setLoading(true);
      setSelections(new Map());
      setReason('damaged');
      setNote('');
      setFormError(null);
      setAnnouncement(null);
      setSubmitting(false);
      idempotencyKey.current = null;
      ++requestId.current;
    }

    return () => {
      ++requestId.current;
    };
  }, [orderId]);

  const load = useCallback(
    async (clearError = true) => {
      const currentRequest = ++requestId.current;
      setLoading(true);
      if (clearError) setError(null);
      try {
        const response = await fetchReturnOverview(orderId);
        if (currentRequest === requestId.current && activeOrderId.current === orderId) {
          overviewOrderId.current = orderId;
          setOverview(response);
        }
      } catch (err) {
        if (currentRequest === requestId.current && activeOrderId.current === orderId) {
          setError(orderErrorMessage(err, 'return.loadError'));
        }
      } finally {
        if (currentRequest === requestId.current && activeOrderId.current === orderId) {
          setLoading(false);
        }
      }
    },
    [locale, orderId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const selectionKey = (line: ReturnEligibilityLine) =>
    `${line.shipmentId}:${line.orderLineItemId}`;

  const handleQuantityChange = (line: ReturnEligibilityLine, value: number) => {
    const key = selectionKey(line);
    setSelections((prev) => {
      const next = new Map(prev);
      if (value <= 0) {
        next.delete(key);
      } else {
        next.set(key, Math.min(value, line.availableQuantity));
      }
      return next;
    });
  };

  const anySelection = selections.size > 0;

  const validateForm = (): string | null => {
    if (!anySelection) return t('return.selectOne');
    if (note && MARKUP_PATTERN.test(note)) return t('return.angleBrackets');
    return null;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const submitOrderId = orderId;
    if (submitOrderId !== activeOrderId.current) return;
    const validationError = validateForm();
    if (validationError) {
      setFormError(
        !anySelection ? orderMessage('return.selectOne') : orderMessage('return.angleBrackets'),
      );
      const firstInvalid = !anySelection
        ? document.querySelector<HTMLElement>('[data-selection-quantity]')
        : document.getElementById('return-note');
      firstInvalid?.focus();
      return;
    }
    setSubmitting(true);
    setFormError(null);

    const selectedEntries = Array.from(selections.entries())
      .filter(([, qty]) => qty > 0)
      .map(([key, quantity]) => {
        const [shipmentId, orderLineItemId] = key.split(':') as [string, string];
        return { shipmentId, orderLineItemId, quantity };
      });

    idempotencyKey.current ??= crypto.randomUUID();
    try {
      await createReturnRequest(orderId, {
        idempotencyKey: idempotencyKey.current,
        reason,
        ...(note.trim() ? { note: note.trim() } : {}),
        selections: selectedEntries,
      });
      if (submitOrderId !== activeOrderId.current) return;
      setAnnouncement(orderMessage('return.success'));
      setSelections(new Map());
      setNote('');
      setReason('damaged');
      idempotencyKey.current = null;
      await load(false);
    } catch (err) {
      if (submitOrderId !== activeOrderId.current) return;
      if (err instanceof ApiError) {
        if (err.code === 'IDEMPOTENCY_CONFLICT') {
          // A coded conflict is definitive; status alone is not a safe discriminator.
          idempotencyKey.current = null;
          setFormError(orderMessage('return.conflict'));
          setSelections(new Map());
          await load(false);
        } else if (err.code === 'QUANTITY_UNAVAILABLE' || err.code === 'RETURN_NOT_ELIGIBLE') {
          // Only eligibility changes invalidate the selected quantities and require a refresh.
          idempotencyKey.current = null;
          setFormError(
            err.code === 'QUANTITY_UNAVAILABLE'
              ? orderMessage('return.quantityChanged')
              : orderErrorMessage(err, 'return.error.generic'),
          );
          setSelections(new Map());
          await load(false);
        } else {
          setFormError(orderErrorMessage(err, 'return.error.generic'));
        }
      } else {
        setFormError(orderErrorMessage(err, 'return.error.generic'));
      }
    } finally {
      if (submitOrderId === activeOrderId.current) setSubmitting(false);
    }
  };

  const handleFormKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key === 'Escape' && submitting) {
      event.preventDefault();
    }
  };

  const currentOverview =
    overview !== null && overviewOrderId.current === orderId ? overview : null;

  if (loading && !currentOverview) {
    return (
      <section aria-label={t('return.title')} className="mt-6 rounded-lg border p-4">
        <p className="text-sm text-muted-foreground" aria-busy="true">
          {t('return.loading')}
        </p>
      </section>
    );
  }

  if (error && !currentOverview && (overview === null || overviewOrderId.current === orderId)) {
    return (
      <section aria-label={t('return.title')} className="mt-6 rounded-lg border p-4">
        <p role="alert" className="text-sm text-destructive">
          {resolveOrderMessage(error, locale)}
        </p>
        <Button type="button" variant="link" className="mt-1 px-0" onClick={() => void load()}>
          {t('return.tryAgain')}
        </Button>
      </section>
    );
  }

  if (!currentOverview) return null;

  const { eligibleLines, requests } = currentOverview;

  // Group eligible lines by shipment
  const linesByShipment = new Map<number, ReturnEligibilityLine[]>();
  for (const line of eligibleLines) {
    const group = linesByShipment.get(line.shipmentNumber) ?? [];
    group.push(line);
    linesByShipment.set(line.shipmentNumber, group);
  }

  const hasEligible = eligibleLines.length > 0;
  const hasHistory = requests.length > 0;

  if (!hasEligible && !hasHistory) {
    return (
      <section aria-label={t('return.title')} className="mt-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('return.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{t('return.emptyDescription')}</p>
          </CardContent>
        </Card>
      </section>
    );
  }

  return (
    <section aria-label={t('return.title')} className="mt-6 space-y-6">
      <p aria-live="polite" className="sr-only">
        {announcement ? resolveOrderMessage(announcement, locale) : ''}
      </p>

      {/* Eligibility & Request Form */}
      {hasEligible && (
        <Card>
          <CardHeader>
            <CardTitle>{t('return.itemsHeading')}</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              ref={formRef}
              onSubmit={(e) => void handleSubmit(e)}
              onKeyDown={handleFormKeyDown}
              noValidate
              className="space-y-4"
            >
              {formError && (
                <p
                  role="alert"
                  className="rounded-md border border-destructive/40 p-3 text-sm text-destructive"
                >
                  {resolveOrderMessage(formError, locale)}
                </p>
              )}

              {/* Eligible lines grouped by shipment */}
              {Array.from(linesByShipment.entries()).map(([shipmentNumber, lines]) => (
                <div key={shipmentNumber} className="rounded-lg border p-3">
                  <h3 className="text-sm font-medium">
                    {t('return.shipment', { number: shipmentNumber })}
                  </h3>
                  <div className="mt-2 space-y-2">
                    {lines.map((line) => {
                      const key = selectionKey(line);
                      const currentQty = selections.get(key) ?? 0;
                      const inputId = `return-qty-${line.shipmentId}-${line.orderLineItemId}`;
                      return (
                        <div
                          key={key}
                          className="flex flex-wrap items-center justify-between gap-2 text-sm"
                        >
                          <label htmlFor={inputId} className="min-w-0 flex-1">
                            {line.productName}
                            {line.variantLabel && (
                              <span className="text-muted-foreground">
                                {' '}
                                &mdash; {line.variantLabel}
                              </span>
                            )}
                            <span className="text-muted-foreground">
                              {' '}
                              {t('return.availableQuantity', {
                                available: line.availableQuantity,
                                delivered: line.deliveredQuantity,
                              })}
                            </span>
                          </label>
                          <input
                            id={inputId}
                            data-selection-quantity
                            type="number"
                            className="w-16 rounded-md border border-input bg-background px-2 py-1 text-sm"
                            min={0}
                            max={line.availableQuantity}
                            value={currentQty || ''}
                            onChange={(e) =>
                              handleQuantityChange(
                                line,
                                Math.max(0, parseInt(e.target.value, 10) || 0),
                              )
                            }
                            aria-label={t('return.quantityAria', { productName: line.productName })}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              {/* Reason */}
              <div>
                <label htmlFor="return-reason" className="text-sm font-medium">
                  {t('return.reason')}
                </label>
                <select
                  id="return-reason"
                  className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                  value={reason}
                  onChange={(e) => setReason(e.target.value as ReturnReasonCode)}
                >
                  {REASON_OPTIONS.map((value) => (
                    <option key={value} value={value}>
                      {returnReasonLabel(value, locale)}
                    </option>
                  ))}
                </select>
              </div>

              {/* Note */}
              <div>
                <label htmlFor="return-note" className="text-sm font-medium">
                  {t('return.note')}{' '}
                  <span className="font-normal text-muted-foreground">{t('return.optional')}</span>
                </label>
                <textarea
                  id="return-note"
                  className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                  rows={3}
                  maxLength={500}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  aria-describedby={note && MARKUP_PATTERN.test(note) ? noteErrorId : undefined}
                  aria-invalid={note !== '' && MARKUP_PATTERN.test(note)}
                />
                {note && MARKUP_PATTERN.test(note) && (
                  <p id={noteErrorId} className="mt-1 text-xs text-destructive">
                    {t('return.angleBrackets')}
                  </p>
                )}
              </div>

              <div id={selectionErrorId} className="sr-only" role="alert">
                {!anySelection ? t('return.selectOne') : ''}
              </div>

              <Button type="submit" disabled={submitting || !anySelection}>
                {submitting ? t('return.submitting') : t('return.submit')}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* History */}
      {hasHistory && (
        <Card>
          <CardHeader>
            <CardTitle>{t('return.history')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {requests.map((req) => (
              <article
                key={req.id}
                className="rounded-lg border p-4"
                aria-label={t('return.requestAria', { requestId: req.id })}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-medium">{t('return.request', { requestId: req.id })}</h3>
                  <Badge variant={statusVariant(req.status)}>
                    {returnStatusLabel(req.status, locale)}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {req.note
                    ? t('return.reasonNote', {
                        reason: returnReasonLabel(req.reason, locale),
                        note: req.note,
                      })
                    : returnReasonLabel(req.reason, locale)}
                </p>
                <ul className="mt-2 space-y-1 text-sm" aria-label={t('return.requestedItems')}>
                  {req.items.map((item) => (
                    <li key={`${item.shipmentId}-${item.orderLineItemId}`}>
                      {item.productName}
                      {item.variantLabel && (
                        <span className="text-muted-foreground"> &mdash; {item.variantLabel}</span>
                      )}{' '}
                      × {item.quantity}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">
                  {t('return.requestedOn', {
                    date: formatOrderTimestamp(
                      req.requestedAt,
                      locale,
                      'date',
                      'return.invalidTimestamp',
                    ),
                  })}
                  {req.status === 'approved' && req.approvedAt
                    ? ` · ${t('return.approvedOn', {
                        date: formatOrderTimestamp(
                          req.approvedAt,
                          locale,
                          'date',
                          'return.invalidTimestamp',
                        ),
                      })}`
                    : ''}
                  {req.status === 'rejected' && req.rejectedAt
                    ? ` · ${t('return.rejectedOn', {
                        date: formatOrderTimestamp(
                          req.rejectedAt,
                          locale,
                          'date',
                          'return.invalidTimestamp',
                        ),
                      })}`
                    : ''}
                  {req.status === 'received' && req.receivedAt
                    ? ` · ${t('return.receivedOn', {
                        date: formatOrderTimestamp(
                          req.receivedAt,
                          locale,
                          'date',
                          'return.invalidTimestamp',
                        ),
                      })}`
                    : ''}
                </p>
                {req.refund && (
                  <div className="mt-2 rounded-md bg-muted p-2 text-sm">
                    {(() => {
                      const refund = locale.formatDualTotal(req.refund.amountCents);
                      return (
                        <>
                          <p>
                            {t('return.refund', { money: refund.display })}
                            {refund.settlement && (
                              <span className="ml-2 text-xs text-muted-foreground">
                                {t('return.settlementRefund', { money: refund.settlement })}
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {t('return.deliveryNotRefundable')}
                          </p>
                        </>
                      );
                    })()}
                    <p className="text-xs text-muted-foreground">
                      {t('return.reference', { reference: req.refund.simulatedReference })}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t('return.refundedOn', {
                        date: formatOrderTimestamp(
                          req.refund.refundedAt,
                          locale,
                          'date',
                          'return.invalidTimestamp',
                        ),
                      })}
                    </p>
                  </div>
                )}
              </article>
            ))}
          </CardContent>
        </Card>
      )}
    </section>
  );
}
