import { useCallback, useState } from 'react';
import type { ReorderResponse } from '@shop/contracts/reorder';
import { Button } from '@/components/ui/button';
import { useCartContext } from '@/hooks/CartContext';
import { useLocalisation } from '@/i18n/LocaleContext';
import { repeatBuyingMessages } from '@shop/localisation/messages/repeatBuying';
import {
  BUY_AGAIN_FAILURE_KEY,
  BUY_AGAIN_FAILURE_MESSAGE,
  type BuyAgainState,
} from './reorderPresentation';

/**
 * Cart pending identity for a reorder, mirroring the key `useCart` registers for the action. Buy
 * Again is scoped to a source order, so one order's spinner can never disable another's control.
 */
function reorderPendingKey(orderId: string): string {
  return `reorder:${orderId}`;
}

type Attempt = { outcome: 'failed' } | { outcome: 'reported'; response: ReorderResponse };

/**
 * Runs Buy Again and holds the resulting report for display.
 *
 * The report belongs to the surface that triggered it, not to cart state, so it lives here. One
 * order-history page shares a single hook across every row, so attempts are stored per order:
 * starting an attempt on one order clears only that order's entry and leaves any other order's
 * report on screen. A report is the only place the buyer is told which lines the server left out,
 * so it must survive until that same order is re-attempted.
 */
export function useBuyAgain() {
  const { reorder, isActionPending } = useCartContext();
  const [attempts, setAttempts] = useState<Record<string, Attempt>>({});

  const buyAgain = useCallback(
    async (orderId: string) => {
      setAttempts((current) => {
        if (!(orderId in current)) return current;
        const next = { ...current };
        delete next[orderId];
        return next;
      });
      const response = await reorder(orderId);
      setAttempts((current) => ({
        ...current,
        [orderId]: response === false ? { outcome: 'failed' } : { outcome: 'reported', response },
      }));
    },
    [reorder],
  );

  /**
   * A failed attempt shows packet-local generic copy rather than the cart hook's `error`. That
   * field is a single global slot shared with every other cart mutation — the header cart sheet is
   * mounted on this page too — so by render time it can hold a message belonging to an unrelated
   * action, or have been cleared. Rendering it inside a region named for this order would attribute
   * someone else's failure to Buy Again; the awaited `reorder` call cannot hand back the specific
   * message, so generic-but-truthful is the correct trade.
   */
  const stateFor = useCallback(
    (orderId: string): BuyAgainState => {
      if (isActionPending(reorderPendingKey(orderId), 'reorder')) return { kind: 'pending' };
      const attempt = attempts[orderId];
      if (!attempt) return { kind: 'idle' };
      if (attempt.outcome === 'reported') return { kind: 'result', response: attempt.response };
      return {
        kind: 'error',
        message: BUY_AGAIN_FAILURE_MESSAGE,
        messageKey: BUY_AGAIN_FAILURE_KEY,
      };
    },
    [attempts, isActionPending],
  );

  return { buyAgain, stateFor };
}

type Props = {
  orderId: string;
  isPending: boolean;
  onActivate: () => void;
  className?: string;
};

/** The Buy Again control for one past order. Names its order so rows stay distinguishable. */
export function BuyAgainButton({ orderId, isPending, onActivate, className }: Props) {
  const { translate } = useLocalisation();
  const label = isPending
    ? translate(repeatBuyingMessages, 'repeatBuying.addingForOrder')
    : translate(repeatBuyingMessages, 'repeatBuying.buyAgain');
  const orderContext = translate(
    repeatBuyingMessages,
    isPending ? 'repeatBuying.forOrder' : 'repeatBuying.fromOrder',
    { orderId },
  );
  return (
    <Button
      variant="outline"
      className={className}
      disabled={isPending}
      aria-label={`${label} ${orderContext}`}
      onClick={onActivate}
    >
      {label}
    </Button>
  );
}
