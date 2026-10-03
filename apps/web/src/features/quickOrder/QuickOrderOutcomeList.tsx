import { Link } from 'react-router-dom';
import type { QuickOrderResponse } from '@shop/contracts/quick-order';
import { useLocalisation } from '@/i18n/LocaleContext';
import {
  repeatBuyingMessages,
  type RepeatBuyingMessageKey,
} from '@shop/localisation/messages/repeatBuying';
import type { MessageParams } from '@shop/localisation';
import {
  adjustedOutcomes,
  moqAdjustmentMessage,
  outcomeLineLabel,
  quickOrderSummaryMessage,
  skipReasonMessage,
  skippedOutcomes,
  type QuickOrderState,
} from './quickOrderPresentation';

type Props = {
  state: QuickOrderState;
};

function ResultBody({
  response,
  t,
}: {
  response: QuickOrderResponse;
  t: (key: RepeatBuyingMessageKey, params?: MessageParams) => string;
}) {
  const adjusted = adjustedOutcomes(response);
  const skipped = skippedOutcomes(response);

  return (
    <div className="space-y-2">
      <p className="font-medium">{quickOrderSummaryMessage(response, t)}</p>
      {adjusted.length > 0 && (
        <ul className="space-y-1" aria-label={t('repeatBuying.amountsAdjustedQuickOrder')}>
          {adjusted.map((outcome) => (
            <li key={outcome.lineNumber}>
              <span className="font-medium">{outcomeLineLabel(outcome, t)}</span>{' '}
              <span className="text-muted-foreground">{moqAdjustmentMessage(outcome, t)}</span>
            </li>
          ))}
        </ul>
      )}
      {skipped.length > 0 && (
        <ul className="space-y-1" aria-label={t('repeatBuying.linesNotAddedQuickOrder')}>
          {skipped.map((outcome) => (
            <li key={outcome.lineNumber}>
              <span className="font-medium">{outcomeLineLabel(outcome, t)}</span>{' '}
              <span className="text-muted-foreground">
                {outcome.reason === null ? '' : skipReasonMessage(outcome.reason, t)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {response.addedLineCount !== 0 && (
        <Link className="inline-block font-medium underline underline-offset-4" to="/cart">
          {t('repeatBuying.viewCart')}
        </Link>
      )}
    </div>
  );
}

/** Reports the result of one pasted Quick Order submission beneath its form. */
export function QuickOrderOutcomeList({ state }: Props) {
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
      aria-label={t('repeatBuying.quickOrderResult')}
      className="text-sm empty:hidden"
    >
      {state.kind === 'pending' && (
        <p className="text-muted-foreground">{t('repeatBuying.quickOrderAdding')}</p>
      )}
      {state.kind === 'error' && (
        <p className="rounded-md border border-destructive/40 p-3 text-destructive">
          {state.messageKey ? t(state.messageKey, state.params) : state.message}
        </p>
      )}
      {state.kind === 'result' && <ResultBody response={state.response} t={t} />}
    </div>
  );
}
