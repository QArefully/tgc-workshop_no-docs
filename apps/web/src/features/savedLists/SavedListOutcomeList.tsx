import { Link } from 'react-router-dom';
import type { SavedListAddToCartResponse } from '@shop/contracts/saved-lists';
import { useLocalisation } from '@/i18n/LocaleContext';
import {
  repeatBuyingMessages,
  type RepeatBuyingMessageKey,
} from '@shop/localisation/messages/repeatBuying';
import type { MessageParams } from '@shop/localisation';
import {
  savedListAdjustedOutcomes,
  savedListAdjustmentMessage,
  savedListOutcomeLabel,
  savedListSkippedOutcomes,
  savedListSkipReasonLabel,
  savedListSummaryMessage,
  type SavedListAddState,
} from './savedListsPresentation';

function ResultBody({
  response,
  translate,
  formatCount,
}: {
  response: SavedListAddToCartResponse;
  translate: ReturnType<typeof useLocalisation>['translate'];
  formatCount: ReturnType<typeof useLocalisation>['formatCount'];
}) {
  const t = Object.assign(
    (key: RepeatBuyingMessageKey, params?: MessageParams) =>
      translate(repeatBuyingMessages, key, params),
    { formatCount },
  );
  const adjusted = savedListAdjustedOutcomes(response);
  const skipped = savedListSkippedOutcomes(response);
  return (
    <div className="space-y-2">
      <p className="font-medium">{savedListSummaryMessage(response, t)}</p>
      {adjusted.length > 0 && (
        <ul className="space-y-1" aria-label={t('repeatBuying.amountsAdjustedSavedList')}>
          {adjusted.map((outcome) => (
            <li key={outcome.itemId}>
              <span className="font-medium">{savedListOutcomeLabel(outcome, t)}</span>{' '}
              <span className="text-muted-foreground">
                {savedListAdjustmentMessage(outcome, t)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {skipped.length > 0 && (
        <ul className="space-y-1" aria-label={t('repeatBuying.itemsNotAddedSavedList')}>
          {skipped.map((outcome) => (
            <li key={outcome.itemId}>
              <span className="font-medium">{savedListOutcomeLabel(outcome, t)}</span>{' '}
              <span className="text-muted-foreground">
                {outcome.reason === null ? '' : savedListSkipReasonLabel(outcome.reason, t)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {response.addedLineCount > 0 && (
        <Link className="inline-block font-medium underline underline-offset-4" to="/cart">
          {t('repeatBuying.viewCart')}
        </Link>
      )}
    </div>
  );
}

/** Per-attempt status kept local to one saved-list detail page. */
export function SavedListOutcomeList({ state }: { state: SavedListAddState }) {
  const { translate, formatCount } = useLocalisation();
  const t = Object.assign(
    (key: RepeatBuyingMessageKey, params?: MessageParams) =>
      translate(repeatBuyingMessages, key, params),
    { formatCount },
  );
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={t('repeatBuying.savedListCartResult')}
      className="text-sm empty:hidden"
    >
      {state.kind === 'pending' && (
        <p className="text-muted-foreground">{t('repeatBuying.addingToCart')}</p>
      )}
      {state.kind === 'error' && (
        <p className="rounded-md border border-destructive/40 p-3 text-destructive">
          {state.messageKey ? t(state.messageKey, state.params) : state.message}
        </p>
      )}
      {state.kind === 'result' && (
        <ResultBody response={state.response} translate={translate} formatCount={formatCount} />
      )}
    </div>
  );
}
