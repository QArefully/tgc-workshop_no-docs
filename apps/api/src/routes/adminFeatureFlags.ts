import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import {
  AdminFeatureFlag,
  AdminFeatureFlagKeyParam,
  AdminFeatureFlagListResponse,
  CreateAdminFeatureFlagBody,
  UpdateAdminFeatureFlagBody,
  type AdminFeatureFlag as AdminFeatureFlagResponse,
} from '@shop/contracts/feature-flags';
import { ErrorResponse, SuccessResponse } from '@shop/contracts/common';
import type { Country } from '@shop/contracts/country';
import type { FastifyInstance } from 'fastify';
import type { SessionService } from '../features/auth/sessionService.js';
import type { AuditContext } from '../features/audit/auditEvent.js';
import {
  FeatureFlagServiceError,
  type FeatureFlagService,
} from '../features/featureFlags/featureFlagService.js';
import type { FeatureFlagRecord } from '../features/featureFlags/featureFlagRepository.js';
import { requireAdmin } from '../plugins/auth.js';
import { sendPublicError } from '../utils/errors.js';
export interface AdminFeatureFlagsRouteServices {
  sessions: SessionService;
  featureFlags: FeatureFlagService;
}
const context = (userId: number, requestId: string, standingCountry: Country): AuditContext => ({
  actor: { type: 'user' as const, userId },
  requestId,
  standingCountry,
});
function sendError(
  request: Parameters<typeof sendPublicError>[0],
  reply: Parameters<typeof sendPublicError>[1],
  e: FeatureFlagServiceError,
) {
  if (e.code === 'NOT_FOUND') return sendPublicError(request, reply, 404, 'NOT_FOUND');
  if (e.code === 'DUPLICATE') return sendPublicError(request, reply, 409, 'DUPLICATE');
  return sendPublicError(request, reply, 400, 'INVALID_INPUT');
}
const map = (flag: FeatureFlagRecord): AdminFeatureFlagResponse => ({
  ...flag,
  updatedByUserId: flag.updatedByUserId === null ? null : String(flag.updatedByUserId),
});
export default function adminFeatureFlagsRoutes(
  app: FastifyInstance,
  { services }: { services: AdminFeatureFlagsRouteServices },
): void {
  app.addHook('preValidation', requireAdmin(services.sessions));
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();
  typed.get(
    '/api/admin/feature-flags',
    {
      preHandler: [requireAdmin(services.sessions)],
      schema: {
        response: { 200: AdminFeatureFlagListResponse, 401: ErrorResponse, 403: ErrorResponse },
      },
    },
    () => ({ items: services.featureFlags.list().map(map) }),
  );
  typed.get(
    '/api/admin/feature-flags/:key',
    {
      preHandler: [requireAdmin(services.sessions)],
      schema: {
        params: AdminFeatureFlagKeyParam,
        response: {
          200: AdminFeatureFlag,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    (r, reply) => {
      try {
        return map(services.featureFlags.get(r.params.key));
      } catch (e) {
        if (e instanceof FeatureFlagServiceError) return sendError(r, reply, e);
        throw e;
      }
    },
  );
  typed.post(
    '/api/admin/feature-flags',
    {
      preHandler: [requireAdmin(services.sessions)],
      schema: {
        body: CreateAdminFeatureFlagBody,
        response: {
          201: AdminFeatureFlag,
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
          services.featureFlags.create(
            r.body,
            context(r.authenticatedUser!.id, r.id, r.resolvedCountry),
          ),
        );
      } catch (e) {
        if (e instanceof FeatureFlagServiceError) return sendError(r, reply, e);
        throw e;
      }
    },
  );
  typed.patch(
    '/api/admin/feature-flags/:key',
    {
      preHandler: [requireAdmin(services.sessions)],
      schema: {
        params: AdminFeatureFlagKeyParam,
        body: UpdateAdminFeatureFlagBody,
        response: {
          200: AdminFeatureFlag,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    (r, reply) => {
      try {
        return map(
          services.featureFlags.update(
            r.params.key,
            r.body,
            context(r.authenticatedUser!.id, r.id, r.resolvedCountry),
          ),
        );
      } catch (e) {
        if (e instanceof FeatureFlagServiceError) return sendError(r, reply, e);
        throw e;
      }
    },
  );
  typed.delete(
    '/api/admin/feature-flags/:key',
    {
      preHandler: [requireAdmin(services.sessions)],
      schema: {
        params: AdminFeatureFlagKeyParam,
        response: {
          200: SuccessResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    (r, reply) => {
      try {
        services.featureFlags.delete(
          r.params.key,
          context(r.authenticatedUser!.id, r.id, r.resolvedCountry),
        );
        return { success: true as const };
      } catch (e) {
        if (e instanceof FeatureFlagServiceError) return sendError(r, reply, e);
        throw e;
      }
    },
  );
}
