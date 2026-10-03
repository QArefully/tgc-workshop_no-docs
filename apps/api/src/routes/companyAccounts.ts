import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { ErrorResponse, SuccessResponse } from '@shop/contracts/common';
import {
  AcceptInviteBody,
  Company,
  CompanyAccountResponse,
  CompanyInvite,
  CompanyInviteListResponse,
  CompanyMembership,
  CompanyMembershipListResponse,
  CreateCompanyBody,
  InviteMemberBody,
  RevokeInviteParams,
  RevokeMembershipParams,
  UpdateMembershipRoleBody,
  UpdateThresholdBody,
} from '@shop/contracts/company-accounts';
import type { SessionService } from '../features/auth/sessionService.js';
import type { CompanyErrorCode } from '../features/companyAccounts/companyErrors.js';
import type { CompanyService } from '../features/companyAccounts/companyService.js';
import { requireAuth } from '../plugins/auth.js';
import { sendPublicError } from '../utils/errors.js';

export interface CompanyAccountsRouteServices {
  sessions: SessionService;
  companyAccounts: CompanyService;
}
const COMPANY_ERROR_STATUS: Record<CompanyErrorCode, 400 | 403 | 404 | 409> = {
  NO_ACTIVE_MEMBERSHIP: 404,
  ALREADY_MEMBER: 409,
  NOT_OWNER: 403,
  SOLE_OWNER: 409,
  MEMBERSHIP_NOT_FOUND: 404,
  INVITE_NOT_FOUND: 404,
  INVITE_EXPIRED: 400,
  INVITE_ALREADY_USED: 400,
  COMPANY_NOT_FOUND: 404,
  INVALID_ROLE: 400,
};
function sendCompanyError(
  request: FastifyRequest,
  reply: FastifyReply,
  code: CompanyErrorCode,
): void {
  sendPublicError(request, reply, COMPANY_ERROR_STATUS[code], code);
}
function context(userId: number, requestId: string) {
  return { actor: { type: 'user' as const, userId }, requestId };
}

/** Company state is always resolved from the authenticated membership, never a client-supplied ID. */
export default function companyAccountsRoutes(
  app: FastifyInstance,
  { services }: { services: CompanyAccountsRouteServices },
): void {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();
  const company = services.companyAccounts;
  typed.get(
    '/api/company',
    {
      preHandler: [requireAuth(services.sessions)],
      schema: { response: { 200: CompanyAccountResponse, 401: ErrorResponse } },
    },
    async (request, reply) => {
      reply.code(200).send(company.get(request.authenticatedUser!.id));
    },
  );
  typed.post(
    '/api/company',
    {
      preHandler: [requireAuth(services.sessions)],
      schema: {
        body: CreateCompanyBody,
        response: {
          201: CompanyAccountResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const user = request.authenticatedUser!;
      const result = company.createCompany(
        user.id,
        request.body.name,
        context(user.id, request.id),
      );
      if (!result.ok) {
        sendCompanyError(request, reply, result.code);
        return;
      }
      reply.code(201).send(result.value);
    },
  );
  typed.get(
    '/api/company/members',
    {
      preHandler: [requireAuth(services.sessions)],
      schema: {
        response: { 200: CompanyMembershipListResponse, 401: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (request, reply) => {
      const result = company.listMembers(request.authenticatedUser!.id);
      if (!result.ok) {
        sendCompanyError(request, reply, result.code);
        return;
      }
      reply.code(200).send(result.value);
    },
  );
  typed.patch(
    '/api/company/members/:membershipId',
    {
      preHandler: [requireAuth(services.sessions)],
      schema: {
        params: RevokeMembershipParams,
        body: UpdateMembershipRoleBody,
        response: {
          200: CompanyMembership,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const user = request.authenticatedUser!;
      const result = company.changeMemberRole(
        user.id,
        Number(request.params.membershipId),
        request.body.role,
        context(user.id, request.id),
      );
      if (!result.ok) {
        sendCompanyError(request, reply, result.code);
        return;
      }
      reply.code(200).send(result.value);
    },
  );
  typed.delete(
    '/api/company/members/:membershipId',
    {
      preHandler: [requireAuth(services.sessions)],
      schema: {
        params: RevokeMembershipParams,
        response: {
          200: SuccessResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const user = request.authenticatedUser!;
      const result = company.revokeMember(
        user.id,
        Number(request.params.membershipId),
        context(user.id, request.id),
      );
      if (!result.ok) {
        sendCompanyError(request, reply, result.code);
        return;
      }
      reply.code(200).send({ success: true });
    },
  );
  typed.get(
    '/api/company/invites',
    {
      preHandler: [requireAuth(services.sessions)],
      schema: {
        response: {
          200: CompanyInviteListResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const result = company.listInvites(request.authenticatedUser!.id);
      if (!result.ok) {
        sendCompanyError(request, reply, result.code);
        return;
      }
      reply.code(200).send(result.value);
    },
  );
  typed.post(
    '/api/company/invites',
    {
      preHandler: [requireAuth(services.sessions)],
      schema: {
        body: InviteMemberBody,
        response: {
          201: CompanyInvite,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const user = request.authenticatedUser!;
      const result = company.inviteMember(
        user.id,
        request.body.email,
        request.body.role,
        context(user.id, request.id),
      );
      if (!result.ok) {
        sendCompanyError(request, reply, result.code);
        return;
      }
      reply.code(201).send(result.value);
    },
  );
  typed.delete(
    '/api/company/invites/:inviteId',
    {
      preHandler: [requireAuth(services.sessions)],
      schema: {
        params: RevokeInviteParams,
        response: {
          200: SuccessResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const user = request.authenticatedUser!;
      const result = company.revokeInvite(
        user.id,
        Number(request.params.inviteId),
        context(user.id, request.id),
      );
      if (!result.ok) {
        sendCompanyError(request, reply, result.code);
        return;
      }
      reply.code(200).send({ success: true });
    },
  );
  typed.post(
    '/api/company/invites/accept',
    {
      preHandler: [requireAuth(services.sessions)],
      schema: {
        body: AcceptInviteBody,
        response: {
          200: CompanyAccountResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const user = request.authenticatedUser!;
      const result = company.acceptInvite(
        user.id,
        request.body.token,
        context(user.id, request.id),
      );
      if (!result.ok) {
        sendCompanyError(request, reply, result.code);
        return;
      }
      reply.code(200).send(result.value);
    },
  );
  typed.patch(
    '/api/company/threshold',
    {
      preHandler: [requireAuth(services.sessions)],
      schema: {
        body: UpdateThresholdBody,
        response: {
          200: Company,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const user = request.authenticatedUser!;
      const result = company.updateThreshold(
        user.id,
        request.body.approvalThresholdCents,
        context(user.id, request.id),
      );
      if (!result.ok) {
        sendCompanyError(request, reply, result.code);
        return;
      }
      reply.code(200).send(result.value);
    },
  );
}
