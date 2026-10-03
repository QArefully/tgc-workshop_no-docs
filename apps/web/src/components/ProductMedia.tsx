import type { Product, ProductWithVariants } from '@shop/contracts/products';

import { PackagingArtwork } from '@/components/packaging/PackagingArtwork';
import { resolveCatalogPackagingPalette } from '@/components/packaging/catalogPackagingPalettes';
import { resolvePackagingSpec } from '@/components/packaging/packagingSpec';
import { useLocalisation } from '@/i18n/LocaleContext';
import { discoveryMessages } from '@shop/localisation/messages/discovery';

interface ProductMediaProps {
  product: Product | ProductWithVariants;
  className?: string;
}

type FoodBagArtwork = {
  accent: string;
  powderAccent: string;
  schemeKey: string;
  mark: string;
  category: string;
  quantity: string;
  batchCode: string;
};

/** Category metadata only -- colours come from the resolved catalog palette, not from this table. */
type FoodBagDesign = Pick<FoodBagArtwork, 'mark' | 'category' | 'quantity'>;

const FOOD_BAG_DESIGNS: Readonly<Record<string, FoodBagDesign>> = {
  'Sports Nutrition': {
    mark: 'SN',
    category: 'Sports Nutrition',
    quantity: '1 kg',
  },
  'Baking & Pantry': {
    mark: 'BP',
    category: 'Baking & Pantry',
    quantity: '1 kg',
  },
  Drinks: {
    mark: 'DR',
    category: 'Drinks',
    quantity: '1 kg',
  },
};

function stableBatchSuffix(value: string): string {
  let hash = 0;
  for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash.toString(36).toUpperCase().padStart(6, '0').slice(-6);
}

/**
 * Supplies the list API's intentionally omitted food packaging fields from stable display-safe
 * product fields. Unknown categories and non-canonical ids stay unresolved so the generic fallback
 * remains visible; colours come from the deterministic per-category palette.
 */
export function resolveFoodBagArtwork(
  product: Pick<Product, 'id' | 'category' | 'name' | 'imageSetId'>,
): FoodBagArtwork | undefined {
  const design = FOOD_BAG_DESIGNS[product.category];
  if (!design) return undefined;
  const palette = resolveCatalogPackagingPalette(product);
  if (!palette) return undefined;

  return {
    ...design,
    accent: palette.ink,
    powderAccent: palette.pigment,
    schemeKey: palette.key,
    batchCode: `F-${stableBatchSuffix(`${product.category}:${product.name}:${product.imageSetId}`)}`,
  };
}

function genericArtworkDataUri(name: string, unavailableLabel: string): string {
  const label = name.replace(/[<&>]/g, '');
  const safeUnavailableLabel = unavailableLabel.replace(/[<&>]/g, '');
  return `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 720"><rect width="720" height="720" fill="#f3efe7"/><rect x="150" y="120" width="420" height="500" rx="24" fill="#e7e0d2" stroke="#333530" stroke-width="8"/><text x="360" y="350" text-anchor="middle" font-family="Arial,sans-serif" font-size="34" font-weight="700" fill="#292b29">${label}</text><text x="360" y="398" text-anchor="middle" font-family="Arial,sans-serif" font-size="20" fill="#69665e">${safeUnavailableLabel}</text></svg>`,
  )}`;
}

/**
 * Renders the packaging vessel appropriate to a product's catalog category. Products with
 * `product.packaging` on the wire keep the locked live bag (colours, mark and consumption badge
 * sourced from that field); every other product must resolve a catalog palette before a printed
 * vessel is drawn, so an unknown category or a non-canonical id falls back to the generic
 * "packaging unavailable" placeholder rather than printing an invented neutral scheme.
 */
export function ProductMedia({ product, className }: ProductMediaProps) {
  const { translate } = useLocalisation();
  const defaultVariant =
    'variants' in product
      ? product.variants.find((variant) => variant.variantId === product.defaultVariantId)
      : undefined;
  const spec = resolvePackagingSpec({ product, variant: defaultVariant });
  const palette = resolveCatalogPackagingPalette(product);

  if (product.packaging) {
    return (
      <PackagingArtwork
        name={product.name}
        // Legacy explicit packaging did not come from the palette registry, so the spec must not
        // advertise a scheme that did not produce the visible colours: the diagnostic key is
        // dropped and the pigment is the authored powder colour actually drawn (plan step 3.6).
        spec={{
          ...spec,
          vessel: 'food-bag',
          schemeKey: '',
          pigment: product.packaging.powderColor,
        }}
        mark={product.packaging.mark}
        quantity={product.packaging.quantity}
        batchCode={product.packaging.batchCode}
        accent={product.packaging.labelColor}
        powderAccent={product.packaging.powderColor}
        consumptionLabel={product.packaging.consumptionLabel}
        className={className}
      />
    );
  }

  // A heavy-duty vessel is only printed when a real catalog scheme backs it; without a palette the
  // spec carries the internal neutral placeholder, which must never reach a rendered sack or keg
  // (plan invariant 7).
  if (spec.vessel !== 'food-bag' && palette) {
    return (
      <PackagingArtwork
        name={product.name}
        spec={spec}
        mark=""
        consumptionLabel={null}
        className={className}
      />
    );
  }

  const foodArtwork = resolveFoodBagArtwork(product);
  if (foodArtwork) {
    return (
      <PackagingArtwork
        name={product.name}
        spec={spec}
        mark={foodArtwork.mark}
        quantity={foodArtwork.quantity}
        batchCode={foodArtwork.batchCode}
        // Colours come from the single rendered carrier (`spec`) so the food bag can never draw a
        // scheme other than the one its diagnostics advertise; `foodArtwork` supplies category
        // metadata and the palette-presence gate.
        accent={spec.ink.ink}
        powderAccent={spec.pigment}
        schemeKey={spec.schemeKey}
        consumptionLabel={null}
        className={className}
      />
    );
  }

  return (
    <img
      src={genericArtworkDataUri(
        product.name,
        translate(discoveryMessages, 'product.packagingUnavailable'),
      )}
      alt={product.name}
      width="720"
      height="720"
      className={className}
    />
  );
}
