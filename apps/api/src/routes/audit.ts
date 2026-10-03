import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { AuditEventListResponse, AuditEventQuery } from '@shop/contracts/audit';
import { ErrorResponse } from '@shop/contracts/common';
import type { FastifyInstance } from 'fastify';
import { type AuditReadService } from '../features/audit/auditService.js';
import { AuditQueryError } from '../features/audit/auditQuery.js';
import { requireAdmin } from '../plugins/auth.js';
import type { SessionService } from '../features/auth/sessionService.js';
import { sendPublicError } from '../utils/errors.js';

export interface AuditRouteServices {
  sessions: SessionService;
  audit: AuditReadService;
}

/** Admin-only, read-only audit ledger endpoint. */
export default function auditRoutes(
  app: FastifyInstance,
  { services }: { services: AuditRouteServices },
): void {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();

  typed.get(
    '/api/admin/audit-events',
    {
      preHandler: [requireAdmin(services.sessions)],
      schema: {
        querystring: AuditEventQuery,
        response: {
          200: AuditEventListResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
      // This route is also mounted by focused test harnesses without the application-wide error
      // handler. Keep validation failures on the same public contract in both compositions.
      errorHandler(error, request, reply) {
        if (error.validation) {
          sendPublicError(request, reply, 400, 'REQUEST_INVALID');
          return;
        }
        throw error;
      },
    },
    (request, reply) => {
      try {
        const page = services.audit.list(request.query);
        return reply.code(200).send({
          ...page,
          items: page.items.map((event) => ({
            ...event,
            actorUserId: event.actorUserId === null ? null : String(event.actorUserId),
          })),
        });
      } catch (error) {
        if (error instanceof AuditQueryError) {
          sendPublicError(request, reply, 400, 'INVALID_QUERY');
          return;
        }
        throw error;
      }
    },
  );
}
