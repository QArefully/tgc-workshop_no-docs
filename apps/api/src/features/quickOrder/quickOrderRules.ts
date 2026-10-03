import { SACK_WEIGHT_GRAMS } from '@shop/contracts/pricing';
import type {
  QuickOrderLineOutcome,
  QuickOrderSkipReason as ContractQuickOrderSkipReason,
} from '@shop/contracts/quick-order';
import type { VariantWithProductRow } from '../catalog/productRepository.js';
import type {
  BulkAddOutcome,
  BulkAddRequest,
  BulkAddSkipReason,
} from '../cart/cartBulkAddRules.js';
import { moqShortfallSacks } from '../pricing/pricingRules.js';

/** Bounded reported lines keep both the request and response transport manageable. */
export const QUICK_ORDER_MAX_INPUT_LINES = 200;
export const QUICK_ORDER_MAX_RAW_LINE_LENGTH = 200;

/** Reasons decided before a group is submitted to the cart. */
export const QUICK_ORDER_PRE_SKIP_REASONS = [
  'MALFORMED_LINE',
  'SKU_NOT_FOUND',
  'INVALID_QUANTITY',
] as const;

export type QuickOrderPreSkipReason = (typeof QUICK_ORDER_PRE_SKIP_REASONS)[number];

/**
 * Quick Order uses the cart's skip vocabulary rather than introducing parallel cart failures.
 * `BLEND_UNAVAILABLE` is structurally possible through that shared vocabulary but never emitted:
 * Quick Order never submits a configured blend.
 */
export type QuickOrderSkipReason = QuickOrderPreSkipReason | BulkAddSkipReason;

type QuickOrderSkipReasonIsContractAssignable =
  QuickOrderSkipReason extends ContractQuickOrderSkipReason ? true : never;
const quickOrderSkipReasonIsContractAssignable: QuickOrderSkipReasonIsContractAssignable = true;
void quickOrderSkipReasonIsContractAssignable;

/** A nonblank physical pasted line after syntax and quantity classification. */
export interface ParsedQuickOrderLine {
  lineNumber: number;
  /** Bounded text retained for transport; overlong source lines are malformed. */
  rawLine: string;
  sku: string | null;
  requestedQuantity: number | null;
  preSkipReason: QuickOrderPreSkipReason | null;
}

