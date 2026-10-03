import { Type } from '@sinclair/typebox';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { ErrorResponse } from '@shop/contracts/common';
import {
  AdminCapturedWebhook,
  AdminCapturedWebhookListQuery,
  AdminCapturedWebhookPage,
  type AdminCapturedWebhook as AdminCapturedWebhookResponse,
} from '@shop/contracts/webhooks';
import type { FastifyInstance } from 'fastify';
import type { SessionService } from '../features/auth/sessionService.js';
import type { CapturedWebhook } from '../features/webhooks/webhookRepository.js';
import type { createWebhookService } from '../features/webhooks/webhookService.js';
import { requireAdmin } from '../plugins/auth.js';
import { sendPublicError } from '../utils/errors.js';

const WebhookIdParam = Type.Object(
  { webhookId: Type.String({ pattern: '^[1-9][0-9]*$' }) },
  { additionalProperties: false },
);

export interface AdminWebhooksRouteServices {
  sessions: SessionService;
  webhooks: ReturnType<typeof createWebhookService>;
}

function transport(webhook: CapturedWebhook): AdminCapturedWebhookResponse {
  return {
    id: String(webhook.id),
    source: webhook.source,
    eventId: webhook.eventId,
    eventType: webhook.eventType as AdminCapturedWebhookResponse['eventType'],
    payload: webhook.payload,
    receivedAt: webhook.receivedAt,
    status: webhook.status,
    processedAt: webhook.processedAt,
    failureReason: webhook.failureReason,
    jobId: webhook.jobId === null ? null : String(webhook.jobId),
  };
}

export default function adminWebhooksRoutes(
  app: FastifyInstance,
  { services }: { services: AdminWebhooksRouteServices },
): void {
  app.addHook('preValidation', requireAdmin(services.sessions));
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();
  typed.get(
    '/api/admin/webhooks',
    {
      preHandler: [requireAdmin(services.sessions)],
      schema: {
        querystring: AdminCapturedWebhookListQuery,
        response: { 200: AdminCapturedWebhookPage, 401: ErrorResponse, 403: ErrorResponse },
      },
    },
    (request) => {
      const page = services.webhooks.list(request.query);
      return { ...page, items: page.items.map(transport) };
    },
  );
  typed.get(
    '/api/admin/webhooks/:webhookId',
    {
      preHandler: [requireAdmin(services.sessions)],
      schema: {
        params: WebhookIdParam,
        response: {
          200: AdminCapturedWebhook,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    (request, reply) => {
      const webhook = services.webhooks.get(Number(request.params.webhookId));
      if (!webhook) return sendPublicError(request, reply, 404, 'WEBHOOK_NOT_FOUND');
      return transport(webhook);
    },
  );
}
