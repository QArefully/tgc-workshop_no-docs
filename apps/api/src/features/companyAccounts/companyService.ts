import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { PublicUser } from '@shop/contracts/auth';
import type {
  Company,
  CompanyInvite,
  CompanyInviteRole,
  CompanyMembership,
} from '@shop/contracts/company-accounts';
import { companyInviteCopy } from '@shop/localisation/messages/asyncContent';
import type { UnitOfWork } from '../../db/unitOfWork.js';
import type { AuditContext } from '../audit/auditEvent.js';
import type { AuditWriter, Clock } from '../audit/auditService.js';
import type { MailboxRepository } from '../mailbox/mailboxRepository.js';
import { normalizeEmail } from '../auth/authRules.js';
import type { CompanyRepository, CompanyRow } from './companyRepository.js';
import type {
  CompanyMembershipRepository,
  CompanyMembershipRow,
} from './companyMembershipRepository.js';
import type { CompanyInviteRepository, CompanyInviteRow } from './companyInviteRepository.js';
import { companyError, companyOk, type CompanyResult } from './companyErrors.js';

const INVITE_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
export type InviteTokenSource = () => string;

function digestToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
function toCompany(row: CompanyRow): Company {
  return {
    id: String(row.id),
    name: row.name,
    createdByUserId: String(row.created_by_user_id),
    active: row.active === 1,
    approvalThresholdCents: row.approval_threshold_cents,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function toMembership(row: CompanyMembershipRow, includeUser = false): CompanyMembership {
  const membership: CompanyMembership = {
    id: String(row.id),
    companyId: String(row.company_id),
    userId: String(row.user_id),
    role: row.role,
    active: row.active === 1,
    createdAt: row.created_at,
  };
  if (
    includeUser &&
    row.email !== undefined &&
    row.display_name !== undefined &&
    row.user_role !== undefined &&
    row.country !== undefined
  )
    membership.user = {
      id: String(row.user_id),
      email: row.email,
      displayName: row.display_name,
      role: row.user_role,
      country: row.country as PublicUser['country'],
    };
  return membership;
}
function toInvite(row: CompanyInviteRow): CompanyInvite {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    email: row.email,
    role: row.role,
    status: row.status,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}
function normalizeName(name: string): string {
  return name.trim();
}
function inviteLink(baseUrl: string, token: string): string {
  const link = new URL('/invites/accept', baseUrl);
  link.searchParams.set('token', token);
  return link.toString();
}

export interface ActiveCompanyMembership {
  company: Company;
  membership: CompanyMembership;
}
export interface CompanyService {
  findActiveByUser(userId: number): ActiveCompanyMembership | null;
  get(userId: number): ActiveCompanyMembership | null;
  createCompany(
    userId: number,
    name: string,
    context: AuditContext,
  ): CompanyResult<ActiveCompanyMembership>;
  listMembers(userId: number): CompanyResult<CompanyMembership[]>;
  changeMemberRole(
    userId: number,
    membershipId: number,
    role: CompanyInviteRole,
    context: AuditContext,
  ): CompanyResult<CompanyMembership>;
  revokeMember(userId: number, membershipId: number, context: AuditContext): CompanyResult<null>;
  listInvites(userId: number): CompanyResult<CompanyInvite[]>;
  inviteMember(
    userId: number,
    email: string,
    role: CompanyInviteRole,
    context: AuditContext,
  ): CompanyResult<CompanyInvite>;
  revokeInvite(userId: number, inviteId: number, context: AuditContext): CompanyResult<null>;
  acceptInvite(
    userId: number,
    token: string,
    context: AuditContext,
  ): CompanyResult<ActiveCompanyMembership>;
  updateThreshold(
    userId: number,
    thresholdCents: number | null,
    context: AuditContext,
  ): CompanyResult<Company>;
}
export interface CompanyServiceDependencies {
  companies: CompanyRepository;
  memberships: CompanyMembershipRepository;
  invites: CompanyInviteRepository;
  mailbox: MailboxRepository;
  unitOfWork: UnitOfWork;
  audit: AuditWriter;
  clock: Clock;
  baseUrl: string;
  tokenSource?: InviteTokenSource;
}

export function createCompanyService(dependencies: CompanyServiceDependencies): CompanyService {
  new URL(dependencies.baseUrl);
  const tokenSource = dependencies.tokenSource ?? (() => randomBytes(32).toString('hex'));
  const now = () => dependencies.clock.now().toISOString();
  const current = (userId: number): ActiveCompanyMembership | null => {
    const membership = dependencies.memberships.findActiveByUser(userId);
    if (!membership) return null;
    const company = dependencies.companies.findActiveById(membership.company_id);
    return company ? { company: toCompany(company), membership: toMembership(membership) } : null;
  };
  const ownerCompany = (userId: number): CompanyResult<ActiveCompanyMembership> => {
    const active = current(userId);
    if (!active) return companyError('NO_ACTIVE_MEMBERSHIP');
    return active.membership.role === 'owner' ? companyOk(active) : companyError('NOT_OWNER');
  };
  const audited = (context: AuditContext, userId: number): boolean =>
    context.actor.type === 'user' && context.actor.userId === userId;
  return {
    findActiveByUser: current,
    get: current,
    createCompany(userId, name, context) {
      if (!audited(context, userId)) throw new Error('Company audit requires authenticated actor');
      if (current(userId)) return companyError('ALREADY_MEMBER');
      const normalized = normalizeName(name);
      const timestamp = now();
      return dependencies.unitOfWork.run(() => {
        if (current(userId)) return companyError('ALREADY_MEMBER');
        // Company country is creator-account authority. Never use the request's selected/admin
        // browsing country, which is deliberately absent from this service boundary.
        const country = dependencies.companies.findUserCountry(userId);
        if (!country) throw new Error('Company creator account not found');
        const company = dependencies.companies.create({
          name: normalized,
          createdByUserId: userId,
          country,
          now: timestamp,
        });
        const membership = dependencies.memberships.create({
          companyId: company.id,
          userId,
          role: 'owner',
          now: timestamp,
        });
        dependencies.audit.append({ action: 'company.created', companyId: company.id, context });
        return companyOk({ company: toCompany(company), membership: toMembership(membership) });
      });
    },
    listMembers(userId) {
      const active = current(userId);
      if (!active) return companyError('NO_ACTIVE_MEMBERSHIP');
      return companyOk(
        dependencies.memberships
          .listActiveByCompany(Number(active.company.id))
          .map((row) => toMembership(row, true)),
      );
    },
    changeMemberRole(userId, membershipId, role, context) {
      if (!audited(context, userId)) throw new Error('Company audit requires authenticated actor');
      const owner = ownerCompany(userId);
      if (!owner.ok) return owner;
      const target = dependencies.memberships.findActiveById(
        Number(owner.value.company.id),
        membershipId,
      );
      if (!target) return companyError('MEMBERSHIP_NOT_FOUND');
      if (target.role === 'owner') return companyError('SOLE_OWNER');
      if (role !== 'buyer' && role !== 'approver') return companyError('INVALID_ROLE');
      return dependencies.unitOfWork.run(() => {
        dependencies.memberships.changeRole(Number(owner.value.company.id), membershipId, role);
        const updated = dependencies.memberships.findActiveById(
          Number(owner.value.company.id),
          membershipId,
        )!;
        const oldRole: CompanyInviteRole = target.role === 'buyer' ? 'buyer' : 'approver';
        dependencies.audit.append({
          action: 'company.member_role_changed',
          companyId: Number(owner.value.company.id),
          membershipId,
          oldRole,
          newRole: role,
          context,
        });
        return companyOk(toMembership(updated, true));
      });
    },
    revokeMember(userId, membershipId, context) {
      if (!audited(context, userId)) throw new Error('Company audit requires authenticated actor');
      const active = current(userId);
      if (!active) return companyError('NO_ACTIVE_MEMBERSHIP');
      const companyId = Number(active.company.id);
      const target = dependencies.memberships.findActiveById(companyId, membershipId);
      if (!target) return companyError('MEMBERSHIP_NOT_FOUND');
      if (active.membership.role !== 'owner' && target.user_id !== userId)
        return companyError('NOT_OWNER');
      if (target.role === 'owner') return companyError('SOLE_OWNER');
      return dependencies.unitOfWork.run(() => {
        dependencies.memberships.retire(companyId, membershipId);
        dependencies.audit.append({
          action: 'company.member_revoked',
          companyId,
          membershipId,
          revokedUserId: target.user_id,
          context,
        });
        return companyOk(null);
      });
    },
    listInvites(userId) {
      const owner = ownerCompany(userId);
      if (!owner.ok) return owner;
      dependencies.invites.expireStale(now());
      return companyOk(
        dependencies.invites.listPendingByCompany(Number(owner.value.company.id)).map(toInvite),
      );
    },
    inviteMember(userId, email, role, context) {
      if (!audited(context, userId)) throw new Error('Company audit requires authenticated actor');
      const owner = ownerCompany(userId);
      if (!owner.ok) return owner;
      if (role !== 'buyer' && role !== 'approver') return companyError('INVALID_ROLE');
      const normalizedEmail = normalizeEmail(email);
      const token = tokenSource();
      const timestamp = now();
      const expiresAt = new Date(
        dependencies.clock.now().getTime() + INVITE_DURATION_MS,
      ).toISOString();
      return dependencies.unitOfWork.run(() => {
        dependencies.invites.expireStale(timestamp);
        if (
          dependencies.invites.findPendingByEmail(Number(owner.value.company.id), normalizedEmail)
        ) {
          return companyError('ALREADY_MEMBER');
        }
        const invite = dependencies.invites.create({
          companyId: Number(owner.value.company.id),
          email: normalizedEmail,
          role,
          tokenDigest: digestToken(token),
          expiresAt,
          now: timestamp,
        });
        const companyCountry = dependencies.companies.findActiveById(
          Number(owner.value.company.id),
        )?.country;
        if (!companyCountry) throw new Error('Company country is missing');
        const copy = companyInviteCopy(companyCountry, {
          companyName: owner.value.company.name,
          inviteUrl: inviteLink(dependencies.baseUrl, token),
          role,
          expiresAt,
        });
        dependencies.mailbox.add({
          recipient: normalizedEmail,
          subject: copy.subject,
          body: copy.body,
          kind: 'template',
          templateKey: 'company_invite',
          templateParams: {
            companyName: owner.value.company.name,
            inviteUrl: inviteLink(dependencies.baseUrl, token),
            role,
            expiresAt,
          },
          country: companyCountry,
          createdAt: timestamp,
        });
        dependencies.audit.append({
          action: 'company.member_invited',
          companyId: Number(owner.value.company.id),
          inviteId: invite.id,
          role,
          context,
        });
        return companyOk(toInvite(invite));
      });
    },
    revokeInvite(userId, inviteId, context) {
      if (!audited(context, userId)) throw new Error('Company audit requires authenticated actor');
      const owner = ownerCompany(userId);
      if (!owner.ok) return owner;
      const companyId = Number(owner.value.company.id);
      dependencies.invites.expireStale(now());
      if (!dependencies.invites.findPendingById(companyId, inviteId))
        return companyError('INVITE_NOT_FOUND');
      return dependencies.unitOfWork.run(() => {
        dependencies.invites.markRevoked(companyId, inviteId, now());
        dependencies.audit.append({
          action: 'company.invite_revoked',
          companyId,
          inviteId,
          context,
        });
        return companyOk(null);
      });
    },
    acceptInvite(userId, token, context) {
      if (!audited(context, userId)) throw new Error('Company audit requires authenticated actor');
      const digest = digestToken(token);
      const invite = dependencies.invites.findByDigest(digest);
      // A fixed-length digest comparison makes the local token check non-observable even though
      // the database lookup remains indexed. Every invalid token receives the same response.
      const storedDigest = invite?.token_digest ?? digest;
      if (!invite || !timingSafeEqual(Buffer.from(storedDigest), Buffer.from(digest)))
        return companyError('INVITE_NOT_FOUND');
      const timestamp = now();
      if (invite.status !== 'pending') return companyError('INVITE_ALREADY_USED');
      if (new Date(invite.expires_at) <= new Date(timestamp)) {
        dependencies.unitOfWork.run(() => dependencies.invites.expireStale(timestamp));
        return companyError('INVITE_EXPIRED');
      }
      if (current(userId)) return companyError('ALREADY_MEMBER');
      return dependencies.unitOfWork.run(() => {
        const fresh = dependencies.invites.findByDigest(digest);
        if (!fresh || fresh.status !== 'pending') return companyError('INVITE_ALREADY_USED');
        if (new Date(fresh.expires_at) <= new Date(timestamp)) {
          dependencies.invites.expireStale(timestamp);
          return companyError('INVITE_EXPIRED');
        }
        if (current(userId)) return companyError('ALREADY_MEMBER');
        const company = dependencies.companies.findActiveById(fresh.company_id);
        if (!company) return companyError('INVITE_NOT_FOUND');
        // Keep invite acceptance inside one-country company boundary. Return settled not-found
        // identity for mismatches so invite/company existence stays undisclosed.
        const userCountry = dependencies.companies.findUserCountry(userId);
        if (!userCountry || userCountry !== company.country)
          return companyError('INVITE_NOT_FOUND');
        const membership = dependencies.memberships.create({
          companyId: fresh.company_id,
          userId,
          role: fresh.role,
          now: timestamp,
        });
        if (!dependencies.invites.markAccepted(fresh.id, timestamp))
          return companyError('INVITE_ALREADY_USED');
        dependencies.audit.append({
          action: 'company.member_joined',
          companyId: fresh.company_id,
          membershipId: membership.id,
          context,
        });
        return companyOk({ company: toCompany(company), membership: toMembership(membership) });
      });
    },
    updateThreshold(userId, thresholdCents, context) {
      if (!audited(context, userId)) throw new Error('Company audit requires authenticated actor');
      const owner = ownerCompany(userId);
      if (!owner.ok) return owner;
      const companyId = Number(owner.value.company.id);
      if (thresholdCents !== null && (!Number.isSafeInteger(thresholdCents) || thresholdCents < 0))
        return companyError('INVALID_ROLE');
      const timestamp = now();
      return dependencies.unitOfWork.run(() => {
        dependencies.companies.updateThreshold(companyId, thresholdCents, timestamp);
        const company = dependencies.companies.findActiveById(companyId)!;
        dependencies.audit.append({
          action: 'company.threshold_changed',
          companyId,
          oldThresholdCents: owner.value.company.approvalThresholdCents,
          newThresholdCents: thresholdCents,
          context,
        });
        return companyOk(toCompany(company));
      });
    },
  };
}
