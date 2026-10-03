import { Link } from 'react-router-dom';
import { useLocalisation } from '@/i18n/LocaleContext';
import {
  repeatBuyingMessages,
  type RepeatBuyingMessageKey,
} from '@shop/localisation/messages/repeatBuying';
import type { MessageParams } from '@shop/localisation';
import {
  outcomeLineLabel,
  priceChangeMessage,
  reorderSummaryMessage,
  repricedOutcomes,
  skipReasonMessage,
  skippedOutcomes,
  type BuyAgainState,
} from './reorderPresentation';
import type { ReorderResponse } from '@shop/contracts/reorder';

type Props = {
  orderId: string;
  state: BuyAgainState;
};

function ResultBody({
  orderId,
  response,
  t,
  formatDisplayMoney,
}: {
  orderId: string;
  response: ReorderResponse;
  t: (key: RepeatBuyingMessageKey, params?: MessageParams) => string;
  formatDisplayMoney: (pence: number) => string;
}) {
  const skipped = skippedOutcomes(response);
  const repriced = repricedOutcomes(response);
  const nothingAdded = response.addedLineCount === 0;

  return (
    <div className="space-y-2">
      <p className="font-medium">{reorderSummaryMessage(response, t)}</p>
      {repriced.length > 0 && (
        <ul className="space-y-1" aria-label={t('repeatBuying.priceChangesOnOrder', { orderId })}>
          {repriced.map((outcome) => (
            <li key={outcome.orderLineItemId}>
              <span className="font-medium">{outcomeLineLabel(outcome, t)}</span>{' '}
              <span className="text-muted-foreground">
                {priceChangeMessage(outcome, t, formatDisplayMoney)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {skipped.length > 0 && (
        <ul
          className="space-y-1"
          aria-label={t('repeatBuying.itemsNotAddedFromOrder', { orderId })}
        >
          {skipped.map((outcome) => (
            <li key={outcome.orderLineItemId}>
              <span className="font-medium">{outcomeLineLabel(outcome, t)}</span>{' '}
              <span className="text-muted-foreground">
                {outcome.reason === null ? '' : skipReasonMessage(outcome.reason, t)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {!nothingAdded && (
        <Link className="inline-block font-medium underline underline-offset-4" to="/cart">
          {t('repeatBuying.viewCart')}
        </Link>
      )}
    </div>
  );
}

/**
 * Shows what one Buy Again attempt did, beneath the surface that triggered it.
 *
 * The region node stays mounted and keeps its name for the whole life of the row, but `empty:hidden`
 * collapses it to `display:none` while idle, which also takes it out of the accessibility tree. So
 * the first transition out of idle reads to assistive technology as an inserted live region rather
 * than a change within an existing one; later transitions (pending → result, result → pending on a
 * re-attempt) happen while the region is already visible and are announced as updates.
 *
 * Every displayed fact comes from the server report: nothing here decides whether a line was
 * eligible or what it costs. An attempt where every line was left out is an explanation, not an
 * error — only a request that never landed is styled and announced as a failure.
 */
export function ReorderOutcomeList({ orderId, state }: Props) {
  const { translate, formatDisplayMoney, formatCount } = useLocalisation();
  const t = Object.assign(
    (key: RepeatBuyingMessageKey, params?: MessageParams) =>
      translate(repeatBuyingMessages, key, params),
    { formatCount },
  );
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={t('repeatBuying.buyAgainResult', { orderId })}
      className="text-sm empty:hidden"
    >
      {state.kind === 'pending' && (
        <p className="text-muted-foreground">{t('repeatBuying.reorderAdding')}</p>
      )}
      {state.kind === 'error' && (
        <p className="rounded-md border border-destructive/40 p-3 text-destructive">
          {state.messageKey ? t(state.messageKey, state.params) : state.message}
        </p>
      )}
      {state.kind === 'result' && (
        <ResultBody
          orderId={orderId}
          response={state.response}
          t={t}
          formatDisplayMoney={formatDisplayMoney}
        />
      )}
    </div>
  );
}
