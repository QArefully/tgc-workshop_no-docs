import { FastifyInstance } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { sendPublicError } from '../utils/errors.js';
import { PaymentBody, PaymentSuccessResponse } from '@shop/contracts/payments';
import { ErrorResponse } from '@shop/contracts/common';
import type { AppContext } from '../app.js';

export default function paymentRoutes(app: FastifyInstance, { services }: AppContext): void {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();

  typed.post(
    '/api/payments/pay',
    {
      schema: {
        body: PaymentBody,
        response: {
          201: PaymentSuccessResponse,
          400: ErrorResponse,
          402: ErrorResponse,
          409: ErrorResponse,
          500: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const userId = request.authenticatedUser?.id ?? null;
      const cardFields =
        'cardNumber' in request.body
          ? {
              cardNumber: request.body.cardNumber,
              cardExpiry: request.body.cardExpiry,
              cardCvc: request.body.cardCvc,
            }
          : { cardNumber: undefined, cardExpiry: undefined, cardCvc: undefined };

      const result = await services.checkout.process({
        cartId: request.body.cartId,
        promoCode: request.body.promoCode,
        customerName: request.body.customerName,
        customerEmail: request.body.customerEmail,
        deliveryDestination: request.body.deliveryDestination,
        billingSelection: request.body.billingSelection,
        deliverySlot: request.body.deliverySlot,
        purchaseOrderReference: request.body.purchaseOrderReference,
        ...cardFields,
        paymentMethod: request.body.paymentMethod,
        idempotencyKey: request.body.idempotencyKey,
        userId,
        auditContext: {
          actor: userId === null ? { type: 'anonymous', userId: null } : { type: 'user', userId },
          requestId: request.id,
        },
      });

      if (result.success) {
        if (userId === null) {
          const { token } = services.orderAccess.issue(Number(result.order.id));
          reply.setCookie(`qpc_order_${result.order.id}`, token, {
            httpOnly: true,
            sameSite: 'lax',
            path: `/api/orders/${result.order.id}`,
            maxAge: 24 * 60 * 60,
            secure: false,
          });
        }
        reply.code(201);
        return result.order;
      }

      switch (result.error) {
        case 'CART_NOT_FOUND':
          sendPublicError(request, reply, 404, 'CART_NOT_FOUND');
          return;
        case 'CART_EMPTY':
          sendPublicError(request, reply, 400, 'CART_EMPTY');
          return;
        case 'CARD_INVALID':
          sendPublicError(request, reply, 400, 'CARD_INVALID');
          return;
        case 'BELOW_MOQ':
          sendPublicError(request, reply, 400, 'BELOW_MOQ', {
            minQuantity: result.minQuantity,
          });
          return;
        case 'PROMO_INVALID':
          switch (result.promoErrorCode) {
            case 'EXPIRED':
              sendPublicError(request, reply, 400, 'PROMO_EXPIRED');
              return;
            case 'NOT_STARTED':
              sendPublicError(request, reply, 400, 'PROMO_NOT_STARTED');
              return;
            case 'MIN_ITEMS':
              // Legacy checkout results do not carry the qualifying count. Keep this fallback
              // parameter-free until a canonical count is available.
              sendPublicError(request, reply, 400, 'PROMO_INVALID');
              return;
            case 'MIN_SUBTOTAL':
              // Legacy checkout records do not carry the threshold, so keep the fallback
              // parameter-free rather than emitting a parameterized code without metadata.
              if ('minSubtotalCents' in result && result.minSubtotalCents !== undefined) {
                sendPublicError(request, reply, 400, 'PROMO_MIN_SUBTOTAL', {
                  minSubtotalCents: result.minSubtotalCents,
                });
              } else {
                sendPublicError(request, reply, 400, 'PROMO_INVALID');
              }
              return;
            case 'USAGE_LIMIT':
              sendPublicError(request, reply, 400, 'PROMO_USAGE_LIMIT');
              return;
            case 'AUTH_REQUIRED':
              sendPublicError(request, reply, 400, 'AUTH_REQUIRED');
              return;
            case 'CATEGORY_MISMATCH':
              sendPublicError(request, reply, 400, 'PROMO_CATEGORY_MISMATCH');
              return;
            default:
              sendPublicError(request, reply, 400, 'PROMO_INVALID');
              return;
          }
        case 'DELIVERY_COUNTRY_NOT_ALLOWED':
          sendPublicError(request, reply, 400, 'DELIVERY_COUNTRY_NOT_ALLOWED');
          return;
        // Both resolution failures answer 400 with one message each. A saved record that is
        // unknown, retired, or another buyer's must be indistinguishable from here.
        case 'DELIVERY_SITE_NOT_FOUND':
          sendPublicError(request, reply, 400, 'DELIVERY_SITE_NOT_FOUND');
          return;
        case 'BILLING_ENTITY_INVALID':
          sendPublicError(request, reply, 400, 'BILLING_ENTITY_INVALID');
          return;
        case 'DELIVERY_SLOT_UNAVAILABLE':
          // Same conflict class as stock shortfall: well-formed request, the buyer must rebook.
          // The freshly derived earliest date travels with it so the picker can recover in place.
          sendPublicError(request, reply, 409, 'DELIVERY_SLOT_UNAVAILABLE', {
            earliestDate: result.earliestDate,
          });
          return;
        case 'PENDING_APPROVAL':
          sendPublicError(request, reply, 409, 'PENDING_APPROVAL', {
            approvalRequestId: result.approvalRequestId,
          });
          return;
        case 'APPROVAL_REJECTED':
          sendPublicError(request, reply, 409, 'APPROVAL_REJECTED');
          return;
        case 'APPROVAL_EXPIRED':
          sendPublicError(request, reply, 409, 'APPROVAL_EXPIRED');
          return;
        case 'APPROVAL_TOTAL_DRIFT':
          sendPublicError(request, reply, 409, 'APPROVAL_TOTAL_DRIFT');
          return;
        case 'DECLINED':
          sendPublicError(request, reply, 402, 'CARD_DECLINED');
          return;
        case 'TIMEOUT':
          sendPublicError(request, reply, 402, 'GATEWAY_TIMEOUT');
          return;
        case 'IDEMPOTENT_CONFLICT':
          sendPublicError(request, reply, 409, 'IDEMPOTENT_CONFLICT');
          return;
        case 'RESERVATION_EXPIRED':
          sendPublicError(request, reply, 409, 'RESERVATION_EXPIRED', {
            reservationExpiresAt: result.reservationExpiresAt,
          });
          return;
        case 'CUSTOM_BLEND_INVALID':
          // Catalog state moved under a configured line. Same conflict class as stock shortfall:
          // the request was well formed, the cart must be revisited before paying.
          sendPublicError(request, reply, 409, 'CUSTOM_BLEND_INVALID');
          return;
        case 'CREDIT_LIMIT_EXCEEDED':
          sendPublicError(request, reply, 409, 'CREDIT_LIMIT_EXCEEDED', {
            requestedCents: result.requestedCents,
            availableCreditCents: result.availableCreditCents,
          });
          return;
        case 'CREDIT_ACCOUNT_ON_HOLD':
          sendPublicError(request, reply, 409, 'CREDIT_ACCOUNT_ON_HOLD');
          return;
        case 'CREDIT_ACCOUNT_SUSPENDED':
          sendPublicError(request, reply, 409, 'CREDIT_ACCOUNT_SUSPENDED');
          return;
        case 'CREDIT_NOT_ELIGIBLE':
          sendPublicError(request, reply, 409, 'CREDIT_NOT_ELIGIBLE');
          return;
        case 'CREDIT_PAYMENT_UNAVAILABLE':
          sendPublicError(request, reply, 500, 'CREDIT_PAYMENT_UNAVAILABLE');
          return;
        case 'COMPANY_REQUIRED':
          sendPublicError(request, reply, 400, 'COMPANY_REQUIRED');
          return;
        case 'PAYMENT_METHOD_INVALID':
          sendPublicError(request, reply, 400, 'PAYMENT_METHOD_INVALID');
          return;
        case 'CARD_FIELDS_FORBIDDEN':
          sendPublicError(request, reply, 400, 'CARD_FIELDS_FORBIDDEN');
          return;
        case 'INSUFFICIENT_STOCK':
          sendPublicError(request, reply, 409, 'INSUFFICIENT_STOCK', {
            productIds: result.productIds,
          });
          return;
        case 'BLOCKED_IN_COUNTRY':
          sendPublicError(request, reply, 409, 'BLOCKED_IN_COUNTRY', {
            productIds: result.productIds,
          });
          return;
        case 'IDEMPOTENT_IN_PROGRESS':
          sendPublicError(request, reply, 409, 'IDEMPOTENT_IN_PROGRESS');
          return;
        case 'CHECKOUT_FAILED':
          sendPublicError(request, reply, 500, 'CHECKOUT_FAILED');
          return;
      }

      const exhaustiveResult: never = result;
      void exhaustiveResult;
    },
  );
}
