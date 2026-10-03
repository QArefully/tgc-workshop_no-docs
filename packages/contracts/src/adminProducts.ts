import { Type, type Static } from '@sinclair/typebox';
import { MoneyCents, PositiveIntegerString } from './common.js';

export const AdminCatalogCategory = Type.Union([
  Type.Literal('Sports Nutrition'),
  Type.Literal('Baking & Pantry'),
  Type.Literal('Drinks'),
  Type.Literal('Household & Cleaning'),
  Type.Literal('Garden & Outdoors'),
  Type.Literal('Trade & Creative Materials'),
]);
export type AdminCatalogCategory = Static<typeof AdminCatalogCategory>;

export const AdminMixingGroup = Type.Union([
  Type.Literal('food-grade'),
  Type.Literal('cleaning'),
  Type.Literal('garden-treatment'),
  Type.Literal('cementitious-materials'),
  Type.Literal('casting-materials'),
  Type.Literal('pigments'),
  Type.Literal('theatrical-effects'),
  Type.Literal('absorbents'),
]);
export type AdminMixingGroup = Static<typeof AdminMixingGroup>;

const NullableAdminMixingGroup = Type.Union([AdminMixingGroup, Type.Null()]);
const ConsumptionClassification = Type.Union([
  Type.Literal('food'),
  Type.Literal('non-food'),
  Type.Literal('caution'),
]);
const PlainText = Type.String({ minLength: 1, maxLength: 10_000, pattern: '^[^<>]*$' });

export const AdminProductIdParam = Type.Object(
  { productId: PositiveIntegerString },
  { additionalProperties: false },
);
export type AdminProductIdParam = Static<typeof AdminProductIdParam>;

export const AdminProduct = Type.Object(
  {
    id: PositiveIntegerString,
    name: PlainText,
    description: PlainText,
    priceCents: MoneyCents,
    category: AdminCatalogCategory,
    stockCount: Type.Integer({ minimum: 0 }),
    imageSetId: Type.Union([Type.String({ minLength: 1, maxLength: 255 }), Type.Null()]),
    slug: Type.String({ minLength: 1, maxLength: 255 }),
    compareAtPriceCents: Type.Union([MoneyCents, Type.Null()]),
    salesCount: Type.Integer({ minimum: 0 }),
    active: Type.Boolean(),
    createdAt: Type.String({ minLength: 24, maxLength: 24 }),
    consumptionClassification: ConsumptionClassification,
    mixingGroup: NullableAdminMixingGroup,
    detailsJson: Type.Union([Type.String({ maxLength: 100_000 }), Type.Null()]),
    defaultVariantId: Type.Union([PositiveIntegerString, Type.Null()]),
    blendSourceVariantId: Type.Union([PositiveIntegerString, Type.Null()]),
  },
  { additionalProperties: false },
);
export type AdminProduct = Static<typeof AdminProduct>;

export const AdminProductListQuery = Type.Object(
  { includeRetired: Type.Optional(Type.Boolean()) },
  { additionalProperties: false },
);
export type AdminProductListQuery = Static<typeof AdminProductListQuery>;

export const AdminProductListResponse = Type.Object(
  { items: Type.Array(AdminProduct) },
  { additionalProperties: false },
);
export type AdminProductListResponse = Static<typeof AdminProductListResponse>;

export const CreateAdminProductBody = Type.Object(
  {
    name: PlainText,
    description: PlainText,
    priceCents: MoneyCents,
    category: AdminCatalogCategory,
    stockCount: Type.Integer({ minimum: 0 }),
    imageSetId: Type.Optional(
      Type.Union([Type.String({ minLength: 1, maxLength: 255 }), Type.Null()]),
    ),
    slug: Type.String({ minLength: 1, maxLength: 255 }),
    compareAtPriceCents: Type.Optional(Type.Union([MoneyCents, Type.Null()])),
    consumptionClassification: ConsumptionClassification,
    mixingGroup: NullableAdminMixingGroup,
    detailsJson: Type.Optional(Type.Union([Type.String({ maxLength: 100_000 }), Type.Null()])),
  },
  { additionalProperties: false },
);
export type CreateAdminProductBody = Static<typeof CreateAdminProductBody>;

export const UpdateAdminProductBody = Type.Partial(CreateAdminProductBody, {
  additionalProperties: false,
  minProperties: 1,
});
export type UpdateAdminProductBody = Static<typeof UpdateAdminProductBody>;
