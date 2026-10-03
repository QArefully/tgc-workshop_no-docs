import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { sendPublicError } from '../utils/errors.js';
import { ErrorResponse } from '@shop/contracts/common';
import { OrderIdParam } from '@shop/contracts/orders';
import {
  CreateReturnRequestBody,
  ReturnOverviewResponse,
  ReturnRequest,
} from '@shop/contracts/returns';
import type { AppContext } from '../app.js';
import { ReturnDomainError } from '../features/returns/returnErrors.js';
import { requireCustomer } from '../plugins/auth.js';

function sendReturnError(
  request: FastifyRequest,
  reply: FastifyReply,
  error: ReturnDomainError,
): void {
  switch (error.code) {
    case 'RETURN_NOT_FOUND':
      sendPublicError(request, reply, 404, 'RETURN_NOT_FOUND');
      return;
    case 'RETURN_NOT_ELIGIBLE':
      sendPublicError(request, reply, 422, 'RETURN_NOT_ELIGIBLE');
      return;
    case 'RETURN_WINDOW_EXPIRED':
      sendPublicError(request, reply, 422, 'RETURN_WINDOW_EXPIRED');
      return;
    case 'QUANTITY_UNAVAILABLE':
      // ReturnDomainError currently carries no available-quantity snapshot. Keep the 422 result
      // without fabricating metadata at this boundary.
      sendPublicError(request, reply, 422, 'RETURN_NOT_ELIGIBLE');
      return;
    case 'INVALID_TRANSITION':
      sendPublicError(request, reply, 409, 'INVALID_TRANSITION');
      return;
    case 'STALE_VERSION':
      sendPublicError(request, reply, 409, 'STALE_VERSION');
      return;
    case 'IDEMPOTENCY_CONFLICT':
      sendPublicError(request, reply, 409, 'IDEMPOTENCY_CONFLICT');
      return;
    case 'PAYMENT_NOT_REFUNDABLE':
      sendPublicError(request, reply, 409, 'PAYMENT_NOT_REFUNDABLE');
      return;
    case 'RETURN_DATA_CORRUPT':
      sendPublicError(request, reply, 409, 'RETURN_DATA_CORRUPT');
      return;
  }
}

function auditContext(userId: number, requestId: string) {
  return { actor: { type: 'user' as const, userId }, requestId };
}

export default function returnsRoutes(app: FastifyInstance, { services }: AppContext): void {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();

  typed.get(
    '/api/orders/:orderId/returns',
    {
      preHandler: [requireCustomer(services.sessions)],
      schema: {
        params: OrderIdParam,
        response: {
          200: ReturnOverviewResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    (request, reply) => {
      const orderId = Number(request.params.orderId);
      const userId = request.authenticatedUser!.id;
      try {
        return services.returns.getOverview(orderId, userId);
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
    '/api/orders/:orderId/returns',
    {
      preHandler: [requireCustomer(services.sessions)],
      schema: {
        params: OrderIdParam,
        body: CreateReturnRequestBody,
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
      const orderId = Number(request.params.orderId);
      const userId = request.authenticatedUser!.id;
      try {
        return services.returns.requestReturn({
          orderId,
          userId,
          idempotencyKey: request.body.idempotencyKey,
          reason: request.body.reason,
          note: request.body.note ?? null,
          selections: request.body.selections,
          context: auditContext(userId, request.id),
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
