import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import type { OrderDetailResponse } from '@shop/contracts/orders';
import type { Product } from '@shop/contracts/products';
import type { LegacyRef } from 'react';
import { useLocalisation } from '@/i18n/LocaleContext';
import {
  CustomBlendPackaging,
  customBlendCompositionLabel,
  customBlendMadeToOrderNote,
  isResolvedCustomBlendSnapshot,
} from '@/features/customBlend/CustomBlendPackaging';
import {
  orderLifecycleMessages,
  type OrderLifecycleMessageKey,
} from '@shop/localisation/messages/orderLifecycle';
import {
  formatBillingIdentifiers,
  formatAddressLine,
  formatDeliverySlot,
  formatOrderDate,
  formatPurchaseOrderReference,
  hasOrderTradeDetails,
  orderStatusLabel,
} from './orderPresentation';
import { InvoiceDetails } from './InvoiceDetails';

type Props = {
  order: OrderDetailResponse;
  /** Guest confirmation uses an exact-order capability and must not load the invoice endpoint. */
  showInvoice?: boolean;
  allowCancellation?: boolean;
  isCancelling?: boolean;
  onRequestCancellation?: () => void;
  cancelTriggerRef?: LegacyRef<HTMLElement>;
};

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'delivery_failed' || status === 'cancelled') return 'destructive';
  if (status === 'delivered') return 'default';
  return 'secondary';
}

function orderPackagingProduct(item: OrderDetailResponse['items'][number]): Product {
  const resolvedBlend = isResolvedCustomBlendSnapshot(item.customBlend)
    ? item.customBlend
    : undefined;
  // Historic snapshots may carry a frozen base presentation, but without a server-resolved
  // outcome it is not safe to infer either a vessel or a safety treatment from that data.
  const presentation = resolvedBlend?.basePresentation;
  return {
    id: item.productId,
    name: item.productName,
    description: '',
    priceCents: item.unitPriceCents,
    imageSetId: `order-${item.productId}`,
    category: presentation?.category ?? '',
    stock: 0,
    availability: 'out_of_stock',
    backorderable: false,
    backorderLeadDays: null,
    slug: `order-${item.productId}`,
    salesCount: 0,
    createdAt: '1970-01-01T00:00:00.000Z',
    available: false,
    tags: [],
    specificationGroups: [],
    consumptionClassification:
      resolvedBlend?.resultClassification ??
      presentation?.consumptionClassification ??
      item.variantSnapshot?.consumptionClassification,
    mixingGroup: item.customBlend?.mixingGroup,
    ...(presentation ? { categoryFacts: presentation.categoryFacts } : {}),
  };
}

