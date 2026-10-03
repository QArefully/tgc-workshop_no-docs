import type { Cart } from '@shop/contracts/cart';
import type { CuratedBundle } from '@shop/contracts/bundles';
import type { Country } from '@shop/contracts/country';
import { toProductContract } from '../../mappers/product.js';
import type { UnitOfWork } from '../../db/unitOfWork.js';
import { getCart } from '../cart/cartService.js';
import type { CartRepository } from '../cart/cartRepository.js';
import type { InventoryService } from '../inventory/inventoryService.js';
import type { AuditContext } from '../audit/auditEvent.js';
import type { AuditWriter } from '../audit/auditService.js';
import type { BundleComponentRow, BundleRepository, BundleRow } from './bundleRepository.js';
import type { ProductRow, VariantRow } from '../catalog/productRepository.js';
import type { CountryProfileService } from '../countryProfile/countryProfileService.js';

export interface BundleServiceDependencies {
  bundles: BundleRepository;
  carts: CartRepository;
  unitOfWork: UnitOfWork;
  audit: AuditWriter;
  availability?: BundleAvailabilityDependencies;
  countryProfiles?: Pick<CountryProfileService, 'isCategoryBlocked' | 'isProductBlocked'>;
}

export interface BundleAvailabilityDependencies {
  inventory: Pick<InventoryService, 'availableToSell'>;
  clock: { now(): Date };
}

export type BundleUnavailable = {
  error: 'BUNDLE_UNAVAILABLE';
  variantIds: string[];
};

export type BundleMutationResult =
  Cart | 'CART_NOT_FOUND' | 'CART_RESERVED' | 'BUNDLE_NOT_FOUND' | BundleUnavailable;

export interface BundleService {
  list(productId?: string, country?: Country): CuratedBundle[];
  addToCart(cartId: string, bundleId: string, context?: AuditContext): BundleMutationResult;
}

type ProductCountryAvailability = (product: ProductRow) => boolean;

function isVisible(
  bundle: BundleRow,
  isAvailableInCountry: ProductCountryAvailability = () => true,
): boolean {
  return (
    bundle.active === 1 &&
    bundle.components.length >= 2 &&
    bundle.components.every(
      (component) => component.product?.active === 1 && isAvailableInCountry(component.product),
    )
  );
}

function variantToDetail(variant: VariantRow) {
  return {
    variantId: variant.id,
    sku: variant.sku,
    label: variant.label,
    weightGrams: variant.weight_grams,
    priceCents: variant.price_cents,
  };
}

/** Current persisted prices remain source of truth; no bundle price is stored. */
export function toCuratedBundle(
  bundle: BundleRow,
  variantMap: Map<number, VariantRow>,
  isAvailableInCountry: ProductCountryAvailability = () => true,
): CuratedBundle {
  if (!isVisible(bundle, isAvailableInCountry)) {
    throw new Error('Cannot map a hidden curated bundle');
  }
  const components = bundle.components.map((component) => {
    if (!component.product) throw new Error('Curated bundle component product is missing');
    const variant = component.variantId != null ? variantMap.get(component.variantId) : undefined;
    const priceCents = variant?.price_cents ?? component.product.price_cents;
    return {
      product: toProductContract(component.product),
      ...(component.variantId != null ? { variantId: component.variantId } : {}),
      ...(variant ? { variantDetail: variantToDetail(variant) } : {}),
      quantity: component.quantity,
      lineTotalCents: priceCents * component.quantity,
    };
  });
  return {
    id: String(bundle.id),
    key: bundle.key,
    name: bundle.name,
    description: bundle.description,
    components,
    totalCents: components.reduce((total, component) => total + component.lineTotalCents, 0),
    available: components.every((component) => component.product.available),
  };
}

function withAvailableToSell(
  bundles: readonly BundleRow[],
  availability: BundleAvailabilityDependencies | undefined,
): BundleRow[] {
  if (!availability) return [...bundles];
  const variantIds = [
    ...new Set(
      bundles.flatMap((bundle) =>
        bundle.components.filter((c) => c.variantId != null).map((c) => c.variantId!),
      ),
    ),
  ];
  const availabilityByVariant = new Map(
    variantIds.length > 0
      ? availability.inventory
          .availableToSell(variantIds, availability.clock.now().toISOString())
          .map((v) => [v.variantId, v])
      : [],
  );
  return bundles.map((bundle) => ({
    ...bundle,
    components: bundle.components.map((component) => {
      const avail =
        component.variantId != null ? availabilityByVariant.get(component.variantId) : undefined;
      return {
        ...component,
        product: component.product
          ? {
              ...component.product,
              available_to_sell: avail?.availableToSell ?? component.product.stock_count,
              backorderable: avail?.backorderable ? 1 : 0,
              backorder_lead_days: avail?.backorderLeadDays ?? null,
            }
          : undefined,
      };
    }),
  }));
}

