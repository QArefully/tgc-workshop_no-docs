import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import {
  ApprovalDecisionBody,
  ApprovalIdParams,
  ApprovalListResponse,
  OrderApproval,
} from '@shop/contracts/order-approvals';
import { ErrorResponse } from '@shop/contracts/common';
import type { SessionService } from '../features/auth/sessionService.js';
import type { ApprovalErrorCode } from '../features/orderApprovals/approvalErrors.js';
import type { ApprovalService } from '../features/orderApprovals/approvalService.js';
import { requireAuth } from '../plugins/auth.js';
import { sendPublicError } from '../utils/errors.js';

export interface OrderApprovalsRouteServices {
  sessions: SessionService;
  approvals: ApprovalService;
}

function context(userId: number, requestId: string) {
  return { actor: { type: 'user' as const, userId }, requestId };
}

function sendApprovalError(
  request: FastifyRequest,
  reply: FastifyReply,
  code: ApprovalErrorCode,
): void {
  switch (code) {
    case 'APPROVAL_NOT_FOUND':
      sendPublicError(request, reply, 404, 'APPROVAL_NOT_FOUND');
      return;
    case 'NOT_APPROVER':
      sendPublicError(request, reply, 403, 'NOT_APPROVER');
      return;
    case 'APPROVAL_EXPIRED':
      sendPublicError(request, reply, 400, 'APPROVAL_EXPIRED');
      return;
    case 'APPROVAL_ALREADY_RESOLVED':
      sendPublicError(request, reply, 409, 'APPROVAL_ALREADY_RESOLVED');
      return;
  }
}

/** Approval inboxes are membership-scoped; no request accepts a company identifier from clients. */
export default function orderApprovalRoutes(
  app: FastifyInstance,
  { services }: { services: OrderApprovalsRouteServices },
): void {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();
  typed.get(
    '/api/approvals',
    {
      preHandler: [requireAuth(services.sessions)],
      schema: {
        response: {
          200: ApprovalListResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const result = services.approvals.listPendingForApprover(request.authenticatedUser!.id);
      if (!result.ok) return sendApprovalError(request, reply, result.code);
      reply.code(200).send(result.value);
    },
  );
  typed.get(
    '/api/approvals/mine',
    {
      preHandler: [requireAuth(services.sessions)],
      schema: { response: { 200: ApprovalListResponse, 401: ErrorResponse } },
    },
    async (request, reply) => {
      reply.code(200).send(services.approvals.listForRequester(request.authenticatedUser!.id));
    },
  );
  typed.get(
    '/api/approvals/:approvalId',
    {
      preHandler: [requireAuth(services.sessions)],
      schema: {
        params: ApprovalIdParams,
        response: {
          200: OrderApproval,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const result = services.approvals.getForApprover(
        request.authenticatedUser!.id,
        Number(request.params.approvalId),
      );
      if (!result.ok) return sendApprovalError(request, reply, result.code);
      reply.code(200).send(result.value);
    },
  );
  typed.post(
    '/api/approvals/:approvalId/decision',
    {
      preHandler: [requireAuth(services.sessions)],
      schema: {
        params: ApprovalIdParams,
        body: ApprovalDecisionBody,
        response: {
          200: OrderApproval,
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
      const result = services.approvals.decide(
        user.id,
        Number(request.params.approvalId),
        request.body.action,
        request.body.reason,
        context(user.id, request.id),
      );
      if (!result.ok) return sendApprovalError(request, reply, result.code);
      reply.code(200).send(result.value);
    },
  );
}
