import type { BackInStockStatus, BackInStockSubscription } from '@shop/contracts/back-in-stock';
import type { UnitOfWork } from '../../db/unitOfWork.js';
import type { AuditContext } from '../audit/auditEvent.js';
import type { AuditWriter, Clock } from '../audit/auditService.js';
import type { VariantRow } from '../catalog/productRepository.js';
import type { InventoryService } from '../inventory/inventoryService.js';
import type { CountryProfileService } from '../countryProfile/countryProfileService.js';
import { minimumOrderQuantity } from '../pricing/pricingRules.js';
import { backInStockError, backInStockOk, type BackInStockResult } from './backInStockErrors.js';
import {
  createBackInStockRepository,
  type BackInStockRepository,
  type BackInStockRow,
  type BackInStockSubscriptionRow,
  type BackInStockVariantFacts,
} from './backInStockRepository.js';
import { BACK_IN_STOCK_SUBSCRIPTION_LIMIT, isNotifiable } from './backInStockRules.js';

export interface BackInStockVariantReader {
  findVariantById(variantId: number): VariantRow | undefined;
}

export interface BackInStockDependencies {
  repository: BackInStockRepository;
  inventory: Pick<InventoryService, 'availableToSell'>;
  variants: BackInStockVariantReader;
  unitOfWork: UnitOfWork;
  audit: AuditWriter;
  clock: Clock;
  countryProfiles?: Pick<CountryProfileService, 'isCategoryBlocked' | 'isProductBlocked'>;
}

export interface BackInStockService {
  subscribe(
    userId: number,
    variantId: number,
    context: AuditContext,
  ): BackInStockResult<BackInStockSubscription>;
  listOwned(userId: number, status?: BackInStockStatus): BackInStockSubscription[];
  cancel(userId: number, subscriptionId: number, context: AuditContext): BackInStockResult<null>;
}

function subscription(
  row: BackInStockRow,
  facts: Pick<
    BackInStockVariantFacts,
    'sku' | 'label' | 'product_id' | 'product_name' | 'weight_grams' | 'moq_sacks'
  >,
  minimum: number,
): BackInStockSubscription {
  return {
    subscriptionId: String(row.id),
    variantId: row.variant_id,
    productId: String(facts.product_id),
    sku: facts.sku,
    productName: facts.product_name,
    variantLabel: facts.label,
    status: row.status,
    requestedAt: row.requested_at,
    notifiedAt: row.notified_at,
    minimumOrderQuantity: minimum,
  };
}

/**
 * A retired lot cannot come back: subscribing to one would create an interest nothing can ever
 * satisfy, so it is rejected rather than parked.
 */
function isRetired(variant: VariantRow): boolean {
  return variant.active !== 1;
}

/** Owns the transaction boundary for buyer back-in-stock interest. */
export function createBackInStockService(
  dependencies: BackInStockDependencies,
): BackInStockService {
  const now = () => dependencies.clock.now().toISOString();
  const availabilityFor = (variantId: number, at: string): number =>
    dependencies.inventory
      .availableToSell([variantId], at)
      .find((entry) => entry.variantId === variantId)?.availableToSell ?? 0;
  const listed = (row: BackInStockSubscriptionRow): BackInStockSubscription =>
    subscription(row, row, minimumOrderQuantity(row.weight_grams, row.moq_sacks) ?? 1);
  return {
    subscribe(userId, variantId, context) {
      return dependencies.unitOfWork.run(() => {
        const variant = dependencies.variants.findVariantById(variantId);
        if (!variant) return backInStockError<BackInStockSubscription>('VARIANT_NOT_FOUND');
        const facts = dependencies.repository.variantFacts(variantId);
        if (!facts) return backInStockError<BackInStockSubscription>('VARIANT_NOT_FOUND');
        const country = dependencies.repository.userCountry(userId);
        if (!country) return backInStockError<BackInStockSubscription>('VARIANT_NOT_FOUND');
        if (
          dependencies.countryProfiles?.isCategoryBlocked(country, facts.product_category) ||
          dependencies.countryProfiles?.isProductBlocked(country, facts.product_slug)
        ) {
          return backInStockError<BackInStockSubscription>('VARIANT_NOT_FOUND');
        }
        if (isRetired(variant)) return backInStockError<BackInStockSubscription>('VARIANT_RETIRED');
        const minimum = minimumOrderQuantity(facts.weight_grams, facts.moq_sacks);
        // An unusable weight/MOQ basis makes the variant unorderable, so it is not a valid target.
        if (minimum === undefined)
          return backInStockError<BackInStockSubscription>('VARIANT_NOT_FOUND');
        if (dependencies.repository.findPending(userId, variantId))
          return backInStockError<BackInStockSubscription>('ALREADY_SUBSCRIBED');
        const at = now();
        if (isNotifiable(availabilityFor(variantId, at), minimum))
          return backInStockError<BackInStockSubscription>('VARIANT_AVAILABLE');
        if (dependencies.repository.countPending(userId) >= BACK_IN_STOCK_SUBSCRIPTION_LIMIT)
          return backInStockError<BackInStockSubscription>('SUBSCRIPTION_LIMIT_REACHED');
        const row = dependencies.repository.insert({ userId, variantId, now: at });
        dependencies.audit.append({
          action: 'back_in_stock.subscribed',
          subscriptionId: row.id,
          context,
        });
        return backInStockOk(subscription(row, facts, minimum));
      });
    },
    listOwned(userId, status) {
      return dependencies.repository.listOwned(userId, status).map(listed);
    },
    cancel(userId, subscriptionId, context) {
      return dependencies.unitOfWork.run(() => {
        const row = dependencies.repository.findOwned(subscriptionId, userId);
        // A notified or already-cancelled row has no interest left to withdraw.
        if (!row || row.status !== 'pending')
          return backInStockError<null>('SUBSCRIPTION_NOT_FOUND');
        dependencies.repository.markCancelled(row.id, now());
        dependencies.audit.append({
          action: 'back_in_stock.cancelled',
          subscriptionId: row.id,
          context,
        });
        return backInStockOk(null);
      });
    },
  };
}

export { createBackInStockRepository };
