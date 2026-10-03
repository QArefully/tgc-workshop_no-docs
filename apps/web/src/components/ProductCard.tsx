import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SaveToListButton } from '@/components/SaveToListButton';
import type { Product, ProductWithVariants } from '@shop/contracts/products';
import { ProductMedia } from '@/components/ProductMedia';
import { useLocalisation } from '@/i18n/LocaleContext';
import { discoveryMessages } from '@shop/localisation/messages/discovery';

type ProductOrVariant = Product | ProductWithVariants;

function hasVariants(p: ProductOrVariant): p is ProductWithVariants {
  return 'variants' in p && Array.isArray(p.variants) && p.variants.length > 0;
}

interface ProductCardProps {
  product: ProductOrVariant;
  onAddToCart: (productId: string, variantId?: number) => Promise<boolean>;
  isCartAvailable: boolean;
  isAdding?: boolean;
  comparisonControl?: ReactNode;
}

function getPriceRange(product: ProductOrVariant): { min: number; max: number } {
  if (hasVariants(product))
    return product.priceRange ?? { min: product.priceCents, max: product.priceCents };
  return { min: product.priceCents, max: product.priceCents };
}

function getBaseAvailability(product: ProductOrVariant): string {
  if (hasVariants(product)) return product.baseAvailability ?? product.availability;
  return product.availability;
}

function getIsOnSale(product: ProductOrVariant): boolean {
  const priceMin = getPriceRange(product).min;
  return product.compareAtPriceCents != null && product.compareAtPriceCents > priceMin;
}

function hasActiveClearance(product: ProductOrVariant): boolean {
  return product.hasActiveClearance === true;
}

function getTotalStock(product: ProductOrVariant): number {
  if (hasVariants(product)) {
    let total = 0;
    for (const v of product.variants) {
      if (v.active) total += v.stockCount;
    }
    return total;
  }
  return product.stock;
}

