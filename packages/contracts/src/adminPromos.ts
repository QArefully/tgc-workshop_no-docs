import { Type, type Static } from '@sinclair/typebox';
import { MoneyCents, PromoCodeValue } from './common.js';
import { AdminCatalogCategory } from './adminProducts.js';
import { PromoCodeKind } from './promos.js';
import { Country } from './country.js';

const UtcIsoInstant = Type.String({
  minLength: 24,
  maxLength: 24,
  pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$',
});
const PromoWriteProperties = {
  discountPercent: Type.Integer({ minimum: 0, maximum: 100 }),
  minItemCount: Type.Integer({ minimum: 0 }),
  kind: PromoCodeKind,
  amountCents: Type.Union([MoneyCents, Type.Null()]),
  minSubtotalCents: Type.Union([MoneyCents, Type.Null()]),
  categoryScope: Type.Union([AdminCatalogCategory, Type.Null()]),
  countries: Type.Optional(Type.Array(Country)),
  startAt: Type.Union([UtcIsoInstant, Type.Null()]),
  endAt: Type.Union([UtcIsoInstant, Type.Null()]),
  maxRedemptions: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  perUserLimit: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
};

export const AdminPromoCodeParam = Type.Object(
  { code: PromoCodeValue },
  { additionalProperties: false },
);
export type AdminPromoCodeParam = Static<typeof AdminPromoCodeParam>;

export const AdminPromo = Type.Object(
  {
    code: PromoCodeValue,
    active: Type.Boolean(),
    redemptionCount: Type.Integer({ minimum: 0 }),
    ...PromoWriteProperties,
  },
  { additionalProperties: false },
);
export type AdminPromo = Static<typeof AdminPromo>;

export const AdminPromoListQuery = Type.Object(
  { code: Type.Optional(PromoCodeValue), active: Type.Optional(Type.Boolean()) },
  { additionalProperties: false },
);
export type AdminPromoListQuery = Static<typeof AdminPromoListQuery>;

export const AdminPromoListResponse = Type.Object(
  { items: Type.Array(AdminPromo) },
  { additionalProperties: false },
);
export type AdminPromoListResponse = Static<typeof AdminPromoListResponse>;

export const CreateAdminPromoBody = Type.Object(
  { code: PromoCodeValue, ...PromoWriteProperties },
  { additionalProperties: false },
);
export type CreateAdminPromoBody = Static<typeof CreateAdminPromoBody>;

export const UpdateAdminPromoBody = Type.Object(PromoWriteProperties, {
  additionalProperties: false,
});
export type UpdateAdminPromoBody = Static<typeof UpdateAdminPromoBody>;

export const DeactivateAdminPromoBody = Type.Object(
  { force: Type.Optional(Type.Boolean()) },
  { additionalProperties: false },
);
export type DeactivateAdminPromoBody = Static<typeof DeactivateAdminPromoBody>;
