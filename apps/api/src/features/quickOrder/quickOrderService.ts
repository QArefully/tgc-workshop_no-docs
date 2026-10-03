import type { Cart } from '@shop/contracts/cart';
import type { QuickOrderLineOutcome } from '@shop/contracts/quick-order';
import type { UnitOfWork } from '../../db/unitOfWork.js';
import type { AuditContext } from '../audit/auditEvent.js';
import type { AuditWriter } from '../audit/auditService.js';
import type { CartService } from '../cart/cartService.js';
import type { VariantWithProductRow } from '../catalog/productRepository.js';
import type { CountryProfileService } from '../countryProfile/countryProfileService.js';
import {
  QUICK_ORDER_MAX_INPUT_LINES,
  assembleQuickOrderOutcomes,
  buildQuickOrderDemand,
  countQuickOrderOutcomes,
  parseQuickOrderText,
  toQuickOrderBulkAddRequests,
} from './quickOrderRules.js';
import { quickOrderError, quickOrderOk, type QuickOrderResult } from './quickOrderErrors.js';

/** Narrow SKU reader; satisfied by `ProductRepository`. */
export interface QuickOrderVariantReader {
  findVariantsBySkus(
    skus: readonly string[],
    exclusions?: { blockedCategories: readonly string[]; blockedSlugs: readonly string[] },
  ): VariantWithProductRow[];
}

export interface QuickOrderDependencies {
  carts: Pick<CartService, 'addMany' | 'country'>;
  variants: QuickOrderVariantReader;
  countryProfiles: Pick<CountryProfileService, 'blockedCategoriesFor' | 'blockedSlugsFor'>;
  unitOfWork: UnitOfWork;
  audit: AuditWriter;
}

export interface QuickOrderInput {
  cartId: string;
  text: string;
  context: AuditContext;
}

/** Domain report; route handlers map this directly to the transport response. */
export interface QuickOrderReport {
  cart: Cart;
  addedLineCount: number;
  skippedLineCount: number;
  outcomes: QuickOrderLineOutcome[];
}

export interface QuickOrderService {
  /** Parses one paste and applies all cart-eligible SKU demand in a single transaction. */
  quickOrder(input: QuickOrderInput): QuickOrderResult<QuickOrderReport>;
}

export function createQuickOrderService(dependencies: QuickOrderDependencies): QuickOrderService {
  return {
    quickOrder({ cartId, text, context }) {
      return dependencies.unitOfWork.run((): QuickOrderResult<QuickOrderReport> => {
        const lines = parseQuickOrderText(text);
        if (lines.length === 0) return quickOrderError<QuickOrderReport>('NO_INPUT_LINES');
        if (lines.length > QUICK_ORDER_MAX_INPUT_LINES) {
          return quickOrderError<QuickOrderReport>('TOO_MANY_LINES');
        }
        const country = dependencies.carts.country(cartId);
        if (!country) return quickOrderError<QuickOrderReport>('CART_NOT_FOUND');

        const skus = [...new Set(lines.flatMap((line) => (line.sku === null ? [] : [line.sku])))];
        const exclusions = {
          blockedCategories: dependencies.countryProfiles.blockedCategoriesFor(country),
          blockedSlugs: dependencies.countryProfiles.blockedSlugsFor(country),
        };
        const variants = dependencies.variants.findVariantsBySkus(skus, exclusions);
        const visibleSkus = new Set(variants.map((variant) => variant.sku));
        const blockedSkus = new Set(
          dependencies.variants
            .findVariantsBySkus(skus)
            .filter((variant) => !visibleSkus.has(variant.sku))
            .map((variant) => variant.sku),
        );
        const variantBySku = new Map(variants.map((variant) => [variant.sku, variant]));
        const groups = buildQuickOrderDemand(lines, variantBySku);
        const result = dependencies.carts.addMany(
          cartId,
          toQuickOrderBulkAddRequests(groups),
          context,
        );
        if (result === 'CART_NOT_FOUND' || result === 'CART_RESERVED') {
          return quickOrderError<QuickOrderReport>(result);
        }

        const outcomes = assembleQuickOrderOutcomes(
          lines,
          groups,
          result.outcomes,
          variantBySku,
        ).map((outcome) =>
          outcome.sku !== null && blockedSkus.has(outcome.sku)
            ? { ...outcome, reason: 'BLOCKED_IN_COUNTRY' as const }
            : outcome,
        );
        const { addedLineCount, skippedLineCount } = countQuickOrderOutcomes(outcomes);
        dependencies.audit.append({
          action: 'cart.quick_order_added',
          cartId,
          lineCount: lines.length,
          addedLineCount,
          skippedLineCount,
          context,
        });

        return quickOrderOk<QuickOrderReport>({
          cart: result.cart,
          addedLineCount,
          skippedLineCount,
          outcomes,
        });
      });
    },
  };
}
