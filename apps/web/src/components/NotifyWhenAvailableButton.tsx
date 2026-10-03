import { useState } from 'react';
import { BellRing, BellPlus } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/AuthContext';
import { useBackInStock } from '@/hooks/useBackInStock';
import { productMessages } from '@shop/localisation/messages/product';
import { useLocalisation } from '@/i18n/LocaleContext';

export const NOTIFY_LABEL = 'Notify me when this is back in stock';
export const NOTIFIED_LABEL = 'You will be notified when this is back in stock';

/**
 * Waiting-list control for a sold-out variant. Availability is never re-derived here: the caller
 * decides whether the selected variant is sold out, and the server decides whether a subscription
 * exists.
 */
export function NotifyWhenAvailableButton({ variantId }: { variantId: number }) {
  const { user } = useAuth();
  const { pendingVariantIds, subscribe, error } = useBackInStock();
  const { translate } = useLocalisation();
  const navigate = useNavigate();
  const location = useLocation();
  const subscribed = pendingVariantIds.has(variantId);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  // Only whether the attempt failed is recorded here. The message itself is read from the shared
  // state at render time, because the click closure captured `error` before the write settled.
  const subscribeError = failed
    ? (error ?? translate(productMessages, 'product.unableCreateAlert'))
    : null;

  const onClick = async () => {
    if (!user) {
      navigate('/login', { state: { from: `${location.pathname}${location.search}` } });
      return;
    }
    if (pending || subscribed) return;
    setPending(true);
    setFailed(false);
    const created = await subscribe(variantId);
    if (created === false) setFailed(true);
    setPending(false);
  };

  return (
    <div className="mt-3">
      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={pending || subscribed}
        onClick={() => void onClick()}
        aria-label={
          subscribed
            ? translate(productMessages, 'product.notifiedLabel')
            : translate(productMessages, 'product.notifyLabel')
        }
      >
        {subscribed ? (
          <BellRing className="mr-2 size-4" aria-hidden="true" />
        ) : (
          <BellPlus className="mr-2 size-4" aria-hidden="true" />
        )}
        {subscribed
          ? translate(productMessages, 'product.wellEmail')
          : translate(productMessages, 'product.notifyAvailable')}
      </Button>
      {subscribeError && (
        <p className="sr-only" role="alert">
          {subscribeError}
        </p>
      )}
    </div>
  );
}
