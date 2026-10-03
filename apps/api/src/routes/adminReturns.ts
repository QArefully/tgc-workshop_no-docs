import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import {
  AdminDecisionBody,
  AdminReceiveBody,
  AdminRefundBody,
  AdminReturnListQuery,
  AdminReturnListResponse,
  ReturnIdParam,
  ReturnRequest,
} from '@shop/contracts/returns';
import { ErrorResponse } from '@shop/contracts/common';
import type { Country } from '@shop/contracts/country';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';
import type { AuditContext } from '../features/audit/auditEvent.js';
import { ReturnDomainError } from '../features/returns/returnErrors.js';
import { requireAdmin } from '../plugins/auth.js';
import { sendPublicError } from '../utils/errors.js';

function auditContext(userId: number, requestId: string, standingCountry: Country): AuditContext {
  return { actor: { type: 'user' as const, userId }, requestId, standingCountry };
}

function sendReturnError(
  request: Parameters<typeof sendPublicError>[0],
  reply: Parameters<typeof sendPublicError>[1],
  error: ReturnDomainError,
): void {
  switch (error.code) {
    case 'RETURN_NOT_FOUND':
      sendPublicError(request, reply, 404, 'RETURN_NOT_FOUND');
      return;
    case 'RETURN_NOT_ELIGIBLE':
    case 'RETURN_WINDOW_EXPIRED':
      sendPublicError(request, reply, 422, error.code);
      return;
    case 'QUANTITY_UNAVAILABLE':
      // ReturnDomainError currently carries no available-quantity snapshot. Keep the 422 result
      // without fabricating metadata at this boundary.
      sendPublicError(request, reply, 422, 'RETURN_NOT_ELIGIBLE');
      return;
    case 'INVALID_TRANSITION':
    case 'STALE_VERSION':
    case 'IDEMPOTENCY_CONFLICT':
    case 'PAYMENT_NOT_REFUNDABLE':
    case 'RETURN_DATA_CORRUPT':
      sendPublicError(request, reply, 409, error.code);
      return;
  }
}

export default function adminReturnsRoutes(app: FastifyInstance, { services }: AppContext): void {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();

  typed.get(
    '/api/admin/returns',
    {
      preHandler: [requireAdmin(services.sessions)],
      schema: {
        querystring: AdminReturnListQuery,
        response: {
          200: AdminReturnListResponse,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    (request) => {
      return services.returns.listReturns({
        status: request.query.status,
        page: request.query.page ?? 1,
        pageSize: request.query.pageSize ?? 20,
      });
    },
  );

  typed.post(
    '/api/admin/returns/:returnId/decision',
    {
      preHandler: [requireAdmin(services.sessions)],
      schema: {
        params: ReturnIdParam,
        body: AdminDecisionBody,
        response: {
          200: ReturnRequest,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
          422: ErrorResponse,
        },
      },
    },
    (request, reply) => {
      const returnId = Number(request.params.returnId);
      const userId = request.authenticatedUser!.id;
      try {
        return services.returns.decideReturn({
          returnId,
          version: request.body.version,
          decision: request.body.decision,
          idempotencyKey: request.body.idempotencyKey,
          context: auditContext(userId, request.id, request.resolvedCountry),
        });
      } catch (error) {
        if (error instanceof ReturnDomainError) {
          sendReturnError(request, reply, error);
          return;
        }
        throw error;
      }
    },
  );

  typed.post(
    '/api/admin/returns/:returnId/receive',
    {
      preHandler: [requireAdmin(services.sessions)],
      schema: {
        params: ReturnIdParam,
        body: AdminReceiveBody,
        response: {
          200: ReturnRequest,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    (request, reply) => {
      const returnId = Number(request.params.returnId);
      const userId = request.authenticatedUser!.id;
      try {
        return services.returns.receiveReturn({
          returnId,
          version: request.body.version,
          idempotencyKey: request.body.idempotencyKey,
          context: auditContext(userId, request.id, request.resolvedCountry),
        });
      } catch (error) {
        if (error instanceof ReturnDomainError) {
          sendReturnError(request, reply, error);
          return;
        }
        throw error;
      }
    },
  );

  typed.post(
    '/api/admin/returns/:returnId/refund',
    {
      preHandler: [requireAdmin(services.sessions)],
      schema: {
        params: ReturnIdParam,
        body: AdminRefundBody,
        response: {
          200: ReturnRequest,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
          422: ErrorResponse,
        },
      },
    },
    (request, reply) => {
      const returnId = Number(request.params.returnId);
      const userId = request.authenticatedUser!.id;
      try {
        return services.returns.refundReturn({
          returnId,
          version: request.body.version,
          idempotencyKey: request.body.idempotencyKey,
          context: auditContext(userId, request.id, request.resolvedCountry),
        });
      } catch (error) {
        if (error instanceof ReturnDomainError) {
          sendReturnError(request, reply, error);
          return;
        }
        throw error;
      }
    },
  );
}
