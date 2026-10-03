import type { Cart } from '@shop/contracts/cart';
import type { Country } from '@shop/contracts/country';
import type { CartRepository } from '../cart/cartRepository.js';
import { getCart } from '../cart/cartService.js';
import type { Clock } from '../auth/authService.js';
import type { PromoRecord, PromoRepository } from './promoRepository.js';

export type PromoValidationError =
  | 'EXPIRED'
  | 'NOT_STARTED'
  | 'MIN_ITEMS'
  | 'MIN_SUBTOTAL'
  | 'USAGE_LIMIT'
  | 'AUTH_REQUIRED'
  | 'CATEGORY_MISMATCH'
  | 'INVALID';

export interface ValidPromo {
  code: string;
  discountPercent: number;
  minItemCount: number;
  kind: 'percent' | 'fixed';
  amountCents?: number;
  minSubtotalCents?: number;
  categoryScope?: string;
}

export type PromoValidation =
  | { valid: true; promoCode: ValidPromo }
  | {
      valid: false;
      error: string;
      errorCode: PromoValidationError;
      /** Canonical GBP pence threshold for the MIN_SUBTOTAL gate. */
      minSubtotalCents?: number;
    };

export interface PromoService {
  validate(params: {
    code: string;
    cartId: string;
    userId: number | null;
    country?: Country;
  }): PromoValidation;
}

export function createPromoService(dependencies: {
  promos: PromoRepository;
  carts: CartRepository;
  clock: Clock;
}): PromoService {
  return {
    validate: (params) => validatePromo({ ...params, now: dependencies.clock.now() }, dependencies),
  };
}

function invalid(
  error: string,
  errorCode: PromoValidationError,
  metadata?: Pick<Extract<PromoValidation, { valid: false }>, 'minSubtotalCents'>,
): PromoValidation {
  return { valid: false, error, errorCode, ...metadata };
}

function asValidPromo(promo: PromoRecord): ValidPromo {
  return {
    code: promo.code,
    discountPercent: promo.discountPercent,
    minItemCount: promo.minItemCount,
    kind: promo.kind,
    amountCents: promo.amountCents ?? undefined,
    minSubtotalCents: promo.minSubtotalCents ?? undefined,
    ...(promo.categoryScope ? { categoryScope: promo.categoryScope } : {}),
  };
}

export interface ResolvedPromoScope {
  qualifyingItemCount: number;
  discountBaseCents: number;
}

/**
 * An unscoped promo deliberately reads the cart totals rather than recomputing them, preserving
 * legacy promotion behavior exactly. Scoped promos count and discount only matching merchandise;
 * each line's discountable total already excludes any Custom Blend service fee.
 */
export function resolvePromoScope(params: {
  promo: Pick<ValidPromo, 'categoryScope'>;
  cart: Pick<Cart, 'items' | 'totalItems' | 'discountableSubtotalCents'>;
}): ResolvedPromoScope {
  const categoryScope = params.promo.categoryScope?.trim();
  if (!categoryScope) {
    return {
      qualifyingItemCount: params.cart.totalItems,
      discountBaseCents: params.cart.discountableSubtotalCents,
    };
  }

  const normalizedScope = categoryScope.toLowerCase();
  return params.cart.items.reduce(
    (resolved, item) => {
      if (item.product.category.toLowerCase() !== normalizedScope) return resolved;
      return {
        qualifyingItemCount: resolved.qualifyingItemCount + item.quantity,
        discountBaseCents: resolved.discountBaseCents + item.discountableTotalCents,
      };
    },
    { qualifyingItemCount: 0, discountBaseCents: 0 },
  );
}

export function validatePromo(
  params: {
    code: string;
    cartId: string;
    userId: number | null;
    country?: Country;
    now: Date;
  },
  dependencies: {
    promos: PromoRepository;
    carts: CartRepository;
  },
): PromoValidation {
  const promo = dependencies.promos.findByCode(params.code);
  if (!promo || !promo.active) return invalid('Promo code not found or inactive', 'INVALID');
  const cartCountry = dependencies.carts.country(params.cartId);
  const targetedCountries = dependencies.promos.targetedCountries(promo.code);
  if (targetedCountries.length > 0 && (!cartCountry || !targetedCountries.includes(cartCountry)))
    return invalid('Promo code not found or inactive', 'INVALID');
  const { now } = params;
  if (promo.startAt && now < new Date(promo.startAt))
    return invalid('This promo code is not yet active', 'NOT_STARTED');
  if (promo.endAt && now >= new Date(promo.endAt))
    return invalid('This promo code has expired', 'EXPIRED');
  if (promo.perUserLimit !== null && params.userId === null)
    return invalid('You must be logged in to use this promo code', 'AUTH_REQUIRED');
  if (
    promo.perUserLimit !== null &&
    params.userId !== null &&
    dependencies.promos.redemptionCountForUser(promo.code, params.userId) +
      dependencies.promos.activeReservationCountForUser(promo.code, params.userId) >=
      promo.perUserLimit
  ) {
    return invalid('You have already used this promo code', 'USAGE_LIMIT');
  }
  if (
    promo.maxRedemptions !== null &&
    promo.redemptionCount + dependencies.promos.activeReservationCount(promo.code) >=
      promo.maxRedemptions
  )
    return invalid('This promo code has reached its usage limit', 'USAGE_LIMIT');
  const cart = getCart(dependencies.carts, params.cartId);
  if (!cart) return invalid('Cart not found', 'INVALID');
  const validPromo = asValidPromo(promo);
  const scope = resolvePromoScope({ promo: validPromo, cart });
  if (validPromo.categoryScope && scope.qualifyingItemCount === 0)
    return invalid(
      `This promo code applies only to ${validPromo.categoryScope} products`,
      'CATEGORY_MISMATCH',
    );
  if (scope.qualifyingItemCount < promo.minItemCount)
    return invalid(
      `Minimum ${promo.minItemCount} items required (have ${scope.qualifyingItemCount})`,
      'MIN_ITEMS',
    );
  // Eligibility and discount both read the discountable subtotal: Custom Blend blending fees are
  // a service charge, never merchandise, so they can neither unlock nor be reduced by a promotion.
  if (promo.minSubtotalCents !== null && scope.discountBaseCents < promo.minSubtotalCents)
    return invalid('Minimum qualifying subtotal required', 'MIN_SUBTOTAL', {
      minSubtotalCents: promo.minSubtotalCents,
    });
  return { valid: true, promoCode: validPromo };
}

/**
 * Discount is computed against the discountable subtotal only, so a fixed-amount promo can never
 * consume blending fees and a percentage promo never applies to them.
 */
export function calculateDiscount(params: {
  promo: Pick<ValidPromo, 'kind' | 'discountPercent' | 'amountCents'>;
  discountableSubtotalCents: number;
}): number {
  return params.promo.kind === 'fixed'
    ? Math.min(params.promo.amountCents ?? 0, params.discountableSubtotalCents)
    : Math.floor((params.discountableSubtotalCents * params.promo.discountPercent) / 100);
}
