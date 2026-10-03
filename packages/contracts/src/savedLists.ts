import { Type, type Static } from '@sinclair/typebox';
import { Cart } from './cart.js';
import { MoneyCents, PositiveIntegerString, REQUIRED_PLAIN_TEXT_PATTERN, Uuid } from './common.js';

const SafePositiveInteger = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
const SafeNonNegativeInteger = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const UtcIsoInstant = Type.String({
  minLength: 24,
  maxLength: 24,
  pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$',
});

/** Saved-list names match the persisted `saved_lists.name` length constraint. */
const SavedListName = Type.String({
  minLength: 1,
  maxLength: 80,
  pattern: REQUIRED_PLAIN_TEXT_PATTERN,
});

/** Saved-list add responses close the otherwise extensible cart transport shape. */
const SavedListCart = Type.Object(Cart.properties, { additionalProperties: false });

/** List metadata used in list views and as the basis of a saved-list detail. */
export const SavedListSummary = Type.Object(
  {
    listId: PositiveIntegerString,
    name: SavedListName,
    isDefault: Type.Boolean(),
    itemCount: SafeNonNegativeInteger,
    createdAt: UtcIsoInstant,
    updatedAt: UtcIsoInstant,
  },
  { additionalProperties: false },
);
export type SavedListSummary = Static<typeof SavedListSummary>;

/** Current catalog facts resolved for one saved variant. */
export const SavedListItem = Type.Object(
  {
    itemId: PositiveIntegerString,
    variantId: SafePositiveInteger,
    sku: Type.String({ minLength: 1, maxLength: 64 }),
    label: Type.String({ minLength: 1, maxLength: 160 }),
    productId: Type.String({ minLength: 1 }),
    productName: Type.String({ minLength: 1, maxLength: 160 }),
    quantity: SafePositiveInteger,
    weightGrams: SafePositiveInteger,
    moqSacks: SafePositiveInteger,
    unitPriceCents: Type.Union([MoneyCents, Type.Null()]),
    perTonneCents: Type.Union([MoneyCents, Type.Null()]),
    availableToSell: Type.Boolean(),
    backorderable: Type.Boolean(),
    active: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type SavedListItem = Static<typeof SavedListItem>;

export const SavedListDetail = Type.Object(
  {
    ...SavedListSummary.properties,
    items: Type.Array(SavedListItem),
  },
  { additionalProperties: false },
);
export type SavedListDetail = Static<typeof SavedListDetail>;

export const SavedListsResponse = Type.Array(SavedListSummary);
export type SavedListsResponse = Static<typeof SavedListsResponse>;

export const CreateSavedListBody = Type.Object(
  { name: SavedListName },
  { additionalProperties: false },
);
export type CreateSavedListBody = Static<typeof CreateSavedListBody>;

export const RenameSavedListBody = Type.Object(
  { name: SavedListName },
  { additionalProperties: false },
);
export type RenameSavedListBody = Static<typeof RenameSavedListBody>;

export const AddSavedListItemBody = Type.Object(
  { variantId: SafePositiveInteger, quantity: SafePositiveInteger },
  { additionalProperties: false },
);
export type AddSavedListItemBody = Static<typeof AddSavedListItemBody>;

export const UpdateSavedListItemBody = Type.Object(
  { quantity: SafePositiveInteger },
  { additionalProperties: false },
);
export type UpdateSavedListItemBody = Static<typeof UpdateSavedListItemBody>;

export const AddSavedListToCartBody = Type.Object(
  { cartId: Uuid },
  { additionalProperties: false },
);
export type AddSavedListToCartBody = Static<typeof AddSavedListToCartBody>;

export const SaveCartAsListBody = Type.Object(
  { name: SavedListName, cartId: Uuid },
  { additionalProperties: false },
);
export type SaveCartAsListBody = Static<typeof SaveCartAsListBody>;

export const SaveOrderAsListBody = Type.Object(
  { name: SavedListName },
  { additionalProperties: false },
);
export type SaveOrderAsListBody = Static<typeof SaveOrderAsListBody>;

export const SavedListIdParam = Type.Object(
  { listId: PositiveIntegerString },
  { additionalProperties: false },
);
export type SavedListIdParam = Static<typeof SavedListIdParam>;

export const SavedListItemIdParam = Type.Object(
  { listId: PositiveIntegerString, itemId: PositiveIntegerString },
  { additionalProperties: false },
);
export type SavedListItemIdParam = Static<typeof SavedListItemIdParam>;

/** Why a saved list item could not be added to the target cart. */
export const SavedListSkipReason = Type.Union([
  /** Outranks every other skip reason and never discloses retirement or stock state. */
  Type.Literal('BLOCKED_IN_COUNTRY'),
  Type.Literal('VARIANT_RETIRED'),
  Type.Literal('VARIANT_UNRESOLVED'),
  Type.Literal('INSUFFICIENT_STOCK'),
  Type.Literal('BELOW_MOQ'),
  Type.Literal('INVALID_QUANTITY'),
  /** Structurally present for the shared skip vocabulary; saved lists never produce it. */
  Type.Literal('BLEND_UNAVAILABLE'),
]);
export type SavedListSkipReason = Static<typeof SavedListSkipReason>;

export const SavedListLineStatus = Type.Union([Type.Literal('added'), Type.Literal('skipped')]);
export type SavedListLineStatus = Static<typeof SavedListLineStatus>;

const SavedListLineOutcomeFields = {
  itemId: PositiveIntegerString,
  variantId: SafePositiveInteger,
  sku: Type.String({ minLength: 1, maxLength: 64 }),
  productId: Type.String({ minLength: 1 }),
  productName: Type.String({ minLength: 1, maxLength: 160 }),
  savedQuantity: SafePositiveInteger,
  submittedQuantity: Type.Union([SafePositiveInteger, Type.Null()]),
  moqAdjusted: Type.Boolean(),
  resolvedUnitPriceCents: Type.Union([MoneyCents, Type.Null()]),
};

const SavedListLineAdded = Type.Object(
  {
    ...SavedListLineOutcomeFields,
    status: Type.Literal('added'),
    reason: Type.Null(),
  },
  { additionalProperties: false },
);

const SavedListLineSkipped = Type.Object(
  {
    ...SavedListLineOutcomeFields,
    status: Type.Literal('skipped'),
    reason: SavedListSkipReason,
  },
  { additionalProperties: false },
);

/** One saved list item's final result after an add-to-cart action. */
export const SavedListLineOutcome = Type.Union([SavedListLineAdded, SavedListLineSkipped]);
export type SavedListLineOutcome = Static<typeof SavedListLineOutcome>;

export const SavedListAddToCartResponse = Type.Object(
  {
    cart: SavedListCart,
    addedLineCount: SafeNonNegativeInteger,
    skippedLineCount: SafeNonNegativeInteger,
    outcomes: Type.Array(SavedListLineOutcome),
  },
  { additionalProperties: false },
);
export type SavedListAddToCartResponse = Static<typeof SavedListAddToCartResponse>;
