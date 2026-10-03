import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import {
  AdminUserIdParam,
  AdminUserListQuery,
  AdminUserListResponse,
  SetAdminUserRoleBody,
  SuspendAdminUserBody,
  UpdateAdminUserDisplayNameBody,
} from '@shop/contracts/admin-users';
import { AdminUserView } from '@shop/contracts/auth';
import { ErrorResponse } from '@shop/contracts/common';
import type { Country } from '@shop/contracts/country';
import type { FastifyInstance } from 'fastify';
import type { SessionService } from '../features/auth/sessionService.js';
import type { AuditContext } from '../features/audit/auditEvent.js';
import { UserAdminServiceError, type UserAdminService } from '../features/auth/userAdminService.js';
import { requireAdmin } from '../plugins/auth.js';
import { sendPublicError } from '../utils/errors.js';
export interface AdminUsersRouteServices {
  sessions: SessionService;
  userAdmin: UserAdminService;
}
const context = (userId: number, requestId: string, standingCountry: Country): AuditContext => ({
  actor: { type: 'user' as const, userId },
  requestId,
  standingCountry,
});
const map = (u: ReturnType<UserAdminService['get']>): AdminUserView => ({
  ...u,
  id: String(u.id),
  suspendedByUserId: u.suspendedByUserId === null ? null : String(u.suspendedByUserId),
  country: u.country as AdminUserView['country'],
});
function sendError(
  request: Parameters<typeof sendPublicError>[0],
  reply: Parameters<typeof sendPublicError>[1],
  e: UserAdminServiceError,
) {
  if (e.code === 'NOT_FOUND') return sendPublicError(request, reply, 404, 'NOT_FOUND');
  if (e.code === 'LAST_ADMIN') return sendPublicError(request, reply, 409, 'LAST_ADMIN');
  return sendPublicError(request, reply, 400, 'INVALID_INPUT');
}
export default function adminUsersRoutes(
  app: FastifyInstance,
  { services }: { services: AdminUsersRouteServices },
): void {
  app.addHook('preValidation', requireAdmin(services.sessions));
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();
  typed.get(
    '/api/admin/users',
    {
      preHandler: [requireAdmin(services.sessions)],
      schema: {
        querystring: AdminUserListQuery,
        response: {
          200: AdminUserListResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    (r) => ({ items: services.userAdmin.list(r.query, r.resolvedCountry).map(map) }),
  );
  typed.get(
    '/api/admin/users/:userId',
    {
      preHandler: [requireAdmin(services.sessions)],
      schema: {
        params: AdminUserIdParam,
        response: {
          200: AdminUserView,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    (r, reply) => {
      try {
        return map(services.userAdmin.get(Number(r.params.userId), r.resolvedCountry));
      } catch (e) {
        if (e instanceof UserAdminServiceError) return sendError(r, reply, e);
        throw e;
      }
    },
  );
  typed.patch(
    '/api/admin/users/:userId/display-name',
    {
      preHandler: [requireAdmin(services.sessions)],
      schema: {
        params: AdminUserIdParam,
        body: UpdateAdminUserDisplayNameBody,
        response: {
          200: AdminUserView,
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
          services.userAdmin.updateDisplayName(
            Number(r.params.userId),
            r.body.displayName,
            context(r.authenticatedUser!.id, r.id, r.resolvedCountry),
            r.resolvedCountry,
          ),
        );
      } catch (e) {
        if (e instanceof UserAdminServiceError) return sendError(r, reply, e);
        throw e;
      }
    },
  );
  typed.patch(
    '/api/admin/users/:userId/role',
    {
      preHandler: [requireAdmin(services.sessions)],
      schema: {
        params: AdminUserIdParam,
        body: SetAdminUserRoleBody,
        response: {
          200: AdminUserView,
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
          services.userAdmin.setRole(
            Number(r.params.userId),
            r.body.role,
            context(r.authenticatedUser!.id, r.id, r.resolvedCountry),
            r.resolvedCountry,
          ),
        );
      } catch (e) {
        if (e instanceof UserAdminServiceError) return sendError(r, reply, e);
        throw e;
      }
    },
  );
  typed.post(
    '/api/admin/users/:userId/suspend',
    {
      preHandler: [requireAdmin(services.sessions)],
      schema: {
        params: AdminUserIdParam,
        body: SuspendAdminUserBody,
        response: {
          200: AdminUserView,
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
          services.userAdmin.suspend(
            Number(r.params.userId),
            r.body.reason,
            r.authenticatedUser!.id,
            context(r.authenticatedUser!.id, r.id, r.resolvedCountry),
            r.resolvedCountry,
          ),
        );
      } catch (e) {
        if (e instanceof UserAdminServiceError) return sendError(r, reply, e);
        throw e;
      }
    },
  );
  typed.post(
    '/api/admin/users/:userId/reactivate',
    {
      preHandler: [requireAdmin(services.sessions)],
      schema: {
        params: AdminUserIdParam,
        response: {
          200: AdminUserView,
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
          services.userAdmin.reactivate(
            Number(r.params.userId),
            r.authenticatedUser!.id,
            context(r.authenticatedUser!.id, r.id, r.resolvedCountry),
            r.resolvedCountry,
          ),
        );
      } catch (e) {
        if (e instanceof UserAdminServiceError) return sendError(r, reply, e);
        throw e;
      }
    },
  );
}
