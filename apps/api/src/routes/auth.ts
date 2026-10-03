import { FastifyInstance } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { sendPublicError } from '../utils/errors.js';
import { createSession, destroySession, requireAuth } from '../plugins/auth.js';
import {
  SignupBody,
  LoginBody,
  ForgotPasswordBody,
  ResetPasswordBody,
  ChangePasswordBody,
  SuccessResponse,
  PublicUser,
  CurrentUserResponse,
} from '@shop/contracts/auth';
import { ErrorResponse } from '@shop/contracts/common';
import { toPublicUser } from '../features/auth/authService.js';
import type { AuditContext } from '../features/audit/auditEvent.js';
import type { AppContext } from '../app.js';

function anonymousAuditContext(requestId: string): AuditContext {
  return { actor: { type: 'anonymous', userId: null }, requestId };
}

function userAuditContext(userId: number, requestId: string): AuditContext {
  return { actor: { type: 'user', userId }, requestId };
}

/** Auth routes. */
export default function authRoutes(app: FastifyInstance, { services }: AppContext): void {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();

  // POST /signup
  typed.post(
    '/signup',
    {
      schema: {
        body: SignupBody,
        response: {
          201: PublicUser,
          400: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const { email, password, displayName, country } = request.body;

      const result = await services.auth.signup({
        email,
        password,
        displayName,
        country,
        auditContext: anonymousAuditContext(request.id),
      });

      if (!result.ok) {
        if (result.error === 'EMAIL_EXISTS') {
          sendPublicError(request, reply, 409, 'EMAIL_EXISTS');
          return;
        }
        sendPublicError(request, reply, 400, result.error);
        return;
      }

      const session = createSession(services.sessions, reply, result.userId, {
        context: userAuditContext(result.userId, request.id),
        source: 'signup',
      });
      if (!session) {
        sendPublicError(request, reply, 401, 'UNAUTHORIZED');
        return;
      }
      reply.code(201).send(result.user);
    },
  );

  // POST /login
  typed.post(
    '/login',
    {
      schema: {
        body: LoginBody,
        response: {
          200: PublicUser,
          400: ErrorResponse,
          401: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const { email, password, country } = request.body;

      const result = await services.auth.login({ email, password, country });

      if (!result.ok) {
        sendPublicError(request, reply, 401, result.error ?? 'UNAUTHORIZED');
        return;
      }

      const session = createSession(services.sessions, reply, result.userId, {
        context: userAuditContext(result.userId, request.id),
        source: 'login',
      });
      if (!session) {
        sendPublicError(request, reply, 401, 'UNAUTHORIZED');
        return;
      }
      reply.code(200).send(result.user);
    },
  );

  // POST /logout
  typed.post(
    '/logout',
    {
      schema: {
        response: {
          200: SuccessResponse,
        },
      },
    },
    async (request, reply) => {
      const user = request.authenticatedUser;
      destroySession(
        services.sessions,
        request,
        reply,
        user ? userAuditContext(user.id, request.id) : undefined,
      );
      reply.code(200).send({ success: true as const });
    },
  );

  // POST /forgot-password
  typed.post(
    '/forgot-password',
    {
      schema: {
        body: ForgotPasswordBody,
        response: {
          200: SuccessResponse,
          400: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const { email, country } = request.body;
      services.passwordReset.request(email, country, anonymousAuditContext(request.id));
      // Always return success — no user enumeration.
      reply.code(200).send({ success: true as const });
    },
  );

  // POST /reset-password
  typed.post(
    '/reset-password',
    {
      schema: {
        body: ResetPasswordBody,
        response: {
          200: SuccessResponse,
          400: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const { token, newPassword } = request.body;

      const result = await services.passwordReset.reset({
        token,
        newPassword,
        requestId: request.id,
      });

      if (result === 'INVALID_TOKEN') {
        sendPublicError(request, reply, 400, 'INVALID_TOKEN');
        return;
      }
      if (result === 'EXPIRED') {
        sendPublicError(request, reply, 400, 'EXPIRED');
        return;
      }
      if (result === 'ALREADY_USED') {
        sendPublicError(request, reply, 400, 'ALREADY_USED');
        return;
      }
      if (result === 'WEAK_PASSWORD') {
        sendPublicError(request, reply, 400, 'WEAK_PASSWORD');
        return;
      }

      reply.code(200).send({ success: true as const });
    },
  );

  // GET /me
  typed.get(
    '/me',
    {
      schema: {
        response: {
          200: CurrentUserResponse,
        },
      },
    },
    async (request, reply) => {
      const user = request.authenticatedUser;
      if (!user) {
        reply.code(200).send(null);
        return;
      }
      reply.code(200).send(toPublicUser(user));
    },
  );

  // PATCH /password
  typed.patch(
    '/password',
    {
      preHandler: requireAuth(services.sessions),
      schema: {
        body: ChangePasswordBody,
        response: {
          200: SuccessResponse,
          400: ErrorResponse,
          401: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const { currentPassword, newPassword } = request.body;

      const user = request.authenticatedUser!;
      const sessionToken = request.sessionToken;

      const result = await services.auth.changePassword({
        userId: user.id,
        currentPassword,
        newPassword,
        invalidateOtherSessions: () =>
          services.sessions.invalidateOtherForUser(user.id, sessionToken ?? ''),
        auditContext: userAuditContext(user.id, request.id),
      });

      if (result === 'INVALID_CURRENT') {
        sendPublicError(request, reply, 400, 'INVALID_CURRENT');
        return;
      }
      if (result === 'SAME_PASSWORD') {
        sendPublicError(request, reply, 400, 'SAME_PASSWORD');
        return;
      }
      if (result === 'WEAK_PASSWORD') {
        sendPublicError(request, reply, 400, 'WEAK_PASSWORD');
        return;
      }

      reply.code(200).send({ success: true as const });
    },
  );
}
