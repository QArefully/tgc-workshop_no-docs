import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { ErrorResponse } from '@shop/contracts/common';
import { PaymentWebhookAck } from '@shop/contracts/webhooks';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';
import { WebhookError } from '../features/webhooks/webhookService.js';
import { sendPublicError } from '../utils/errors.js';

/** Payment processors sign exact JSON bytes, so this plugin preserves its JSON text route-locally. */
export default function webhookRoutes(app: FastifyInstance, { services }: AppContext): void {
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    done(null, body);
  });
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();
  typed.post(
    '/api/webhooks/payments',
    {
      schema: {
        response: { 202: PaymentWebhookAck, 400: ErrorResponse, 401: ErrorResponse },
      },
    },
    (request, reply) => {
      const signature = request.headers['x-webhook-signature'];
      if (typeof signature !== 'string')
        return sendPublicError(request, reply, 401, 'INVALID_SIGNATURE');
      try {
        const captured = services.webhooks.capture({
          rawPayload: request.body as string,
          signature,
        });
        reply.code(202);
        return { webhookId: String(captured.webhook.id), replayed: captured.replayed };
      } catch (error) {
        if (error instanceof WebhookError) {
          if (error.code === 'INVALID_SIGNATURE')
            return sendPublicError(request, reply, 401, 'INVALID_SIGNATURE');
          return sendPublicError(request, reply, 400, 'INVALID_PAYLOAD');
        }
        throw error;
      }
    },
  );
}
