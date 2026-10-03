import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { LoadingSpinner } from './LoadingSpinner';
import { ErrorMessage } from './ErrorMessage';
import { CartLineItem } from './CartLineItem';
import { useCartContext } from '@/hooks/CartContext';
import { cartItemKey, pendingConfigKey } from '@/lib/cartLineIdentity';
import { Link } from 'react-router-dom';
import { useLocalisation } from '@/i18n/LocaleContext';
import { cartMessages } from '@shop/localisation/messages/cart';

export function CartSheet() {
  const [open, setOpen] = useState(false);
  const { translate, formatMoney, number } = useLocalisation();
  const {
    cart,
    isLoading,
    isInitializing,
    error,
    updateQuantity,
    removeItem,
    retryCart,
    isActionPending,
  } = useCartContext();
  const itemCount = cart?.totalItems ?? 0;
  const weightLabel = number.weightGrams;
  const triggerLabel =
    itemCount > 0
      ? translate(cartMessages, 'cart.openCart', {
          count: itemCount,
          formattedCount: number.count(itemCount),
        })
      : translate(cartMessages, 'cart.openCartEmpty');

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={<Button variant="outline" size="sm" className="relative" />}
        aria-label={triggerLabel}
      >
        {translate(cartMessages, 'cart.openCartEmpty')}
        {isInitializing && (
          <span className="ml-1.5 inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        )}
        {!isInitializing && itemCount > 0 && (
          <span
            aria-label={translate(cartMessages, 'cart.openCart', {
              count: itemCount,
              formattedCount: number.count(itemCount),
            })}
            className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground"
          >
            {number.count(itemCount)}
          </span>
        )}
      </SheetTrigger>
      <SheetContent className="flex flex-col w-full sm:w-auto">
        <SheetHeader>
          <SheetTitle>
            {translate(cartMessages, 'cart.orderTitle', {
              count: itemCount,
              formattedCount: number.count(itemCount),
            })}
          </SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {isInitializing && <LoadingSpinner />}
          {!isInitializing && isLoading && <LoadingSpinner />}
          {!isInitializing && !isLoading && error && !cart && (
            <ErrorMessage message={error} onRetry={() => void retryCart()} />
          )}
          {!isInitializing && !isLoading && error && cart && (
            <div
              role="alert"
              className="mb-3 flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3"
            >
              <p className="text-xs text-destructive">{error}</p>
              <Button variant="outline" size="sm" onClick={() => void retryCart()}>
                {translate(cartMessages, 'cart.retry')}
              </Button>
            </div>
          )}
          {!isInitializing && !isLoading && cart && cart.totalItems === 0 && (
            <p className="py-8 text-center text-muted-foreground">
              {translate(cartMessages, 'cart.empty')}
            </p>
          )}
          {!isInitializing &&
            !isLoading &&
            cart &&
            cart.items.map((item) => (
              <div key={cartItemKey(item)}>
                <CartLineItem
                  item={item}
                  isUpdating={isActionPending(
                    item.productId,
                    'update',
                    item.variantSnap?.variantId,
                    pendingConfigKey(item),
                  )}
                  isRemoving={isActionPending(
                    item.productId,
                    'remove',
                    item.variantSnap?.variantId,
                    pendingConfigKey(item),
                  )}
                  onUpdateQuantity={updateQuantity}
                  onRemove={removeItem}
                />
                {item.variantSnap && (
                  <p className="-mt-1 pb-3 text-xs text-muted-foreground">
                    {translate(cartMessages, 'cart.perTonne', {
                      money: formatMoney(item.perTonneCents),
                    })}{' '}
                    <span className="mx-1.5" aria-hidden="true">
                      &middot;
                    </span>{' '}
                    {translate(cartMessages, 'cart.packWeight', {
                      weight: weightLabel(item.variantSnap.weightGrams),
                    })}
                  </p>
                )}
                {item.clearance && (
                  <p
                    className="-mt-2 pb-3 text-xs font-medium text-sale"
                    aria-label={translate(cartMessages, 'cart.clearanceAria')}
                  >
                    {translate(cartMessages, 'cart.clearancePrice', {
                      money: formatMoney(item.clearance.priceCents),
                    })}
                  </p>
                )}
                {item.nextTierProgress && (
                  <p
                    className="-mt-2 pb-3 text-xs text-muted-foreground"
                    aria-label={translate(cartMessages, 'cart.nextTierProgressAria')}
                  >
                    {translate(cartMessages, 'cart.nextTierProgress', {
                      count: item.nextTierProgress.sacksToNextTier,
                      formattedCount: number.count(item.nextTierProgress.sacksToNextTier),
                      formattedMinTonnes: number.decimal(item.nextTierProgress.minTonnes),
                      formattedDiscountPct: number.decimal(item.nextTierProgress.discountPct),
                    })}
                  </p>
                )}
              </div>
            ))}
        </div>
        {!isInitializing && cart && cart.totalItems > 0 && (
          <div className="space-y-3 border-t px-4 pt-4 pb-4">
            {cart.blendingFeeTotalCents > 0 && (
              <>
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>{translate(cartMessages, 'cart.materialSubtotal')}</span>
                  <span>{formatMoney(cart.discountableSubtotalCents)}</span>
                </div>
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>{translate(cartMessages, 'cart.blendingFees')}</span>
                  <span>{formatMoney(cart.blendingFeeTotalCents)}</span>
                </div>
              </>
            )}
            <div className="flex items-center justify-between text-sm">
              <span>{translate(cartMessages, 'cart.resolvedOrderSubtotalShort')}</span>
              <span className="font-semibold">{formatMoney(cart.subtotalCents)}</span>
            </div>
            {cart.deliveryPreview && (
              <>
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>
                    {cart.deliveryPreview.mode === 'freight'
                      ? translate(cartMessages, 'cart.deliveryFreight')
                      : translate(cartMessages, 'cart.deliveryParcel')}
                  </span>
                  <span>
                    {cart.deliveryPreview.chargeCents === 0
                      ? translate(cartMessages, 'cart.free')
                      : formatMoney(cart.deliveryPreview.chargeCents)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {translate(cartMessages, 'cart.totalWeight', {
                    weight: weightLabel(cart.deliveryPreview.weightGrams),
                  })}
                </p>
              </>
            )}
            <Separator />
            <Button
              className="w-full"
              variant="outline"
              nativeButton={false}
              render={<Link to="/cart" onClick={() => setOpen(false)} />}
            >
              {translate(cartMessages, 'cart.reviewOrder')}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
