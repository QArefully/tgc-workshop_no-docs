import type { FastifyInstance } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { ErrorResponse } from '@shop/contracts/common';
import { UpdatePreferencesBody, UserPreferences } from '@shop/contracts/account-depth';
import type { PreferencesService } from '../features/preferences/preferencesService.js';
import type { SessionService } from '../features/auth/sessionService.js';
import { requireAuth } from '../plugins/auth.js';

export interface AccountPreferencesRouteServices {
  sessions: SessionService;
  preferences: PreferencesService;
}

function auditContext(userId: number, requestId: string) {
  return { actor: { type: 'user' as const, userId }, requestId };
}

/** Authenticated buyer endpoints for persisted email notification opt-ins. */
export default function accountPreferencesRoutes(
  app: FastifyInstance,
  { services }: { services: AccountPreferencesRouteServices },
): void {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();

  typed.get(
    '/api/account/preferences',
    {
      preHandler: [requireAuth(services.sessions)],
      schema: { response: { 200: UserPreferences, 401: ErrorResponse } },
    },
    async (request, reply) => {
      reply.code(200).send(services.preferences.get(request.authenticatedUser!.id));
    },
  );

  typed.patch(
    '/api/account/preferences',
    {
      preHandler: [requireAuth(services.sessions)],
      schema: {
        body: UpdatePreferencesBody,
        response: { 200: UserPreferences, 401: ErrorResponse },
      },
    },
    async (request, reply) => {
      const user = request.authenticatedUser!;
      reply
        .code(200)
        .send(
          services.preferences.update(user.id, request.body, auditContext(user.id, request.id)),
        );
    },
  );
}
