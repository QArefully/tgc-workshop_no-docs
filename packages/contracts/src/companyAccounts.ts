import { Type, type Static } from '@sinclair/typebox';
import {
  EmailAddress,
  MoneyCents,
  PositiveIntegerString,
  REQUIRED_PLAIN_TEXT_PATTERN,
} from './common.js';
import { PublicUser } from './auth.js';

const UtcIsoInstant = Type.String({
  minLength: 24,
  maxLength: 24,
  pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$',
});
const CompanyName = Type.String({
  minLength: 1,
  maxLength: 160,
  pattern: REQUIRED_PLAIN_TEXT_PATTERN,
});
const InviteToken = Type.String({ minLength: 1, maxLength: 512 });

/** Membership authorization is separate from the stable customer/admin account role. */
export const CompanyMembershipRole = Type.Union([
  Type.Literal('owner'),
  Type.Literal('buyer'),
  Type.Literal('approver'),
]);
export type CompanyMembershipRole = Static<typeof CompanyMembershipRole>;

export const CompanyInviteRole = Type.Union([Type.Literal('buyer'), Type.Literal('approver')]);
export type CompanyInviteRole = Static<typeof CompanyInviteRole>;

export const CompanyInviteStatus = Type.Union([
  Type.Literal('pending'),
  Type.Literal('accepted'),
  Type.Literal('revoked'),
  Type.Literal('expired'),
]);
export type CompanyInviteStatus = Static<typeof CompanyInviteStatus>;

export const Company = Type.Object(
  {
    id: PositiveIntegerString,
    name: CompanyName,
    createdByUserId: PositiveIntegerString,
    active: Type.Boolean(),
    approvalThresholdCents: Type.Union([MoneyCents, Type.Null()]),
    createdAt: UtcIsoInstant,
    updatedAt: UtcIsoInstant,
  },
  { additionalProperties: false },
);
export type Company = Static<typeof Company>;

export const CompanyMembership = Type.Object(
  {
    id: PositiveIntegerString,
    companyId: PositiveIntegerString,
    userId: PositiveIntegerString,
    role: CompanyMembershipRole,
    active: Type.Boolean(),
    createdAt: UtcIsoInstant,
    /** Present in company member lists; omitted where revealing a member is not authorized. */
    user: Type.Optional(PublicUser),
  },
  { additionalProperties: false },
);
export type CompanyMembership = Static<typeof CompanyMembership>;

export const CompanyInvite = Type.Object(
  {
    id: PositiveIntegerString,
    companyId: PositiveIntegerString,
    email: EmailAddress,
    role: CompanyInviteRole,
    status: CompanyInviteStatus,
    expiresAt: UtcIsoInstant,
    createdAt: UtcIsoInstant,
    resolvedAt: Type.Union([UtcIsoInstant, Type.Null()]),
  },
  { additionalProperties: false },
);
export type CompanyInvite = Static<typeof CompanyInvite>;

export const CompanyAccountResponse = Type.Union([
  Type.Object({ company: Company, membership: CompanyMembership }, { additionalProperties: false }),
  Type.Null(),
]);
export type CompanyAccountResponse = Static<typeof CompanyAccountResponse>;

export const CompanyMembershipListResponse = Type.Array(CompanyMembership);
export type CompanyMembershipListResponse = Static<typeof CompanyMembershipListResponse>;

export const CompanyInviteListResponse = Type.Array(CompanyInvite);
export type CompanyInviteListResponse = Static<typeof CompanyInviteListResponse>;

export const CreateCompanyBody = Type.Object(
  { name: CompanyName },
  { additionalProperties: false },
);
export type CreateCompanyBody = Static<typeof CreateCompanyBody>;

export const InviteMemberBody = Type.Object(
  { email: EmailAddress, role: CompanyInviteRole },
  { additionalProperties: false },
);
export type InviteMemberBody = Static<typeof InviteMemberBody>;

export const AcceptInviteBody = Type.Object(
  { token: InviteToken },
  { additionalProperties: false },
);
export type AcceptInviteBody = Static<typeof AcceptInviteBody>;

export const UpdateThresholdBody = Type.Object(
  { approvalThresholdCents: Type.Union([MoneyCents, Type.Null()]) },
  { additionalProperties: false },
);
export type UpdateThresholdBody = Static<typeof UpdateThresholdBody>;

/** Owners may only assign non-owner roles; ownership remains a single-company invariant. */
export const UpdateMembershipRoleBody = Type.Object(
  { role: CompanyInviteRole },
  { additionalProperties: false },
);
export type UpdateMembershipRoleBody = Static<typeof UpdateMembershipRoleBody>;

export const RevokeMembershipParams = Type.Object(
  { membershipId: PositiveIntegerString },
  { additionalProperties: false },
);
export type RevokeMembershipParams = Static<typeof RevokeMembershipParams>;

export const RevokeInviteParams = Type.Object(
  { inviteId: PositiveIntegerString },
  { additionalProperties: false },
);
export type RevokeInviteParams = Static<typeof RevokeInviteParams>;
