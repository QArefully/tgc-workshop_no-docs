import { FastifyInstance } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import {
  AddBundleToCartBody,
  BundleMutationConflictResponse,
  CuratedBundleListQuery,
  CuratedBundleListResponse,
} from '@shop/contracts/bundles';
import { CartIdParam, Cart } from '@shop/contracts/cart';
import { ErrorResponse } from '@shop/contracts/common';
import type { AppContext } from '../app.js';
import type { AuditContext } from '../features/audit/auditEvent.js';
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

/** Customer bundle reads and fixed-component cart mutation endpoints. */
export default function bundleRoutes(app: FastifyInstance, { services }: AppContext): void {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();
  const { bundles } = services;

  typed.get(
    '/api/bundles',
    {
      schema: {
        querystring: CuratedBundleListQuery,
        response: { 200: CuratedBundleListResponse, 400: ErrorResponse },
      },
    },
    (request) => bundles.list(request.query.productId, request.resolvedCountry),
  );

  typed.post(
    '/api/cart/:cartId/bundles',
    {
      schema: {
        params: CartIdParam,
        body: AddBundleToCartBody,
        response: {
          200: Cart,
          400: ErrorResponse,
          404: ErrorResponse,
          409: BundleMutationConflictResponse,
        },
      },
    },
    async (request, reply) => {
      const result = bundles.addToCart(
        request.params.cartId,
        request.body.bundleId,
        auditContext(request),
      );
      if (result === 'CART_NOT_FOUND') {
        sendPublicError(request, reply, 404, 'CART_NOT_FOUND');
        return;
      }
      if (result === 'BUNDLE_NOT_FOUND') {
        sendPublicError(request, reply, 404, 'BUNDLE_NOT_FOUND');
        return;
      }
      if (result === 'CART_RESERVED') {
        sendPublicError(request, reply, 409, 'CART_RESERVED');
        return;
      }
      if (
        typeof result === 'object' &&
        'error' in result &&
        result.error === 'BUNDLE_UNAVAILABLE'
      ) {
        // A country-blocked component must stay opaque. Keep stock/retirement diagnostics for
        // ordinary unavailable bundles, but strip every component identifier when the failure
        // could disclose a lot hidden by the cart's persisted country.
        const blockedInCountry = services.carts.blockedInCountry(
          request.params.cartId,
          result.variantIds.map((variantId) => Number(variantId)),
        );
        // Keep the parameterized call type-safe while letting the public-error validator omit
        // diagnostics when a country-blocked component must remain opaque.
        const disclosedVariantIds = blockedInCountry ? [] : result.variantIds;
        sendPublicError(request, reply, 409, 'BUNDLE_UNAVAILABLE', {
          variantIds: disclosedVariantIds,
        });
        return;
      }
      return result;
    },
  );
}
