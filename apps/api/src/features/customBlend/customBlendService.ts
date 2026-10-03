import {
  type Cart,
  type CustomBlendBaseListQuery,
  type CustomBlendBaseListResponse,
  type CreateCustomBlendBody,
  type CustomBlendEvaluationBody,
  type CustomBlendEvaluationResponse,
  type CustomBlendOptionsResponse,
  type CustomBlendSnapshot,
  type ReplaceCustomBlendBody,
} from '@shop/contracts';
import type { Country } from '@shop/contracts/country';
import type { CustomBlendRepository } from './customBlendRepository.js';
import type { CartService } from '../cart/cartService.js';
import type { AuditContext } from '../audit/auditEvent.js';
import {
  createCustomBlendResolver,
  CustomBlendResolverError,
  type CustomBlendResolver,
  type CustomBlendResolverClock,
} from './customBlendResolver.js';

export class CustomBlendInvalidError extends Error {
  readonly resolverCode?: CustomBlendResolverError['code'];
  readonly maxPercentage?: number;
  readonly actualPercentage?: number;

  constructor(message: string, resolverError?: CustomBlendResolverError) {
    super(message);
    this.name = 'CustomBlendInvalidError';
    if (resolverError) {
      this.resolverCode = resolverError.code;
      this.maxPercentage = resolverError.maxPercentage;
      this.actualPercentage = resolverError.actualPercentage;
    }
  }
}

export interface CustomBlendService {
  listBases(query?: CustomBlendBaseListQuery, country?: Country): CustomBlendBaseListResponse;
  listOptions(baseVariantId: number, country?: Country): CustomBlendOptionsResponse;
  evaluate(body: CustomBlendEvaluationBody, country?: Country): CustomBlendEvaluationResponse;
  create(
    carts: CartService,
    cartId: string,
    body: CreateCustomBlendBody,
    context: AuditContext,
  ): CustomBlendMutationResult;
  replace(
    carts: CartService,
    cartId: string,
    body: ReplaceCustomBlendBody,
    context: AuditContext,
  ): CustomBlendMutationResult;
}

export type CustomBlendMutationResult =
  | Cart
  | 'CART_NOT_FOUND'
  | 'VARIANT_NOT_FOUND'
  | 'VARIANT_NOT_IN_CART'
  | 'CART_RESERVED'
  | 'BLOCKED_IN_COUNTRY'
  | 'BELOW_MOQ'
  | 'INVALID_QUANTITY';

/**
 * Resolves options and mutation specifications through one authority. The repository overload is
 * retained for existing direct service callers; application composition supplies the resolver and
 * an injected clock explicitly.
 */
export function createCustomBlendService(resolver: CustomBlendResolver): CustomBlendService;
export function createCustomBlendService(
  repository: CustomBlendRepository,
  clock?: CustomBlendResolverClock,
): CustomBlendService;
export function createCustomBlendService(
  resolverOrRepository: CustomBlendResolver | CustomBlendRepository,
  clock: CustomBlendResolverClock = { now: () => new Date(0) },
): CustomBlendService {
  const resolver = isCustomBlendResolver(resolverOrRepository)
    ? resolverOrRepository
    : createCustomBlendResolver(resolverOrRepository, clock);
  return {
    listBases(query, country) {
      try {
        return resolver.listBases(query, country);
      } catch (error) {
        throwInvalid(error);
      }
    },
    listOptions(baseVariantId, country) {
      try {
        return resolver.listOptions(baseVariantId, country);
      } catch (error) {
        throwInvalid(error);
      }
    },
    evaluate(body, country) {
      try {
        const resolved = resolver.evaluate(
          body.baseVariantId,
          body.ingredients,
          body.quantity,
          country,
        );
        return { quantity: resolved.quantity, customBlend: resolved };
      } catch (error) {
        throwInvalid(error);
      }
    },
    create(carts, cartId, body, context) {
      if (
        carts.blockedInCountry(cartId, [
          body.baseVariantId,
          ...body.ingredients.map((ingredient) => ingredient.variantId),
        ])
      ) {
        return 'BLOCKED_IN_COUNTRY';
      }
      const evaluated = evaluatedSpecFor(
        resolver,
        body.baseVariantId,
        body.ingredients,
        body.quantity,
      );
      return carts.addConfigured(
        cartId,
        String(body.baseVariantId),
        evaluated.snapshot,
        evaluated.quantity,
        context,
      );
    },
    replace(carts, cartId, body, context) {
      if (
        carts.blockedInCountry(cartId, [
          body.baseVariantId,
          ...body.ingredients.map((ingredient) => ingredient.variantId),
        ])
      ) {
        return 'BLOCKED_IN_COUNTRY';
      }
      const evaluated = evaluatedSpecFor(resolver, body.baseVariantId, body.ingredients);
      return carts.replaceConfigured(
        cartId,
        String(body.baseVariantId),
        body.configKey,
        evaluated.snapshot,
        context,
      );
    },
  };
}

function isCustomBlendResolver(
  value: CustomBlendResolver | CustomBlendRepository,
): value is CustomBlendResolver {
  return typeof (value as CustomBlendResolver).evaluate === 'function';
}

function throwInvalid(error: unknown): never {
  if (error instanceof CustomBlendInvalidError) throw error;
  if (error instanceof CustomBlendResolverError) {
    throw new CustomBlendInvalidError('Custom Blend specification is invalid.', error);
  }
  throw error;
}

function evaluatedSpecFor(
  resolver: CustomBlendResolver,
  baseVariantId: number,
  ingredients: CreateCustomBlendBody['ingredients'],
  quantity?: number,
): { snapshot: CustomBlendSnapshot; quantity: number } {
  try {
    const resolved = resolver.evaluate(baseVariantId, ingredients, quantity);
    return { snapshot: resolver.toPersistedSpec(resolved), quantity: resolved.quantity };
  } catch (error) {
    throwInvalid(error);
  }
}
