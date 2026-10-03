import { Type, type Static } from '@sinclair/typebox';
import { TypeSystem } from '@sinclair/typebox/system';
import { Cart } from './cart.js';
import { MoneyCents } from './common.js';

const SafePositiveInteger = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
const SafeNonNegativeInteger = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });

/** Quick Order responses close the otherwise extensible cart transport shape. */
const QuickOrderCart = Type.Object(Cart.properties, { additionalProperties: false });

/** Raw buyer-entered Quick Order lines. Parsing and SKU normalization remain server-owned. */
export const QuickOrderRequestBody = Type.Object(
  {
    text: Type.String({ minLength: 1, maxLength: 20_000 }),
  },
  { additionalProperties: false },
);
export type QuickOrderRequestBody = Static<typeof QuickOrderRequestBody>;

/** Why an input Quick Order line was skipped. */
export const QuickOrderSkipReason = Type.Union([
  /** Outranks every other skip reason and never discloses retirement or stock state. */
  Type.Literal('BLOCKED_IN_COUNTRY'),
  Type.Literal('MALFORMED_LINE'),
  Type.Literal('SKU_NOT_FOUND'),
  Type.Literal('INVALID_QUANTITY'),
  Type.Literal('VARIANT_RETIRED'),
  Type.Literal('INSUFFICIENT_STOCK'),
  Type.Literal('BELOW_MOQ'),
  /** Structurally present for the shared skip vocabulary; Quick Order never produces it. */
  Type.Literal('BLEND_UNAVAILABLE'),
]);
export type QuickOrderSkipReason = Static<typeof QuickOrderSkipReason>;

export const QuickOrderLineStatus = Type.Union([Type.Literal('added'), Type.Literal('skipped')]);
export type QuickOrderLineStatus = Static<typeof QuickOrderLineStatus>;

const QuickOrderLineOutcomeFields = Type.Object(
  {
    /** One-based physical source line number. */
    lineNumber: SafePositiveInteger,
    /** Original source text for this reported line. */
    rawLine: Type.String({ maxLength: 200 }),
    sku: Type.Union([Type.String({ minLength: 1, maxLength: 64 }), Type.Null()]),
    requestedQuantity: Type.Union([SafePositiveInteger, Type.Null()]),
    submittedQuantity: Type.Union([SafePositiveInteger, Type.Null()]),
    moqAdjusted: Type.Boolean(),
    duplicateSku: Type.Boolean(),
    variantId: Type.Union([SafePositiveInteger, Type.Null()]),
    productId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    productName: Type.Union([Type.String({ minLength: 1, maxLength: 160 }), Type.Null()]),
    resolvedUnitPriceCents: Type.Union([MoneyCents, Type.Null()]),
    status: QuickOrderLineStatus,
    reason: Type.Union([QuickOrderSkipReason, Type.Null()]),
  },
  { additionalProperties: false },
);

/** Status and reason form one fact: added lines have no reason; skipped lines always have one. */
const QuickOrderOutcomeStatusPair = TypeSystem.Type<unknown>(
  'QuickOrderOutcomeStatusPair',
  (_options, value) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const outcome = value as { status?: unknown; reason?: unknown };
    if (outcome.status === 'added') return outcome.reason === null;
    if (outcome.status === 'skipped')
      return typeof outcome.reason === 'string' && outcome.reason.length > 0;
    return false;
  },
);

/** One pasted Quick Order line's final result. */
export const QuickOrderLineOutcome = Type.Intersect([
  QuickOrderLineOutcomeFields,
  QuickOrderOutcomeStatusPair(),
]);
export type QuickOrderLineOutcome = Static<typeof QuickOrderLineOutcome>;

export const QuickOrderResponse = Type.Object(
  {
    cart: QuickOrderCart,
    addedLineCount: SafeNonNegativeInteger,
    skippedLineCount: SafeNonNegativeInteger,
    outcomes: Type.Array(QuickOrderLineOutcome),
  },
  { additionalProperties: false },
);
export type QuickOrderResponse = Static<typeof QuickOrderResponse>;
