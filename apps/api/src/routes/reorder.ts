import { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { ErrorResponse } from '@shop/contracts/common';
import { OrderIdParam } from '@shop/contracts/orders';
import {
  ReorderRequestBody,
  ReorderResponse,
  type ReorderLineOutcome,
} from '@shop/contracts/reorder';
import type { AppContext } from '../app.js';
import type { AuditContext } from '../features/audit/auditEvent.js';
import type { ReorderErrorCode } from '../features/reorder/reorderErrors.js';
import type { ReorderLineOutcome as DomainReorderLineOutcome } from '../features/reorder/reorderRules.js';
import { requireCustomer } from '../plugins/auth.js';
import { sendPublicError } from '../utils/errors.js';

/**
 * Code-bearing rejection body for the reorder endpoint.
 *
 * The generic `ErrorResponse` helpers carry prose only, but the buyer-facing client keys its
 * recovery and messaging on a stable `code`, so the whole-request rejections declare one here.
 * Declared alongside the generic shape in a union exactly as the cart and Custom Blend routes do.
 */
const ReorderErrorResponse = Type.Object(
  {
    code: Type.Union([
      Type.Literal('ORDER_NOT_FOUND'),
      Type.Literal('CART_NOT_FOUND'),
      Type.Literal('CART_RESERVED'),
    ]),
    error: Type.String({ minLength: 1, maxLength: 500 }),
  },
  { additionalProperties: false },
);

const REORDER_ERROR_STATUS: Readonly<Record<ReorderErrorCode, 404 | 409>> = {
  ORDER_NOT_FOUND: 404,
  CART_NOT_FOUND: 404,
  CART_RESERVED: 409,
};

/** Domain outcome -> wire outcome. The domain shape never reaches the wire unmapped. */
function toTransportOutcome(outcome: DomainReorderLineOutcome): ReorderLineOutcome {
  return {
    orderLineItemId: outcome.orderLineItemId,
    productId: outcome.productId,
    productName: outcome.productName,
    variantId: outcome.variantId,
    sku: outcome.sku,
    configKey: outcome.configKey,
    quantity: outcome.quantity,
    status: outcome.status,
    reason: outcome.reason,
    orderedUnitPriceCents: outcome.orderedUnitPriceCents,
    currentUnitPriceCents: outcome.currentUnitPriceCents,
    priceChanged: outcome.priceChanged,
  };
}

function auditContext(userId: number, requestId: string): AuditContext {
  return { actor: { type: 'user', userId }, requestId };
}

/** Buy again: re-add an owned past order's lines to the buyer's active cart. */
export default function reorderRoutes(app: FastifyInstance, { services }: AppContext): void {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();

  typed.post(
    '/api/orders/:orderId/reorder',
    {
      // Reorder is a write against the buyer's own cart, so the guest capability-cookie path used
      // by the order read endpoint is deliberately not extended to it.
      preHandler: [requireCustomer(services.sessions)],
      schema: {
        params: OrderIdParam,
        body: ReorderRequestBody,
        response: {
          200: ReorderResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: Type.Union([ReorderErrorResponse, ErrorResponse]),
          409: ReorderErrorResponse,
        },
      },
    },
    (request, reply) => {
      const userId = request.authenticatedUser!.id;
      const result = services.reorder.reorder({
        orderId: Number(request.params.orderId),
        userId,
        cartId: request.body.cartId,
        context: auditContext(userId, request.id),
      });
      if (!result.ok) {
        sendPublicError(request, reply, REORDER_ERROR_STATUS[result.code], result.code);
        return;
      }
      const { cart, addedLineCount, skippedLineCount, outcomes } = result.value;
      return { cart, addedLineCount, skippedLineCount, outcomes: outcomes.map(toTransportOutcome) };
    },
  );
}
