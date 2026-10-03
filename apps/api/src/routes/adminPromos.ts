import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import {
  AdminPromo,
  AdminPromoCodeParam,
  AdminPromoListQuery,
  AdminPromoListResponse,
  CreateAdminPromoBody,
  DeactivateAdminPromoBody,
  UpdateAdminPromoBody,
  type AdminPromo as AdminPromoResponse,
} from '@shop/contracts/admin-promos';
import type { AdminCatalogCategory } from '@shop/contracts/admin-products';
import { ErrorResponse } from '@shop/contracts/common';
import type { Country } from '@shop/contracts/country';
import type { FastifyInstance } from 'fastify';
import type { SessionService } from '../features/auth/sessionService.js';
import type { AuditContext } from '../features/audit/auditEvent.js';
import {
  PromoAdminServiceError,
  type PromoAdminService,
} from '../features/promos/promoAdminService.js';
import type { PromoRecord } from '../features/promos/promoRepository.js';
import { requireAdmin } from '../plugins/auth.js';
import { sendPublicError } from '../utils/errors.js';
export interface AdminPromosRouteServices {
  sessions: SessionService;
  promoAdmin: PromoAdminService;
}
const context = (userId: number, requestId: string, standingCountry: Country): AuditContext => ({
  actor: { type: 'user' as const, userId },
  requestId,
  standingCountry,
});
function sendError(
  request: Parameters<typeof sendPublicError>[0],
  reply: Parameters<typeof sendPublicError>[1],
  e: PromoAdminServiceError,
) {
  if (e.code === 'NOT_FOUND') return sendPublicError(request, reply, 404, 'PROMO_NOT_FOUND');
  if (e.code === 'DUPLICATE') return sendPublicError(request, reply, 409, 'DUPLICATE');
  if (e.code === 'ACTIVE_RESERVATIONS')
    return sendPublicError(request, reply, 409, 'ACTIVE_RESERVATIONS');
  return sendPublicError(request, reply, 400, 'INVALID_INPUT');
}
function categoryScope(value: string | null): AdminCatalogCategory | null {
  if (value === null) return null;
  switch (value) {
    case 'Sports Nutrition':
    case 'Baking & Pantry':
    case 'Drinks':
    case 'Household & Cleaning':
    case 'Garden & Outdoors':
    case 'Trade & Creative Materials':
      return value;
    default:
      throw new Error('Unexpected promo category');
  }
}
const map = (promo: PromoRecord): AdminPromoResponse => ({
  ...promo,
  categoryScope: categoryScope(promo.categoryScope),
});
export default function adminPromosRoutes(
  app: FastifyInstance,
  { services }: { services: AdminPromosRouteServices },
): void {
  app.addHook('preValidation', requireAdmin(services.sessions));
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();
  typed.get(
    '/api/admin/promos',
    {
      preHandler: [requireAdmin(services.sessions)],
      schema: {
        querystring: AdminPromoListQuery,
        response: {
          200: AdminPromoListResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    (r) => ({ items: services.promoAdmin.listAdmin(r.query, r.resolvedCountry).map(map) }),
  );
  typed.get(
    '/api/admin/promos/:code',
    {
      preHandler: [requireAdmin(services.sessions)],
      schema: {
        params: AdminPromoCodeParam,
        response: {
          200: AdminPromo,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    (r, reply) => {
      try {
        return map(services.promoAdmin.get(r.params.code, r.resolvedCountry));
      } catch (e) {
        if (e instanceof PromoAdminServiceError) return sendError(r, reply, e);
        throw e;
      }
    },
  );
  typed.post(
    '/api/admin/promos',
    {
      preHandler: [requireAdmin(services.sessions)],
      schema: {
        body: CreateAdminPromoBody,
        response: {
          201: AdminPromo,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    (r, reply) => {
      try {
        reply.code(201);
        return map(
          services.promoAdmin.create(
            r.body,
            context(r.authenticatedUser!.id, r.id, r.resolvedCountry),
            r.resolvedCountry,
          ),
        );
      } catch (e) {
        if (e instanceof PromoAdminServiceError) return sendError(r, reply, e);
        throw e;
      }
    },
  );
  typed.put(
    '/api/admin/promos/:code',
    {
      preHandler: [requireAdmin(services.sessions)],
      schema: {
        params: AdminPromoCodeParam,
        body: UpdateAdminPromoBody,
        response: {
          200: AdminPromo,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    (r, reply) => {
      try {
        return map(
          services.promoAdmin.update(
            r.params.code,
            r.body,
            context(r.authenticatedUser!.id, r.id, r.resolvedCountry),
            r.resolvedCountry,
          ),
        );
      } catch (e) {
        if (e instanceof PromoAdminServiceError) return sendError(r, reply, e);
        throw e;
      }
    },
  );
  typed.post(
    '/api/admin/promos/:code/deactivate',
    {
      preHandler: [requireAdmin(services.sessions)],
      schema: {
        params: AdminPromoCodeParam,
        body: DeactivateAdminPromoBody,
        response: {
          200: AdminPromo,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    (r, reply) => {
      try {
        return map(
          services.promoAdmin.deactivate(
            r.params.code,
            context(r.authenticatedUser!.id, r.id, r.resolvedCountry),
            r.body,
            r.resolvedCountry,
          ),
        );
      } catch (e) {
        if (e instanceof PromoAdminServiceError) return sendError(r, reply, e);
        throw e;
      }
    },
  );
}
