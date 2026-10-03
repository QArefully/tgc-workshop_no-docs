import { Type, type Static } from '@sinclair/typebox';
import { PositiveIntegerString } from './common.js';

export const FeatureFlagKey = Type.String({
  minLength: 2,
  maxLength: 64,
  pattern: '^[a-z][a-z0-9_.]{1,63}$',
});
export type FeatureFlagKey = Static<typeof FeatureFlagKey>;

export const AdminFeatureFlag = Type.Object(
  {
    key: FeatureFlagKey,
    description: Type.String({ maxLength: 2_000 }),
    enabled: Type.Boolean(),
    updatedAt: Type.String({ minLength: 19, maxLength: 24 }),
    updatedByUserId: Type.Union([PositiveIntegerString, Type.Null()]),
  },
  { additionalProperties: false },
);
export type AdminFeatureFlag = Static<typeof AdminFeatureFlag>;

export const AdminFeatureFlagKeyParam = Type.Object(
  { key: FeatureFlagKey },
  { additionalProperties: false },
);
export type AdminFeatureFlagKeyParam = Static<typeof AdminFeatureFlagKeyParam>;

export const AdminFeatureFlagListResponse = Type.Object(
  { items: Type.Array(AdminFeatureFlag) },
  { additionalProperties: false },
);
export type AdminFeatureFlagListResponse = Static<typeof AdminFeatureFlagListResponse>;

export const CreateAdminFeatureFlagBody = Type.Object(
  { key: FeatureFlagKey, description: Type.String({ maxLength: 2_000 }), enabled: Type.Boolean() },
  { additionalProperties: false },
);
export type CreateAdminFeatureFlagBody = Static<typeof CreateAdminFeatureFlagBody>;

export const UpdateAdminFeatureFlagBody = Type.Object(
  {
    description: Type.Optional(Type.String({ maxLength: 2_000 })),
    enabled: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false, minProperties: 1 },
);
export type UpdateAdminFeatureFlagBody = Static<typeof UpdateAdminFeatureFlagBody>;
