import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { SessionService } from '../features/auth/sessionService.js';
import type { SessionUser } from '../features/auth/sessionRepository.js';
import type { AuditContext } from '../features/audit/auditEvent.js';
import type { SessionAuditDetails } from '../features/auth/sessionService.js';
import { sendPublicError } from '../utils/errors.js';

export type AuthenticatedUser = SessionUser;

/** Persist session state through the service; cookie serialization remains an HTTP concern. */
export function createSession(
  sessions: SessionService,
  reply: FastifyReply,
  userId: number,
  audit?: SessionAuditDetails,
): string | null {
  const session = sessions.create(userId, audit);
  if (!session) return null;
  const { token, expiresAt } = session;
  reply.setCookie('sid', token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000)),
    secure: false,
  });
  return token;
}

export function destroySession(
  sessions: SessionService,
  request: FastifyRequest,
  reply: FastifyReply,
  context?: AuditContext,
): void {
  const token = request.cookies?.sid;
  if (token) sessions.destroy(token, context);
  reply.clearCookie('sid', { path: '/' });
}

export function getAuthenticatedUser(
  sessions: SessionService,
  request: FastifyRequest,
): AuthenticatedUser | null {
  const token = request.cookies?.sid;
  return token ? sessions.getUser(token) : null;
}

/** Resolve admin identity from the parent hook, with a direct-route harness fallback. */
function resolveAdminUser(
  sessions: SessionService,
  request: FastifyRequest,
): AuthenticatedUser | null {
  const resolved = request.authenticatedUser as AuthenticatedUser | null | undefined;
  if (resolved !== undefined) return resolved;

  const user = getAuthenticatedUser(sessions, request);
  request.authenticatedUser = user;
  return user;
}

export function requireAuth(sessions: SessionService) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    // Authentication is resolved once, in the application preValidation hook. Keeping this
    // guard read-only avoids a second session lookup after request validation has run and makes
    // the identity available to validation-time hooks and handlers alike.
    void sessions;
    const user = request.authenticatedUser;
    if (!user) {
      sendPublicError(request, reply, 401, 'UNAUTHORIZED');
      return;
    }
  };
}

/** Require a valid session whose user has the administrator role. */
export function requireAdmin(sessions: SessionService) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const user = resolveAdminUser(sessions, request);
    if (!user) {
      sendPublicError(request, reply, 401, 'UNAUTHORIZED');
      return;
    }
    if (user.role !== 'admin') {
      sendPublicError(request, reply, 403, 'FORBIDDEN');
      return;
    }
  };
}

/** Require a valid session whose user has the customer role. */
export function requireCustomer(sessions: SessionService) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    void sessions;
    const user = request.authenticatedUser;
    if (!user) {
      sendPublicError(request, reply, 401, 'UNAUTHORIZED');
      return;
    }
    if (user.role !== 'customer') {
      sendPublicError(request, reply, 403, 'FORBIDDEN');
      return;
    }
  };
}

/** Attach request-local authentication state. */
export function authPlugin(sessions: SessionService) {
  return (app: FastifyInstance, _opts: unknown, done: () => void): void => {
    app.decorateRequest('authenticatedUser', null);
    app.decorateRequest('sessionToken', null);
    // Resolve identity before schema validation. This hook is intentionally read-only: invalid
    // requests must not mutate session state, while later route guards can reuse the same lookup.
    app.addHook('preValidation', (request, _reply, next) => {
      const user = getAuthenticatedUser(sessions, request);
      request.authenticatedUser = user;
      request.sessionToken = user ? (request.cookies?.sid ?? null) : null;
      next();
    });
    // Last-seen is the sole auth mutation and runs only after validation succeeds. The global hook
    // is registered once, so a route-level requireAuth/requireAdmin/requireCustomer cannot double
    // the write.
    app.addHook('preHandler', (request, _reply, next) => {
      const token = request.cookies?.sid;
      if (request.authenticatedUser && token && request.sessionToken === token)
        sessions.updateLastSeen(token);
      next();
    });
    done();
  };
}

declare module 'fastify' {
  interface FastifyRequest {
    authenticatedUser: AuthenticatedUser | null;
    sessionToken: string | null;
  }
}
