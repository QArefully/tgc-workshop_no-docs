import { useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { useCartContext } from '@/hooks/CartContext';
import { useLocalisation } from '@/i18n/LocaleContext';
import { repeatBuyingMessages } from '@shop/localisation/messages/repeatBuying';
import { QuickOrderOutcomeList } from './QuickOrderOutcomeList';
import { QUICK_ORDER_FAILURE_KEY, type QuickOrderState } from './quickOrderPresentation';

const EXAMPLE_LINES = 'BKP-0001-001, 4\nGDN-1043-001, 6';

/** Paste-to-cart entry point for buyers who already know the material codes they need. */
export function QuickOrderPage() {
  const { isCartAvailable, isActionPending, quickOrder } = useCartContext();
  const { translate } = useLocalisation();
  const [text, setText] = useState('');
  const [state, setState] = useState<QuickOrderState>({ kind: 'idle' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submissionInFlightRef = useRef(false);
  const isPending = isSubmitting || isActionPending('quick-order', 'quick-order');
  const submitDisabled = !isCartAvailable || isPending || text.trim() === '';

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitDisabled || submissionInFlightRef.current) return;

    submissionInFlightRef.current = true;
    setIsSubmitting(true);
    setState({ kind: 'pending' });
    try {
      const response = await quickOrder(text);
      setState(
        response
          ? { kind: 'result', response }
          : {
              kind: 'error',
              message: translate(repeatBuyingMessages, QUICK_ORDER_FAILURE_KEY),
              messageKey: QUICK_ORDER_FAILURE_KEY,
            },
      );
    } finally {
      submissionInFlightRef.current = false;
      setIsSubmitting(false);
    }
  }

  const errorMessage =
    state.kind === 'error'
      ? state.messageKey
        ? translate(repeatBuyingMessages, state.messageKey, state.params)
        : state.message
      : null;

  return (
    <div className="mx-auto max-w-2xl pb-12">
      <header className="mb-7 max-w-xl">
        <p className="section-eyebrow">
          {translate(repeatBuyingMessages, 'repeatBuying.quickOrder')}
        </p>
        <h1 className="section-heading mt-2">
          {translate(repeatBuyingMessages, 'repeatBuying.quickOrderHeading')}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {translate(repeatBuyingMessages, 'repeatBuying.quickOrderDescription')}
        </p>
      </header>

      <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
        <div className="space-y-2">
          <label htmlFor="quick-order-lines" className="text-sm font-medium">
            {translate(repeatBuyingMessages, 'repeatBuying.itemCodesAndAmounts')}
          </label>
          <p id="quick-order-format" className="text-xs text-muted-foreground">
            {translate(repeatBuyingMessages, 'repeatBuying.quickOrderFormat')}
          </p>
          <textarea
            id="quick-order-lines"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={EXAMPLE_LINES}
            rows={8}
            className="flex min-h-40 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
            aria-describedby={
              errorMessage ? 'quick-order-format quick-order-error' : 'quick-order-format'
            }
            aria-invalid={Boolean(errorMessage)}
          />
        </div>
        {errorMessage && (
          <div
            id="quick-order-error"
            role="alert"
            className="rounded-xl border border-destructive/40 px-4 py-3 text-sm text-destructive"
          >
            {errorMessage}
          </div>
        )}
        <Button type="submit" disabled={submitDisabled}>
          {isPending
            ? translate(repeatBuyingMessages, 'repeatBuying.addMaterialsToCart')
            : translate(repeatBuyingMessages, 'repeatBuying.addToCart')}
        </Button>
      </form>

      <div className="mt-6">
        <QuickOrderOutcomeList state={state} />
      </div>
    </div>
  );
}
