import type {
  StandingOrderCadence,
  StandingOrderLineOutcome,
  StandingOrderRun,
} from '@shop/contracts/standing-orders';
import { ApiError } from '@/api/client';
import { outcomeLineLabel, skipReasonMessage } from '@/features/reorder/reorderPresentation';
import type { RepeatBuyingTranslator } from '@/features/savedLists/savedListsPresentation';
import {
  translateTradeAsync,
  type TradeAsyncMessageKey,
} from '@shop/localisation/messages/tradeAsync';

const cadence: Readonly<Record<StandingOrderCadence, TradeAsyncMessageKey>> = {
  weekly: 'standing.weekly',
  fortnightly: 'standing.fortnightly',
  monthly: 'standing.monthly',
};
const defaultTranslate = (
  key: TradeAsyncMessageKey,
  params?: Readonly<Record<string, string | number | bigint>>,
) => translateTradeAsync('UK', key, params);

export type StandingOrderTranslator = (
  key: TradeAsyncMessageKey,
  params?: Readonly<Record<string, string | number | bigint>>,
) => string;

const resolve = (translate?: StandingOrderTranslator): StandingOrderTranslator =>
  typeof translate === 'function' ? translate : defaultTranslate;

const apiErrorParams = (error: ApiError): Record<string, string | number | bigint> => {
  const params: Record<string, string | number | bigint> = {};
  for (const [key, value] of Object.entries(error.meta ?? {})) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint')
      params[key] = value;
  }
  return params;
};

const API_ERROR_FALLBACK_KEYS: Readonly<Record<string, TradeAsyncMessageKey>> = {
  NOT_FOUND: 'standing.error.generic',
  SOURCE_NOT_FOUND: 'standing.error.generic',
  CART_RESERVED: 'standing.error.generic',
  CART_NOT_FOUND: 'standing.error.generic',
  UNAUTHENTICATED: 'standing.error.generic',
  FORBIDDEN: 'standing.error.generic',
};
export const STANDING_ORDER_CADENCES = Object.keys(cadence) as StandingOrderCadence[];
export const STANDING_ORDER_ERROR_CODES = Object.keys(API_ERROR_FALLBACK_KEYS);
export const standingOrderCadenceLabel = (
  value: StandingOrderCadence,
  translate?: StandingOrderTranslator,
) => resolve(translate)(cadence[value]);
export function standingOrderErrorMessage(
  error: unknown,
  translate?: StandingOrderTranslator,
  translateApi?: (
    key: string,
    params?: Readonly<Record<string, string | number | bigint>>,
  ) => string,
): string {
  const t = resolve(translate);
  if (error instanceof ApiError) {
    if (error.code !== null && translateApi) {
      try {
        return translateApi(error.code, apiErrorParams(error));
      } catch {
        // Safe generic fallback below.
      }
    }
    if (error.status === 401) {
      try {
        return translateApi?.('UNAUTHORIZED', {}) ?? t('standing.error.generic');
      } catch {
        return t('standing.error.generic');
      }
    }
    if (error.status === 403) {
      try {
        return translateApi?.('FORBIDDEN', {}) ?? t('standing.error.generic');
      } catch {
        return t('standing.error.generic');
      }
    }
    if (error.isNetworkError) return t('standing.error.network');
  }
  return t('standing.error.generic');
}
export const standingOrderOutcomeLabel = (
  outcome: StandingOrderLineOutcome,
  translate?: RepeatBuyingTranslator,
) => outcomeLineLabel(outcome, translate);
export const standingOrderSkipReasonLabel = (
  outcome: StandingOrderLineOutcome,
  translate?: RepeatBuyingTranslator,
) =>
  outcome.status === 'skipped' && outcome.reason
    ? skipReasonMessage(outcome.reason, translate)
    : null;
export function standingOrderRunSummary(
  run: StandingOrderRun,
  translate?: StandingOrderTranslator,
): string {
  const t = resolve(translate);
  if (run.status === 'pending') return t('standing.run.pending');
  if (run.status === 'failed')
    return t('standing.run.failed', { reason: t('standing.error.generic') });
  if (!run.addedLineCount && !run.skippedLineCount) return t('standing.run.none');
  if (!run.skippedLineCount) return t('standing.run.added', { count: run.addedLineCount });
  if (!run.addedLineCount) return t('standing.run.noneAdded', { count: run.skippedLineCount });
  return t('standing.run.mixed', {
    added: run.addedLineCount,
    skipped: run.skippedLineCount,
  });
}
