import {
  AdminReviewModerationBody,
  AdminReviewModerationResponse,
  AdminReviewQueueQuery,
  AdminReviewQueueResponse,
  CreateReviewReportBody,
  CreateReviewBody,
  OwnedReviewResponse,
  ReviewIdParam,
  ReviewEngagementResponse,
  ReviewListQuery,
  ReviewListResponse,
  ReviewMutationResponse,
  ReviewProductParam,
  UpdateReviewBody,
} from '@shop/contracts/reviews';
import { ErrorResponse, SuccessResponse } from '@shop/contracts/common';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ReviewServiceError, type ReviewService } from '../features/reviews/reviewService.js';
import type { AuditContext } from '../features/audit/auditEvent.js';
import { requireAdmin, requireAuth, requireCustomer } from '../plugins/auth.js';
import type { SessionService } from '../features/auth/sessionService.js';
import type { ProductService } from '../features/catalog/productService.js';
import type { Country } from '@shop/contracts/country';
import { sendPublicError } from '../utils/errors.js';

export interface ReviewRouteServices {
  sessions: SessionService;
  reviews: ReviewService;
  products: Pick<ProductService, 'findCustomerProductById'>;
}

function sendReviewError(
  request: FastifyRequest,
  reply: FastifyReply,
  error: ReviewServiceError,
): void {
  switch (error.code) {
    case 'INVALID_INPUT':
      sendPublicError(request, reply, 400, 'INVALID_INPUT');
      return;
    case 'FORBIDDEN':
      sendPublicError(request, reply, 403, 'FORBIDDEN');
      return;
    case 'NOT_FOUND':
      sendPublicError(request, reply, 404, 'NOT_FOUND');
      return;
    case 'INVALID_TRANSITION':
      sendPublicError(request, reply, 409, 'INVALID_TRANSITION');
      return;
    case 'DUPLICATE':
      sendPublicError(request, reply, 409, 'DUPLICATE');
      return;
    case 'TOO_MANY_REPORTS':
      sendPublicError(request, reply, 429, 'TOO_MANY_REPORTS');
      return;
  }
}

