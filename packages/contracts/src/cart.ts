import { Type, type Static } from '@sinclair/typebox';
import { TypeSystem } from '@sinclair/typebox/system';
import { MoneyCents, Uuid } from './common.js';
import { Product } from './products.js';
import { DeliveryClass, DeliverySummary } from './delivery.js';
import {
  CartLineConfigKey,
  CustomBlendSnapshot,
  ResolvedCustomBlendSnapshot,
} from './customBlends.js';
import { ClearanceWindow, NextTierProgress } from './pricing.js';
import { Country } from './country.js';

const SafePositiveInteger = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
const SafeNonNegativeInteger = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function safeProduct(left: unknown, right: unknown): number | undefined {
  if (!isSafeNonNegativeInteger(left) || !isSafeNonNegativeInteger(right)) return undefined;
  if (right > 0 && left > Math.floor(Number.MAX_SAFE_INTEGER / right)) return undefined;
  const result = left * right;
  return Number.isSafeInteger(result) ? result : undefined;
}

function safeSum(values: readonly unknown[]): number | undefined {
  let total = 0;
  for (const value of values) {
    if (!isSafeNonNegativeInteger(value) || value > Number.MAX_SAFE_INTEGER - total)
      return undefined;
    total += value;
  }
  return total;
}

export const CartLineVariantSnap = Type.Object(
  {
    variantId: Type.Integer({ minimum: 1 }),
    sku: Type.String({ minLength: 1, maxLength: 64 }),
    label: Type.String({ minLength: 1, maxLength: 160 }),
    weightGrams: Type.Integer({ minimum: 1 }),
    deliveryClass: DeliveryClass,
  },
  { additionalProperties: false },
);
export type CartLineVariantSnap = Static<typeof CartLineVariantSnap>;

const CartLineFields = Type.Object(
  {
    productId: Type.String({ minLength: 1 }),
    configKey: CartLineConfigKey,
    product: Product,
    variantSnap: Type.Optional(CartLineVariantSnap),
    /** Informational base price per tonne, resolved by the server for this variant. */
    perTonneCents: MoneyCents,
    /** Current server-resolved pack price after the line quantity's tier discount. */
    resolvedUnitPriceCents: MoneyCents,
    /** Omitted when this line already qualifies for the top tier. */
    nextTierProgress: Type.Optional(NextTierProgress),
    clearance: Type.Optional(ClearanceWindow),
    quantity: SafePositiveInteger,
    materialSubtotalCents: MoneyCents,
    blendingFeeCents: MoneyCents,
    discountableTotalCents: MoneyCents,
    lineTotalCents: MoneyCents,
    customBlend: Type.Optional(CustomBlendSnapshot),
  },
  { additionalProperties: false },
);

const CartLineConfigPair = TypeSystem.Type<unknown>('CartLineConfigPair', (_options, value) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const line = value as { configKey?: unknown; customBlend?: { configKey?: unknown } };
  if (line.configKey === '') return line.customBlend === undefined;
  return (
    typeof line.configKey === 'string' &&
    typeof line.customBlend === 'object' &&
    line.customBlend !== null &&
    line.customBlend.configKey === line.configKey
  );
});

/**
 * Cart monetary fields are one invariant, not four unrelated numbers. The server computes the
 * material amount from its resolved unit price and quantity; a resolved blend additionally has a
 * quantity-specific snapshot whose totals must agree with the line. Legacy snapshots intentionally
 * skip the outcome comparison so historic carts remain readable during the V8/V9 transition.
 */
