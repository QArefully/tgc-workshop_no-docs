import { FastifyInstance } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { calculateDiscount, resolvePromoScope } from '../features/promos/promoService.js';
import { sendPublicError } from '../utils/errors.js';
import { ValidatePromoResponse, ValidatePromoBody } from '@shop/contracts/promos';
import { ErrorResponse } from '@shop/contracts/common';
import type { AppContext } from '../app.js';

function isMoneyCents(value: number | undefined): value is number {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0;
}

export default function promoRoutes(app: FastifyInstance, { services }: AppContext): void {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();

  /** POST /api/promo/validate — Validate a single promo code against a cart. No stacking: only one code evaluated per request. */
  typed.post(
    '/api/promo/validate',
    {
      schema: {
        body: ValidatePromoBody,
        response: {
          200: ValidatePromoResponse,
          400: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const cart = services.carts.get(request.body.cartId);
      if (!cart) {
        sendPublicError(request, reply, 404, 'CART_NOT_FOUND');
        return;
      }
      const country = services.carts.country(request.body.cartId);
      if (!country) {
        sendPublicError(request, reply, 404, 'CART_NOT_FOUND');
        return;
      }
      const userId = request.authenticatedUser?.id ?? null;
      const result = services.promos.validate({
        code: request.body.promoCode,
        cartId: request.body.cartId,
        userId,
        country,
      });
      if (result.valid) {
        const scope = resolvePromoScope({ promo: result.promoCode, cart });
        const discountCents = calculateDiscount({
          promo: result.promoCode,
          discountableSubtotalCents: scope.discountBaseCents,
        });
        // Promotions discount merchandise only: blending fees stay out of the discount base but
        // remain inside the payable subtotal. Reuse the cart's server-owned delivery quote so
        // clients receive the same freight-inclusive total shown at checkout.
        const totalCents =
          cart.subtotalCents - discountCents + (cart.deliveryPreview?.chargeCents ?? 0);
        return {
          valid: true,
          promoCode: result.promoCode,
          discountBaseCents: scope.discountBaseCents,
          discountCents,
          totalCents,
        };
      }
      return {
        valid: false,
        errorCode: result.errorCode,
        ...(isMoneyCents(result.minSubtotalCents)
          ? { minSubtotalCents: result.minSubtotalCents }
          : {}),
      };
    },
  );
}
