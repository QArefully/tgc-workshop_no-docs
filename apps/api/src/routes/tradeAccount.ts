import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { ErrorResponse, SuccessResponse } from '@shop/contracts/common';
import {
  BillingEntity,
  BillingEntityIdParam,
  BillingEntityListResponse,
  CreateBillingEntityBody,
  CreateDeliverySiteBody,
  DeliverySite,
  DeliverySiteIdParam,
  DeliverySiteListResponse,
  UpdateBillingEntityBody,
  UpdateDeliverySiteBody,
} from '@shop/contracts/trade-account';
import { requireAuth } from '../plugins/auth.js';
import { sendPublicError } from '../utils/errors.js';
import type {
  TradeAccountErrorCode,
  TradeAccountResult,
} from '../features/tradeAccount/tradeAccountErrors.js';
import type { AppContext } from '../app.js';

/** Domain failure -> preserved HTTP status. Ownership failures stay indistinguishable 404s. */
const TRADE_ACCOUNT_ERROR_STATUS: Record<TradeAccountErrorCode, 400 | 404 | 409> = {
  SITE_NOT_FOUND: 404,
  BILLING_ENTITY_NOT_FOUND: 404,
  SITE_LIMIT_REACHED: 409,
  BILLING_ENTITY_LIMIT_REACHED: 409,
  DUPLICATE_LABEL: 409,
  DUPLICATE_LEGAL_NAME: 409,
  INVALID_POSTCODE: 400,
  DELIVERY_COUNTRY_NOT_ALLOWED: 400,
};

function sendTradeAccountError(
  request: FastifyRequest,
  reply: FastifyReply,
  failure: Extract<TradeAccountResult<unknown>, { ok: false }>,
): void {
  sendPublicError(request, reply, TRADE_ACCOUNT_ERROR_STATUS[failure.code], failure.code);
}

/**
 * Trade account routes: the buyer's saved delivery sites and billing entities.
 *
 * Every endpoint is behind `requireAuth` and scopes every service call to the authenticated user
 * id. The route layer holds no SQL and no business rule: caps, duplicate detection, default
 * promotion, and retire semantics all live in the services.
 */
export default function tradeAccountRoutes(app: FastifyInstance, { services }: AppContext): void {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();
  const { sites, billingEntities } = services.tradeAccount;

  // GET /api/account/delivery-sites
  typed.get(
    '/api/account/delivery-sites',
    {
      preHandler: [requireAuth(services.sessions)],
      schema: {
        response: {
          200: DeliverySiteListResponse,
          401: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const user = request.authenticatedUser!;
      reply.code(200).send(sites.list(user.id));
    },
  );

  // POST /api/account/delivery-sites
  typed.post(
    '/api/account/delivery-sites',
    {
      preHandler: [requireAuth(services.sessions)],
      schema: {
        body: CreateDeliverySiteBody,
        response: {
          201: DeliverySite,
          400: ErrorResponse,
          401: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const user = request.authenticatedUser!;
      const result = sites.create(user.id, request.body);
      if (!result.ok) {
        sendTradeAccountError(request, reply, result);
        return;
      }
      reply.code(201).send(result.value);
    },
  );

  // PATCH /api/account/delivery-sites/:siteId
  typed.patch(
    '/api/account/delivery-sites/:siteId',
    {
      preHandler: [requireAuth(services.sessions)],
      schema: {
        params: DeliverySiteIdParam,
        body: UpdateDeliverySiteBody,
        response: {
          200: DeliverySite,
          400: ErrorResponse,
          401: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const user = request.authenticatedUser!;
      const result = sites.update(user.id, Number(request.params.siteId), request.body);
      if (!result.ok) {
        sendTradeAccountError(request, reply, result);
        return;
      }
      reply.code(200).send(result.value);
    },
  );

  // DELETE /api/account/delivery-sites/:siteId
  typed.delete(
    '/api/account/delivery-sites/:siteId',
    {
      preHandler: [requireAuth(services.sessions)],
      schema: {
        params: DeliverySiteIdParam,
        response: {
          200: SuccessResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const user = request.authenticatedUser!;
      // Retires the site; the row survives so historic orders keep their foreign key.
      const result = sites.retire(user.id, Number(request.params.siteId));
      if (!result.ok) {
        sendTradeAccountError(request, reply, result);
        return;
      }
      reply.code(200).send({ success: true as const });
    },
  );

  // GET /api/account/billing-entities
  typed.get(
    '/api/account/billing-entities',
    {
      preHandler: [requireAuth(services.sessions)],
      schema: {
        response: {
          200: BillingEntityListResponse,
          401: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const user = request.authenticatedUser!;
      reply.code(200).send(billingEntities.list(user.id));
    },
  );

  // POST /api/account/billing-entities
  typed.post(
    '/api/account/billing-entities',
    {
      preHandler: [requireAuth(services.sessions)],
      schema: {
        body: CreateBillingEntityBody,
        response: {
          201: BillingEntity,
          400: ErrorResponse,
          401: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const user = request.authenticatedUser!;
      const result = billingEntities.create(user.id, request.body);
      if (!result.ok) {
        sendTradeAccountError(request, reply, result);
        return;
      }
      reply.code(201).send(result.value);
    },
  );

  // PATCH /api/account/billing-entities/:entityId
  typed.patch(
    '/api/account/billing-entities/:entityId',
    {
      preHandler: [requireAuth(services.sessions)],
      schema: {
        params: BillingEntityIdParam,
        body: UpdateBillingEntityBody,
        response: {
          200: BillingEntity,
          400: ErrorResponse,
          401: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const user = request.authenticatedUser!;
      // The body is forwarded whole: an absent identifier means "leave it", an explicit `null`
      // means "clear it", and collapsing the two here would silently drop the clear instruction.
      const result = billingEntities.update(user.id, Number(request.params.entityId), request.body);
      if (!result.ok) {
        sendTradeAccountError(request, reply, result);
        return;
      }
      reply.code(200).send(result.value);
    },
  );

  // DELETE /api/account/billing-entities/:entityId
  typed.delete(
    '/api/account/billing-entities/:entityId',
    {
      preHandler: [requireAuth(services.sessions)],
      schema: {
        params: BillingEntityIdParam,
        response: {
          200: SuccessResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const user = request.authenticatedUser!;
      const result = billingEntities.retire(user.id, Number(request.params.entityId));
      if (!result.ok) {
        sendTradeAccountError(request, reply, result);
        return;
      }
      reply.code(200).send({ success: true as const });
    },
  );
}