/** One distinct, valid SKU demand group in first-appearance order. */
export interface QuickOrderDemandGroup {
  sku: string;
  lines: ParsedQuickOrderLine[];
  requestedQuantity: number;
  submittedQuantity: number;
  moqAdjusted: boolean;
  variant: VariantWithProductRow | undefined;
  preSkipReason: Extract<QuickOrderPreSkipReason, 'SKU_NOT_FOUND' | 'INVALID_QUANTITY'> | null;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function malformedLine(lineNumber: number, rawLine: string): ParsedQuickOrderLine {
  return {
    lineNumber,
    rawLine: rawLine.slice(0, QUICK_ORDER_MAX_RAW_LINE_LENGTH),
    sku: null,
    requestedQuantity: null,
    preSkipReason: 'MALFORMED_LINE',
  };
}

/**
 * Parses one buyer paste without collapsing physical line positions. Empty lines are deliberately
 * absent from the result, so they neither count toward the line cap nor receive an outcome.
 */
export function parseQuickOrderText(text: string): ParsedQuickOrderLine[] {
  const physicalLines = text.replace(/\r\n?/g, '\n').split('\n');
  const parsedLines: ParsedQuickOrderLine[] = [];

  for (const [index, physicalLine] of physicalLines.entries()) {
    if (physicalLine.trim() === '') continue;
    const lineNumber = index + 1;
    if (physicalLine.length > QUICK_ORDER_MAX_RAW_LINE_LENGTH) {
      parsedLines.push(malformedLine(lineNumber, physicalLine));
      continue;
    }

    const tokens = /[,;\t]/.test(physicalLine)
      ? physicalLine.split(/[,;\t]/).map((token) => token.trim())
      : physicalLine.trim().split(/\s+/);
    if (tokens.length !== 2 || tokens.some((token) => token === '')) {
      parsedLines.push(malformedLine(lineNumber, physicalLine));
      continue;
    }

    const sku = tokens[0]!.trim().toUpperCase();
    if (sku.length === 0 || sku.length > 64) {
      parsedLines.push(malformedLine(lineNumber, physicalLine));
      continue;
    }

    const quantityToken = tokens[1]!.trim();
    if (!/^\d+$/.test(quantityToken)) {
      parsedLines.push({
        lineNumber,
        rawLine: physicalLine,
        sku,
        requestedQuantity: null,
        preSkipReason: 'INVALID_QUANTITY',
      });
      continue;
    }
    const requestedQuantity = Number(quantityToken);
    if (!isPositiveSafeInteger(requestedQuantity)) {
      parsedLines.push({
        lineNumber,
        rawLine: physicalLine,
        sku,
        requestedQuantity: null,
        preSkipReason: 'INVALID_QUANTITY',
      });
      continue;
    }
    parsedLines.push({
      lineNumber,
      rawLine: physicalLine,
      sku,
      requestedQuantity,
      preSkipReason: null,
    });
  }
  return parsedLines;
}

function canRoundUpMoq(quantity: number, variant: VariantWithProductRow): boolean {
  return (
    variant.active === 1 &&
    isPositiveSafeInteger(variant.weight_grams) &&
    isPositiveSafeInteger(variant.moq_sacks) &&
    quantity <= Math.floor(Number.MAX_SAFE_INTEGER / variant.weight_grams) &&
    variant.moq_sacks <= Math.floor(Number.MAX_SAFE_INTEGER / SACK_WEIGHT_GRAMS)
  );
}

/**
 * Groups valid parsed lines by SKU, then resolves a single MOQ-safe demand per group. Invalid
 * source lines remain outside groups so they can never be summed into a sibling's cart request.
 */
export function buildQuickOrderDemand(
  lines: readonly ParsedQuickOrderLine[],
  variantBySku: ReadonlyMap<string, VariantWithProductRow>,
): QuickOrderDemandGroup[] {
  const groups: QuickOrderDemandGroup[] = [];
  const groupBySku = new Map<string, QuickOrderDemandGroup>();

  for (const line of lines) {
    if (line.preSkipReason !== null || line.sku === null || line.requestedQuantity === null)
      continue;
    const existing = groupBySku.get(line.sku);
    if (existing) {
      existing.lines.push(line);
      if (existing.preSkipReason === null) {
        const summed = existing.requestedQuantity + line.requestedQuantity;
        if (Number.isSafeInteger(summed)) existing.requestedQuantity = summed;
        else existing.preSkipReason = 'INVALID_QUANTITY';
      }
      continue;
    }
    const group: QuickOrderDemandGroup = {
      sku: line.sku,
      lines: [line],
      requestedQuantity: line.requestedQuantity,
      submittedQuantity: line.requestedQuantity,
      moqAdjusted: false,
      variant: variantBySku.get(line.sku),
      preSkipReason: null,
    };
    groupBySku.set(group.sku, group);
    groups.push(group);
  }

  for (const group of groups) {
    if (group.preSkipReason !== null) continue;
    group.submittedQuantity = group.requestedQuantity;
    if (!group.variant) {
      group.preSkipReason = 'SKU_NOT_FOUND';
      continue;
    }
    if (!canRoundUpMoq(group.requestedQuantity, group.variant)) continue;
    const shortfall = moqShortfallSacks(
      group.requestedQuantity,
      group.variant.weight_grams,
      group.variant.moq_sacks,
    );
    const submittedQuantity = group.requestedQuantity + shortfall;
    if (!Number.isSafeInteger(submittedQuantity)) {
      group.preSkipReason = 'INVALID_QUANTITY';
      continue;
    }
    group.submittedQuantity = submittedQuantity;
    group.moqAdjusted = shortfall > 0;
  }
  return groups;
}

/** Converts each submit-ready SKU group into the one cart request that represents its demand. */
export function toQuickOrderBulkAddRequests(
  groups: readonly QuickOrderDemandGroup[],
): BulkAddRequest[] {
  return groups.flatMap((group) => {
    if (group.preSkipReason !== null || !group.variant) return [];
    return [{ key: group.sku, variantId: group.variant.id, quantity: group.submittedQuantity }];
  });
}

function skippedOutcome(
  line: ParsedQuickOrderLine,
  reason: QuickOrderSkipReason,
  group?: QuickOrderDemandGroup,
  resolvedVariant?: VariantWithProductRow,
): QuickOrderLineOutcome {
  const variant = group?.variant ?? resolvedVariant;
  return {
    lineNumber: line.lineNumber,
    rawLine: line.rawLine,
    sku: line.sku,
    requestedQuantity: line.requestedQuantity,
    submittedQuantity: group?.submittedQuantity ?? null,
    moqAdjusted: group?.moqAdjusted ?? false,
    duplicateSku: (group?.lines.length ?? 0) > 1,
    variantId: variant?.id ?? null,
    productId: variant ? String(variant.product_id) : null,
    productName: variant?.product_name ?? null,
    resolvedUnitPriceCents: null,
    status: 'skipped',
    reason,
  };
}

function addedOutcome(
  line: ParsedQuickOrderLine,
  group: QuickOrderDemandGroup,
  outcome: BulkAddOutcome,
): QuickOrderLineOutcome {
  const variant = group.variant!;
  if (!isNonNegativeSafeInteger(outcome.resolvedUnitPriceCents)) {
    throw new Error(`Quick Order SKU ${group.sku} was added by the cart without a resolved price`);
  }
  return {
    lineNumber: line.lineNumber,
    rawLine: line.rawLine,
    sku: line.sku,
    requestedQuantity: line.requestedQuantity,
    submittedQuantity: group.submittedQuantity,
    moqAdjusted: group.moqAdjusted,
    duplicateSku: group.lines.length > 1,
    variantId: variant.id,
    productId: String(variant.product_id),
    productName: variant.product_name,
    resolvedUnitPriceCents: outcome.resolvedUnitPriceCents,
    status: 'added',
    reason: null,
  };
}

/**
 * Fans a single SKU group verdict back to every physical source line. A missing verdict for a
 * submitted group is a cart invariant breach, never a buyer-facing per-line skip.
 */
export function assembleQuickOrderOutcomes(
  lines: readonly ParsedQuickOrderLine[],
  groups: readonly QuickOrderDemandGroup[],
  bulkOutcomes: readonly BulkAddOutcome[],
  variantBySku: ReadonlyMap<string, VariantWithProductRow>,
): QuickOrderLineOutcome[] {
  const groupByLineNumber = new Map<number, QuickOrderDemandGroup>();
  for (const group of groups) {
    for (const line of group.lines) groupByLineNumber.set(line.lineNumber, group);
  }
  const outcomeBySku = new Map(bulkOutcomes.map((outcome) => [outcome.key, outcome]));

  return lines.map((line) => {
    const resolvedVariant = line.sku === null ? undefined : variantBySku.get(line.sku);
    if (line.preSkipReason !== null)
      return skippedOutcome(line, line.preSkipReason, undefined, resolvedVariant);
    const group = groupByLineNumber.get(line.lineNumber);
    if (!group) {
      throw new Error(`Quick Order line ${line.lineNumber} has no demand group`);
    }
    if (group.preSkipReason !== null)
      return skippedOutcome(line, group.preSkipReason, group, resolvedVariant);

    const outcome = outcomeBySku.get(group.sku);
    if (!outcome) {
      throw new Error(`Quick Order SKU ${group.sku} was submitted but has no cart outcome`);
    }
    if (outcome.status === 'added') return addedOutcome(line, group, outcome);
    if (!outcome.reason) {
      throw new Error(`Quick Order SKU ${group.sku} was skipped by the cart without a reason`);
    }
    return skippedOutcome(line, outcome.reason, group);
  });
}

/** Counts source lines, rather than aggregated SKU groups, by their final cart verdict. */
export function countQuickOrderOutcomes(outcomes: readonly QuickOrderLineOutcome[]): {
  addedLineCount: number;
  skippedLineCount: number;
} {
  const addedLineCount = outcomes.filter((outcome) => outcome.status === 'added').length;
  return { addedLineCount, skippedLineCount: outcomes.length - addedLineCount };
}
