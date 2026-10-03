import { Type, type Static } from '@sinclair/typebox';
import { EmailAddress, PositiveIntegerString } from './common.js';
import { AdminUserView } from './auth.js';

export const AdminUserIdParam = Type.Object(
  { userId: PositiveIntegerString },
  { additionalProperties: false },
);
export type AdminUserIdParam = Static<typeof AdminUserIdParam>;

export const AdminUserListQuery = Type.Object(
  { search: Type.Optional(Type.String({ minLength: 1, maxLength: 254 })) },
  { additionalProperties: false },
);
export type AdminUserListQuery = Static<typeof AdminUserListQuery>;

export const AdminUserListResponse = Type.Object(
  { items: Type.Array(AdminUserView) },
  { additionalProperties: false },
);
export type AdminUserListResponse = Static<typeof AdminUserListResponse>;

export const UpdateAdminUserDisplayNameBody = Type.Object(
  { displayName: Type.String({ minLength: 1, maxLength: 80, pattern: '^(?!\\s*$)[^<>]*$' }) },
  { additionalProperties: false },
);
export type UpdateAdminUserDisplayNameBody = Static<typeof UpdateAdminUserDisplayNameBody>;

export const SetAdminUserRoleBody = Type.Object(
  { role: Type.Union([Type.Literal('customer'), Type.Literal('admin')]) },
  { additionalProperties: false },
);
export type SetAdminUserRoleBody = Static<typeof SetAdminUserRoleBody>;

export const SuspendAdminUserBody = Type.Object(
  { reason: Type.String({ minLength: 1, maxLength: 500, pattern: '^(?!\\s*$)[^<>]*$' }) },
  { additionalProperties: false },
);
export type SuspendAdminUserBody = Static<typeof SuspendAdminUserBody>;

export const AdminUserEmailQuery = Type.Object(
  { email: EmailAddress },
  { additionalProperties: false },
);
export type AdminUserEmailQuery = Static<typeof AdminUserEmailQuery>;
