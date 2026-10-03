import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useLocalisation } from '@/i18n/LocaleContext';
import { cartMessages, type CartMessageKey } from '@shop/localisation/messages/cart';
import type { CartLine } from '@shop/contracts/cart';
import { ProductMedia } from '@/components/ProductMedia';
import {
  CustomBlendPackaging,
  customBlendCompositionLabel,
  customBlendMadeToOrderNote,
  isResolvedCustomBlendSnapshot,
} from '@/features/customBlend/CustomBlendPackaging';

interface CartLineItemProps {
  item: CartLine;
  onUpdateQuantity: (
    productId: string,
    quantity: number,
    variantId?: number,
    configKey?: string,
  ) => Promise<boolean>;
  onRemove: (productId: string, variantId?: number, configKey?: string) => Promise<boolean>;
  isUpdating?: boolean;
  isRemoving?: boolean;
}

/**
 * Several configured lines can share one base variant, so line identity carries the config key.
 * Plain lines keep the historic empty key and therefore the historic identity.
 */
function cartLineKey(item: CartLine): string {
  return `${item.productId}:${item.variantSnap?.variantId ?? 'no-variant'}:${item.configKey}`;
}

/** `undefined` for plain lines keeps the pre-blend call shape of the cart mutations. */
function mutationConfigKey(item: CartLine): string | undefined {
  return item.configKey === '' ? undefined : item.configKey;
}

function editBlendHref(item: CartLine, baseVariantId: number): string {
  return `/custom-blend?baseVariantId=${baseVariantId}&editConfigKey=${item.configKey}`;
}