function OrderCustomBlendDetails({
  item,
  locale,
  t,
}: {
  item: OrderDetailResponse['items'][number];
  locale: ReturnType<typeof useLocalisation>;
  t: (key: OrderLifecycleMessageKey, params?: Record<string, string | number | bigint>) => string;
}) {
  const blend = item.customBlend;
  if (!blend) return null;
  const resolved = isResolvedCustomBlendSnapshot(blend) ? blend : undefined;
  const resultLabel = resolved
    ? t(
        resolved.resultClassification === 'food'
          ? 'order.customBlend.resultFood'
          : 'order.customBlend.resultNonFood',
      )
    : undefined;
  const safetyLabel =
    resolved?.resultClassification === 'non-food'
      ? t('order.customBlend.notForConsumption')
      : undefined;

  return (
    <span className="block text-xs text-muted-foreground" data-testid="order-blend">
      <Badge variant="outline" className="mb-0.5 w-fit text-[10px]">
        {t('order.customBlend')}
      </Badge>
      <span className="block">
        {customBlendCompositionLabel(item.productName, blend, locale.country)}
      </span>
      {resolved ? (
        <>
          <Badge
            variant={resolved.resultClassification === 'non-food' ? 'destructive' : 'secondary'}
            className="mt-1 w-fit"
            data-testid="order-blend-result"
          >
            {resultLabel}
          </Badge>
          {safetyLabel && (
            <span
              role="alert"
              data-testid="order-blend-safety"
              className="custom-blend-notice mt-1 block rounded-md px-2 py-1"
            >
              <span className="font-semibold">{safetyLabel}</span>{' '}
              {t('order.customBlend.safetyWarning')}
            </span>
          )}
          <ul
            className="mt-1 grid gap-1 border-l pl-2"
            aria-label={t('order.customBlend')}
            data-testid="order-blend-components"
          >
            {resolved.components.map((component) => {
              const roleLabel = t(
                component.role === 'base'
                  ? 'order.customBlend.componentBase'
                  : 'order.customBlend.componentIngredient',
              );
              return (
                <li key={`${component.role}-${component.variantId}`}>
                  <span className="font-medium text-foreground">{component.productName}</span>{' '}
                  {locale.number.count(component.percentage)}% · {roleLabel}
                  <span className="block">
                    {t('order.customBlend.componentRole', { role: roleLabel })}
                  </span>
                  <span className="block">
                    {t('order.customBlend.componentWeight', {
                      weight: locale.formatWeightGrams(component.weightGrams),
                    })}
                  </span>
                  <span className="block">
                    {t('order.customBlend.componentSourcePrice', {
                      money: locale.formatDisplayMoney(component.sourceUnitPriceCents),
                    })}
                  </span>
                  {component.clearance && (
                    <span className="block">
                      {t('order.customBlend.componentClearance', {
                        money: locale.formatDisplayMoney(component.clearance.priceCents),
                      })}
                    </span>
                  )}
                  <span className="block">
                    {t('order.customBlend.componentTier', {
                      discountPct: locale.number.count(component.tierDiscountPct),
                    })}
                  </span>
                  {component.nextTierProgress && (
                    <span className="block">
                      {t('order.customBlend.componentNextTier', {
                        sacksToNextTier: locale.number.count(
                          component.nextTierProgress.sacksToNextTier,
                        ),
                        minTonnes: locale.number.decimal(component.nextTierProgress.minTonnes),
                        discountPct: locale.number.count(component.nextTierProgress.discountPct),
                      })}
                    </span>
                  )}
                  <span className="block">
                    {t('order.customBlend.componentUnitContribution', {
                      money: locale.formatDisplayMoney(component.unitContributionCents),
                    })}
                  </span>
                  <span className="block">
                    {t('order.customBlend.componentSubtotal', {
                      money: locale.formatDisplayMoney(component.subtotalCents),
                    })}
                  </span>
                </li>
              );
            })}
          </ul>
          <span className="block">
            {t('order.customBlend.materialUnitPrice', {
              money: locale.formatDisplayMoney(resolved.materialUnitPriceCents),
            })}
          </span>
          <span className="block">
            {t('order.customBlend.materialSubtotal', {
              money: locale.formatDisplayMoney(resolved.materialSubtotalCents),
            })}
          </span>
          <span className="block">
            {t('order.customBlend.blendingFee', {
              money: locale.formatDisplayMoney(resolved.blendingFeeCents),
            })}
          </span>
          <span className="block font-medium text-foreground">
            {t('order.customBlend.lineTotal', {
              money: locale.formatDisplayMoney(resolved.lineTotalCents),
            })}
          </span>
        </>
      ) : (
        <>
          <span className="block" data-testid="order-blend-legacy">
            {t('order.customBlend.legacyFallback')}
          </span>
          {/* Legacy line money is historical order data; no current component facts are inferred. */}
          <span className="block">
            {t('order.baseMaterial', {
              money: locale.formatDisplayMoney(item.discountableTotalCents),
            })}{' '}
            ·{' '}
            {t('order.blendingFee', {
              money: locale.formatDisplayMoney(item.blendingFeeCents),
            })}
          </span>
        </>
      )}
    </span>
  );
}

