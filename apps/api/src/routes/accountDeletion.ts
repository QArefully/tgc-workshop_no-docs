import type { FastifyInstance } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { DeleteAccountBody } from '@shop/contracts/account-depth';
import { ErrorResponse, SuccessResponse } from '@shop/contracts/common';
import type { AccountDeletionService } from '../features/accountDeletion/deletionService.js';
import type { SessionService } from '../features/auth/sessionService.js';
import { requireAuth } from '../plugins/auth.js';
import { sendPublicError } from '../utils/errors.js';

export interface AccountDeletionRouteServices {
  sessions: SessionService;
  accountDeletion: AccountDeletionService;
}

/** Password-confirmed account redaction. Composition-root registration is intentionally separate. */
export default function accountDeletionRoutes(
  app: FastifyInstance,
  { services }: { services: AccountDeletionRouteServices },
): void {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();
  typed.post(
    '/api/account/delete',
    {
      preHandler: [requireAuth(services.sessions)],
      schema: {
        body: DeleteAccountBody,
        response: {
          200: SuccessResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const user = request.authenticatedUser!;
      const result = await services.accountDeletion.execute({
        userId: user.id,
        currentPassword: request.body.currentPassword,
        context: { actor: { type: 'user', userId: user.id }, requestId: request.id },
      });
      if (!result.ok) {
        if (result.code === 'INVALID_CURRENT') {
          sendPublicError(request, reply, 400, 'INVALID_CURRENT');
          return;
        }
        sendPublicError(request, reply, 409, 'OWNS_COMPANY');
        return;
      }
      reply.code(200).send({ success: true });
    },
  );
}
