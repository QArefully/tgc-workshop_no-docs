import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { ErrorResponse, SuccessResponse } from '@shop/contracts/common';
import { RevokeSessionParams, SessionListResponse } from '@shop/contracts/account-depth';
import { requireAuth } from '../plugins/auth.js';
import type { SessionService } from '../features/auth/sessionService.js';
import { sendPublicError } from '../utils/errors.js';

export interface AccountSessionRouteServices {
  sessions: SessionService;
}

function auditContext(userId: number, requestId: string) {
  return { actor: { type: 'user' as const, userId }, requestId };
}

function sendSessionError(
  request: FastifyRequest,
  reply: FastifyReply,
  code: 'CANNOT_REVOKE_CURRENT' | 'SESSION_NOT_FOUND',
): void {
  if (code === 'CANNOT_REVOKE_CURRENT') {
    sendPublicError(request, reply, 400, code);
    return;
  }
  sendPublicError(request, reply, 404, code);
}

/** Authenticated buyer endpoints for inspecting and selectively revoking their own sessions. */
export default function accountSessionRoutes(
  app: FastifyInstance,
  { services }: { services: AccountSessionRouteServices },
): void {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();

  typed.get(
    '/api/account/sessions',
    {
      preHandler: [requireAuth(services.sessions)],
      schema: { response: { 200: SessionListResponse, 401: ErrorResponse } },
    },
    async (request, reply) => {
      reply
        .code(200)
        .send(services.sessions.listForUser(request.authenticatedUser!.id, request.sessionToken!));
    },
  );

  typed.delete(
    '/api/account/sessions/:sessionId',
    {
      preHandler: [requireAuth(services.sessions)],
      schema: {
        params: RevokeSessionParams,
        response: {
          200: SuccessResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const user = request.authenticatedUser!;
      const result = services.sessions.revokeForUser(
        user.id,
        request.params.sessionId,
        request.sessionToken!,
        auditContext(user.id, request.id),
      );
      if (!result.ok) {
        sendSessionError(request, reply, result.code);
        return;
      }
      reply.code(200).send({ success: true as const });
    },
  );
}