export function ProductCard({
  product,
  onAddToCart,
  isCartAvailable,
  isAdding = false,
  comparisonControl,
}: ProductCardProps) {
  const { translate, formatDisplayMoney, formatCount } = useLocalisation();
  const t = (key: keyof typeof discoveryMessages, params?: Record<string, string | number>) =>
    translate(discoveryMessages, key, params);
  const [actionError, setActionError] = useState<string | null>(null);
  const baseAvail = getBaseAvailability(product);
  const purchasable =
    baseAvail === 'in_stock' || baseAvail === 'low_stock' || baseAvail === 'backorder';
  const totalStock = getTotalStock(product);
  const priceRange = getPriceRange(product);
  const hasPriceRange = priceRange.min !== priceRange.max;
  const isOnSale = getIsOnSale(product);
  const isClearance = hasActiveClearance(product);
  const isBestseller = product.salesCount >= 250;
  const packSize = product.packaging?.quantity;
  const isFood = hasVariants(product) && product.consumptionClassification === 'food';
  const isNonFood = hasVariants(product) && product.consumptionClassification === 'non-food';
  const isCaution = hasVariants(product) && product.consumptionClassification === 'caution';
  const variantCount = hasVariants(product) ? product.variants.filter((v) => v.active).length : 0;

  useEffect(() => {
    setActionError(null);
  }, [product.id]);

  const defaultVariantId = hasVariants(product) ? product.defaultVariantId : undefined;

  const handleAddToCart = async () => {
    setActionError(null);
    const added = await onAddToCart(product.id, defaultVariantId);
    if (!added) setActionError(t('product.addError'));
  };

  const priceLabel = hasPriceRange
    ? t('product.from', { price: formatDisplayMoney(priceRange.min) })
    : formatDisplayMoney(priceRange.min);

  return (
    <Card className="group flex h-full flex-col gap-0 overflow-hidden border-border/80 bg-surface-raised py-0 shadow-sm transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-lg">
      <div className="relative aspect-4/5 overflow-hidden bg-surface-soft">
        <Link
          to={`/products/${product.id}`}
          className="block h-full w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <ProductMedia
            product={product}
            className="h-full w-full object-contain p-4 transition-transform duration-200 group-hover:scale-[1.035] sm:p-5"
          />
        </Link>
        <div className="pointer-events-none absolute top-3 left-3 flex flex-wrap gap-1.5">
          {isClearance && (
            <Badge className="bg-sale px-2.5 text-sale-foreground">{t('product.clearance')}</Badge>
          )}
          {isOnSale && (
            <Badge className="bg-sale px-2.5 text-sale-foreground">{t('product.sale')}</Badge>
          )}
          {isBestseller && (
            <Badge
              variant="secondary"
              className="border-primary/10 bg-background/95 px-2.5 text-primary shadow-sm"
            >
              {t('product.bestseller')}
            </Badge>
          )}
          {isFood && (
            <Badge className="bg-emerald-600 px-2.5 text-white">{t('product.food')}</Badge>
          )}
          {isNonFood && (
            <Badge variant="secondary" className="px-2.5">
              {t('product.notForConsumption')}
            </Badge>
          )}
          {isCaution && (
            <Badge className="bg-amber-500 px-2.5 text-white">{t('product.caution')}</Badge>
          )}
        </div>
        <div className="absolute top-2 right-2 rounded-full bg-background/90 shadow-sm backdrop-blur-sm">
          <SaveToListButton variantId={defaultVariantId} />
        </div>
      </div>
      <CardContent className="flex flex-1 flex-col gap-2 p-4 pt-4 sm:p-5 sm:pt-4">
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {t('product.material')} · {product.category}
        </p>
        <h3 className="line-clamp-2 min-h-11 text-base font-semibold leading-[1.35] tracking-tight">
          <Link
            to={`/products/${product.id}`}
            className="rounded-sm underline-offset-4 hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {product.name}
          </Link>
        </h3>
        {packSize && (
          <p className="text-xs text-muted-foreground">{t('product.pack', { pack: packSize })}</p>
        )}
        <div className="mt-auto pt-2">
          <div className="flex flex-wrap items-baseline gap-2">
            {isOnSale ? (
              <>
                <span className="price-current text-sale">{priceLabel}</span>
                <span className="price-compare">
                  {formatDisplayMoney(product.compareAtPriceCents!)}
                </span>
              </>
            ) : (
              <span className="price-current">{priceLabel}</span>
            )}
          </div>
          {variantCount > 1 && (
            <p className="mt-1 text-xs text-muted-foreground">
              {t('product.options', {
                count: variantCount,
                displayCount: formatCount(variantCount),
              })}
            </p>
          )}
        </div>
      </CardContent>
      <CardFooter className="border-t-0 bg-transparent p-4 pt-0 sm:px-5 sm:pb-5">
        <div className="w-full space-y-2">
          {baseAvail === 'backorder' && (
            <p className="text-xs font-medium text-amber-700">{t('product.backorderAvailable')}</p>
          )}
          {baseAvail === 'out_of_stock' && (
            <p className="text-xs font-medium text-destructive">{t('product.outOfStock')}</p>
          )}
          {(baseAvail === 'low_stock' || baseAvail === 'in_stock') && totalStock <= 5 && (
            <p className="text-xs font-medium text-sale">
              {t('product.onlyLeft', { count: totalStock, displayCount: formatCount(totalStock) })}
            </p>
          )}
          <Button
            className="w-full"
            disabled={!isCartAvailable || !purchasable || isAdding}
            onClick={() => {
              void handleAddToCart();
            }}
          >
            {!isCartAvailable
              ? t('product.cartUnavailable')
              : isAdding
                ? t('product.adding')
                : purchasable
                  ? t('product.addToOrder')
                  : t('product.unavailable')}
          </Button>
          {comparisonControl}
          {actionError && (
            <p role="alert" className="text-center text-xs text-destructive">
              {actionError}
            </p>
          )}
        </div>
      </CardFooter>
    </Card>
  );
}
