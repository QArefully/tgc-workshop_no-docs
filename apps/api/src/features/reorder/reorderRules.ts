import type { OrderLineItem } from '@shop/contracts/orders';
import type { ReorderSkipReason as ContractReorderSkipReason } from '@shop/contracts/reorder';
import type {
  BulkAddOutcome,
  BulkAddRequest,
  BulkAddSkipReason,
} from '../cart/cartBulkAddRules.js';

/**
 * Pure reorder rules: source order lines in, cart bulk-add requests and per-line outcomes out.
 *
 * This module never reads a clock, never touches SQL, and never resolves a variant itself. Live
 * variant facts are the cart feature's job; everything here is a deterministic mapping over the
 * order lines plus the outcomes the cart reported back.
 */

/**
 * A line that never reaches the cart. `VARIANT_UNRESOLVED` covers an order line whose variant is
 * gone (`order_line_items.variant_id` is nullable and unconstrained); `INVALID_QUANTITY` guards the
 * cart boundary, because bulk-add aggregates duplicate quantities *before* validating them, so an
 * unusable quantity must never be summed into a sibling line's demand.
 */
export const REORDER_PRE_SKIP_REASONS = ['VARIANT_UNRESOLVED', 'INVALID_QUANTITY'] as const;

export type ReorderPreSkipReason = (typeof REORDER_PRE_SKIP_REASONS)[number];

/** Every reason a source order line can fail to re-add: pre-cart plus cart-classified. */
export type ReorderSkipReason = ReorderPreSkipReason | BulkAddSkipReason;

type ReorderSkipReasonIsContractAssignable = ReorderSkipReason extends ContractReorderSkipReason
  ? true
  : never;
const reorderSkipReasonIsContractAssignable: ReorderSkipReasonIsContractAssignable = true;
void reorderSkipReasonIsContractAssignable;

/** Facts about one source order line, independent of its fate. */
interface ReorderLineIdentity {
  /** Source `order_line_items.id`, stringified; also the bulk-add correlation key. */
  orderLineItemId: string;
  productId: string;
  productName: string;
  /** Null when the original variant can no longer be resolved from the order line. */
  variantId: number | null;
  sku: string | null;
  configKey: string;
  quantity: number;
  /** Unit price frozen on the source order line. */
  orderedUnitPriceCents: number;
  /** Current server-resolved unit price, or null when no current price could be resolved. */
  currentUnitPriceCents: number | null;
  priceChanged: boolean;
}

/**
 * One source order line's fate.
 *
 * The union pairs `status` with `reason` structurally, so an added line carrying a reason (or a
 * skipped line without one) cannot be constructed at all. The transport schema expresses the same
 * pairing through a custom format that Ajv does not enforce on the wire, which makes this type the
 * single thing actually guaranteeing the invariant.
 */
export type ReorderLineOutcome = ReorderLineIdentity &
  ({ status: 'added'; reason: null } | { status: 'skipped'; reason: ReorderSkipReason });

export interface ReorderRequestPlan {
  /** Requests to submit to `CartService.addMany`, in source line order. */
  requests: BulkAddRequest[];
  /** Source line ids that were rejected before the cart, keyed to their reason. */
  preSkips: Map<string, ReorderPreSkipReason>;
}

function orderLineKey(line: OrderLineItem): string {
  return String(line.lineId);
}

/**
 * Live-resolvable variant id of a source order line, or null.
 *
 * The snapshot's other fields (sku, weight, price) are never trusted for eligibility: hydration
 * synthesises fallbacks for them, so only the id is usable and everything else must be re-read.
 */
export function reorderLineVariantId(line: OrderLineItem): number | null {
  const variantId = line.variantSnapshot?.variantId;
  return typeof variantId === 'number' && Number.isSafeInteger(variantId) && variantId > 0
    ? variantId
    : null;
}

/**
 * Decides whether a line is rejected before the cart sees it. Shared by request building and
 * outcome assembly so both agree on which lines were ever submitted.
 */
function preSkipReasonFor(line: OrderLineItem): ReorderPreSkipReason | null {
  if (reorderLineVariantId(line) === null) return 'VARIANT_UNRESOLVED';
  if (!Number.isSafeInteger(line.quantity) || line.quantity < 1) return 'INVALID_QUANTITY';
  return null;
}

/**
 * Maps source order lines onto bulk-add requests, one request per line, correlated by the source
 * line id. Lines that cannot be submitted are reported as pre-skips instead of being dropped.
 */
export function toBulkAddRequests(orderLines: readonly OrderLineItem[]): ReorderRequestPlan {
  const requests: BulkAddRequest[] = [];
  const preSkips = new Map<string, ReorderPreSkipReason>();
  for (const line of orderLines) {
    const key = orderLineKey(line);
    const preSkip = preSkipReasonFor(line);
    if (preSkip !== null) {
      preSkips.set(key, preSkip);
      continue;
    }
    requests.push({
      key,
      variantId: reorderLineVariantId(line)!,
      quantity: line.quantity,
      ...(line.customBlend ? { customBlend: line.customBlend } : {}),
    });
  }
  return { requests, preSkips };
}

/**
 * Merges pre-cart skips and cart outcomes back onto every source order line, in source order.
 *
 * Duplicate source lines that share a `(variantId, configKey)` identity are judged once by the
 * cart and fanned back out to each submitted key there, so every submitted line has exactly one
 * outcome here. A submitted line with no outcome means the cart broke its own contract.
 *
 * @param resolvedPrices current unit price per source line id; an absent or null entry means no
 *   current price could be resolved, which reports as no drift rather than as a price change.
 */
export function assembleReorderOutcomes(
  orderLines: readonly OrderLineItem[],
  bulkOutcomes: readonly BulkAddOutcome[],
  resolvedPrices: ReadonlyMap<string, number | null>,
): ReorderLineOutcome[] {
  const outcomeByKey = new Map(bulkOutcomes.map((outcome) => [outcome.key, outcome]));
  return orderLines.map((line) => {
    const orderLineItemId = orderLineKey(line);
    const currentUnitPriceCents = resolvedPrices.get(orderLineItemId) ?? null;
    const identity: ReorderLineIdentity = {
      orderLineItemId,
      productId: line.productId,
      productName: line.productName,
      variantId: reorderLineVariantId(line),
      sku: line.variantSnapshot?.sku || null,
      configKey: line.customBlend?.configKey ?? '',
      quantity: line.quantity,
      orderedUnitPriceCents: line.unitPriceCents,
      currentUnitPriceCents,
      priceChanged: currentUnitPriceCents !== null && currentUnitPriceCents !== line.unitPriceCents,
    };

    const preSkip = preSkipReasonFor(line);
    if (preSkip !== null) return { ...identity, status: 'skipped', reason: preSkip };

    const outcome = outcomeByKey.get(orderLineItemId);
    if (!outcome) {
      throw new Error(`Reorder line ${orderLineItemId} was submitted but has no cart outcome`);
    }
    if (outcome.status === 'added') return { ...identity, status: 'added', reason: null };
    if (!outcome.reason) {
      throw new Error(`Reorder line ${orderLineItemId} was skipped by the cart without a reason`);
    }
    return { ...identity, status: 'skipped', reason: outcome.reason };
  });
}

/** Counts added and skipped lines; every outcome falls into exactly one bucket. */
export function countReorderOutcomes(outcomes: readonly ReorderLineOutcome[]): {
  addedLineCount: number;
  skippedLineCount: number;
} {
  const addedLineCount = outcomes.filter((outcome) => outcome.status === 'added').length;
  return { addedLineCount, skippedLineCount: outcomes.length - addedLineCount };
}
