import { SACK_WEIGHT_GRAMS } from '@shop/contracts/pricing';
import type {
  SavedListLineOutcome,
  SavedListSkipReason as ContractSavedListSkipReason,
} from '@shop/contracts/saved-lists';
import type {
  BulkAddOutcome,
  BulkAddRequest,
  BulkAddSkipReason,
} from '../cart/cartBulkAddRules.js';
import type { VariantRow } from '../catalog/productRepository.js';
import { moqShortfallSacks } from '../pricing/pricingRules.js';

export const SAVED_LIST_MAX_PER_USER = 25;
export const SAVED_LIST_MAX_ITEMS = 200;

/** Whitespace is presentation-insignificant in names, including duplicate detection. */
export function normalizeSavedListName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized.length >= 1 && normalized.length <= 80 ? normalized : null;
}

export function safeSavedQuantity(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export type SavedListPreSkipReason = 'VARIANT_RETIRED' | 'VARIANT_UNRESOLVED' | 'INVALID_QUANTITY';
export type SavedListSkipReason = SavedListPreSkipReason | BulkAddSkipReason;

type SavedListSkipReasonIsContractAssignable =
  SavedListSkipReason extends ContractSavedListSkipReason ? true : never;
const savedListSkipReasonIsContractAssignable: SavedListSkipReasonIsContractAssignable = true;
void savedListSkipReasonIsContractAssignable;

export interface SavedListCartItemSource {
  itemId: number;
  variantId: number;
  sku: string;
  productId: string;
  productName: string;
  quantity: number;
  variant: VariantRow | undefined;
}

export interface SavedListCartPlan {
  requests: BulkAddRequest[];
  preSkips: Map<number, SavedListPreSkipReason>;
  submittedQuantityByItemId: Map<number, number>;
  moqAdjustedByItemId: Map<number, boolean>;
}

function moqQuantity(quantity: number, variant: VariantRow): number | null {
  if (!safeSavedQuantity(quantity) || variant.active !== 1) return null;
  if (!safeSavedQuantity(variant.weight_grams) || !safeSavedQuantity(variant.moq_sacks))
    return null;
  if (quantity > Math.floor(Number.MAX_SAFE_INTEGER / variant.weight_grams)) return null;
  if (variant.moq_sacks > Math.floor(Number.MAX_SAFE_INTEGER / SACK_WEIGHT_GRAMS)) return null;
  const result = quantity + moqShortfallSacks(quantity, variant.weight_grams, variant.moq_sacks);
  return Number.isSafeInteger(result) ? result : null;
}

/** Retired lines are deliberately pre-skipped: cart lookup must not turn history into a live add. */
export function buildSavedListCartPlan(
  items: readonly SavedListCartItemSource[],
): SavedListCartPlan {
  const requests: BulkAddRequest[] = [];
  const preSkips = new Map<number, SavedListPreSkipReason>();
  const submittedQuantityByItemId = new Map<number, number>();
  const moqAdjustedByItemId = new Map<number, boolean>();
  for (const item of items) {
    if (!safeSavedQuantity(item.quantity)) {
      preSkips.set(item.itemId, 'INVALID_QUANTITY');
      continue;
    }
    if (!item.variant) {
      preSkips.set(item.itemId, 'VARIANT_UNRESOLVED');
      continue;
    }
    if (item.variant.active !== 1) {
      preSkips.set(item.itemId, 'VARIANT_RETIRED');
      continue;
    }
    const submittedQuantity = moqQuantity(item.quantity, item.variant);
    if (submittedQuantity === null) {
      preSkips.set(item.itemId, 'INVALID_QUANTITY');
      continue;
    }
    submittedQuantityByItemId.set(item.itemId, submittedQuantity);
    moqAdjustedByItemId.set(item.itemId, submittedQuantity !== item.quantity);
    requests.push({
      key: String(item.itemId),
      variantId: item.variantId,
      quantity: submittedQuantity,
    });
  }
  return { requests, preSkips, submittedQuantityByItemId, moqAdjustedByItemId };
}

export function assembleSavedListCartOutcomes(
  items: readonly SavedListCartItemSource[],
  plan: SavedListCartPlan,
  bulkOutcomes: readonly BulkAddOutcome[],
): SavedListLineOutcome[] {
  const outcomes = new Map(bulkOutcomes.map((outcome) => [outcome.key, outcome]));
  return items.map((item) => {
    const base = {
      itemId: String(item.itemId),
      variantId: item.variantId,
      sku: item.sku,
      productId: item.productId,
      productName: item.productName,
      savedQuantity: item.quantity,
      submittedQuantity: plan.submittedQuantityByItemId.get(item.itemId) ?? null,
      moqAdjusted: plan.moqAdjustedByItemId.get(item.itemId) ?? false,
    };
    const preSkip = plan.preSkips.get(item.itemId);
    if (preSkip)
      return { ...base, resolvedUnitPriceCents: null, status: 'skipped' as const, reason: preSkip };
    const outcome = outcomes.get(String(item.itemId));
    if (!outcome)
      throw new Error(`Saved list item ${item.itemId} was submitted but has no cart outcome`);
    if (outcome.status === 'added') {
      if (!safeNonNegativeInteger(outcome.resolvedUnitPriceCents))
        throw new Error(`Saved list item ${item.itemId} has no cart price`);
      return {
        ...base,
        resolvedUnitPriceCents: outcome.resolvedUnitPriceCents,
        status: 'added' as const,
        reason: null,
      };
    }
    if (!outcome.reason)
      throw new Error(`Saved list item ${item.itemId} was skipped without reason`);
    return {
      ...base,
      resolvedUnitPriceCents: null,
      status: 'skipped' as const,
      reason: outcome.reason,
    };
  });
}

function safeNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function countSavedListOutcomes(outcomes: readonly SavedListLineOutcome[]) {
  const addedLineCount = outcomes.filter((outcome) => outcome.status === 'added').length;
  return { addedLineCount, skippedLineCount: outcomes.length - addedLineCount };
}
