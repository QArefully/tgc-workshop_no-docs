import type {
  ReorderLineOutcome,
  ReorderResponse,
  ReorderSkipReason,
} from '@shop/contracts/reorder';
import { formatCount as formatDisplayCount } from '@shop/localisation';
import {
  createRepeatBuyingTranslator,
  type RepeatBuyingMessageKey,
} from '@shop/localisation/messages/repeatBuying';
import { formatDisplayMoney } from '@shop/localisation';
import { countryProfile } from '@shop/contracts/country-profiles';
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
const defaultDisplayMoney = (pence: number) => formatDisplayMoney(pence, countryProfile('US'));

function countFormatter(locale?: RepeatBuyingLocale): (value: number) => string {
  if (typeof locale === 'string') return (value) => formatDisplayCount(value, locale);
  if (typeof locale === 'function' && locale.formatCount) return locale.formatCount;
  return (value) => String(value);
}

export type BuyAgainState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | ({ kind: 'error'; message: string } & Partial<{
      messageKey: RepeatBuyingMessageKey;
      params: Readonly<Record<string, string | number | bigint>>;
    }>)
  | { kind: 'result'; response: ReorderResponse };

const SKIP_REASON_KEY: Readonly<Record<ReorderSkipReason, RepeatBuyingMessageKey>> = {
  BLOCKED_IN_COUNTRY: 'repeatBuying.reorderSkip.BLOCKED_IN_COUNTRY',
  VARIANT_RETIRED: 'repeatBuying.reorderSkip.VARIANT_RETIRED',
  VARIANT_UNRESOLVED: 'repeatBuying.reorderSkip.VARIANT_UNRESOLVED',
  INSUFFICIENT_STOCK: 'repeatBuying.reorderSkip.INSUFFICIENT_STOCK',
  BELOW_MOQ: 'repeatBuying.reorderSkip.BELOW_MOQ',
  INVALID_QUANTITY: 'repeatBuying.reorderSkip.INVALID_QUANTITY',
  BLEND_UNAVAILABLE: 'repeatBuying.reorderSkip.BLEND_UNAVAILABLE',
};

/** Plain-language cause shown next to a line the server left out. */
export function skipReasonMessage(
  reason: ReorderSkipReason,
  translate?: RepeatBuyingLocale,
): string {
  return resolve(translate)(SKIP_REASON_KEY[reason]);
}

export const SKIP_REASONS = Object.keys(SKIP_REASON_KEY) as ReorderSkipReason[];

export const BUY_AGAIN_FAILURE_KEY = 'repeatBuying.error.buyAgain' as const;
export const BUY_AGAIN_FAILURE_MESSAGE = defaultTranslate(BUY_AGAIN_FAILURE_KEY);

/** `Cement × 3`. Names line as buyer saw it on original order. */
export function outcomeLineLabel(
  outcome: ReorderLineOutcome,
  translate?: RepeatBuyingLocale,
): string {
  const formatCount = countFormatter(translate);
  return resolve(translate)('repeatBuying.savedListOutcomeLabel', {
    productName: outcome.productName,
    displayQuantity: formatCount(outcome.quantity),
  });
}

/** Old-to-new price sentence for a line whose price moved. */
export function priceChangeMessage(
  outcome: ReorderLineOutcome,
  translate?: RepeatBuyingLocale,
  formatDisplayMoney: (pence: number) => string = defaultDisplayMoney,
): string | null {
  if (!outcome.priceChanged || outcome.currentUnitPriceCents === null) return null;
  const t = resolve(translate);
  return t('repeatBuying.priceChanged', {
    fromPrice: formatDisplayMoney(outcome.orderedUnitPriceCents),
    toPrice: formatDisplayMoney(outcome.currentUnitPriceCents),
  });
}

function countItems(count: number, translate?: RepeatBuyingLocale): string {
  return resolve(translate)('repeatBuying.countItems', {
    count,
    displayCount: countFormatter(translate)(count),
  });
}

/** One sentence describing whole attempt. Reports server counts verbatim. */
export function reorderSummaryMessage(
  response: ReorderResponse,
  translate?: RepeatBuyingLocale,
): string {
  const t = resolve(translate);
  const formatCount = countFormatter(translate);
  const { addedLineCount, skippedLineCount } = response;
  if (addedLineCount === 0 && skippedLineCount === 0) return t('repeatBuying.reorderSummaryEmpty');
  if (skippedLineCount === 0)
    return t('repeatBuying.reorderAddedOnly', {
      count: addedLineCount,
      displayCount: formatCount(addedLineCount),
    });
  if (addedLineCount === 0)
    return t('repeatBuying.reorderNoneAdded', {
      count: skippedLineCount,
      displayCount: countItems(skippedLineCount, t),
    });
  return t('repeatBuying.mixedAdded', {
    addedCount: countItems(addedLineCount, t),
    skippedCount: countItems(skippedLineCount, t),
  });
}

export function skippedOutcomes(response: ReorderResponse): ReorderLineOutcome[] {
  return response.outcomes.filter((outcome) => outcome.status === 'skipped');
}

export function repricedOutcomes(response: ReorderResponse): ReorderLineOutcome[] {
  return response.outcomes.filter(
    (outcome) => outcome.status === 'added' && priceChangeMessage(outcome) !== null,
  );
}
