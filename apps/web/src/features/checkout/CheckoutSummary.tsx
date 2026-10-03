import type { Cart } from '@shop/contracts/cart';
import type { DeliverySlot } from '@shop/contracts/delivery';
import type { PromoValidationErrorCode } from '@shop/contracts/promos';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { cartItemKey } from '@/lib/cartLineIdentity';
import {
  customBlendMadeToOrderNote,
  CustomBlendPackaging,
  customBlendCompositionLabel,
  isResolvedCustomBlendSnapshot,
} from '@/features/customBlend/CustomBlendPackaging';
import { Badge } from '@/components/ui/badge';
import { useLocalisation } from '@/i18n/LocaleContext';
import { checkoutMessages } from '@shop/localisation/messages/checkout';
import { PromoCodeForm } from './PromoCodeForm';

interface CheckoutSummaryProps {
  cart: Cart;
  promoCode: string;
  appliedPromo: string | null;
  discountCents: number;
  discountBaseCents: number | null;
  promoCategoryScope: string | null;
  totalCents: number;
  promoError: string | null;
  promoErrorCode: PromoValidationErrorCode | null;
  promoMinSubtotalCents: number | null;
  promoValidating: boolean;
  isPromoEligible: boolean;
  /** Chosen saved site label, or the head of the ad-hoc address. `null` until step 1 completes. */
  destinationSummary: string | null;
  billingSummary: string | null;
  deliverySlot: DeliverySlot | null;
  purchaseOrderReference: string | null;
  onPromoChange: (value: string) => void;
  onApplyPromo: () => void;
  onRemovePromo: () => void;
}

function checkoutPackagingProduct(item: Cart['items'][number]): Cart['items'][number]['product'] {
  if (!item.customBlend || isResolvedCustomBlendSnapshot(item.customBlend)) {
    return item.product;
  }
  // Historic blend snapshots can include a frozen base presentation, but it has no authoritative
  // result classification. Blank the catalog category so the livery renders its neutral fallback
  // instead of guessing a vessel or safety treatment from stale facts.
  return { ...item.product, category: '', consumptionClassification: undefined };
}

