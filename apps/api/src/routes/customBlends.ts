import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Type } from '@sinclair/typebox';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import {
  CustomBlendBaseListQuery,
  CustomBlendBaseListResponse,
  CustomBlendErrorResponse,
  CustomBlendEvaluationBody,
  CustomBlendEvaluationResponse,
  CustomBlendOptionsQuery,
  CustomBlendOptionsResponse,
  CreateCustomBlendBody,
  ErrorResponse,
  ReplaceCustomBlendBody,
  Cart,
  CartIdParam,
} from '@shop/contracts';
import type { AppContext } from '../app.js';
import { CustomBlendInvalidError } from '../features/customBlend/customBlendService.js';
import type { AuditContext } from '../features/audit/auditEvent.js';
import type { Cart as CartResponse } from '@shop/contracts/cart';
import { minimumOrderQuantity } from '../features/pricing/pricingRules.js';
import { sendPublicError } from '../utils/errors.js';

function auditContext(request: {
  id: string;
  authenticatedUser: { id: number } | null;
}): AuditContext {
  return {
    actor: request.authenticatedUser
      ? { type: 'user', userId: request.authenticatedUser.id }
      : { type: 'anonymous', userId: null },
    requestId: request.id,
  };
}

/** Public read endpoint for eligible base and compatible ingredient lots. */
export default function customBlendRoutes(app: FastifyInstance, { services }: AppContext): void {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();

  typed.get(
    '/api/custom-blends/bases',
    {
      schema: {
        querystring: CustomBlendBaseListQuery,
        response: {
          200: CustomBlendBaseListResponse,
          400: ErrorResponse,
        },
      },
    },
    (request, reply) => {
      try {
        return services.customBlends.listBases(request.query, request.resolvedCountry);
      } catch (error) {
        if (error instanceof CustomBlendInvalidError) {
          sendCustomBlendError(request, reply, error);
          return;
        }
        throw error;
      }
    },
  );

  typed.get(
    '/api/custom-blends/options',
    {
      schema: {
        querystring: CustomBlendOptionsQuery,
        response: {
          200: CustomBlendOptionsResponse,
          400: Type.Union([CustomBlendErrorResponse, ErrorResponse]),
        },
      },
    },
    (request, reply) => {
      try {
        return services.customBlends.listOptions(
          request.query.baseVariantId,
          request.resolvedCountry,
        );
      } catch (error) {
        if (error instanceof CustomBlendInvalidError) {
          sendCustomBlendError(request, reply, error);
          return;
        }
        throw error;
      }
    },
  );

  typed.post(
    '/api/custom-blends/evaluate',
    {
      schema: {
        body: CustomBlendEvaluationBody,
        response: {
          200: CustomBlendEvaluationResponse,
          400: ErrorResponse,
        },
      },
    },
    (request, reply) => {
      try {
        return services.customBlends.evaluate(request.body, request.resolvedCountry);
      } catch (error) {
        if (error instanceof CustomBlendInvalidError) {
          sendCustomBlendError(request, reply, error);
          return;
        }
        throw error;
      }
    },
  );

  typed.post(
    '/api/cart/:cartId/custom-blends',
    {
      schema: {
        params: CartIdParam,
        body: CreateCustomBlendBody,
        response: {
          200: Cart,
          400: Type.Union([CustomBlendErrorResponse, ErrorResponse]),
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    (request, reply) => {
      try {
        const result = services.customBlends.create(
          services.carts,
          request.params.cartId,
          request.body,
          auditContext(request),
        );
        const minQuantity =
          result === 'BELOW_MOQ'
            ? customBlendMinimumQuantity(services, request.body.baseVariantId)
            : undefined;
        return sendMutationResult(request, reply, result, request.body.quantity, minQuantity);
      } catch (error) {
        if (error instanceof CustomBlendInvalidError) {
          sendCustomBlendError(request, reply, error);
          return;
        }
        throw error;
      }
    },
  );

  typed.put(
    '/api/cart/:cartId/custom-blends',
    {
      schema: {
        params: CartIdParam,
        body: ReplaceCustomBlendBody,
        response: {
          200: Cart,
          400: Type.Union([CustomBlendErrorResponse, ErrorResponse]),
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    (request, reply) => {
      try {
        const result = services.customBlends.replace(
          services.carts,
          request.params.cartId,
          request.body,
          auditContext(request),
        );
        const minQuantity =
          result === 'BELOW_MOQ'
            ? customBlendMinimumQuantity(services, request.body.baseVariantId)
            : undefined;
        return sendMutationResult(request, reply, result, undefined, minQuantity);
      } catch (error) {
        if (error instanceof CustomBlendInvalidError) {
          sendCustomBlendError(request, reply, error);
          return;
        }
        throw error;
      }
    },
  );
}

function sendCustomBlendError(
  request: FastifyRequest,
  reply: FastifyReply,
  error: CustomBlendInvalidError,
): void {
  if (error.resolverCode === 'CUSTOM_BLEND_INCOMPATIBLE') {
    sendPublicError(request, reply, 400, 'CUSTOM_BLEND_INCOMPATIBLE');
    return;
  }
  if (
    error.resolverCode === 'CUSTOM_BLEND_PIGMENT_CAP_EXCEEDED' &&
    isSafePercentage(error.maxPercentage) &&
    isSafePercentage(error.actualPercentage)
  ) {
    sendPublicError(request, reply, 400, 'CUSTOM_BLEND_PIGMENT_CAP_EXCEEDED', {
      maxPercentage: error.maxPercentage,
      actualPercentage: error.actualPercentage,
    });
    return;
  }
  // Unavailable, corrupt, or unrecognised resolver failures retain the legacy non-disclosing code.
  sendPublicError(request, reply, 400, 'CUSTOM_BLEND_INVALID');
}

function isSafePercentage(value: number | undefined): value is number {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0 && value <= 100;
}

function sendMutationResult(
  request: FastifyRequest,
  reply: FastifyReply,
  result:
    | import('@shop/contracts').Cart
    | 'CART_NOT_FOUND'
    | 'VARIANT_NOT_FOUND'
    | 'VARIANT_NOT_IN_CART'
    | 'CART_RESERVED'
    | 'BLOCKED_IN_COUNTRY'
    | 'BELOW_MOQ'
    | 'INVALID_QUANTITY',
  quantity?: number,
  minQuantity?: number,
): CartResponse | void {
  if (typeof result !== 'string') return result;
  if (result === 'CART_NOT_FOUND') {
    sendPublicError(request, reply, 404, 'CART_NOT_FOUND');
    return;
  }
  if (result === 'VARIANT_NOT_FOUND' || result === 'BLOCKED_IN_COUNTRY') {
    sendPublicError(request, reply, 404, 'VARIANT_NOT_FOUND');
    return;
  }
  if (result === 'VARIANT_NOT_IN_CART') {
    sendPublicError(request, reply, 404, 'VARIANT_NOT_IN_CART');
    return;
  }
  if (result === 'CART_RESERVED') {
    sendPublicError(request, reply, 409, 'CART_RESERVED');
    return;
  }
  if (result === 'BELOW_MOQ') {
    if (minQuantity === undefined) {
      sendPublicError(request, reply, 400, 'INTERNAL_ERROR');
      return;
    }
    sendPublicError(request, reply, 400, 'BELOW_MOQ', { minQuantity });
    return;
  }
  if (quantity === undefined) {
    sendPublicError(request, reply, 400, 'INTERNAL_ERROR');
    return;
  }
  sendPublicError(request, reply, 400, 'INVALID_QUANTITY', { quantity });
}

function customBlendMinimumQuantity(
  services: AppContext['services'],
  baseVariantId: number,
): number | undefined {
  try {
    const variant = services.customBlends.listOptions(baseVariantId).base.variant;
    return minimumOrderQuantity(variant.weightGrams, variant.moqSacks);
  } catch (error) {
    if (error instanceof CustomBlendInvalidError) return undefined;
    throw error;
  }
}