/** Public review reads plus customer ownership and admin moderation endpoints. */
export default function reviewsRoutes(
  app: FastifyInstance,
  { services }: { services: ReviewRouteServices },
): void {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();
  const contextFor = (userId: number, requestId: string): AuditContext => ({
    actor: { type: 'user', userId },
    requestId,
  });
  const adminContextFor = (
    userId: number,
    requestId: string,
    standingCountry: Country,
  ): AuditContext => ({
    actor: { type: 'user', userId },
    requestId,
    standingCountry,
  });

  typed.get(
    '/api/products/:productId/reviews',
    {
      schema: {
        params: ReviewProductParam,
        querystring: ReviewListQuery,
        response: { 200: ReviewListResponse, 400: ErrorResponse, 404: ErrorResponse },
      },
    },
    (request, reply) => {
      const productId = Number(request.params.productId);
      if (!services.products.findCustomerProductById(productId, request.resolvedCountry)) {
        sendPublicError(request, reply, 404, 'PRODUCT_NOT_FOUND');
        return;
      }
      try {
        return services.reviews.listProduct(
          productId,
          request.query,
          request.authenticatedUser?.role === 'customer' ? request.authenticatedUser.id : null,
        );
      } catch (error) {
        if (error instanceof ReviewServiceError) {
          sendReviewError(request, reply, error);
          return;
        }
        throw error;
      }
    },
  );

  typed.get(
    '/api/products/:productId/reviews/me',
    {
      preHandler: [requireAuth(services.sessions)],
      schema: {
        params: ReviewProductParam,
        response: { 200: OwnedReviewResponse, 401: ErrorResponse, 404: ErrorResponse },
      },
    },
    (request, reply) => {
      const productId = Number(request.params.productId);
      if (!services.products.findCustomerProductById(productId, request.resolvedCountry)) {
        sendPublicError(request, reply, 404, 'PRODUCT_NOT_FOUND');
        return;
      }
      try {
        return services.reviews.findOwned(request.authenticatedUser!.id, productId);
      } catch (error) {
        if (error instanceof ReviewServiceError) {
          sendReviewError(request, reply, error);
          return;
        }
        throw error;
      }
    },
  );

  typed.post(
    '/api/products/:productId/reviews',
    {
      preHandler: [requireCustomer(services.sessions)],
      schema: {
        params: ReviewProductParam,
        body: CreateReviewBody,
        response: {
          201: ReviewMutationResponse,
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
        reply.code(201);
        return services.reviews.create(
          request.authenticatedUser!.id,
          Number(request.params.productId),
          request.body,
          contextFor(request.authenticatedUser!.id, request.id),
        );
      } catch (error) {
        if (error instanceof ReviewServiceError) {
          sendReviewError(request, reply, error);
          return;
        }
        throw error;
      }
    },
  );

  typed.patch(
    '/api/reviews/:reviewId',
    {
      preHandler: [requireCustomer(services.sessions)],
      schema: {
        params: ReviewIdParam,
        body: UpdateReviewBody,
        response: {
          200: ReviewMutationResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    (request, reply) => {
      try {
        return services.reviews.update(
          request.authenticatedUser!.id,
          Number(request.params.reviewId),
          request.body,
          contextFor(request.authenticatedUser!.id, request.id),
        );
      } catch (error) {
        if (error instanceof ReviewServiceError) {
          sendReviewError(request, reply, error);
          return;
        }
        throw error;
      }
    },
  );

  typed.delete(
    '/api/reviews/:reviewId',
    {
      preHandler: [requireCustomer(services.sessions)],
      schema: {
        params: ReviewIdParam,
        response: {
          200: SuccessResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    (request, reply) => {
      try {
        services.reviews.delete(
          request.authenticatedUser!.id,
          Number(request.params.reviewId),
          contextFor(request.authenticatedUser!.id, request.id),
        );
        return { success: true as const };
      } catch (error) {
        if (error instanceof ReviewServiceError) {
          sendReviewError(request, reply, error);
          return;
        }
        throw error;
      }
    },
  );

  for (const [method, suffix, handler] of [
    [
      'put',
      'helpful',
      (userId: number, reviewId: number, context: AuditContext) =>
        services.reviews.addHelpful(userId, reviewId, context),
    ],
    [
      'delete',
      'helpful',
      (userId: number, reviewId: number, context: AuditContext) =>
        services.reviews.removeHelpful(userId, reviewId, context),
    ],
  ] as const) {
    typed[method](
      `/api/reviews/:reviewId/${suffix}`,
      {
        preHandler: [requireCustomer(services.sessions)],
        schema: {
          params: ReviewIdParam,
          response: {
            200: ReviewEngagementResponse,
            401: ErrorResponse,
            403: ErrorResponse,
            404: ErrorResponse,
          },
        },
      },
      (request, reply) => {
        try {
          return handler(
            request.authenticatedUser!.id,
            Number(request.params.reviewId),
            contextFor(request.authenticatedUser!.id, request.id),
          );
        } catch (error) {
          if (error instanceof ReviewServiceError) {
            sendReviewError(request, reply, error);
            return;
          }
          throw error;
        }
      },
    );
  }

  typed.post(
    '/api/reviews/:reviewId/reports',
    {
      preHandler: [requireCustomer(services.sessions)],
      schema: {
        params: ReviewIdParam,
        body: CreateReviewReportBody,
        response: {
          200: ReviewEngagementResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
          429: ErrorResponse,
        },
      },
    },
    (request, reply) => {
      try {
        return services.reviews.createReport(
          request.authenticatedUser!.id,
          Number(request.params.reviewId),
          request.body,
          contextFor(request.authenticatedUser!.id, request.id),
        );
      } catch (error) {
        if (error instanceof ReviewServiceError) {
          sendReviewError(request, reply, error);
          return;
        }
        throw error;
      }
    },
  );
  typed.delete(
    '/api/reviews/:reviewId/reports/me',
    {
      preHandler: [requireCustomer(services.sessions)],
      schema: {
        params: ReviewIdParam,
        response: {
          200: ReviewEngagementResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    (request, reply) => {
      try {
        return services.reviews.withdrawReport(
          request.authenticatedUser!.id,
          Number(request.params.reviewId),
          contextFor(request.authenticatedUser!.id, request.id),
        );
      } catch (error) {
        if (error instanceof ReviewServiceError) {
          sendReviewError(request, reply, error);
          return;
        }
        throw error;
      }
    },
  );

  typed.get(
    '/api/admin/reviews/moderation',
    {
      preHandler: [requireAdmin(services.sessions)],
      schema: {
        querystring: AdminReviewQueueQuery,
        response: {
          200: AdminReviewQueueResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    (request, reply) => {
      try {
        return services.reviews.listModeration(request.query, request.resolvedCountry);
      } catch (error) {
        if (error instanceof ReviewServiceError) {
          sendReviewError(request, reply, error);
          return;
        }
        throw error;
      }
    },
  );
  typed.post(
    '/api/admin/reviews/:reviewId/moderation',
    {
      preHandler: [requireAdmin(services.sessions)],
      schema: {
        params: ReviewIdParam,
        body: AdminReviewModerationBody,
        response: {
          200: AdminReviewModerationResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    (request, reply) => {
      try {
        return services.reviews.moderate(
          Number(request.params.reviewId),
          request.body.decision,
          request.authenticatedUser!.id,
          adminContextFor(request.authenticatedUser!.id, request.id, request.resolvedCountry),
          request.resolvedCountry,
        );
      } catch (error) {
        if (error instanceof ReviewServiceError) {
          sendReviewError(request, reply, error);
          return;
        }
        throw error;
      }
    },
  );

  for (const [action, handler] of [
    [
      'hide',
      (reviewId: number, context: AuditContext, country: Country) =>
        services.reviews.hide(reviewId, context, country),
    ],
    [
      'restore',
      (reviewId: number, context: AuditContext, country: Country) =>
        services.reviews.restore(reviewId, context, country),
    ],
  ] as const) {
    typed.post(
      `/api/admin/reviews/:reviewId/${action}`,
      {
        preHandler: [requireAdmin(services.sessions)],
        schema: {
          params: ReviewIdParam,
          response: {
            200: ReviewMutationResponse,
            401: ErrorResponse,
            403: ErrorResponse,
            404: ErrorResponse,
            409: ErrorResponse,
          },
        },
      },
      (request, reply) => {
        try {
          return handler(
            Number(request.params.reviewId),
            adminContextFor(request.authenticatedUser!.id, request.id, request.resolvedCountry),
            request.resolvedCountry,
          );
        } catch (error) {
          if (error instanceof ReviewServiceError) {
            sendReviewError(request, reply, error);
            return;
          }
          throw error;
        }
      },
    );
  }
}
