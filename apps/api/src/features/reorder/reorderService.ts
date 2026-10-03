import type { Cart } from '@shop/contracts/cart';
import type { OrderLineItem } from '@shop/contracts/orders';
import type { UnitOfWork } from '../../db/unitOfWork.js';
import type { AuditContext } from '../audit/auditEvent.js';
import type { AuditWriter } from '../audit/auditService.js';
import type { CartService } from '../cart/cartService.js';
import type { BulkAddOutcome } from '../cart/cartBulkAddRules.js';
import type { VariantRow } from '../catalog/productRepository.js';
import type { OrderService } from '../orders/orderService.js';
import { resolveClearance } from '../pricing/clearanceRules.js';
import { resolveUnitPriceCents } from '../pricing/pricingRules.js';
import { reorderError, reorderOk, type ReorderResult } from './reorderErrors.js';
import {
  assembleReorderOutcomes,
  countReorderOutcomes,
  reorderLineVariantId,
  toBulkAddRequests,
  type ReorderLineOutcome,
} from './reorderRules.js';

/** Narrow live-variant reader; satisfied by `ProductRepository`. */
export interface ReorderVariantReader {
  findVariantsByIds(variantIds: readonly number[]): VariantRow[];
}

export interface ReorderDependencies {
  orders: Pick<OrderService, 'getOwned'>;
  carts: Pick<CartService, 'addMany'>;
  variants: ReorderVariantReader;
  unitOfWork: UnitOfWork;
  audit: AuditWriter;
  clock: { now(): Date };
}

export interface ReorderInput {
  orderId: number;
  userId: number;
  cartId: string;
  context: AuditContext;
}

/** Domain-shaped reorder report; transport mapping happens outside this feature. */
export interface ReorderReport {
  cart: Cart;
  addedLineCount: number;
  skippedLineCount: number;
  outcomes: ReorderLineOutcome[];
}

export interface ReorderService {
  /**
   * Re-adds every resolvable line of an owned past order to a cart, in one transaction.
   *
   * Partial success is the normal result: a retired variant, a shortfall, or a sub-MOQ line is
   * reported as a skipped outcome and never blocks the lines that did apply. Reorder is offered
   * for orders in any lifecycle state, including cancelled and returned ones.
   */
  reorder(input: ReorderInput): ReorderResult<ReorderReport>;
}

/**
 * Composes the canonical clearance-then-tier price for one live variant at a given quantity.
 *
 * Mirrors the ordering used by the cart read model and by bulk-add classification; a variant that
 * is gone or retired has no current price at all.
 */
function currentUnitPriceFor(
  variant: VariantRow | undefined,
  quantity: number,
  now: Date,
): number | null {
  if (!variant || variant.active !== 1) return null;
  if (!Number.isSafeInteger(quantity) || quantity < 1) return null;
  if (!Number.isSafeInteger(variant.weight_grams) || variant.weight_grams < 1) return null;
  if (!Number.isSafeInteger(variant.price_cents) || variant.price_cents < 0) return null;
  const clearanceResolution = resolveClearance({
    priceCents: variant.price_cents,
    clearancePriceCents: variant.clearance_price_cents,
    clearanceStartsAt: variant.clearance_starts_at,
    clearanceEndsAt: variant.clearance_ends_at,
    weightGrams: variant.weight_grams,
    now,
  });
  const resolvedBasePriceCents =
    clearanceResolution.clearance?.priceCents ?? clearanceResolution.basePriceCents;
  return resolveUnitPriceCents(resolvedBasePriceCents, quantity, variant.weight_grams);
}

/**
 * Builds the current-price map used for drift disclosure.
 *
 * An added line already carries the cart's resolved price at its post-add cumulative quantity, so
 * that value is reused rather than recomputed. A policy-valid configured skip likewise carries the
 * singleton resolver's material price; a configured line without that outcome price is unresolved
 * and must not fall back to the base variant price. Ordinary lines are priced live at the quantity
 * that was originally ordered.
 */
function resolveCurrentPrices(
  orderLines: readonly OrderLineItem[],
  bulkOutcomes: readonly BulkAddOutcome[],
  variants: ReorderVariantReader,
  now: Date,
): Map<string, number | null> {
  const outcomeByKey = new Map(bulkOutcomes.map((outcome) => [outcome.key, outcome]));
  const variantIds = [
    ...new Set(
      orderLines
        .map((line) => reorderLineVariantId(line))
        .filter((variantId): variantId is number => variantId !== null),
    ),
  ];
  const variantById = new Map(
    (variantIds.length > 0 ? variants.findVariantsByIds(variantIds) : []).map((row) => [
      row.id,
      row,
    ]),
  );
  const prices = new Map<string, number | null>();
  for (const line of orderLines) {
    const key = String(line.lineId);
    const outcome = outcomeByKey.get(key);
    if (typeof outcome?.resolvedUnitPriceCents === 'number') {
      prices.set(key, outcome.resolvedUnitPriceCents);
      continue;
    }
    // The base variant price is not a valid substitute for a configured blend. The cart bulk
    // classifier leaves this null when the singleton resolver could not resolve the blend itself
    // (including BLEND_UNAVAILABLE), while policy-valid stock/MOQ/country skips carry the price
    // above and return early.
    if (line.customBlend) {
      prices.set(key, null);
      continue;
    }
    const variantId = reorderLineVariantId(line);
    prices.set(
      key,
      variantId === null
        ? null
        : currentUnitPriceFor(variantById.get(variantId), line.quantity, now),
    );
  }
  return prices;
}

export function createReorderService(dependencies: ReorderDependencies): ReorderService {
  return {
    reorder({ orderId, userId, cartId, context }) {
      return dependencies.unitOfWork.run((): ReorderResult<ReorderReport> => {
        // Ownership failure and a missing order are deliberately indistinguishable to the caller.
        const order = dependencies.orders.getOwned(orderId, userId);
        if (!order) return reorderError<ReorderReport>('ORDER_NOT_FOUND');

        const { requests } = toBulkAddRequests(order.items);
        const result = dependencies.carts.addMany(cartId, requests, context);
        if (result === 'CART_NOT_FOUND' || result === 'CART_RESERVED') {
          return reorderError<ReorderReport>(result);
        }

        const now = dependencies.clock.now();
        const resolvedPrices = resolveCurrentPrices(
          order.items,
          result.outcomes,
          dependencies.variants,
          now,
        );
        const outcomes = assembleReorderOutcomes(order.items, result.outcomes, resolvedPrices);
        const { addedLineCount, skippedLineCount } = countReorderOutcomes(outcomes);

        // Reorder-level audit. Bulk add separately emits its own cart-level add events; both are
        // intended, because they answer different questions about the same mutation.
        dependencies.audit.append({
          action: 'cart.reorder_added',
          cartId,
          orderId,
          addedLineCount,
          skippedLineCount,
          context,
        });

        return reorderOk<ReorderReport>({
          cart: result.cart,
          addedLineCount,
          skippedLineCount,
          outcomes,
        });
      });
    },
  };
}
