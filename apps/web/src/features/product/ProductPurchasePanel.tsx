import { useState } from 'react';
import type { ProductWithVariants, CatalogVariant } from '@shop/contracts/products';
import { SACK_WEIGHT_GRAMS } from '@shop/contracts/pricing';
import { Check, Package, Scale, AlertTriangle, Truck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AddToListMenu } from '@/features/savedLists/AddToListMenu';
import { CompareProductButton } from '@/features/comparison/CompareProductButton';
import { NotifyWhenAvailableButton } from '@/components/NotifyWhenAvailableButton';
import { productMessages } from '@shop/localisation/messages/product';
import { useLocalisation } from '@/i18n/LocaleContext';

interface ProductPurchasePanelProps {
  product: ProductWithVariants;
  isCartAvailable: boolean;
  isAdding: boolean;
  actionError: string | null;
  cartError?: string | null;
  onAddToCart: (variantId: number, quantity: number) => Promise<void>;
  onRetryCart?: () => void;
  belowMoqError?: string | null;
}

type PurchaseValidationError =
  | { readonly key: 'product.pleaseSelectBagOption' }
  | { readonly key: 'product.selectedUnavailable' }
  | { readonly key: 'product.enterWholeNumberSacks' }
  | {
      readonly key: 'product.minimumOrder';
      readonly params: { readonly count: number; readonly label: string };
    };

function variantIsPurchasable(v: CatalogVariant): boolean {
  return v.active && (v.stockCount > 0 || v.backorderable);
}

/** Sold out with no backorder route — the only state a waiting list makes sense in. */
function variantIsSoldOut(v: CatalogVariant): boolean {
  return v.active && v.stockCount === 0 && !v.backorderable;
}

function minimumOrderUnits(variant: CatalogVariant): number {
  return Math.ceil((variant.moqSacks * SACK_WEIGHT_GRAMS) / variant.weightGrams);
}

