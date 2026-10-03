import { Type, type Static } from '@sinclair/typebox';
import { MoneyCents, PositiveIntegerString } from './common.js';
import { DeliveryClass } from './delivery.js';

const UtcIsoInstant = Type.String({
  minLength: 24,
  maxLength: 24,
  pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$',
});

export const AdminVariantIdParam = Type.Object(
  { variantId: PositiveIntegerString },
  { additionalProperties: false },
);
export type AdminVariantIdParam = Static<typeof AdminVariantIdParam>;

export const AdminProductVariantsParam = Type.Object(
  { productId: PositiveIntegerString },
  { additionalProperties: false },
);
export type AdminProductVariantsParam = Static<typeof AdminProductVariantsParam>;

export const AdminVariantClearance = Type.Object(
  { priceCents: MoneyCents, startsAt: UtcIsoInstant, endsAt: UtcIsoInstant },
  { additionalProperties: false },
);
export type AdminVariantClearance = Static<typeof AdminVariantClearance>;

export const AdminVariant = Type.Object(
  {
    id: PositiveIntegerString,
    productId: PositiveIntegerString,
    sku: Type.String({ minLength: 1, maxLength: 64 }),
    label: Type.String({ minLength: 1, maxLength: 160 }),
    weightGrams: Type.Integer({ minimum: 1 }),
    priceCents: MoneyCents,
    moqSacks: Type.Integer({ minimum: 1 }),
    compareAtPriceCents: Type.Union([MoneyCents, Type.Null()]),
    clearance: Type.Union([AdminVariantClearance, Type.Null()]),
    stockCount: Type.Integer({ minimum: 0 }),
    backorderable: Type.Boolean(),
    backorderLeadDays: Type.Union([Type.Integer({ minimum: 1, maximum: 365 }), Type.Null()]),
    deliveryClass: DeliveryClass,
    active: Type.Boolean(),
    sortOrder: Type.Integer({ minimum: 0 }),
    createdAt: UtcIsoInstant,
    updatedAt: UtcIsoInstant,
  },
  { additionalProperties: false },
);
export type AdminVariant = Static<typeof AdminVariant>;

export const AdminVariantListResponse = Type.Object(
  { items: Type.Array(AdminVariant) },
  { additionalProperties: false },
);
export type AdminVariantListResponse = Static<typeof AdminVariantListResponse>;

export const CreateAdminVariantBody = Type.Object(
  {
    productId: PositiveIntegerString,
    sku: Type.String({ minLength: 1, maxLength: 64 }),
    label: Type.String({ minLength: 1, maxLength: 160 }),
    weightGrams: Type.Integer({ minimum: 1 }),
    priceCents: MoneyCents,
    stockCount: Type.Integer({ minimum: 0 }),
    backorderable: Type.Optional(Type.Boolean()),
    backorderLeadDays: Type.Optional(
      Type.Union([Type.Integer({ minimum: 1, maximum: 365 }), Type.Null()]),
    ),
    deliveryClass: DeliveryClass,
    sortOrder: Type.Integer({ minimum: 1 }),
    moqSacks: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);
export type CreateAdminVariantBody = Static<typeof CreateAdminVariantBody>;

export const UpdateAdminVariantBody = Type.Partial(
  Type.Omit(CreateAdminVariantBody, ['productId']),
  { additionalProperties: false, minProperties: 1 },
);
export type UpdateAdminVariantBody = Static<typeof UpdateAdminVariantBody>;

export const SetAdminVariantClearanceBody = Type.Object(
  { clearance: Type.Union([AdminVariantClearance, Type.Null()]) },
  { additionalProperties: false },
);
export type SetAdminVariantClearanceBody = Static<typeof SetAdminVariantClearanceBody>;
