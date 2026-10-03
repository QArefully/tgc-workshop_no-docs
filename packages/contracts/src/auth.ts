import { Type, type Static } from '@sinclair/typebox';
import { EmailAddress, Password, SuccessResponse } from './common.js';
import { Country } from './country.js';

export const PublicUser = Type.Object({
  id: Type.String({ minLength: 1 }),
  email: EmailAddress,
  displayName: Type.String({ minLength: 1, maxLength: 120 }),
  role: Type.Union([Type.Literal('customer'), Type.Literal('admin')]),
  country: Country,
});
export type PublicUser = Static<typeof PublicUser>;

/** Admin-only account state. Public customer auth never exposes suspension facts. */
export const AdminUserView = Type.Object(
  {
    ...PublicUser.properties,
    suspendedAt: Type.Union([Type.String({ minLength: 24, maxLength: 24 }), Type.Null()]),
    suspensionReason: Type.Union([Type.String({ minLength: 1, maxLength: 500 }), Type.Null()]),
    suspendedByUserId: Type.Union([Type.String({ pattern: '^[1-9][0-9]*$' }), Type.Null()]),
  },
  { additionalProperties: false },
);
export type AdminUserView = Static<typeof AdminUserView>;
export const CurrentUserResponse = Type.Union([PublicUser, Type.Null()]);
export type CurrentUserResponse = Static<typeof CurrentUserResponse>;

export const SignupBody = Type.Object({
  email: EmailAddress,
  password: Password,
  displayName: Type.String({ minLength: 1, maxLength: 120 }),
  country: Country,
});
export type SignupBody = Static<typeof SignupBody>;
export const LoginBody = Type.Object({ email: EmailAddress, password: Password, country: Country });
export type LoginBody = Static<typeof LoginBody>;
export const ForgotPasswordBody = Type.Object({ email: EmailAddress, country: Country });
export type ForgotPasswordBody = Static<typeof ForgotPasswordBody>;
export const ResetPasswordBody = Type.Object({
  token: Type.String({ minLength: 1, maxLength: 512 }),
  newPassword: Password,
});
export type ResetPasswordBody = Static<typeof ResetPasswordBody>;
export const ChangePasswordBody = Type.Object({ currentPassword: Password, newPassword: Password });
export type ChangePasswordBody = Static<typeof ChangePasswordBody>;

export { SuccessResponse };