export function collectUnavailableComponentVariantIds(
  cartId: string,
  components: readonly BundleComponentRow[],
  carts: CartRepository,
  isAvailableInCountry: ProductCountryAvailability = () => true,
): string[] {
  const unavailable = new Set<string>();
  for (const component of components) {
    if (component.variantId == null) {
      unavailable.add(String(component.productId));
      continue;
    }
    const variant = carts.getVariant(component.variantId);
    const availableToSell = component.product?.available_to_sell ?? variant?.stock_count ?? 0;
    const isBackorderable = variant?.backorderable === 1;
    if (
      !variant ||
      variant.active !== 1 ||
      !component.product ||
      component.product.active !== 1 ||
      !isAvailableInCountry(component.product) ||
      !Number.isSafeInteger(component.quantity) ||
      component.quantity <= 0 ||
      (availableToSell <
        carts.lineQuantity(cartId, String(component.variantId)) + component.quantity &&
        !isBackorderable)
    ) {
      unavailable.add(String(component.variantId));
    }
  }
  return [...unavailable].sort((left, right) => Number(left) - Number(right));
}

function requireAuditContext(context: AuditContext | undefined): asserts context is AuditContext {
  if (!context) throw new Error('Bundle audit context is required');
}

function assertPersistedShape(bundle: BundleRow): void {
  if (bundle.components.length < 2) {
    throw new Error('Curated bundle integrity error: expected at least two components');
  }
  const variantIds = new Set<number>();
  for (const component of bundle.components) {
    if (
      !component.product ||
      !Number.isSafeInteger(component.quantity) ||
      component.quantity <= 0
    ) {
      throw new Error('Curated bundle integrity error: invalid component');
    }
    if (component.variantId == null) {
      throw new Error('Curated bundle integrity error: component missing variant');
    }
    if (variantIds.has(component.variantId)) {
      throw new Error('Curated bundle integrity error: duplicate variant');
    }
    variantIds.add(component.variantId);
  }
}

/** Coordinates all-or-nothing ordinary cart-line mutations for fixed curated bundles. */
export function createBundleService(dependencies: BundleServiceDependencies): BundleService {
  const countryAvailability = (country?: Country): ProductCountryAvailability => {
    if (!country || !dependencies.countryProfiles) return () => true;
    return (product) =>
      !dependencies.countryProfiles!.isCategoryBlocked(country, product.category) &&
      !dependencies.countryProfiles!.isProductBlocked(country, product.slug);
  };

  return {
    list(productId, country) {
      const isAvailableInCountry = countryAvailability(country);
      const bundles = withAvailableToSell(
        dependencies.bundles.list(productId),
        dependencies.availability,
      );
      const variantIds = [
        ...new Set(
          bundles.flatMap((b) =>
            b.components.filter((c) => c.variantId != null).map((c) => c.variantId!),
          ),
        ),
      ];
      const variantMap = new Map<number, VariantRow>();
      for (const vId of variantIds) {
        const variant = dependencies.carts.getVariant(vId);
        if (variant) variantMap.set(vId, variant);
      }
      return bundles
        .filter((bundle) => isVisible(bundle, isAvailableInCountry))
        .map((bundle) => toCuratedBundle(bundle, variantMap, isAvailableInCountry));
    },
    addToCart(cartId, bundleId, context) {
      requireAuditContext(context);
      return dependencies.unitOfWork.run(() => {
        if (!dependencies.carts.exists(cartId)) return 'CART_NOT_FOUND';
        const isAvailableInCountry = countryAvailability(dependencies.carts.country(cartId));
        if (
          dependencies.carts.isReserved(
            cartId,
            dependencies.availability?.clock.now().toISOString(),
          )
        ) {
          return 'CART_RESERVED';
        }

        const storedBundle = dependencies.bundles.findById(bundleId);
        const bundle = withAvailableToSell(
          storedBundle ? [storedBundle] : [],
          dependencies.availability,
        )[0];
        if (!bundle || bundle.active !== 1) return 'BUNDLE_NOT_FOUND';
        assertPersistedShape(bundle);

        const unavailable = collectUnavailableComponentVariantIds(
          cartId,
          bundle.components,
          dependencies.carts,
          isAvailableInCountry,
        );
        if (unavailable.length > 0) return { error: 'BUNDLE_UNAVAILABLE', variantIds: unavailable };

        for (const component of bundle.components) {
          if (component.variantId == null) {
            throw new Error('Curated bundle integrity error: component missing variant');
          }
          dependencies.carts.addLineQuantity(
            cartId,
            String(component.variantId),
            component.quantity,
          );
        }
        dependencies.carts.touch(cartId);
        dependencies.audit.append({
          action: 'cart.bundle_added',
          cartId,
          bundleId: bundle.id,
          componentCount: bundle.components.length,
          quantity: bundle.components.reduce((total, component) => total + component.quantity, 0),
          context,
        });
        return getCart(dependencies.carts, cartId, dependencies.availability) ?? 'CART_NOT_FOUND';
      });
    },
  };
}