function CheckoutCustomBlendDetails({ item }: { item: Cart['items'][number] }) {
  const { country, translate, formatDisplayMoney, formatWeightGrams, number } = useLocalisation();
  const blend = item.customBlend;
  if (!blend) return null;
  const resolved = isResolvedCustomBlendSnapshot(blend) ? blend : undefined;
  const resultLabel = resolved
    ? translate(
        checkoutMessages,
        resolved.resultClassification === 'food'
          ? 'checkout.customBlend.resultFood'
          : 'checkout.customBlend.resultNonFood',
      )
    : undefined;
  const safetyLabel =
    resolved?.resultClassification === 'non-food'
      ? translate(checkoutMessages, 'checkout.customBlend.notForConsumption')
      : undefined;

  return (
    <span className="block text-xs text-muted-foreground" data-testid="checkout-blend">
      <Badge variant="outline" className="mb-0.5 w-fit text-[10px]">
        {translate(checkoutMessages, 'checkout.customBlend')}
      </Badge>
      <span className="block">
        {customBlendCompositionLabel(item.product.name, blend, country)}
      </span>
      {resolved ? (
        <>
          <Badge
            variant={resolved.resultClassification === 'non-food' ? 'destructive' : 'secondary'}
            className="mt-1 w-fit"
            data-testid="checkout-blend-result"
          >
            {resultLabel}
          </Badge>
          {safetyLabel && (
            <span
              role="alert"
              data-testid="checkout-blend-safety"
              className="custom-blend-notice mt-1 block rounded-md px-2 py-1"
            >
              <span className="font-semibold">{safetyLabel}</span>{' '}
              {translate(checkoutMessages, 'checkout.customBlend.safetyWarning')}
            </span>
          )}
          <ul
            className="mt-1 grid gap-1 border-l pl-2"
            aria-label={translate(checkoutMessages, 'checkout.customBlend')}
            data-testid="checkout-blend-components"
          >
            {resolved.components.map((component) => {
              const roleLabel = translate(
                checkoutMessages,
                component.role === 'base'
                  ? 'checkout.customBlend.componentBase'
                  : 'checkout.customBlend.componentIngredient',
              );
              return (
                <li key={`${component.role}-${component.variantId}`}>
                  <span className="font-medium text-foreground">{component.productName}</span>{' '}
                  {number.count(component.percentage)}% · {roleLabel}
                  <span className="block">
                    {translate(checkoutMessages, 'checkout.customBlend.componentRole', {
                      role: roleLabel,
                    })}
                  </span>
                  <span className="block">
                    {translate(checkoutMessages, 'checkout.customBlend.componentWeight', {
                      weight: formatWeightGrams(component.weightGrams),
                    })}
                  </span>
                  <span className="block">
                    {translate(checkoutMessages, 'checkout.customBlend.componentSourcePrice', {
                      money: formatDisplayMoney(component.sourceUnitPriceCents),
                    })}
                  </span>
                  {component.clearance && (
                    <span className="block">
                      {translate(checkoutMessages, 'checkout.customBlend.componentClearance', {
                        money: formatDisplayMoney(component.clearance.priceCents),
                      })}
                    </span>
                  )}
                  <span className="block">
                    {translate(checkoutMessages, 'checkout.customBlend.componentTier', {
                      discountPct: number.count(component.tierDiscountPct),
                    })}
                  </span>
                  {component.nextTierProgress && (
                    <span className="block">
                      {translate(checkoutMessages, 'checkout.customBlend.componentNextTier', {
                        sacksToNextTier: number.count(component.nextTierProgress.sacksToNextTier),
                        minTonnes: number.decimal(component.nextTierProgress.minTonnes),
                        discountPct: number.count(component.nextTierProgress.discountPct),
                      })}
                    </span>
                  )}
                  <span className="block">
                    {translate(checkoutMessages, 'checkout.customBlend.componentUnitContribution', {
                      money: formatDisplayMoney(component.unitContributionCents),
                    })}
                  </span>
                  <span className="block">
                    {translate(checkoutMessages, 'checkout.customBlend.componentSubtotal', {
                      money: formatDisplayMoney(component.subtotalCents),
                    })}
                  </span>
                </li>
              );
            })}
          </ul>
          <span className="block">
            {translate(checkoutMessages, 'checkout.customBlend.materialUnitPrice', {
              money: formatDisplayMoney(resolved.materialUnitPriceCents),
            })}
          </span>
          <span className="block">
            {translate(checkoutMessages, 'checkout.customBlend.materialSubtotal', {
              money: formatDisplayMoney(resolved.materialSubtotalCents),
            })}
          </span>
          <span className="block">
            {translate(checkoutMessages, 'checkout.customBlend.blendingFee', {
              money: formatDisplayMoney(resolved.blendingFeeCents),
            })}
          </span>
          <span className="block font-medium text-foreground">
            {translate(checkoutMessages, 'checkout.customBlend.lineTotal', {
              money: formatDisplayMoney(resolved.lineTotalCents),
            })}
          </span>
        </>
      ) : (
        <>
          <span className="block" data-testid="checkout-blend-legacy">
            {translate(checkoutMessages, 'checkout.customBlend.legacyFallback')}
          </span>
          {/* A legacy line may show only its captured line split; no component/current price facts. */}
          <span className="block">
            {translate(checkoutMessages, 'checkout.baseMaterial', {
              money: formatDisplayMoney(item.materialSubtotalCents),
            })}{' '}
            ·{' '}
            {translate(checkoutMessages, 'checkout.blendingFee', {
              money: formatDisplayMoney(item.blendingFeeCents),
            })}
          </span>
        </>
      )}
    </span>
  );
}

