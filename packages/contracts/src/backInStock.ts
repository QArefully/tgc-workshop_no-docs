import { Type, type Static } from '@sinclair/typebox';
import { PositiveIntegerString } from './common.js';

const SafePositiveInteger = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
const UtcIsoInstant = Type.String({
  minLength: 24,
  maxLength: 24,
  pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$',
});

/**
 * Lifecycle of one buyer's back-in-stock interest in a variant.
 * `notified` is terminal for a given subscription; a buyer re-subscribes to be told again.
 */
export const BackInStockStatus = Type.Union([
  Type.Literal('pending'),
  Type.Literal('notified'),
  Type.Literal('cancelled'),
]);
export type BackInStockStatus = Static<typeof BackInStockStatus>;

/** One buyer subscription plus the catalog facts needed to render it without a second fetch. */
export const BackInStockSubscription = Type.Object(
  {
    subscriptionId: PositiveIntegerString,
    variantId: SafePositiveInteger,
    productId: Type.String({ minLength: 1 }),
    sku: Type.String({ minLength: 1, maxLength: 64 }),
    productName: Type.String({ minLength: 1, maxLength: 160 }),
    variantLabel: Type.String({ minLength: 1, maxLength: 160 }),
    status: BackInStockStatus,
    requestedAt: UtcIsoInstant,
    notifiedAt: Type.Union([UtcIsoInstant, Type.Null()]),
    minimumOrderQuantity: SafePositiveInteger,
  },
  { additionalProperties: false },
);
export type BackInStockSubscription = Static<typeof BackInStockSubscription>;

export const CreateBackInStockSubscriptionBody = Type.Object(
  { variantId: SafePositiveInteger },
  { additionalProperties: false },
);
export type CreateBackInStockSubscriptionBody = Static<typeof CreateBackInStockSubscriptionBody>;

export const BackInStockSubscriptionListResponse = Type.Array(BackInStockSubscription);
export type BackInStockSubscriptionListResponse = Static<
  typeof BackInStockSubscriptionListResponse
>;

export const BackInStockSubscriptionIdParam = Type.Object(
  { subscriptionId: PositiveIntegerString },
  { additionalProperties: false },
);
export type BackInStockSubscriptionIdParam = Static<typeof BackInStockSubscriptionIdParam>;