export function OrderDetailView({
  order,
  showInvoice = true,
  allowCancellation = false,
  isCancelling = false,
  onRequestCancellation,
  cancelTriggerRef,
}: Props) {
  const locale = useLocalisation();
  const t = (key: OrderLifecycleMessageKey, params?: Record<string, string | number | bigint>) =>
    locale.translate(orderLifecycleMessages, key, params);
  const deliveryModeLabel = (mode: string) =>
    t(mode === 'freight' ? 'order.deliveryMode.freight' : 'order.deliveryMode.parcel');
  const namesByLineId = new Map<string, string>(
    order.items.map((line): [string, string] => [line.lineId, line.productName]),
  );
  const hasCustomBlend = order.items.some((line) => line.customBlend !== undefined);
  const deliveryAddress = formatAddressLine(order.deliveryAddress);
  const deliverySlot = formatDeliverySlot(order.deliverySlot, locale);
  const billingIdentifiers = formatBillingIdentifiers(order.billingEntity, locale);
  const purchaseOrderReference = formatPurchaseOrderReference(order.purchaseOrderReference);
  const total = locale.formatDualTotal(order.totalCents);

  return (
    <section className="space-y-6" aria-label={t('order.orderAria', { orderId: order.id })}>
      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>{t('order.orderNumber', { orderId: order.id })}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('order.placed', { date: formatOrderDate(order.createdAt, locale) })}
            </p>
          </div>
          <Badge
            variant={statusVariant(order.status)}
            aria-label={t('order.statusAria', { status: orderStatusLabel(order.status, locale) })}
          >
            {orderStatusLabel(order.status, locale)}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3" aria-label={t('order.purchasedItems')}>
            {order.items.map((item) => (
              <div key={item.lineId} className="flex items-center justify-between gap-4 text-sm">
                {item.customBlend && (
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                    <CustomBlendPackaging
                      product={orderPackagingProduct(item)}
                      variant={item.variantSnapshot}
                      blend={item.customBlend}
                      className="h-full w-full object-cover"
                    />
                  </div>
                )}
                <span className="min-w-0 flex-1">
                  {item.productName}{' '}
                  <span className="text-muted-foreground">× {item.quantity}</span>
                  {item.variantSnapshot && (
                    <span className="block text-xs text-muted-foreground">
                      {t('order.variantMeta', {
                        label: item.variantSnapshot.label,
                        sku: item.variantSnapshot.sku,
                        weight: locale.formatWeightGrams(item.variantSnapshot.weightGrams),
                      })}
                    </span>
                  )}
                  {item.customBlend && (
                    <OrderCustomBlendDetails item={item} locale={locale} t={t} />
                  )}
                  {item.inventoryStatus === 'partially_backordered' && (
                    <span className="block text-xs font-medium text-amber-700">
                      {t('order.inventory.partiallyBackordered', {
                        allocated: item.allocatedQuantity,
                        backordered: item.backorderedQuantity,
                      })}
                    </span>
                  )}
                  {item.inventoryStatus === 'backordered' && (
                    <span className="block text-xs font-medium text-amber-700">
                      {t('order.inventory.backordered')}
                    </span>
                  )}
                  {item.inventoryStatus === 'allocated' && (
                    <span className="block text-xs text-muted-foreground">
                      {t('order.inventory.allocated')}
                    </span>
                  )}
                  {item.inventoryStatus === 'cancelled' && (
                    <span className="block text-xs text-muted-foreground">
                      {t('order.inventory.cancelled')}
                    </span>
                  )}
                </span>
                <span className="shrink-0">{locale.formatDisplayMoney(item.lineTotalCents)}</span>
              </div>
            ))}
          </div>
          {hasCustomBlend && (
            <p className="custom-blend-notice rounded-md px-3 py-2 text-xs">
              {customBlendMadeToOrderNote(locale.country)}
            </p>
          )}
          <Separator />
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{t('order.merchandiseSubtotal')}</span>
              <span>{locale.formatDisplayMoney(order.subtotalCents)}</span>
            </div>
            {order.discountCents > 0 && (
              <div className="flex items-center justify-between text-sm text-green-700">
                <span>
                  {order.promoApplied
                    ? t('order.discountWithPromo', { promo: order.promoApplied })
                    : t('order.discount')}
                </span>
                <span>{locale.formatDisplayMoney(-order.discountCents)}</span>
              </div>
            )}
            {order.deliveryMode && (
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>{t('order.delivery', { mode: deliveryModeLabel(order.deliveryMode) })}</span>
                <span>
                  {order.deliveryChargeCents !== undefined && order.deliveryChargeCents === 0
                    ? t('order.free')
                    : order.deliveryChargeCents !== undefined
                      ? locale.formatDisplayMoney(order.deliveryChargeCents)
                      : ''}
                </span>
              </div>
            )}
          </div>
          <Separator />
          <div className="flex items-center justify-between text-lg font-bold">
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
        </CardContent>
      </Card>

      {showInvoice && <InvoiceDetails key={order.id} order={order} />}

      {hasOrderTradeDetails(order) && (
        <Card>
          <CardHeader>
            <CardTitle>{t('order.deliveryBilling')}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              {deliveryAddress && (
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t('order.deliveryAddress')}
                  </dt>
                  <dd className="mt-1">{deliveryAddress}</dd>
                </div>
              )}
              {deliverySlot && (
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t('order.deliverySlot')}
                  </dt>
                  <dd className="mt-1">{deliverySlot}</dd>
                </div>
              )}
              {order.billingEntity && (
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t('order.billingDetails')}
                  </dt>
                  <dd className="mt-1">
                    <span className="block font-medium">{order.billingEntity.legalName}</span>
                    <span className="block text-muted-foreground">
                      {formatAddressLine(order.billingEntity.address)}
                    </span>
                    {billingIdentifiers && (
                      <span className="block text-xs text-muted-foreground">
                        {billingIdentifiers}
                      </span>
                    )}
                  </dd>
                </div>
              )}
              {purchaseOrderReference && (
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t('order.purchaseOrderReference')}
                  </dt>
                  <dd className="mt-1 font-medium">{purchaseOrderReference}</dd>
                </div>
              )}
            </dl>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('order.shipments')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {order.shipments.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('order.shipmentPlanningPending')}</p>
          ) : (
            order.shipments.map((shipment) => (
              <article
                key={shipment.id}
                className="rounded-lg border p-4"
                aria-label={t('order.shipmentAria', { number: shipment.shipmentNumber })}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-medium">
                    {t('order.shipment', { number: shipment.shipmentNumber })}
                  </h3>
                  <Badge variant={statusVariant(shipment.status)}>
                    {orderStatusLabel(shipment.status, locale)}
                  </Badge>
                </div>
                {shipment.trackingReference && (
                  <p className="mt-2 text-sm">
                    {t('order.trackingReference', { reference: shipment.trackingReference })}
                  </p>
                )}
                {order.deliveryMode && (
                  <p className="text-xs text-muted-foreground">
                    {t('order.shipmentWeight', {
                      mode: deliveryModeLabel(order.deliveryMode),
                      weight:
                        order.deliveryWeightGrams !== undefined
                          ? locale.formatWeightGrams(order.deliveryWeightGrams)
                          : '',
                    })}
                  </p>
                )}
                <ul
                  className="mt-3 list-inside list-disc text-sm text-muted-foreground"
                  aria-label={t('order.shipmentItems', { number: shipment.shipmentNumber })}
                >
                  {shipment.lines.map((line) => (
                    <li key={line.lineId}>
                      {namesByLineId.get(line.lineId) ?? t('order.purchasedItem')} × {line.quantity}
                    </li>
                  ))}
                </ul>
              </article>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('order.timeline')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-4 border-l pl-5" aria-label={t('order.timelineAria')}>
            {order.events.map((event) => (
              <li key={event.id} className="relative text-sm">
                <span
                  className="absolute -left-[1.55rem] top-1.5 h-2.5 w-2.5 rounded-full bg-primary"
                  aria-hidden="true"
                />
                <p className="font-medium">{event.title}</p>
                {event.detail && <p className="text-muted-foreground">{event.detail}</p>}
                {event.location && <p className="text-muted-foreground">{event.location}</p>}
                <time className="text-xs text-muted-foreground" dateTime={event.occurredAt}>
                  {formatOrderDate(event.occurredAt, locale)}
                </time>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      {allowCancellation && order.canCancel && onRequestCancellation && (
        <div className="rounded-lg border border-destructive/40 p-4">
          <h2 className="font-medium">{t('order.cancel.heading')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('order.cancel.description')}</p>
          <Button
            ref={cancelTriggerRef}
            className="mt-3"
            variant="destructive"
            disabled={isCancelling}
            onClick={onRequestCancellation}
          >
            {isCancelling ? t('order.cancel.cancelling') : t('order.cancel.button')}
          </Button>
        </div>
      )}
    </section>
  );
}
