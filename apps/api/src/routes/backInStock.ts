import { Type } from '@sinclair/typebox';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { ErrorResponse, SuccessResponse } from '@shop/contracts/common';
import {
  BackInStockStatus,
  BackInStockSubscription,
  BackInStockSubscriptionIdParam,
  BackInStockSubscriptionListResponse,
  CreateBackInStockSubscriptionBody,
  type BackInStockSubscription as BackInStockSubscriptionResponse,
} from '@shop/contracts/back-in-stock';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';
import type { AuditContext } from '../features/audit/auditEvent.js';
import type { BackInStockErrorCode } from '../features/backInStock/backInStockErrors.js';
import { requireAuth } from '../plugins/auth.js';
import { sendPublicError } from '../utils/errors.js';

/** Optional buyer-side filter; the service owns the ownership scope, this only narrows status. */
const BackInStockListQuery = Type.Object(
  { status: Type.Optional(BackInStockStatus) },
  { additionalProperties: false },
);

const BackInStockErrorResponse = Type.Object(
  {
    code: Type.Union([
      Type.Literal('VARIANT_NOT_FOUND'),
      Type.Literal('VARIANT_RETIRED'),
      Type.Literal('VARIANT_AVAILABLE'),
      Type.Literal('ALREADY_SUBSCRIBED'),
      Type.Literal('SUBSCRIPTION_LIMIT_REACHED'),
      Type.Literal('SUBSCRIPTION_NOT_FOUND'),
    ]),
    error: Type.String({ minLength: 1, maxLength: 500 }),
  },
  { additionalProperties: false },
);

const BACK_IN_STOCK_ERROR_STATUS: Readonly<Record<BackInStockErrorCode, 404 | 409>> = {
  VARIANT_NOT_FOUND: 404,
  VARIANT_RETIRED: 409,
  VARIANT_AVAILABLE: 409,
  ALREADY_SUBSCRIBED: 409,
  SUBSCRIPTION_LIMIT_REACHED: 409,
  SUBSCRIPTION_NOT_FOUND: 404,
};

function auditContext(userId: number, requestId: string): AuditContext {
  return { actor: { type: 'user', userId }, requestId };
}

/** Domain records are copied into their public contract shape at this boundary. */
function toTransport(value: BackInStockSubscriptionResponse): BackInStockSubscriptionResponse {
  return { ...value };
}

function sendBackInStockError(
  request: Parameters<typeof sendPublicError>[0],
  reply: Parameters<typeof sendPublicError>[1],
  code: BackInStockErrorCode,
): void {
  sendPublicError(request, reply, BACK_IN_STOCK_ERROR_STATUS[code], code);
}

/**
 * Authenticated buyer routes for back-in-stock interest.
 *
 * The contract transports `subscriptionId` as a string; the domain service keys on the numeric
 * row id, so the conversion happens here and nowhere deeper.
 */
export default function backInStockRoutes(app: FastifyInstance, { services }: AppContext): void {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();
  const auth = [requireAuth(services.sessions)];

  typed.get(
    '/api/back-in-stock',
    {
      preHandler: auth,
      schema: {
        querystring: BackInStockListQuery,
        response: {
          200: BackInStockSubscriptionListResponse,
          400: ErrorResponse,
          401: ErrorResponse,
        },
      },
    },
    (request) =>
      services.backInStock
        .listOwned(request.authenticatedUser!.id, request.query.status)
        .map(toTransport),
  );

  typed.post(
    '/api/back-in-stock',
    {
      preHandler: auth,
      schema: {
        body: CreateBackInStockSubscriptionBody,
        response: {
          201: BackInStockSubscription,
          400: ErrorResponse,
          401: ErrorResponse,
          404: BackInStockErrorResponse,
          409: BackInStockErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const userId = request.authenticatedUser!.id;
      const result = services.backInStock.subscribe(
        userId,
        request.body.variantId,
        auditContext(userId, request.id),
      );
      if (!result.ok) {
        sendBackInStockError(request, reply, result.code);
        return;
      }
      return reply.code(201).send(toTransport(result.value));
    },
  );

  typed.delete(
    '/api/back-in-stock/:subscriptionId',
    {
      preHandler: auth,
      schema: {
        params: BackInStockSubscriptionIdParam,
        response: {
          200: SuccessResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          404: BackInStockErrorResponse,
          409: BackInStockErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const userId = request.authenticatedUser!.id;
      const result = services.backInStock.cancel(
        userId,
        Number(request.params.subscriptionId),
        auditContext(userId, request.id),
      );
      if (!result.ok) {
        sendBackInStockError(request, reply, result.code);
        return;
      }
      return { success: true as const };
    },
  );
}
