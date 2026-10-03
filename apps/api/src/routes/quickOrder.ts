import { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { CartIdParam } from '@shop/contracts/cart';
import { ErrorResponse } from '@shop/contracts/common';
import {
  QuickOrderRequestBody,
  QuickOrderResponse,
  type QuickOrderLineOutcome,
} from '@shop/contracts/quick-order';
import type { AppContext } from '../app.js';
import type { AuditContext } from '../features/audit/auditEvent.js';
import type { QuickOrderErrorCode } from '../features/quickOrder/quickOrderErrors.js';
import { parseQuickOrderText } from '../features/quickOrder/quickOrderRules.js';
import { sendPublicError } from '../utils/errors.js';

const QuickOrderErrorResponse = Type.Object(
  {
    code: Type.Union([
      Type.Literal('NO_INPUT_LINES'),
      Type.Literal('TOO_MANY_LINES'),
      Type.Literal('CART_NOT_FOUND'),
      Type.Literal('CART_RESERVED'),
    ]),
    error: Type.String({ minLength: 1, maxLength: 500 }),
  },
  { additionalProperties: false },
);

const QUICK_ORDER_ERROR_STATUS: Readonly<Record<QuickOrderErrorCode, 400 | 404 | 409>> = {
  NO_INPUT_LINES: 400,
  TOO_MANY_LINES: 400,
  CART_NOT_FOUND: 404,
  CART_RESERVED: 409,
};

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

/** Domain outcome -> wire outcome. The domain shape never reaches the wire unmapped. */
function toTransportOutcome(outcome: QuickOrderLineOutcome): QuickOrderLineOutcome {
  return {
    lineNumber: outcome.lineNumber,
    rawLine: outcome.rawLine,
    sku: outcome.sku,
    requestedQuantity: outcome.requestedQuantity,
    submittedQuantity: outcome.submittedQuantity,
    moqAdjusted: outcome.moqAdjusted,
    duplicateSku: outcome.duplicateSku,
    variantId: outcome.variantId,
    productId: outcome.productId,
    productName: outcome.productName,
    resolvedUnitPriceCents: outcome.resolvedUnitPriceCents,
    status: outcome.status,
    reason: outcome.reason,
  };
}

/** Parses and applies a buyer's pasted SKU quantities to a cart in one transaction. */
export default function quickOrderRoutes(app: FastifyInstance, { services }: AppContext): void {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();

  typed.post(
    '/api/cart/:cartId/quick-order',
    {
      schema: {
        params: CartIdParam,
        body: QuickOrderRequestBody,
        response: {
          200: QuickOrderResponse,
          400: Type.Union([QuickOrderErrorResponse, ErrorResponse]),
          404: Type.Union([QuickOrderErrorResponse, ErrorResponse]),
          409: QuickOrderErrorResponse,
        },
      },
    },
    (request, reply) => {
      const result = services.quickOrder.quickOrder({
        cartId: request.params.cartId,
        text: request.body.text,
        context: auditContext(request),
      });
      if (!result.ok) {
        if (result.code === 'TOO_MANY_LINES') {
          sendPublicError(request, reply, QUICK_ORDER_ERROR_STATUS[result.code], result.code, {
            lineCount: parseQuickOrderText(request.body.text).length,
          });
        } else {
          sendPublicError(request, reply, QUICK_ORDER_ERROR_STATUS[result.code], result.code);
        }
        return;
      }
      const { cart, addedLineCount, skippedLineCount, outcomes } = result.value;
      return {
        cart,
        addedLineCount,
        skippedLineCount,
        outcomes: outcomes.map(toTransportOutcome),
      };
    },
  );
}
