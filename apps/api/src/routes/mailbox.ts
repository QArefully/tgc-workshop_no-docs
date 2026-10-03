import { FastifyInstance } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Value } from '@sinclair/typebox/value';
import { MailboxListResponse } from '@shop/contracts/mailbox';
import type { AppContext } from '../app.js';

/**
 * Dev mailbox routes.
 * Lists all mailbox messages (e.g. password reset emails).
 */
export default function mailboxRoutes(app: FastifyInstance, { services }: AppContext): void {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();

  typed.get(
    '/api/dev/mailbox',
    {
      schema: {
        response: {
          200: MailboxListResponse,
        },
      },
    },
    async (_request, reply) => {
      const messages = services.mailbox.list();
      // Keep the dev route fail-closed even when a persisted row was bypass-written. Fastify's
      // response schema remains the transport boundary; this check gives the repository error a
      // deterministic failure before serialization.
      if (!Value.Check(MailboxListResponse, messages)) {
        throw new Error('Mailbox repository returned an invalid response');
      }
      reply.code(200).send(messages);
    },
  );
}
