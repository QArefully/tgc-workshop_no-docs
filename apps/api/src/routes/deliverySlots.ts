import type { FastifyInstance } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { ErrorResponse } from '@shop/contracts/common';
import { DeliverySlotOptionsQuery, DeliverySlotOptionsResponse } from '@shop/contracts/delivery';
import { sendPublicError } from '../utils/errors.js';
import type { AppContext } from '../app.js';

/**
 * Delivery slot options for a cart.
 *
 * Deliberately unauthenticated and cart-scoped, matching the rest of the cart surface: a buyer
 * must be able to see lead time and bookable dates before signing in. The cart id is the only
 * capability, so the route reads nothing user-owned and leaks nothing about accounts.
 */
export default function deliverySlotRoutes(app: FastifyInstance, { services }: AppContext): void {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();

  // GET /api/delivery/slots?cartId=
  typed.get(
    '/api/delivery/slots',
    {
      schema: {
        querystring: DeliverySlotOptionsQuery,
        response: {
          200: DeliverySlotOptionsResponse,
          400: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const result = services.deliverySlots.optionsForCart(request.query.cartId);
      if (result === 'CART_NOT_FOUND') {
        sendPublicError(request, reply, 404, 'CART_NOT_FOUND');
        return;
      }
      reply.code(200).send(result);
    },
  );
}
