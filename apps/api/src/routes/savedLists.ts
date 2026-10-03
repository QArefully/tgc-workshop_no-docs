import { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { ErrorResponse, SuccessResponse } from '@shop/contracts/common';
import {
  AddSavedListItemBody,
  AddSavedListToCartBody,
  CreateSavedListBody,
  RenameSavedListBody,
  SaveCartAsListBody,
  SaveOrderAsListBody,
  SavedListAddToCartResponse,
  SavedListDetail,
  SavedListIdParam,
  SavedListItemIdParam,
  SavedListsResponse,
  UpdateSavedListItemBody,
  type SavedListDetail as SavedListDetailResponse,
  type SavedListLineOutcome,
  type SavedListSummary,
} from '@shop/contracts/saved-lists';
import type { AppContext } from '../app.js';
import type { AuditContext } from '../features/audit/auditEvent.js';
import type { SavedListErrorCode } from '../features/savedLists/savedListErrors.js';
import { requireAuth, requireCustomer } from '../plugins/auth.js';
import { sendPublicError } from '../utils/errors.js';

const SavedListErrorResponse = Type.Object(
  {
    code: Type.Union([
      Type.Literal('LIST_NOT_FOUND'),
      Type.Literal('ITEM_NOT_FOUND'),
      Type.Literal('NAME_INVALID'),
      Type.Literal('NAME_TAKEN'),
      Type.Literal('LIST_LIMIT_REACHED'),
      Type.Literal('ITEM_LIMIT_REACHED'),
      Type.Literal('VARIANT_NOT_FOUND'),
      Type.Literal('DEFAULT_LIST_IMMUTABLE'),
      Type.Literal('CART_NOT_FOUND'),
      Type.Literal('CART_RESERVED'),
      Type.Literal('CART_EMPTY'),
      Type.Literal('ORDER_NOT_FOUND'),
    ]),
    error: Type.String({ minLength: 1, maxLength: 500 }),
  },
  { additionalProperties: false },
);

const SAVED_LIST_ERROR_STATUS: Readonly<Record<SavedListErrorCode, 400 | 404 | 409>> = {
  LIST_NOT_FOUND: 404,
  ITEM_NOT_FOUND: 404,
  NAME_INVALID: 400,
  NAME_TAKEN: 409,
  LIST_LIMIT_REACHED: 409,
  ITEM_LIMIT_REACHED: 409,
  VARIANT_NOT_FOUND: 404,
  DEFAULT_LIST_IMMUTABLE: 409,
  CART_NOT_FOUND: 404,
  CART_RESERVED: 409,
  CART_EMPTY: 400,
  ORDER_NOT_FOUND: 404,
};

function auditContext(userId: number, requestId: string): AuditContext {
  return { actor: { type: 'user', userId }, requestId };
}

/** Domain records are copied into their public contract shape at this boundary. */
function toTransportDetail(value: SavedListDetailResponse): SavedListDetailResponse {
  return { ...value, items: value.items.map((entry) => ({ ...entry })) };
}
function toTransportSummary(value: SavedListSummary): SavedListSummary {
  return { ...value };
}
function toTransportOutcome(value: SavedListLineOutcome): SavedListLineOutcome {
  return { ...value };
}
function sendSavedListError(
  request: Parameters<typeof sendPublicError>[0],
  reply: Parameters<typeof sendPublicError>[1],
  code: SavedListErrorCode,
): void {
  sendPublicError(request, reply, SAVED_LIST_ERROR_STATUS[code], code);
}

/** Authenticated buyer routes for named, variant-scoped saved lists. */
export default function savedListRoutes(app: FastifyInstance, { services }: AppContext): void {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();
  const auth = [requireAuth(services.sessions)];

  typed.get(
    '/api/saved-lists',
    { preHandler: auth, schema: { response: { 200: SavedListsResponse, 401: ErrorResponse } } },
    (request) => services.savedLists.list(request.authenticatedUser!.id).map(toTransportSummary),
  );

  typed.post(
    '/api/saved-lists',
    {
      preHandler: auth,
      schema: {
        body: CreateSavedListBody,
        response: {
          201: SavedListDetail,
          400: Type.Union([SavedListErrorResponse, ErrorResponse]),
          401: ErrorResponse,
          409: SavedListErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const userId = request.authenticatedUser!.id;
      const result = services.savedLists.create(
        userId,
        request.body.name,
        auditContext(userId, request.id),
      );
      if (!result.ok) {
        sendSavedListError(request, reply, result.code);
        return;
      }
      return reply.code(201).send(toTransportDetail(result.value));
    },
  );

  typed.get(
    '/api/saved-lists/:listId',
    {
      preHandler: auth,
      schema: {
        params: SavedListIdParam,
        response: {
          200: SavedListDetail,
          400: ErrorResponse,
          401: ErrorResponse,
          404: SavedListErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const result = services.savedLists.get(
        request.authenticatedUser!.id,
        Number(request.params.listId),
      );
      if (!result.ok) {
        sendSavedListError(request, reply, result.code);
        return;
      }
      return toTransportDetail(result.value);
    },
  );

  typed.patch(
    '/api/saved-lists/:listId',
    {
      preHandler: auth,
      schema: {
        params: SavedListIdParam,
        body: RenameSavedListBody,
        response: {
          200: SavedListDetail,
          400: Type.Union([SavedListErrorResponse, ErrorResponse]),
          401: ErrorResponse,
          404: SavedListErrorResponse,
          409: SavedListErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const userId = request.authenticatedUser!.id;
      const result = services.savedLists.rename(
        userId,
        Number(request.params.listId),
        request.body.name,
        auditContext(userId, request.id),
      );
      if (!result.ok) {
        sendSavedListError(request, reply, result.code);
        return;
      }
      return toTransportDetail(result.value);
    },
  );

  typed.delete(
    '/api/saved-lists/:listId',
    {
      preHandler: auth,
      schema: {
        params: SavedListIdParam,
        response: {
          200: SuccessResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          404: SavedListErrorResponse,
          409: SavedListErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const userId = request.authenticatedUser!.id;
      const result = services.savedLists.delete(
        userId,
        Number(request.params.listId),
        auditContext(userId, request.id),
      );
      if (!result.ok) {
        sendSavedListError(request, reply, result.code);
        return;
      }
      return { success: true as const };
    },
  );

  typed.post(
    '/api/saved-lists/:listId/items',
    {
      preHandler: auth,
      schema: {
        params: SavedListIdParam,
        body: AddSavedListItemBody,
        response: {
          200: SavedListDetail,
          400: ErrorResponse,
          401: ErrorResponse,
          404: SavedListErrorResponse,
          409: SavedListErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const userId = request.authenticatedUser!.id;
      const result = services.savedLists.addItem(
        userId,
        Number(request.params.listId),
        request.body.variantId,
        request.body.quantity,
        auditContext(userId, request.id),
      );
      if (!result.ok) {
        sendSavedListError(request, reply, result.code);
        return;
      }
      return toTransportDetail(result.value);
    },
  );

  typed.patch(
    '/api/saved-lists/:listId/items/:itemId',
    {
      preHandler: auth,
      schema: {
        params: SavedListItemIdParam,
        body: UpdateSavedListItemBody,
        response: {
          200: SavedListDetail,
          400: ErrorResponse,
          401: ErrorResponse,
          404: SavedListErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const userId = request.authenticatedUser!.id;
      const result = services.savedLists.updateItem(
        userId,
        Number(request.params.listId),
        Number(request.params.itemId),
        request.body.quantity,
        auditContext(userId, request.id),
      );
      if (!result.ok) {
        sendSavedListError(request, reply, result.code);
        return;
      }
      return toTransportDetail(result.value);
    },
  );

  typed.delete(
    '/api/saved-lists/:listId/items/:itemId',
    {
      preHandler: auth,
      schema: {
        params: SavedListItemIdParam,
        response: {
          200: SuccessResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          404: SavedListErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const userId = request.authenticatedUser!.id;
      const result = services.savedLists.removeItem(
        userId,
        Number(request.params.listId),
        Number(request.params.itemId),
        auditContext(userId, request.id),
      );
      if (!result.ok) {
        sendSavedListError(request, reply, result.code);
        return;
      }
      return { success: true as const };
    },
  );

  typed.post(
    '/api/saved-lists/:listId/add-to-cart',
    {
      preHandler: [requireCustomer(services.sessions)],
      schema: {
        params: SavedListIdParam,
        body: AddSavedListToCartBody,
        response: {
          200: SavedListAddToCartResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: SavedListErrorResponse,
          409: SavedListErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const userId = request.authenticatedUser!.id;
      const result = services.savedLists.addToCart(
        userId,
        Number(request.params.listId),
        request.body.cartId,
        auditContext(userId, request.id),
      );
      if (!result.ok) {
        sendSavedListError(request, reply, result.code);
        return;
      }
      return { ...result.value, outcomes: result.value.outcomes.map(toTransportOutcome) };
    },
  );

  typed.post(
    '/api/saved-lists/from-cart',
    {
      preHandler: auth,
      schema: {
        body: SaveCartAsListBody,
        response: {
          201: SavedListDetail,
          400: Type.Union([SavedListErrorResponse, ErrorResponse]),
          401: ErrorResponse,
          404: SavedListErrorResponse,
          409: SavedListErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const userId = request.authenticatedUser!.id;
      const result = services.savedLists.createFromCart(
        userId,
        request.body.cartId,
        request.body.name,
        auditContext(userId, request.id),
      );
      if (!result.ok) {
        sendSavedListError(request, reply, result.code);
        return;
      }
      return reply.code(201).send(toTransportDetail(result.value));
    },
  );

  typed.post(
    '/api/saved-lists/from-order/:orderId',
    {
      preHandler: auth,
      schema: {
        params: Type.Object(
          { orderId: Type.String({ pattern: '^[1-9][0-9]*$' }) },
          { additionalProperties: false },
        ),
        body: SaveOrderAsListBody,
        response: {
          201: SavedListDetail,
          400: Type.Union([SavedListErrorResponse, ErrorResponse]),
          401: ErrorResponse,
          404: SavedListErrorResponse,
          409: SavedListErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const userId = request.authenticatedUser!.id;
      const result = services.savedLists.createFromOrder(
        userId,
        Number(request.params.orderId),
        request.body.name,
        auditContext(userId, request.id),
      );
      if (!result.ok) {
        sendSavedListError(request, reply, result.code);
        return;
      }
      return reply.code(201).send(toTransportDetail(result.value));
    },
  );
}
