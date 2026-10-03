import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import {
  AdminOrderDetailResponse,
  AdminOrdersListResponse,
} from '@shop/contracts/admin-orders-list';
import { ErrorResponse } from '@shop/contracts/common';
import {
  AdminOrderListQuery as AdminOrderListQuerySchema,
  OrderIdParam,
} from '@shop/contracts/orders';
import type { FastifyInstance } from 'fastify';
import type { SessionService } from '../features/auth/sessionService.js';
import { OrderAdminError, type OrderAdminService } from '../features/orders/orderAdminService.js';
import { requireAdmin } from '../plugins/auth.js';
import { sendPublicError } from '../utils/errors.js';
export interface AdminOrdersListRouteServices {
  sessions: SessionService;
  orderAdmin: OrderAdminService;
}
function sendError(
  request: Parameters<typeof sendPublicError>[0],
  reply: Parameters<typeof sendPublicError>[1],
  e: OrderAdminError,
) {
  if (e.code === 'ORDER_NOT_FOUND') return sendPublicError(request, reply, 404, 'ORDER_NOT_FOUND');
  return sendPublicError(request, reply, 400, 'INVALID_QUERY');
}
export default function adminOrdersListRoutes(
  app: FastifyInstance,
  { services }: { services: AdminOrdersListRouteServices },
): void {
  app.addHook('preValidation', requireAdmin(services.sessions));
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();
  typed.get(
    '/api/admin/orders',
    {
      preHandler: [requireAdmin(services.sessions)],
      schema: {
        querystring: AdminOrderListQuerySchema,
        response: {
          200: AdminOrdersListResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    (r, reply) => {
      try {
        return services.orderAdmin.listAdmin(r.query, r.resolvedCountry);
      } catch (e) {
        if (e instanceof OrderAdminError) return sendError(r, reply, e);
        throw e;
      }
    },
  );
  typed.get(
    '/api/admin/orders/:orderId',
    {
      preHandler: [requireAdmin(services.sessions)],
      schema: {
        params: OrderIdParam,
        response: {
          200: AdminOrderDetailResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    (r, reply) => {
      try {
        return services.orderAdmin.getAdminDetail(Number(r.params.orderId), r.resolvedCountry);
      } catch (e) {
        if (e instanceof OrderAdminError) return sendError(r, reply, e);
        throw e;
      }
    },
  );
}
