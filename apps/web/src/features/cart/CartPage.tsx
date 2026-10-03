import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { ErrorMessage } from '@/components/ErrorMessage';
import { CartLineItem } from '@/components/CartLineItem';
import { useCartContext } from '@/hooks/CartContext';
import { cartItemKey, pendingConfigKey } from '@/lib/cartLineIdentity';
import { SaveCartAsListButton } from '@/features/savedLists/SaveCartAsListButton';
import { useLocalisation } from '@/i18n/LocaleContext';
import { cartMessages } from '@shop/localisation/messages/cart';

export function CartPage() {
  const { translate, formatMoney, number } = useLocalisation();
  const {
    cart,
    cartId,
    isLoading,
    isInitializing,
    error,
    updateQuantity,
    removeItem,
    retryCart,
    isActionPending,
  } = useCartContext();
  const weightLabel = number.weightGrams;

  if (isInitializing || isLoading) return <LoadingSpinner />;
  if (error && !cart) return <ErrorMessage message={error} onRetry={() => void retryCart()} />;

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-2 text-2xl font-bold">{translate(cartMessages, 'cart.title')}</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        {translate(cartMessages, 'cart.description')}
      </p>
      <Link
        to="/quick-order"
        className="mb-6 inline-block text-sm font-medium underline underline-offset-4"
      >
        {translate(cartMessages, 'cart.quickOrder')}
      </Link>
      {error && cart && (
        <div
          role="alert"
          className="mb-4 flex items-center justify-between gap-4 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3"
        >
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="outline" size="sm" onClick={() => void retryCart()}>
            {translate(cartMessages, 'cart.retryCart')}
          </Button>
        </div>
      )}
      {!cart || cart.totalItems === 0 ? (
        <div className="py-12 text-center space-y-4">
          <p className="text-muted-foreground">{translate(cartMessages, 'cart.empty')}</p>
          <Button variant="outline" nativeButton={false} render={<Link to="/" />}>
            {translate(cartMessages, 'cart.browseMaterials')}
          </Button>
        </div>
      ) : (
        <div className="space-y-1">
          {cart.items.map((item) => (
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
          <Separator className="my-4" />
          <div className="space-y-2">
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
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">
                {translate(cartMessages, 'cart.resolvedOrderSubtotal', {
                  count: cart.totalItems,
                  formattedCount: number.count(cart.totalItems),
                })}
              </span>
              <span className="font-semibold">{formatMoney(cart.subtotalCents)}</span>
            </div>
            {cart.deliveryPreview && (
              <>
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>
                    {cart.deliveryPreview.mode === 'freight'
                      ? translate(cartMessages, 'cart.deliveryFreightScheduled')
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
          </div>
          <div className="flex gap-3 pt-4">
            <Button
              variant="outline"
              className="flex-1"
              nativeButton={false}
              render={<Link to="/" />}
            >
              {translate(cartMessages, 'cart.continueSourcing')}
            </Button>
            <Button className="flex-1" nativeButton={false} render={<Link to="/checkout" />}>
              {translate(cartMessages, 'cart.continueCheckout')}
            </Button>
          </div>
          {cartId && (
            <SaveCartAsListButton
              cartId={cartId}
              excludesBlends={cart.items.some((item) => item.customBlend !== undefined)}
            />
          )}
        </div>
      )}
    </div>
  );
}