function VariantSelector({
  variants,
  selectedVariantId,
  onSelect,
}: {
  variants: readonly CatalogVariant[];
  selectedVariantId: number | null;
  onSelect: (variantId: number) => void;
}) {
  const sorted = [...variants].sort((a, b) => a.sortOrder - b.sortOrder);
  const { translate, formatDisplayMoney, formatWeightGrams, formatInstant, formatCount } =
    useLocalisation();
  const t = <K extends keyof typeof productMessages>(
    key: K,
    params?: Record<string, string | number>,
  ) => translate(productMessages, key, params);

  return (
    <fieldset className="mt-6">
      <legend className="font-semibold text-foreground">{t('product.packPalletOptions')}</legend>
      <div className="mt-3 grid gap-3">
        {sorted.map((v) => {
          const isSelected = selectedVariantId === v.variantId;
          const isOutOfStock = variantIsSoldOut(v);
          // A sold-out option stays selectable so the buyer can join its waiting list; only a
          // retired option is unselectable. Purchasability is still enforced on the add action.
          const disabled = !variantIsPurchasable(v) && !isOutOfStock;
          const isBackorder = v.active && v.stockCount === 0 && v.backorderable;
          const isFreight = v.deliveryClass === 'freight';
          const hasSale = v.compareAtPriceCents != null && v.compareAtPriceCents > v.priceCents;
          const clearance = v.clearance;

          return (
            <label
              key={v.variantId}
              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors ${
                disabled
                  ? 'cursor-not-allowed border-border/40 bg-surface-soft/50 opacity-60'
                  : isSelected
                    ? 'border-primary/50 bg-primary/5 ring-2 ring-primary/20'
                    : 'border-border/80 bg-surface-raised hover:border-primary/30'
              }`}
            >
              <input
                type="radio"
                name="variant"
                className="mt-0.5 size-4 accent-primary"
                checked={isSelected}
                disabled={disabled}
                onChange={() => onSelect(v.variantId)}
              />
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-semibold text-foreground">{v.label}</span>
                  {isFreight && (
                    <Badge variant="secondary" className="gap-1 px-2">
                      <Truck className="size-3" />
                      {t('product.freight')}
                    </Badge>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                  <span className="font-semibold text-foreground">
                    {clearance ? (
                      <>
                        <span className="text-sale">
                          {t('product.clearancePrice', {
                            amount: formatDisplayMoney(clearance.priceCents),
                          })}
                        </span>{' '}
                        <span className="text-xs font-normal text-muted-foreground line-through">
                          {formatDisplayMoney(v.priceCents)}
                        </span>
                      </>
                    ) : hasSale ? (
                      <>
                        <span className="text-sale">
                          {t('product.packPrice', { amount: formatDisplayMoney(v.priceCents) })}
                        </span>{' '}
                        <span className="text-xs font-normal text-muted-foreground line-through">
                          {formatDisplayMoney(v.compareAtPriceCents!)}
                        </span>
                      </>
                    ) : (
                      <>{t('product.packPrice', { amount: formatDisplayMoney(v.priceCents) })}</>
                    )}
                  </span>
                  <span>
                    {t('product.perTonne', {
                      amount: formatDisplayMoney(clearance?.perTonneCents ?? v.perTonneCents),
                    })}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Package className="size-3.5" />
                    {t('product.sku', { sku: v.sku })}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Scale className="size-3.5" />
                    {t('product.weight', { weight: formatWeightGrams(v.weightGrams) })}
                  </span>
                </div>
                {clearance && (
                  <p
                    className="text-xs font-medium text-sale"
                    aria-label={t('product.clearanceEnds', {
                      date: formatInstant(clearance.endsAt, 'date'),
                    })}
                  >
                    {t('product.clearanceEnds', {
                      date: formatInstant(clearance.endsAt, 'date'),
                    })}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  {isOutOfStock ? (
                    <span className="inline-flex items-center gap-1 font-medium text-destructive">
                      <AlertTriangle className="size-3.5" />
                      {t('product.soldOut')}
                    </span>
                  ) : isBackorder ? (
                    <span className="inline-flex items-center gap-1 font-medium text-amber-700">
                      {t('product.backorder')}
                      {v.backorderLeadDays != null &&
                        ` ${t('product.daysLead', { days: formatCount(v.backorderLeadDays) })}`}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 font-medium text-success">
                      <Check className="size-3.5" />
                      {v.stockCount === 1
                        ? t('product.palletAvailable', { count: 1 })
                        : v.stockCount <= 5
                          ? t('product.onlyPalletsAvailable', { count: formatCount(v.stockCount) })
                          : t('product.palletAvailable', { count: v.stockCount })}
                    </span>
                  )}
                </div>
                {isFreight && (
                  <p className="text-sm text-muted-foreground">
                    {t('product.palletFreightArranged')}
                    {isBackorder && v.backorderLeadDays != null
                      ? ` · ${t('product.leadTime', { days: formatCount(v.backorderLeadDays) })}`
                      : '.'}
                  </p>
                )}
              </div>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function ProductPurchasePanel({
  product,
  isCartAvailable,
  isAdding,
  actionError,
  cartError,
  onAddToCart,
  onRetryCart,
  belowMoqError,
}: ProductPurchasePanelProps) {
  const [selectedVariantId, setSelectedVariantId] = useState<number | null>(null);
  const [quantity, setQuantity] = useState('');
  const [localError, setLocalError] = useState<PurchaseValidationError | null>(null);
  const { translate, formatDisplayMoney, formatWeightGrams, formatCount, formatInstant } =
    useLocalisation();
  const t = <K extends keyof typeof productMessages>(
    key: K,
    params?: Record<string, string | number>,
  ) => translate(productMessages, key, params);

  const baseAvail = product.baseAvailability;
  const hasPriceRange = product.priceRange.min !== product.priceRange.max;
  const isOnSale =
    product.compareAtPriceCents != null && product.compareAtPriceCents > product.priceRange.min;
  const packSize = product.packaging?.quantity;
  const consumptionLabel = product.packaging?.consumptionLabel;
  const isFood = product.consumptionClassification === 'food';
  const isNonFood = product.consumptionClassification === 'non-food';
  const isCaution = product.consumptionClassification === 'caution';

  const selectedVariant = selectedVariantId
    ? (product.variants.find((v) => v.variantId === selectedVariantId) ?? null)
    : null;
  const minimumUnits = selectedVariant ? minimumOrderUnits(selectedVariant) : null;
  const selectedClearance = selectedVariant?.clearance;

  const parsedQuantity = Number(quantity);
  const hasValidQuantity = Number.isSafeInteger(parsedQuantity) && parsedQuantity >= 1;
  const variantAddDisabled =
    !selectedVariantId || !variantIsPurchasable(selectedVariant!) || !hasValidQuantity;

  const priceLabel = hasPriceRange
    ? t('product.from', { amount: formatDisplayMoney(product.priceRange.min) })
    : formatDisplayMoney(product.priceRange.min);

  const handleAddToCart = async () => {
    if (!selectedVariantId) {
      setLocalError({ key: 'product.pleaseSelectBagOption' });
      return;
    }
    if (!selectedVariant || !variantIsPurchasable(selectedVariant)) {
      setLocalError({ key: 'product.selectedUnavailable' });
      return;
    }
    setLocalError(null);
    if (!hasValidQuantity) {
      setLocalError({ key: 'product.enterWholeNumberSacks' });
      return;
    }
    if (minimumUnits != null && parsedQuantity < minimumUnits) {
      setLocalError({
        key: 'product.minimumOrder',
        params: { count: minimumUnits, label: selectedVariant.label },
      });
      return;
    }
    await onAddToCart(selectedVariantId, parsedQuantity);
  };

  const allUnavailable = product.variants.every((v) => !variantIsPurchasable(v));

  return (
    <aside className="product-purchase-panel self-start rounded-2xl border bg-surface-raised p-6 shadow-sm xl:p-8">
      <p className="section-eyebrow">
        {t('product.material')} · {product.category}
      </p>
      <div className="mt-3 flex flex-wrap items-start gap-2">
        <h1 className="min-w-0 flex-1 text-3xl font-semibold tracking-tight sm:text-4xl">
          {product.name}
        </h1>
        {isOnSale && <Badge className="bg-sale text-sale-foreground">{t('product.sale')}</Badge>}
        {isFood && <Badge className="bg-emerald-600 text-white">{t('product.food')}</Badge>}
        {isNonFood && <Badge variant="secondary">{t('product.notForConsumption')}</Badge>}
        {isCaution && <Badge className="bg-amber-500 text-white">{t('product.caution')}</Badge>}
      </div>

      <div className="mt-6 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span
          className={
            selectedClearance
              ? 'text-3xl font-bold tracking-tight text-sale'
              : 'text-3xl font-bold tracking-tight text-foreground'
          }
        >
          {selectedClearance ? formatDisplayMoney(selectedClearance.priceCents) : priceLabel}
        </span>
        {selectedClearance ? (
          <span className="text-lg text-muted-foreground line-through">
            {formatDisplayMoney(selectedVariant.priceCents)}
          </span>
        ) : (
          isOnSale && (
            <>
              <span className="text-lg text-muted-foreground line-through">
                {formatDisplayMoney(product.compareAtPriceCents!)}
              </span>
            </>
          )
        )}
      </div>
      {selectedClearance && (
        <p
          className="mt-1 text-sm font-medium text-sale"
          aria-label={t('product.clearanceEnds', {
            date: formatInstant(selectedClearance.endsAt, 'date'),
          })}
        >
          {t('product.clearanceEnds', {
            date: formatInstant(selectedClearance.endsAt, 'date'),
          })}
        </p>
      )}

      <p className="mt-6 leading-7 text-muted-foreground">{product.description}</p>

      <VariantSelector
        variants={product.variants}
        selectedVariantId={selectedVariantId}
        onSelect={(variantId) => {
          setSelectedVariantId(variantId);
          const variant = product.variants.find((item) => item.variantId === variantId);
          setQuantity(variant ? String(minimumOrderUnits(variant)) : '');
          setLocalError(null);
        }}
      />

      {selectedVariant && (
        <div className="mt-4 space-y-4 rounded-xl bg-surface-soft p-4 text-sm">
          <p>
            <span className="font-semibold">{t('product.selected')}</span> {selectedVariant.label} (
            {t('product.skuLabel')}: {selectedVariant.sku})
          </p>
          <p>
            <span className="font-semibold">{t('product.price')}</span>{' '}
            {formatDisplayMoney(selectedClearance?.priceCents ?? selectedVariant.priceCents)}
            {selectedClearance ? (
              <>
                {' '}
                <span className="text-muted-foreground line-through">
                  {formatDisplayMoney(selectedVariant.priceCents)}
                </span>
              </>
            ) : (
              selectedVariant.compareAtPriceCents != null &&
              selectedVariant.compareAtPriceCents > selectedVariant.priceCents && (
                <>
                  {' '}
                  <span className="text-muted-foreground line-through">
                    {formatDisplayMoney(selectedVariant.compareAtPriceCents)}
                  </span>
                </>
              )
            )}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="order-quantity" className="font-semibold">
                {t('product.orderQuantity', { label: selectedVariant.label })}
              </label>
              <input
                id="order-quantity"
                type="number"
                inputMode="numeric"
                min={minimumUnits ?? 1}
                step={1}
                value={quantity}
                aria-describedby="order-quantity-hint"
                aria-invalid={
                  hasValidQuantity && minimumUnits != null && parsedQuantity < minimumUnits
                }
                onChange={(event) => {
                  setQuantity(event.target.value);
                  setLocalError(null);
                }}
                className="mt-2 h-10 w-full rounded-md border bg-background px-3 text-foreground"
              />
              <p id="order-quantity-hint" className="mt-1 text-muted-foreground">
                {t('product.minimumOrderHint', {
                  count: formatCount(minimumUnits ?? 0),
                  label: selectedVariant.label,
                })}
              </p>
            </div>
            <div className="rounded-lg border border-border/70 bg-background p-3">
              <p className="font-semibold">{t('product.totalWeight')}</p>
              <p className="mt-1 text-muted-foreground">
                {hasValidQuantity
                  ? formatWeightGrams(selectedVariant.weightGrams * parsedQuantity)
                  : t('product.enterQuantity')}
              </p>
            </div>
          </div>
          <div>
            <p className="font-semibold">{t('product.volumePricing')}</p>
            <ul
              aria-label={t('product.volumePricing')}
              className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground"
            >
              {selectedVariant.priceTiers.map((tier) => (
                <li key={`${tier.minTonnes}-${tier.discountPct}`}>
                  {formatCount(tier.minTonnes)}{' '}
                  {translate(productMessages, 'product.tonne', { count: tier.minTonnes })}:{' '}
                  {t('product.percentOff', { percent: formatCount(tier.discountPct) })}
                </li>
              ))}
            </ul>
          </div>
          {selectedVariant.deliveryClass === 'freight' && (
            <p className="rounded-lg border border-border/70 bg-background p-3 text-muted-foreground">
              {t('product.palletFreightApplies')}
              {selectedVariant.backorderLeadDays != null
                ? t('product.currentBackorderLead', {
                    days: formatCount(selectedVariant.backorderLeadDays),
                  })
                : '.'}
            </p>
          )}
        </div>
      )}

      <div className="mt-5 grid gap-3 rounded-xl border border-border/80 bg-surface-soft p-4 text-sm sm:grid-cols-2">
        <div>
          <p className="font-semibold">{t('product.bagFormat')}</p>
          <p className="mt-1 text-muted-foreground">{packSize ?? t('product.sack')}</p>
        </div>
        <div>
          <p className="font-semibold">{t('product.handling')}</p>
          <p className="mt-1 text-muted-foreground">{t('product.handlingDetail')}</p>
        </div>
      </div>
      {consumptionLabel && (
        <p
          role="note"
          className="mt-4 rounded-lg border border-sale/40 bg-sale/10 px-4 py-3 text-sm font-semibold text-foreground"
        >
          {consumptionLabel}
        </p>
      )}

      <ul
        aria-label={t('product.shoppingDetails')}
        className="mt-5 grid gap-2 text-sm font-medium text-muted-foreground"
      >
        <li className="flex items-center gap-2">
          <Check className="size-4 shrink-0 text-success" aria-hidden="true" />
          {t('product.linesHeld')}
        </li>
        <li className="flex items-center gap-2">
          <Check className="size-4 shrink-0 text-success" aria-hidden="true" />
          {t('product.adjustPallet')}
        </li>
        <li className="flex items-center gap-2">
          <Check className="size-4 shrink-0 text-success" aria-hidden="true" />
          {t('product.simulatedPaymentNoCharge')}
        </li>
      </ul>

      <div className="mt-6 rounded-xl bg-surface-soft p-4">
        <p
          className={
            baseAvail === 'in_stock' || baseAvail === 'low_stock'
              ? 'font-semibold text-success'
              : baseAvail === 'backorder'
                ? 'font-semibold text-amber-700'
                : 'font-semibold text-destructive'
          }
        >
          {baseAvail === 'in_stock'
            ? t('product.inStock')
            : baseAvail === 'low_stock'
              ? t('product.lowStock')
              : baseAvail === 'backorder'
                ? t('product.availableBackorder')
                : t('product.outOfStock')}
        </p>
        {selectedVariant && variantIsPurchasable(selectedVariant) && (
          <p className="mt-1 text-sm text-muted-foreground">
            {selectedVariant.stockCount > 0
              ? t('product.itemsAvailable', { count: selectedVariant.stockCount })
              : t('product.backorderLead', {
                  days: selectedVariant.backorderLeadDays ?? '?',
                })}
          </p>
        )}
      </div>

      <div className="mt-6 flex items-center gap-3">
        <Button
          size="lg"
          className="h-12 flex-1 text-base"
          disabled={!isCartAvailable || allUnavailable || variantAddDisabled || isAdding}
          onClick={() => void handleAddToCart()}
        >
          {!isCartAvailable
            ? t('product.cartUnavailable')
            : isAdding
              ? t('product.adding')
              : allUnavailable
                ? t('product.unavailable')
                : !selectedVariantId
                  ? t('product.chooseBagOption')
                  : variantAddDisabled
                    ? t('product.unavailable')
                    : t('product.addToOrder')}
        </Button>
        <AddToListMenu
          variantId={selectedVariantId}
          quantity={hasValidQuantity ? parsedQuantity : 1}
        />
      </div>
      {selectedVariant && variantIsSoldOut(selectedVariant) && (
        <NotifyWhenAvailableButton variantId={selectedVariant.variantId} />
      )}
      <div className="mt-3">
        <CompareProductButton productId={product.id} productName={product.name} />
      </div>

      {(actionError || localError) && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {localError
            ? localError.key === 'product.minimumOrder'
              ? t(localError.key, {
                  count: formatCount(localError.params.count),
                  label: localError.params.label,
                })
              : t(localError.key)
            : actionError}
        </p>
      )}
      {belowMoqError && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {belowMoqError}
        </p>
      )}
      {cartError && onRetryCart && (
        <div role="alert" className="mt-3 flex flex-wrap items-center gap-2">
          <p className="text-sm text-destructive">{cartError}</p>
          <Button variant="outline" size="sm" onClick={onRetryCart}>
            {t('product.retryCart')}
          </Button>
        </div>
      )}

      <dl className="mt-8 grid gap-4 border-t pt-6 text-sm sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        <div>
          <dt className="font-semibold">{t('product.paymentSimulation')}</dt>
          <dd className="mt-1 text-muted-foreground">{t('product.noCardCharged')}</dd>
        </div>
        <div>
          <dt className="font-semibold">{t('product.deliveryReturns')}</dt>
          <dd className="mt-1 text-muted-foreground">{t('product.noRealFulfilment')}</dd>
        </div>
      </dl>
    </aside>
  );
}
