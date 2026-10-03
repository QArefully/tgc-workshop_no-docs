import { Type, type Static } from '@sinclair/typebox';
import { TypeSystem } from '@sinclair/typebox/system';
import { MoneyCents, PositiveIntegerString } from './common.js';
import { CartLineConfigKey } from './customBlends.js';
import { Cart } from './cart.js';

const SafePositiveInteger = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });

/** Reorder request. The target cart receives every resolvable line of the source order. */
export const ReorderRequestBody = Type.Object(
  { cartId: Type.String({ minLength: 1 }) },
  { additionalProperties: false },
);
export type ReorderRequestBody = Static<typeof ReorderRequestBody>;

/** Why one source order line could not be re-added. Transport enum only; no domain logic here. */
export const ReorderSkipReason = Type.Union([
  /** Outranks every other skip reason and never discloses retirement or stock state. */
  Type.Literal('BLOCKED_IN_COUNTRY'),
  Type.Literal('VARIANT_RETIRED'),
  Type.Literal('VARIANT_UNRESOLVED'),
  Type.Literal('INSUFFICIENT_STOCK'),
  Type.Literal('BELOW_MOQ'),
  Type.Literal('INVALID_QUANTITY'),
  Type.Literal('BLEND_UNAVAILABLE'),
]);
export type ReorderSkipReason = Static<typeof ReorderSkipReason>;

export const ReorderLineStatus = Type.Union([Type.Literal('added'), Type.Literal('skipped')]);
export type ReorderLineStatus = Static<typeof ReorderLineStatus>;

const ReorderLineOutcomeFields = Type.Object(
  {
    /** Identifier of the source order line this outcome reports on. */
    orderLineItemId: PositiveIntegerString,
    productId: Type.String({ minLength: 1 }),
    productName: Type.String({ minLength: 1, maxLength: 160 }),
    /** Null when the original variant can no longer be resolved. */
    variantId: Type.Union([SafePositiveInteger, Type.Null()]),
    sku: Type.Union([Type.String({ minLength: 1, maxLength: 64 }), Type.Null()]),
    configKey: CartLineConfigKey,
    quantity: SafePositiveInteger,
    status: ReorderLineStatus,
    reason: Type.Union([ReorderSkipReason, Type.Null()]),
    /** Unit price frozen on the source order line. */
    orderedUnitPriceCents: MoneyCents,
    /** Current server-resolved unit price, or null when no current price exists. */
    currentUnitPriceCents: Type.Union([MoneyCents, Type.Null()]),
    priceChanged: Type.Boolean(),
  },
  { additionalProperties: false },
);

/**
 * Status and reason are a single fact, so the pairing is enforced by the schema rather than by
 * convention: an added line never carries a reason, a skipped line always does.
 */
const ReorderOutcomeStatusPair = TypeSystem.Type<unknown>(
  'ReorderOutcomeStatusPair',
  (_options, value) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const outcome = value as { status?: unknown; reason?: unknown };
    if (outcome.status === 'added') return outcome.reason === null;
    if (outcome.status === 'skipped')
      return typeof outcome.reason === 'string' && outcome.reason.length > 0;
    return false;
  },
);

/** One source order line's fate. `status='added'` -> `reason=null`; `'skipped'` -> reason set. */
export const ReorderLineOutcome = Type.Intersect([
  ReorderLineOutcomeFields,
  ReorderOutcomeStatusPair(),
]);
export type ReorderLineOutcome = Static<typeof ReorderLineOutcome>;

export const ReorderResponse = Type.Object(
  {
    cart: Cart,
    addedLineCount: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    skippedLineCount: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    outcomes: Type.Array(ReorderLineOutcome),
  },
  { additionalProperties: false },
);
export type ReorderResponse = Static<typeof ReorderResponse>;