const CartLineMoneyIntegrity = TypeSystem.Type<unknown>(
  'CartLineMoneyIntegrity',
  (_options, value) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const line = value as {
      configKey?: unknown;
      customBlend?: unknown;
      quantity?: unknown;
      resolvedUnitPriceCents?: unknown;
      materialSubtotalCents?: unknown;
      blendingFeeCents?: unknown;
      discountableTotalCents?: unknown;
      lineTotalCents?: unknown;
      nextTierProgress?: unknown;
    };
    // Keep the historical plain-line pairing exactly as it was: the contract identifies a plain
    // line by its empty config key and absent snapshot. Ordinary-line money remains a collection of
    // safe pence fields; its arithmetic is owned by the server's ordinary pricing path.
    if (line.configKey === '') return line.customBlend === undefined;
    if (typeof line.customBlend !== 'object' || line.customBlend === null) return false;

    const blend = line.customBlend as Partial<Static<typeof ResolvedCustomBlendSnapshot>> & {
      ruleVersion?: unknown;
    };
    // A current configured line must carry the quantity-specific resolved outcome. The legacy
    // specification remains valid for historic orders/quotes, but is not sufficient for a current
    // cart because it contains no authoritative component price or total.
    if (blend.ruleVersion !== 1) return false;
    return (
      safeProduct(line.resolvedUnitPriceCents, line.quantity) === line.materialSubtotalCents &&
      line.materialSubtotalCents === line.discountableTotalCents &&
      safeSum([line.materialSubtotalCents, line.blendingFeeCents]) === line.lineTotalCents &&
      blend.quantity === line.quantity &&
      blend.materialUnitPriceCents === line.resolvedUnitPriceCents &&
      blend.materialSubtotalCents === line.materialSubtotalCents &&
      blend.discountableTotalCents === line.discountableTotalCents &&
      blend.lineTotalCents === line.lineTotalCents &&
      blend.blendingFeeCents === line.blendingFeeCents &&
      line.nextTierProgress === undefined
    );
  },
);

/** Plain lines use an empty config key; configured lines carry the matching specification key. */
export const CartLine = Type.Intersect([
  CartLineFields,
  CartLineConfigPair(),
  CartLineMoneyIntegrity(),
]);
export type CartLine = Static<typeof CartLine>;

export const Cart = Type.Object(
  {
    id: Uuid,
    items: Type.Array(CartLine),
    subtotalCents: MoneyCents,
    discountableSubtotalCents: MoneyCents,
    blendingFeeTotalCents: MoneyCents,
    totalItems: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    deliveryPreview: Type.Optional(DeliverySummary),
  },
  { additionalProperties: false },
);
export type Cart = Static<typeof Cart>;

export const AddToCartBody = Type.Object(
  {
    productId: Type.String({ minLength: 1 }),
    variantId: Type.Optional(Type.Integer({ minimum: 1 })),
    quantity: Type.Optional(SafePositiveInteger),
  },
  { additionalProperties: false },
);
export type AddToCartBody = Static<typeof AddToCartBody>;

export const BelowMoqError = Type.Object(
  {
    code: Type.Literal('BELOW_MOQ'),
    error: Type.String({ minLength: 1, maxLength: 500 }),
  },
  { additionalProperties: false },
);
export type BelowMoqError = Static<typeof BelowMoqError>;

export const UpdateCartLineBody = Type.Object(
  {
    productId: Type.String({ minLength: 1 }),
    variantId: Type.Optional(SafePositiveInteger),
    configKey: Type.Optional(CartLineConfigKey),
    quantity: SafeNonNegativeInteger,
  },
  { additionalProperties: false },
);
export type UpdateCartLineBody = Static<typeof UpdateCartLineBody>;

export const RemoveFromCartBody = Type.Object(
  {
    productId: Type.String({ minLength: 1 }),
    variantId: Type.Optional(SafePositiveInteger),
    configKey: Type.Optional(CartLineConfigKey),
  },
  { additionalProperties: false },
);
export type RemoveFromCartBody = Static<typeof RemoveFromCartBody>;

export const CreateCartResponse = Type.Object({ cartId: Uuid });
export type CreateCartResponse = Static<typeof CreateCartResponse>;

export const CreateCartBody = Type.Object(
  { country: Type.Optional(Country) },
  { additionalProperties: false },
);
export type CreateCartBody = Static<typeof CreateCartBody>;

export const CartIdParam = Type.Object({ cartId: Uuid });
export const CartIdAndProductIdParam = Type.Object({
  cartId: Uuid,
  productId: Type.String({ minLength: 1 }),
});
