import type { CustomBlendSnapshot, ResolvedCustomBlendSnapshot } from '@shop/contracts';
import { resolveClearance } from '../pricing/clearanceRules.js';
import { resolveUnitPriceCents, validateMoq } from '../pricing/pricingRules.js';

/**
 * Feature-agnostic multi-line cart add rules.
 *
 * A caller submits one request per desired line; every request carries an opaque `key` that the
 * caller uses to correlate the per-line outcome. Partial success is the normal result: a skipped
 * line is a domain outcome, never an error, and never cancels the lines that did apply.
 */
export interface BulkAddRequest {
  /** Caller-owned correlation handle; opaque to the cart feature. */
  key: string;
  variantId: number;
  quantity: number;
  customBlend?: CustomBlendSnapshot;
}

/**
 * Reason precedence is fixed: `BLOCKED_IN_COUNTRY`, `VARIANT_RETIRED`, `BLEND_UNAVAILABLE`,
 * `INVALID_QUANTITY`, `INSUFFICIENT_STOCK`, `BELOW_MOQ`. A line failing several checks always
 * reports the first reason in that order.
 */
export const BULK_ADD_SKIP_REASONS = [
  'BLOCKED_IN_COUNTRY',
  'VARIANT_RETIRED',
  'BLEND_UNAVAILABLE',
  'INVALID_QUANTITY',
  'INSUFFICIENT_STOCK',
  'BELOW_MOQ',
] as const;

export type BulkAddSkipReason = (typeof BULK_ADD_SKIP_REASONS)[number];

export interface BulkAddOutcome {
  key: string;
  status: 'added' | 'skipped';
  reason?: BulkAddSkipReason;
  /** Post-add cumulative quantity of the `(variantId, configKey)` line. Added outcomes only. */
  resultingQuantity?: number;
  /**
   * Tier- and clearance-resolved unit price at `resultingQuantity`. Added outcomes always carry
   * this; policy-valid configured skips carry it when their requested quantity was resolvable.
   */
  resolvedUnitPriceCents?: number;
}

/** One demand group: every request sharing a `(variantId, configKey)` identity. */
export interface BulkAddGroup {
  variantId: number;
  configKey: string;
  /** Sum of every member request quantity; deliberately unvalidated so classification can judge. */
  requestedQuantity: number;
  /** Caller keys in submission order; the group outcome fans back out to all of them. */
  keys: string[];
  customBlend?: CustomBlendSnapshot;
}

/** Structural subset of `product_variants` needed to classify a demand group. */
export interface BulkAddVariantRow {
  id: number;
  weight_grams: number;
  price_cents: number;
  moq_sacks: number;
  active: number;
  clearance_price_cents: number | null;
  clearance_starts_at: string | null;
  clearance_ends_at: string | null;
}

/** Availability facts for one variant, as returned by `InventoryService.availableToSell`. */
export interface BulkAddAvailability {
  availableToSell: number;
  backorderable: boolean;
}

export interface ClassifyBulkAddGroupInput {
  blockedInCountry: boolean;
  variantRow: BulkAddVariantRow | undefined;
  /** Quantity already on the `(variantId, configKey)` cart line before this add. */
  existingQuantity: number;
  requestedQuantity: number;
  availability: BulkAddAvailability | undefined;
  /** `undefined` when the group carries no configured blend. */
  blendValid?: boolean;
  /** Resolver-owned component pricing for a configured group at the resulting quantity. */
  resolvedBlend?: Pick<ResolvedCustomBlendSnapshot, 'materialUnitPriceCents'>;
  now: Date;
}

export type BulkAddClassification =
  | { status: 'added'; resultingQuantity: number; resolvedUnitPriceCents: number }
  | { status: 'skipped'; reason: BulkAddSkipReason; resolvedUnitPriceCents?: number };

function configKeyOf(request: BulkAddRequest): string {
  return request.customBlend?.configKey ?? '';
}

/**
 * Groups requests by `(variantId, configKey)` so duplicated lines are judged once, against their
 * combined demand, before any stock or MOQ check runs. Group order follows first appearance.
 */
export function aggregateBulkAddDemand(requests: readonly BulkAddRequest[]): BulkAddGroup[] {
  const groups: BulkAddGroup[] = [];
  const indexByIdentity = new Map<string, number>();
  for (const request of requests) {
    const configKey = configKeyOf(request);
    const identity = `${request.variantId}\u0000${configKey}`;
    const existingIndex = indexByIdentity.get(identity);
    if (existingIndex === undefined) {
      indexByIdentity.set(identity, groups.length);
      groups.push({
        variantId: request.variantId,
        configKey,
        requestedQuantity: request.quantity,
        keys: [request.key],
        ...(request.customBlend ? { customBlend: request.customBlend } : {}),
      });
      continue;
    }
    const group = groups[existingIndex]!;
    group.requestedQuantity += request.quantity;
    group.keys.push(request.key);
  }
  return groups;
}

