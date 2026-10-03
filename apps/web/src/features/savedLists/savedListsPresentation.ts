import type {
  SavedListAddToCartResponse,
  SavedListLineOutcome,
  SavedListSkipReason,
} from '@shop/contracts/saved-lists';
import type { Country } from '@shop/contracts/country';
import { formatCount as formatDisplayCount } from '@shop/localisation';
import {
  createRepeatBuyingTranslator,
  type RepeatBuyingMessageKey,
} from '@shop/localisation/messages/repeatBuying';

export type RepeatBuyingTranslator = ((
  key: RepeatBuyingMessageKey,
  params?: Readonly<Record<string, string | number | bigint>>,
) => string) & {
  readonly country?: Country;
  readonly formatCount?: (value: number) => string;
};
export type RepeatBuyingLocale = RepeatBuyingTranslator | Country;

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

export type SavedListErrorState = {
  readonly messageKey: RepeatBuyingMessageKey;
  readonly params?: Readonly<Record<string, string | number | bigint>>;
};

export type SavedListAddState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | ({ kind: 'error'; message: string } & Partial<SavedListErrorState>)
  | { kind: 'result'; response: SavedListAddToCartResponse };

const SKIP_REASON_KEY: Readonly<Record<SavedListSkipReason, RepeatBuyingMessageKey>> = {
  BLOCKED_IN_COUNTRY: 'repeatBuying.savedListSkip.BLOCKED_IN_COUNTRY',
  VARIANT_RETIRED: 'repeatBuying.savedListSkip.VARIANT_RETIRED',
  VARIANT_UNRESOLVED: 'repeatBuying.savedListSkip.VARIANT_UNRESOLVED',
  INSUFFICIENT_STOCK: 'repeatBuying.savedListSkip.INSUFFICIENT_STOCK',
  BELOW_MOQ: 'repeatBuying.savedListSkip.BELOW_MOQ',
  INVALID_QUANTITY: 'repeatBuying.savedListSkip.INVALID_QUANTITY',
  BLEND_UNAVAILABLE: 'repeatBuying.savedListSkip.BLEND_UNAVAILABLE',
};

/** Every contract reason is deliberately represented by a translated buyer-facing key. */
export const SAVED_LIST_SKIP_REASONS = Object.keys(SKIP_REASON_KEY) as SavedListSkipReason[];

export function savedListSkipReasonLabel(
  reason: SavedListSkipReason,
  translate?: RepeatBuyingLocale,
): string {
  const t = resolve(translate);
  return t(SKIP_REASON_KEY[reason]);
}

export function savedListOutcomeLabel(
  outcome: SavedListLineOutcome,
  translate?: RepeatBuyingLocale,
): string {
  const formatCount = countFormatter(translate);
  return resolve(translate)('repeatBuying.savedListOutcomeLabel', {
    productName: outcome.productName,
    displayQuantity: formatCount(outcome.savedQuantity),
  });
}

/** Describes an API-reported adjustment without calculating an MOQ in the browser. */
export function savedListAdjustmentMessage(
  outcome: SavedListLineOutcome,
  translate?: RepeatBuyingLocale,
): string | null {
  if (!outcome.moqAdjusted || outcome.submittedQuantity === null) return null;
  const formatCount = countFormatter(translate);
  return resolve(translate)('repeatBuying.amountIncreased', {
    displayFromQuantity: formatCount(outcome.savedQuantity),
    displayToQuantity: formatCount(outcome.submittedQuantity),
  });
}

function countItems(count: number, translate?: RepeatBuyingLocale): string {
  return resolve(translate)('repeatBuying.countItems', {
    count,
    displayCount: countFormatter(translate)(count),
  });
}

export function savedListSummaryMessage(
  response: SavedListAddToCartResponse,
  translate?: RepeatBuyingLocale,
): string {
  const t = resolve(translate);
  const formatCount = countFormatter(translate);
  if (response.addedLineCount === 0 && response.skippedLineCount === 0)
    return t('repeatBuying.savedListSummaryEmpty');
  if (response.skippedLineCount === 0)
    return t('repeatBuying.addedOnly', {
      count: response.addedLineCount,
      displayCount: formatCount(response.addedLineCount),
    });
  if (response.addedLineCount === 0)
    return t('repeatBuying.noneAdded', {
      count: response.skippedLineCount,
      displayCount: countItems(response.skippedLineCount, t),
    });
  return t('repeatBuying.mixedAdded', {
    addedCount: countItems(response.addedLineCount, t),
    skippedCount: countItems(response.skippedLineCount, t),
  });
}

export function savedListAdjustedOutcomes(
  response: SavedListAddToCartResponse,
): SavedListLineOutcome[] {
  return response.outcomes.filter((outcome) => outcome.status === 'added' && outcome.moqAdjusted);
}

export function savedListSkippedOutcomes(
  response: SavedListAddToCartResponse,
): SavedListLineOutcome[] {
  return response.outcomes.filter((outcome) => outcome.status === 'skipped');
}

export const SAVED_LIST_ADD_FAILURE_KEY = 'repeatBuying.error.addSavedList' as const;
export const SAVED_LIST_ADD_FAILURE_MESSAGE = defaultTranslate(SAVED_LIST_ADD_FAILURE_KEY);
