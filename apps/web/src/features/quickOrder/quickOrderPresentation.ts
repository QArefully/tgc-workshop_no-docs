import type {
  QuickOrderLineOutcome,
  QuickOrderResponse,
  QuickOrderSkipReason,
} from '@shop/contracts/quick-order';
import { formatCount as formatDisplayCount } from '@shop/localisation';
import {
  createRepeatBuyingTranslator,
  type RepeatBuyingMessageKey,
} from '@shop/localisation/messages/repeatBuying';
import type {
  RepeatBuyingLocale,
  RepeatBuyingTranslator,
} from '@/features/savedLists/savedListsPresentation';

const defaultTranslate = createRepeatBuyingTranslator('UK');
const resolve = (locale?: RepeatBuyingLocale): RepeatBuyingTranslator =>
  typeof locale === 'function'
    ? locale
    : locale === undefined
      ? defaultTranslate
      : createRepeatBuyingTranslator(locale);

function countFormatter(locale?: RepeatBuyingLocale): (value: number) => string {
  if (typeof locale === 'string') return (value) => formatDisplayCount(value, locale);
  if (typeof locale === 'function' && locale.formatCount) return locale.formatCount;
  return (value) => String(value);
}

/** The Quick Order surface's current request state. */
export type QuickOrderState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | ({ kind: 'error'; message: string } & Partial<{
      messageKey: RepeatBuyingMessageKey;
      params: Readonly<Record<string, string | number | bigint>>;
    }>)
  | { kind: 'result'; response: QuickOrderResponse };

/** Plain-language explanations for every server-reported skipped-line reason. */
const SKIP_REASON_KEY: Readonly<Record<QuickOrderSkipReason, RepeatBuyingMessageKey>> = {
  BLOCKED_IN_COUNTRY: 'repeatBuying.quickOrderSkip.BLOCKED_IN_COUNTRY',
  MALFORMED_LINE: 'repeatBuying.quickOrderSkip.MALFORMED_LINE',
  SKU_NOT_FOUND: 'repeatBuying.quickOrderSkip.SKU_NOT_FOUND',
  INVALID_QUANTITY: 'repeatBuying.quickOrderSkip.INVALID_QUANTITY',
  VARIANT_RETIRED: 'repeatBuying.quickOrderSkip.VARIANT_RETIRED',
  INSUFFICIENT_STOCK: 'repeatBuying.quickOrderSkip.INSUFFICIENT_STOCK',
  BELOW_MOQ: 'repeatBuying.quickOrderSkip.BELOW_MOQ',
  BLEND_UNAVAILABLE: 'repeatBuying.quickOrderSkip.BLEND_UNAVAILABLE',
};

/** Plain-language reason displayed beside one skipped source line. */
export function skipReasonMessage(
  reason: QuickOrderSkipReason,
  translate?: RepeatBuyingLocale,
): string {
  return resolve(translate)(SKIP_REASON_KEY[reason]);
}

/** Contract reason list derived from the exhaustive buyer-copy record. */
export const SKIP_REASONS = Object.keys(SKIP_REASON_KEY) as QuickOrderSkipReason[];

export const QUICK_ORDER_FAILURE_KEY = 'repeatBuying.error.quickOrder' as const;
export const QUICK_ORDER_FAILURE_MESSAGE = defaultTranslate(QUICK_ORDER_FAILURE_KEY);

/** Names a result by its original pasted-line position without exposing raw input. */
export function outcomeLineLabel(
  outcome: QuickOrderLineOutcome,
  translate?: RepeatBuyingLocale,
): string {
  const t = resolve(translate);
  const formatCount = countFormatter(translate);
  const productName = outcome.productName ?? t('repeatBuying.itemFallback');
  const amount = outcome.submittedQuantity ?? outcome.requestedQuantity;
  if (amount === null)
    return t('repeatBuying.lineLabelNoQuantity', {
      displayLineNumber: formatCount(outcome.lineNumber),
      productName,
    });
  return t('repeatBuying.lineLabel', {
    displayLineNumber: formatCount(outcome.lineNumber),
    productName,
    displayQuantity: formatCount(amount),
  });
}

/** Describes a server-reported minimum-order adjustment. */
export function moqAdjustmentMessage(
  outcome: QuickOrderLineOutcome,
  translate?: RepeatBuyingLocale,
): string | null {
  if (
    !outcome.moqAdjusted ||
    outcome.requestedQuantity === null ||
    outcome.submittedQuantity === null
  )
    return null;

  const formatCount = countFormatter(translate);
  return resolve(translate)('repeatBuying.amountIncreased', {
    displayFromQuantity: formatCount(outcome.requestedQuantity),
    displayToQuantity: formatCount(outcome.submittedQuantity),
  });
}

function countLines(count: number, translate?: RepeatBuyingLocale): string {
  return resolve(translate)('repeatBuying.countLines', {
    count,
    displayCount: countFormatter(translate)(count),
  });
}

/** One sentence summarising server-reported additions and skipped lines. */
export function quickOrderSummaryMessage(
  response: QuickOrderResponse,
  translate?: RepeatBuyingLocale,
): string {
  const t = resolve(translate);
  const formatCount = countFormatter(translate);
  const { addedLineCount, skippedLineCount } = response;
  if (addedLineCount === 0 && skippedLineCount === 0)
    return t('repeatBuying.quickOrderSummaryEmpty');
  if (skippedLineCount === 0)
    return t('repeatBuying.linesAddedOnly', {
      count: addedLineCount,
      displayCount: formatCount(addedLineCount),
    });
  if (addedLineCount === 0)
    return t('repeatBuying.noneAdded', {
      count: skippedLineCount,
      displayCount: countLines(skippedLineCount, t),
    });
  return t('repeatBuying.mixedAdded', {
    addedCount: countLines(addedLineCount, t),
    skippedCount: countLines(skippedLineCount, t),
  });
}

/** Skipped source lines in server reporting order. */
export function skippedOutcomes(response: QuickOrderResponse): QuickOrderLineOutcome[] {
  return response.outcomes.filter((outcome) => outcome.status === 'skipped');
}

/** Added source lines whose submitted amount was adjusted by the server. */
export function adjustedOutcomes(response: QuickOrderResponse): QuickOrderLineOutcome[] {
  return response.outcomes.filter((outcome) => outcome.status === 'added' && outcome.moqAdjusted);
}