/** Mirrors `cartService.supportsCartLineArithmetic`; overflow-unsafe lines never reach the cart. */
function supportsCartLineArithmetic(variant: BulkAddVariantRow, quantity: number): boolean {
  return !(
    !Number.isSafeInteger(quantity) ||
    quantity < 1 ||
    !Number.isSafeInteger(variant.weight_grams) ||
    variant.weight_grams < 1 ||
    !Number.isSafeInteger(variant.price_cents) ||
    variant.price_cents < 0 ||
    quantity > Math.floor(Number.MAX_SAFE_INTEGER / variant.weight_grams) ||
    variant.price_cents > Math.floor(Number.MAX_SAFE_INTEGER / 100) ||
    (variant.price_cents > 0 &&
      quantity > Math.floor(Number.MAX_SAFE_INTEGER / variant.price_cents))
  );
}

/**
 * Decides a single demand group. A group is added at its full ordered quantity or not at all:
 * quantity is never clamped down to stock nor raised up to the MOQ floor.
 *
 * Clock is injected; this module never reads wall time.
 */
export function classifyBulkAddGroup({
  blockedInCountry,
  variantRow,
  existingQuantity,
  requestedQuantity,
  availability,
  blendValid,
  resolvedBlend,
  now,
}: ClassifyBulkAddGroupInput): BulkAddClassification {
  // A configured line can still have a valid, resolver-derived price when policy blocks the
  // country. Keep that price on the outcome so reorder can disclose configured price drift without
  // falling back to the base variant price. Ordinary lines have no resolved blend and stay as-is.
  const skipped = (reason: BulkAddSkipReason): BulkAddClassification => {
    const carriesResolvedBlendPrice =
      resolvedBlend !== undefined &&
      blendValid !== false &&
      variantRow?.active === 1 &&
      (reason === 'BLOCKED_IN_COUNTRY' ||
        reason === 'INSUFFICIENT_STOCK' ||
        reason === 'BELOW_MOQ');
    return {
      status: 'skipped',
      reason,
      ...(carriesResolvedBlendPrice
        ? { resolvedUnitPriceCents: resolvedBlend.materialUnitPriceCents }
        : {}),
    };
  };

  if (blockedInCountry) return skipped('BLOCKED_IN_COUNTRY');
  if (!variantRow || variantRow.active !== 1) return skipped('VARIANT_RETIRED');
  if (blendValid === false) return skipped('BLEND_UNAVAILABLE');
  if (
    !Number.isSafeInteger(existingQuantity) ||
    existingQuantity < 0 ||
    !Number.isSafeInteger(requestedQuantity) ||
    requestedQuantity < 1 ||
    !Number.isSafeInteger(variantRow.moq_sacks) ||
    variantRow.moq_sacks < 1
  ) {
    return skipped('INVALID_QUANTITY');
  }
  const resultingQuantity = existingQuantity + requestedQuantity;
  if (!supportsCartLineArithmetic(variantRow, resultingQuantity)) {
    return skipped('INVALID_QUANTITY');
  }

  // Backorderable stock never blocks; only a non-backorderable shortfall does.
  const backorderable = availability?.backorderable === true;
  if (!backorderable && (availability?.availableToSell ?? 0) < resultingQuantity) {
    return skipped('INSUFFICIENT_STOCK');
  }

  if (!validateMoq(resultingQuantity, variantRow.weight_grams, variantRow.moq_sacks)) {
    return skipped('BELOW_MOQ');
  }

  const clearanceResolution = resolveClearance({
    priceCents: variantRow.price_cents,
    clearancePriceCents: variantRow.clearance_price_cents,
    clearanceStartsAt: variantRow.clearance_starts_at,
    clearanceEndsAt: variantRow.clearance_ends_at,
    weightGrams: variantRow.weight_grams,
    now,
  });
  const resolvedBasePriceCents =
    clearanceResolution.clearance?.priceCents ?? clearanceResolution.basePriceCents;
  return {
    status: 'added',
    resultingQuantity,
    resolvedUnitPriceCents:
      resolvedBlend?.materialUnitPriceCents ??
      resolveUnitPriceCents(resolvedBasePriceCents, resultingQuantity, variantRow.weight_grams),
  };
}

/** Expands one group classification back onto every caller key that fed the group. */
export function fanOutBulkAddOutcome(
  group: BulkAddGroup,
  classification: BulkAddClassification,
): BulkAddOutcome[] {
  return group.keys.map((key) =>
    classification.status === 'added'
      ? {
          key,
          status: 'added' as const,
          resultingQuantity: classification.resultingQuantity,
          resolvedUnitPriceCents: classification.resolvedUnitPriceCents,
        }
      : {
          key,
          status: 'skipped' as const,
          reason: classification.reason,
          ...(classification.resolvedUnitPriceCents === undefined
            ? {}
            : { resolvedUnitPriceCents: classification.resolvedUnitPriceCents }),
        },
  );
}