export function CheckoutSummary({
  cart,
  promoCode,
  appliedPromo,
  discountCents,
  discountBaseCents,
  promoCategoryScope,
  totalCents,
  promoError,
  promoErrorCode,
  promoMinSubtotalCents,
  promoValidating,
  isPromoEligible,
  destinationSummary,
  billingSummary,
  deliverySlot,
  purchaseOrderReference,
  onPromoChange,
  onApplyPromo,
  onRemovePromo,
}: CheckoutSummaryProps) {
  const {
    country,
    translate,
    formatDisplayMoney,
    formatDualTotal,
    formatCivilDate,
    formatWeightGrams,
  } = useLocalisation();
  const t = (key: keyof typeof checkoutMessages, params?: Record<string, string | number>) =>
    translate(checkoutMessages, key, params);
  const deliveryPreview = cart.deliveryPreview;
  const slotSummary = deliverySlot
    ? `${formatCivilDate(deliverySlot.date, 'long')} · ${t(
        deliverySlot.window === 'am' ? 'checkout.slotMorning' : 'checkout.slotAfternoon',
      )}`
    : null;
  const tradeRows: Array<{ label: string; value: string }> = [
    ...(destinationSummary
      ? [{ label: t('checkout.deliverySiteSummary'), value: destinationSummary }]
      : []),
    ...(slotSummary ? [{ label: t('checkout.deliverySlotSummary'), value: slotSummary }] : []),
    ...(billingSummary ? [{ label: t('checkout.billedTo'), value: billingSummary }] : []),
    ...(purchaseOrderReference
      ? [{ label: t('checkout.purchaseOrderReference'), value: purchaseOrderReference }]
      : []),
  ];
  const hasCustomBlend = cart.items.some((item) => item.customBlend !== undefined);
  const total = formatDualTotal(totalCents);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('checkout.summary')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          {cart.items.map((item) => (
            <div
              key={cartItemKey(item)}
              className="flex items-center justify-between gap-3 text-sm"
            >
              {item.customBlend && (
                <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                  <CustomBlendPackaging
                    product={checkoutPackagingProduct(item)}
                    variant={item.variantSnap}
                    blend={item.customBlend}
                    className="h-full w-full object-cover"
                  />
                </div>
              )}
              <span className="min-w-0 flex-1">
                {item.product.name}{' '}
                {item.variantSnap && (
                  <span className="text-muted-foreground">&mdash; {item.variantSnap.label}</span>
                )}{' '}
                <span className="text-muted-foreground">× {item.quantity}</span>
                {item.variantSnap && (
                  <span className="block text-xs text-muted-foreground">
                    {t('checkout.sku')}: {item.variantSnap.sku} ·{' '}
                    {formatWeightGrams(item.variantSnap.weightGrams)}
                  </span>
                )}
                {item.variantSnap && (
                  <span className="block text-xs text-muted-foreground">
                    {t('checkout.packPrice', {
                      money: formatDisplayMoney(item.resolvedUnitPriceCents),
                    })}{' '}
                    · {t('checkout.perTonne', { money: formatDisplayMoney(item.perTonneCents) })} ·{' '}
                    {t('checkout.packWeight', {
                      weight: formatWeightGrams(item.variantSnap.weightGrams),
                    })}
                  </span>
                )}
                {item.customBlend && <CheckoutCustomBlendDetails item={item} />}
              </span>
              <span className="shrink-0">{formatDisplayMoney(item.lineTotalCents)}</span>
            </div>
          ))}
        </div>
        {hasCustomBlend && (
          <p className="custom-blend-notice rounded-md px-3 py-2 text-xs">
            {customBlendMadeToOrderNote(country)}
          </p>
        )}
        <Separator />
        {cart.blendingFeeTotalCents > 0 && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t('checkout.materialSubtotal')}</span>
            <span>{formatDisplayMoney(cart.discountableSubtotalCents)}</span>
          </div>
        )}
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{t('checkout.merchandiseSubtotal')}</span>
          <span>{formatDisplayMoney(cart.subtotalCents)}</span>
        </div>
        <PromoCodeForm
          promoCode={promoCode}
          appliedPromo={appliedPromo}
          error={promoError}
          errorCode={promoErrorCode}
          minSubtotalCents={promoMinSubtotalCents}
          validating={promoValidating}
          eligible={isPromoEligible}
          onChange={onPromoChange}
          onApply={onApplyPromo}
          onRemove={onRemovePromo}
        />
        {discountCents > 0 && (
          <>
            {promoCategoryScope && discountBaseCents !== null && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {t('checkout.eligibleSubtotal', { scope: promoCategoryScope })}
                </span>
                <span>{formatDisplayMoney(discountBaseCents)}</span>
              </div>
            )}
            <div className="flex items-center justify-between text-sm text-green-700">
              <span>
                {appliedPromo
                  ? t('checkout.discount', {
                      promo: `${appliedPromo}${promoCategoryScope ? ` · ${promoCategoryScope}` : ''}`,
                    })
                  : t('checkout.discountPlain')}
              </span>
              <span>−{formatDisplayMoney(discountCents)}</span>
            </div>
          </>
        )}
        {deliveryPreview && (
          <>
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                {deliveryPreview.mode === 'freight'
                  ? t('checkout.freightScheduled')
                  : `${t('checkout.parcelDelivery')} · ${t('checkout.free')}`}
              </span>
              <span>{formatDisplayMoney(deliveryPreview.chargeCents)}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('checkout.totalWeight', {
                weight: formatWeightGrams(deliveryPreview.weightGrams),
              })}
            </p>
          </>
        )}
        {tradeRows.length > 0 && (
          <>
            <Separator />
            <dl className="space-y-1 text-sm">
              {tradeRows.map((row) => (
                <div key={row.label} className="flex items-start justify-between gap-3">
                  <dt className="text-muted-foreground">{row.label}</dt>
                  <dd className="text-right">{row.value}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
        <Separator />
        <div className="flex items-center justify-between text-lg font-bold">
          <span>{t('checkout.total')}</span>
          <span className="text-right">
            <span className="block">{total.display}</span>
            {total.settlement && (
              <span className="block text-sm font-normal text-muted-foreground">
                {t('checkout.settlementTotal', { money: total.settlement })}
              </span>
            )}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
