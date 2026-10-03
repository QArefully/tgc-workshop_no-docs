import { Type } from '@sinclair/typebox';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { ErrorResponse } from '@shop/contracts/common';
import {
  MarkAllReadResponse,
  Notification,
  NotificationListQuery,
  NotificationPage,
} from '@shop/contracts/notifications';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';
import { requireAuth } from '../plugins/auth.js';
import { sendPublicError } from '../utils/errors.js';

const NotificationIdParam = Type.Object(
  { notificationId: Type.String({ pattern: '^[1-9][0-9]*$' }) },
  { additionalProperties: false },
);
const context = (userId: number, requestId: string) => ({
  actor: { type: 'user' as const, userId },
  requestId,
});
const transport = (notification: Notification): Notification => ({ ...notification });

/** Buyer notification inbox endpoints remain owner-scoped at the service boundary. */
export default function notificationRoutes(app: FastifyInstance, { services }: AppContext): void {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();
  const auth = [requireAuth(services.sessions)];
  typed.get(
    '/api/notifications',
    {
      preHandler: auth,
      schema: {
        querystring: NotificationListQuery,
        response: { 200: NotificationPage, 401: ErrorResponse },
      },
    },
    (request) => {
      const page = services.notifications.list(request.authenticatedUser!.id, request.query);
      return { ...page, items: page.items.map(transport) };
    },
  );
  typed.post(
    '/api/notifications/:notificationId/read',
    {
      preHandler: auth,
      schema: {
        params: NotificationIdParam,
        response: {
          200: Notification,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    (request, reply) => {
      const userId = request.authenticatedUser!.id;
      const result = services.notifications.markRead(
        userId,
        Number(request.params.notificationId),
        context(userId, request.id),
      );
      if (!result.ok) {
        if (result.code === 'NOT_FOUND') {
          sendPublicError(request, reply, 404, 'NOTIFICATION_NOT_FOUND');
        } else {
          sendPublicError(request, reply, 403, 'FORBIDDEN');
        }
        return;
      }
      return transport(result.value);
    },
  );
  typed.post(
    '/api/notifications/read-all',
    { preHandler: auth, schema: { response: { 200: MarkAllReadResponse, 401: ErrorResponse } } },
    (request) => {
      const userId = request.authenticatedUser!.id;
      return services.notifications.markAllRead(userId, context(userId, request.id));
    },
  );
}
