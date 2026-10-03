import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import {
  CreateTrackingEventBody,
  OrderDetailResponse,
  OrderIdParam,
  PackOrderBody,
  ShipmentIdParam,
  TransitionShipmentBody,
} from '@shop/contracts/orders';
import { ErrorResponse } from '@shop/contracts/common';
import type { Country } from '@shop/contracts/country';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';
import type { AuditContext } from '../features/audit/auditEvent.js';
import { OrderDomainError } from '../features/orders/orderErrors.js';
import { requireAdmin } from '../plugins/auth.js';
import { sendPublicError } from '../utils/errors.js';

function contextFor(userId: number, requestId: string, standingCountry: Country): AuditContext {
  return { actor: { type: 'user' as const, userId }, requestId, standingCountry };
}

function sendOrderError(
  request: Parameters<typeof sendPublicError>[0],
  reply: Parameters<typeof sendPublicError>[1],
  error: OrderDomainError,
): void {
  if (error.code === 'ORDER_NOT_FOUND' || error.code === 'ORDER_FORBIDDEN') {
    sendPublicError(request, reply, 404, 'ORDER_NOT_FOUND');
    return;
  }
  sendPublicError(request, reply, 409, error.code);
}

/** Narrow administrator lifecycle commands; there is intentionally no operations UI. */
export default function adminOrdersRoutes(app: FastifyInstance, { services }: AppContext): void {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();

  typed.post(
    '/api/admin/orders/:orderId/shipments',
    {
      preHandler: [requireAdmin(services.sessions)],
      schema: {
        params: OrderIdParam,
        body: PackOrderBody,
        response: {
          200: OrderDetailResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    (request, reply) => {
      try {
        return services.orders.pack({
          orderId: Number(request.params.orderId),
          version: request.body.version,
          idempotencyKey: request.body.idempotencyKey,
          shipments: request.body.shipments,
          context: contextFor(request.authenticatedUser!.id, request.id, request.resolvedCountry),
        });
      } catch (error) {
        if (error instanceof OrderDomainError) {
          sendOrderError(request, reply, error);
          return;
        }
        throw error;
      }
    },
  );

  typed.post(
    '/api/admin/order-shipments/:shipmentId/transition',
    {
      preHandler: [requireAdmin(services.sessions)],
      schema: {
        params: ShipmentIdParam,
        body: TransitionShipmentBody,
        response: {
          200: OrderDetailResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    (request, reply) => {
      try {
        return services.orders.transitionShipment({
          shipmentId: Number(request.params.shipmentId),
          version: request.body.version,
          status: request.body.status,
          idempotencyKey: request.body.idempotencyKey,
          context: contextFor(request.authenticatedUser!.id, request.id, request.resolvedCountry),
        });
      } catch (error) {
        if (error instanceof OrderDomainError) {
          sendOrderError(request, reply, error);
          return;
        }
        throw error;
      }
    },
  );

  typed.post(
    '/api/admin/order-shipments/:shipmentId/tracking-events',
    {
      preHandler: [requireAdmin(services.sessions)],
      schema: {
        params: ShipmentIdParam,
        body: CreateTrackingEventBody,
        response: {
          200: OrderDetailResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    (request, reply) => {
      try {
        return services.orders.addTrackingEvent({
          shipmentId: Number(request.params.shipmentId),
          version: request.body.version,
          code: request.body.code,
          title: request.body.title,
          detail: request.body.detail,
          location: request.body.location,
          idempotencyKey: request.body.idempotencyKey,
          context: contextFor(request.authenticatedUser!.id, request.id, request.resolvedCountry),
        });
      } catch (error) {
        if (error instanceof OrderDomainError) {
          sendOrderError(request, reply, error);
          return;
        }
        throw error;
      }
    },
  );
}
