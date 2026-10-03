import { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { sendPublicError } from '../utils/errors.js';
import {
  Cart,
  type Cart as CartResponse,
  AddToCartBody,
  UpdateCartLineBody,
  CreateCartResponse,
  CreateCartBody,
  CartIdParam,
  CartIdAndProductIdParam,
  BelowMoqError,
  RemoveFromCartBody,
} from '@shop/contracts/cart';
import { ErrorResponse } from '@shop/contracts/common';
import { SACK_WEIGHT_GRAMS } from '@shop/contracts/pricing';
import { LEGACY_DATA_COUNTRY, SUPPORTED_COUNTRIES, type Country } from '@shop/contracts/country';
import type { AppContext } from '../app.js';
import type { AuditContext } from '../features/audit/auditEvent.js';

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

export default function cartRoutes(app: FastifyInstance, { services }: AppContext): void {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();
  const { carts } = services;

  // Create cart
  typed.post(
    '/api/cart',
    {
      schema: {
        // Cart creation predates country selection: a bodyless POST stays valid and
        // falls back to the legacy country.
        body: Type.Union([CreateCartBody, Type.Null()]),
        response: {
          201: CreateCartResponse,
        },
      },
    },
    async (request, reply) => {
      const country = request.body?.country ?? LEGACY_DATA_COUNTRY;
      const { cartId } = carts.create(auditContext(request), country);
      reply.code(201);
      return { cartId };
    },
  );

  // Get cart
  typed.get(
    '/api/cart/:cartId',
    {
      schema: {
        params: CartIdParam,
        response: { 200: Cart, 400: ErrorResponse, 404: ErrorResponse, 409: ErrorResponse },
      },
    },
    async (request, reply) => {
      const cart = carts.get(request.params.cartId);
      if (!cart) {
        sendPublicError(request, reply, 404, 'CART_NOT_FOUND');
        return;
      }
      return cart;
    },
  );

  // Add item to cart
  typed.post(
    '/api/cart/:cartId/items',
    {
      schema: {
        params: CartIdParam,
        body: AddToCartBody,
        response: {
          200: Cart,
          400: Type.Union([BelowMoqError, ErrorResponse]),
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const { productId, variantId, quantity } = request.body;
      const cartCountry = carts.country(request.params.cartId);
      if (!cartCountry) {
        sendPublicError(request, reply, 404, 'CART_NOT_FOUND');
        return;
      }
      const variants = services.products.listVariants(Number(productId), cartCountry);
      let resolvedVariantId: string | null | undefined;
      if (variantId !== undefined) {
        resolvedVariantId = String(variantId);
      } else {
        const active = variants.filter((v) => v.active === 1);
        const product = services.products.findCustomerProductById(Number(productId), cartCountry);
        const defaultVariant = product?.default_variant_id
          ? active.find((variant) => variant.id === product.default_variant_id)
          : undefined;
        if (defaultVariant) {
          resolvedVariantId = String(defaultVariant.id);
        } else if (active.length === 1) {
          resolvedVariantId = String(active[0]!.id);
        } else if (active.length === 0) {
          resolvedVariantId = undefined;
        } else {
          resolvedVariantId = null;
        }
      }

      if (resolvedVariantId === null) {
        sendPublicError(request, reply, 400, 'REQUEST_INVALID');
        return;
      }
      if (resolvedVariantId === undefined) {
        sendPublicError(request, reply, 400, 'VARIANT_NOT_FOUND');
        return;
      }

      const selectedVariant = variants.find((variant) => variant.id === Number(resolvedVariantId));
      const requestedQuantity =
        quantity ??
        (selectedVariant
          ? minimumMoqQuantity(selectedVariant.weight_grams, selectedVariant.moq_sacks)
          : undefined);

      const cart = carts.add(
        request.params.cartId,
        resolvedVariantId,
        requestedQuantity,
        auditContext(request),
      );
      if (cart === 'CART_NOT_FOUND') {
        sendPublicError(request, reply, 404, 'CART_NOT_FOUND');
        return;
      }
      if (cart === 'VARIANT_NOT_FOUND' || cart === 'BLOCKED_IN_COUNTRY') {
        sendPublicError(request, reply, 404, 'VARIANT_NOT_FOUND');
        return;
      }
      if (cart === 'CART_RESERVED') {
        sendPublicError(request, reply, 409, 'CART_RESERVED');
        return;
      }
      if (cart === 'BELOW_MOQ') {
        const minQuantity = selectedVariant
          ? minimumMoqQuantity(selectedVariant.weight_grams, selectedVariant.moq_sacks)
          : undefined;
        if (minQuantity === undefined) {
          sendPublicError(request, reply, 400, 'INTERNAL_ERROR');
          return;
        }
        sendPublicError(request, reply, 400, 'BELOW_MOQ', { minQuantity });
        return;
      }
      if (cart === 'INVALID_QUANTITY') {
        if (requestedQuantity === undefined) {
          sendPublicError(request, reply, 400, 'INTERNAL_ERROR');
          return;
        }
        sendPublicError(request, reply, 400, 'INVALID_QUANTITY', { quantity: requestedQuantity });
        return;
      }
      return cart;
    },
  );

  // Update cart item quantity
  typed.patch(
    '/api/cart/:cartId/items',
    {
      schema: {
        params: CartIdParam,
        body: UpdateCartLineBody,
        response: {
          200: Cart,
          400: Type.Union([BelowMoqError, ErrorResponse]),
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const { productId, variantId, configKey, quantity } = request.body;
      const cartData = carts.get(request.params.cartId);
      const resolvedVariantId = resolveCartLineVariant(cartData, productId, variantId, configKey);

      if (resolvedVariantId === 'AMBIGUOUS') {
        sendPublicError(request, reply, 400, 'REQUEST_INVALID');
        return;
      }
      if (resolvedVariantId === undefined) {
        sendPublicError(request, reply, 404, 'VARIANT_NOT_IN_CART');
        return;
      }

      const result = carts.update(
        request.params.cartId,
        resolvedVariantId,
        quantity,
        auditContext(request),
        configKey,
      );
      if (result === 'CART_NOT_FOUND') {
        sendPublicError(request, reply, 404, 'CART_NOT_FOUND');
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
        const minQuantity = minimumMoqQuantityForVariant(
          services.products,
          productId,
          resolvedVariantId,
          carts.country(request.params.cartId),
        );
        sendPublicError(request, reply, 400, 'BELOW_MOQ', { minQuantity });
        return;
      }
      if (result === 'INVALID_QUANTITY') {
        sendPublicError(request, reply, 400, 'INVALID_QUANTITY', { quantity });
        return;
      }
      return result;
    },
  );

  // Remove item from cart
  typed.delete(
    '/api/cart/:cartId/items/:productId',
    {
      schema: {
        params: CartIdAndProductIdParam,
        body: Type.Optional(RemoveFromCartBody),
        response: { 200: Cart, 400: ErrorResponse, 404: ErrorResponse, 409: ErrorResponse },
      },
    },
    async (request, reply) => {
      const productId = request.body?.productId ?? request.params.productId;
      if (request.body && request.body.productId !== request.params.productId) {
        sendPublicError(request, reply, 400, 'REQUEST_INVALID');
        return;
      }
      const cartData = carts.get(request.params.cartId);
      const resolvedVariantId = resolveCartLineVariant(
        cartData,
        productId,
        request.body?.variantId,
        request.body?.configKey,
      );

      if (resolvedVariantId === 'AMBIGUOUS') {
        sendPublicError(request, reply, 400, 'REQUEST_INVALID');
        return;
      }
      if (resolvedVariantId === undefined) {
        sendPublicError(request, reply, 404, 'VARIANT_NOT_IN_CART');
        return;
      }

      const result = carts.remove(
        request.params.cartId,
        resolvedVariantId,
        auditContext(request),
        request.body?.configKey,
      );
      if (result === 'CART_NOT_FOUND') {
        sendPublicError(request, reply, 404, 'CART_NOT_FOUND');
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
      return result;
    },
  );
}

function resolveCartLineVariant(
  cart: CartResponse | undefined,
  productId: string,
  variantId: number | undefined,
  configKey: string | undefined,
): string | undefined {
  const matchingLines =
    cart?.items.filter(
      (item) => item.productId === productId && item.configKey === (configKey ?? ''),
    ) ?? [];
  if (variantId !== undefined) {
    return matchingLines.some((item) => item.variantSnap?.variantId === variantId)
      ? String(variantId)
      : undefined;
  }
  if (matchingLines.length !== 1) return matchingLines.length > 1 ? 'AMBIGUOUS' : undefined;
  const selected = matchingLines[0]?.variantSnap?.variantId;
  return selected ? String(selected) : undefined;
}

function minimumMoqQuantity(weightGrams: number, moqSacks: number): number {
  const quantity = Math.ceil((moqSacks * SACK_WEIGHT_GRAMS) / weightGrams);
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new RangeError('MOQ quantity is outside the safe integer range.');
  }
  return quantity;
}

/**
 * Resolve MOQ facts from the persisted cart line's variant. Prefer cart country; fall back to
 * another supported catalog country when that country intentionally hides the variant.
 */
function minimumMoqQuantityForVariant(
  products: AppContext['services']['products'],
  productId: string,
  variantId: string,
  preferredCountry: Country | undefined,
): number {
  const countries = preferredCountry
    ? [preferredCountry, ...SUPPORTED_COUNTRIES.filter((country) => country !== preferredCountry)]
    : [...SUPPORTED_COUNTRIES];
  for (const country of countries) {
    const variant = products
      .listVariants(Number(productId), country)
      .find((candidate) => candidate.id === Number(variantId));
    if (variant) return minimumMoqQuantity(variant.weight_grams, variant.moq_sacks);
  }
  throw new Error('Unable to resolve MOQ facts for cart line.');
}
