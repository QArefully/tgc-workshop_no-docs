import type { FastifyInstance } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { DataExportResponse } from '@shop/contracts/account-depth';
import { ErrorResponse } from '@shop/contracts/common';
import type { DataExportService } from '../features/accountExport/dataExportService.js';
import type { SessionService } from '../features/auth/sessionService.js';
import { requireAuth } from '../plugins/auth.js';

export interface AccountExportRouteServices {
  sessions: SessionService;
  dataExport: DataExportService;
}

/** Authenticated self-service export. Composition-root registration is intentionally separate. */
export default function accountExportRoutes(
  app: FastifyInstance,
  { services }: { services: AccountExportRouteServices },
): void {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();
  typed.get(
    '/api/account/export',
    {
      preHandler: [requireAuth(services.sessions)],
      schema: { response: { 200: DataExportResponse, 401: ErrorResponse } },
    },
    (request, reply) => {
      const user = request.authenticatedUser!;
      reply.code(200).send(
        services.dataExport.exportForUser({
          user,
          currentSessionToken: request.sessionToken!,
          context: { actor: { type: 'user', userId: user.id }, requestId: request.id },
        }),
      );
    },
  );
}