function CartCustomBlendDetails({
  item,
  blend,
}: {
  item: CartLine;
  blend: NonNullable<CartLine['customBlend']>;
}) {
  const { translate, formatMoney, number, activeCountry } = useLocalisation();
  const resolved = isResolvedCustomBlendSnapshot(blend) ? blend : undefined;
  const resultLabel = resolved
    ? translate(
        cartMessages,
        resolved.resultClassification === 'food'
          ? 'cart.customBlend.resultFood'
          : 'cart.customBlend.resultNonFood',
      )
    : undefined;
  const safetyLabel =
    resolved?.resultClassification === 'non-food'
      ? translate(cartMessages, 'cart.customBlend.notForConsumption')
      : undefined;

  return (
    <div className="grid gap-1" data-testid="cart-line-custom-blend">
      <Badge variant="outline" className="w-fit text-[10px]">
        {translate(cartMessages, 'cart.customBlend')}
      </Badge>
      <p className="break-words text-xs text-muted-foreground">
        {customBlendCompositionLabel(item.product.name, blend, activeCountry)}
      </p>
      {resolved ? (
        <>
          <Badge
            variant={resolved.resultClassification === 'non-food' ? 'destructive' : 'secondary'}
            className="w-fit"
            data-testid="cart-line-blend-result"
          >
            {resultLabel}
          </Badge>
          {safetyLabel && (
            <p
              role="alert"
              data-testid="cart-line-blend-safety"
              className="custom-blend-notice rounded-md px-2 py-1 text-xs"
            >
              <span className="font-semibold">{safetyLabel}</span>{' '}
              {translate(cartMessages, 'cart.customBlend.safetyWarning')}
            </p>
          )}
          <ul
            className="grid gap-1 border-l pl-2 text-xs text-muted-foreground"
            aria-label={translate(cartMessages, 'cart.customBlend')}
            data-testid="cart-line-blend-components"
          >
            {resolved.components.map((component) => (
              <li key={`${component.role}-${component.variantId}`}>
                <span className="font-medium text-foreground">{component.productName}</span>{' '}
                <span>
                  {number.count(component.percentage)}% ·{' '}
                  {translate(
                    cartMessages,
                    component.role === 'base'
                      ? 'cart.customBlend.componentBase'
                      : 'cart.customBlend.componentIngredient',
                  )}
                </span>
                <span className="block">
                  {translate(cartMessages, 'cart.customBlend.componentRole', {
                    role: translate(
                      cartMessages,
                      component.role === 'base'
                        ? 'cart.customBlend.componentBase'
                        : 'cart.customBlend.componentIngredient',
                    ),
                  })}
                </span>
                <span className="block">
                  {translate(cartMessages, 'cart.customBlend.componentWeight', {
                    weight: number.weightGrams(component.weightGrams),
                  })}
                </span>
                <span className="block">
                  {translate(cartMessages, 'cart.customBlend.componentSourcePrice', {
                    money: formatMoney(component.sourceUnitPriceCents),
                  })}
                </span>
                {component.clearance && (
                  <span className="block">
                    {translate(cartMessages, 'cart.customBlend.componentClearance', {
                      money: formatMoney(component.clearance.priceCents),
                    })}
                  </span>
                )}
                <span className="block">
                  {translate(cartMessages, 'cart.customBlend.componentTier', {
                    discountPct: number.count(component.tierDiscountPct),
                  })}
                </span>
                {component.nextTierProgress && (
                  <span className="block">
                    {translate(cartMessages, 'cart.customBlend.componentNextTier', {
                      sacksToNextTier: number.count(component.nextTierProgress.sacksToNextTier),
                      minTonnes: number.decimal(component.nextTierProgress.minTonnes),
                      discountPct: number.count(component.nextTierProgress.discountPct),
                    })}
                  </span>
                )}
                <span className="block">
                  {translate(cartMessages, 'cart.customBlend.componentUnitContribution', {
                    money: formatMoney(component.unitContributionCents),
                  })}
                </span>
                <span className="block">
                  {translate(cartMessages, 'cart.customBlend.componentSubtotal', {
                    money: formatMoney(component.subtotalCents),
                  })}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            {translate(cartMessages, 'cart.customBlend.materialUnitPrice', {
              money: formatMoney(resolved.materialUnitPriceCents),
            })}
          </p>
          <p className="text-xs text-muted-foreground">
            {translate(cartMessages, 'cart.customBlend.materialSubtotal', {
              money: formatMoney(resolved.materialSubtotalCents),
            })}
          </p>
          <p className="text-xs text-muted-foreground">
            {translate(cartMessages, 'cart.customBlend.blendingFee', {
              money: formatMoney(resolved.blendingFeeCents),
            })}
          </p>
          <p className="text-xs font-medium text-foreground">
            {translate(cartMessages, 'cart.customBlend.lineTotal', {
              money: formatMoney(resolved.lineTotalCents),
            })}
          </p>
        </>
      ) : (
        <>
          <p data-testid="cart-line-blend-legacy" className="text-xs text-muted-foreground">
            {translate(cartMessages, 'cart.customBlend.legacyFallback')}
          </p>
          {/* Historical cart records retain line money, but no component/current-price facts. */}
          <p className="text-xs text-muted-foreground">
            {translate(cartMessages, 'cart.baseMaterial', {
              money: formatMoney(item.materialSubtotalCents),
            })}
          </p>
          <p className="text-xs text-muted-foreground">
            {translate(cartMessages, 'cart.blendingFee', {
              money: formatMoney(item.blendingFeeCents),
            })}
          </p>
        </>
      )}
      {/*
       * Non-returnable status has to be visible where the line is first held, not first at
       * checkout. Rendering it here covers CartPage and CartSheet from the one line component.
       */}
      <p
        data-testid="cart-line-made-to-order"
        className="custom-blend-notice w-fit rounded-md px-2 py-1 text-xs"
      >
        {customBlendMadeToOrderNote(activeCountry)}
      </p>
    </div>
  );
}

export function CartLineItem({
  item,
  onUpdateQuantity,
  onRemove,
  isUpdating = false,
  isRemoving = false,
}: CartLineItemProps) {
  const [actionError, setActionError] = useState<CartMessageKey | null>(null);
  const { translate, formatMoney, number } = useLocalisation();
  const isPending = isUpdating || isRemoving;
  const lineKey = cartLineKey(item);

  useEffect(() => {
    setActionError(null);
  }, [lineKey]);

  const configKey = mutationConfigKey(item);
  const blend = item.customBlend;
  const baseVariantId = item.variantSnap?.variantId;
  const weightLabel = item.variantSnap ? number.weightGrams(item.variantSnap.weightGrams) : null;

  const updateQuantity = async (quantity: number) => {
    setActionError(null);
    if (!(await onUpdateQuantity(item.productId, quantity, baseVariantId, configKey))) {
      setActionError('cart.actionError');
    }
  };

  const remove = async () => {
    setActionError(null);
    if (!(await onRemove(item.productId, baseVariantId, configKey))) {
      setActionError('cart.actionError');
    }
  };

  return (
    <div className="flex items-center gap-3 py-3">
      <div className="h-16 w-16 shrink-0 rounded-md bg-muted flex items-center justify-center overflow-hidden">
        {blend ? (
          <CustomBlendPackaging
            product={item.product}
            variant={item.variantSnap}
            blend={blend}
            className="h-full w-full object-cover"
          />
        ) : (
          <ProductMedia product={item.product} className="h-full w-full object-cover" />
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1">
        <p className="text-sm font-medium leading-tight">
          {item.product.name}
          {item.variantSnap && (
            <span className="text-muted-foreground"> &mdash; {item.variantSnap.label}</span>
          )}
        </p>
        {item.variantSnap && (
          <p className="text-xs text-muted-foreground">
            SKU: {item.variantSnap.sku}
            <span className="mx-1.5">·</span>
            {weightLabel}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {translate(cartMessages, 'cart.resolvedPackPrice', {
            money: formatMoney(item.resolvedUnitPriceCents),
          })}
        </p>
        {blend && <CartCustomBlendDetails item={item} blend={blend} />}
        {blend && (
          <>
            {baseVariantId !== undefined && (
              <Link
                to={editBlendHref(item, baseVariantId)}
                className="w-fit text-xs font-medium underline underline-offset-2"
              >
                {translate(cartMessages, 'cart.editBlend')}
              </Link>
            )}
          </>
        )}
        {item.variantSnap && (
          <Badge variant="outline" className="w-fit text-[10px]">
            {translate(
              cartMessages,
              item.variantSnap.deliveryClass === 'freight'
                ? 'cart.deliveryClass.freight'
                : 'cart.deliveryClass.parcel',
            )}
          </Badge>
        )}
        {item.product.availability === 'backorder' && (
          <p className="text-xs font-medium text-amber-700">
            {translate(cartMessages, 'cart.backorder')}
          </p>
        )}
        {item.product.availability === 'out_of_stock' && (
          <p className="text-xs font-medium text-destructive">
            {translate(cartMessages, 'cart.outOfStock')}
          </p>
        )}
        <div className="flex items-center gap-2 mt-1">
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            aria-label={translate(cartMessages, 'cart.decreaseQuantity')}
            disabled={item.quantity <= 1 || isPending}
            onClick={() => void updateQuantity(item.quantity - 1)}
          >
            <Minus className="h-3 w-3" />
          </Button>
          <span className="w-8 text-center text-sm" aria-live="polite">
            {number.count(item.quantity)}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            aria-label={translate(cartMessages, 'cart.increaseQuantity')}
            disabled={isPending}
            onClick={() => void updateQuantity(item.quantity + 1)}
          >
            <Plus className="h-3 w-3" />
          </Button>
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <span className="text-sm font-semibold">{formatMoney(item.lineTotalCents)}</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs text-destructive hover:text-destructive"
          disabled={isPending}
          onClick={() => void remove()}
        >
          {isRemoving
            ? translate(cartMessages, 'cart.removing')
            : translate(cartMessages, 'cart.remove')}
        </Button>
        {actionError && (
          <p role="alert" className="max-w-36 text-right text-xs text-destructive">
            {translate(cartMessages, actionError)}
          </p>
        )}
      </div>
    </div>
  );
}
