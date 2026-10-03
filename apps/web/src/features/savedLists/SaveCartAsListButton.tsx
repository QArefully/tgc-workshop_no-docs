import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '@/api/client';
import { saveCartAsSavedList } from '@/api/savedLists';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/AuthContext';
import { useLocalisation } from '@/i18n/LocaleContext';
import {
  repeatBuyingMessages,
  type RepeatBuyingMessageKey,
} from '@shop/localisation/messages/repeatBuying';

function messageKey(error: unknown): RepeatBuyingMessageKey {
  const code =
    error instanceof ApiError
      ? (error.code ??
        (error.response && 'code' in error.response ? error.response.code : undefined))
      : undefined;
  if (code === 'CART_EMPTY') return 'repeatBuying.error.cartEmpty';
  if (code === 'NAME_TAKEN') return 'repeatBuying.error.nameTaken';
  if (code === 'LIST_LIMIT_REACHED') return 'repeatBuying.error.listLimit';
  if (code === 'NAME_INVALID') return 'repeatBuying.error.invalidName';
  if (code === 'CART_NOT_FOUND') return 'repeatBuying.error.cartUnavailable';
  if (code === 'CART_RESERVED') return 'repeatBuying.error.cartReserved';
  return 'repeatBuying.error.saveOrder';
}

export function SaveCartAsListButton({
  cartId,
  excludesBlends,
}: {
  cartId: string;
  excludesBlends: boolean;
}) {
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<RepeatBuyingMessageKey | null>(null);
  const [listId, setListId] = useState<string | null>(null);
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { translate } = useLocalisation();
  const save = async () => {
    if (!name.trim() || pending) return;
    if (!user) {
      navigate('/login', { state: { from: `${location.pathname}${location.search}` } });
      return;
    }
    setPending(true);
    setError(null);
    try {
      setListId((await saveCartAsSavedList({ cartId, name: name.trim() })).listId);
    } catch (cause) {
      setError(messageKey(cause));
    } finally {
      setPending(false);
    }
  };
  return (
    <section
      aria-label={translate(repeatBuyingMessages, 'repeatBuying.saveCartAsList')}
      className="mt-5 rounded-lg border p-4 space-y-2"
    >
      <p className="font-medium">
        {translate(repeatBuyingMessages, 'repeatBuying.saveCartAsList')}
      </p>
      {excludesBlends && (
        <p className="text-xs text-muted-foreground">
          {translate(repeatBuyingMessages, 'repeatBuying.customBlendExcluded')}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {translate(repeatBuyingMessages, error)}
        </p>
      )}
      {listId ? (
        <Link className="text-sm font-medium underline" to={`/lists/${listId}`}>
          {translate(repeatBuyingMessages, 'repeatBuying.viewSavedList')}
        </Link>
      ) : (
        <div className="flex flex-wrap gap-2">
          <input
            aria-label={translate(repeatBuyingMessages, 'repeatBuying.listName')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            className="h-9 rounded-md border px-2"
            placeholder={translate(repeatBuyingMessages, 'repeatBuying.listName')}
            disabled={pending}
          />
          <Button
            type="button"
            variant="outline"
            disabled={!name.trim() || pending}
            onClick={() => void save()}
          >
            {pending
              ? translate(repeatBuyingMessages, 'repeatBuying.saving')
              : translate(repeatBuyingMessages, 'repeatBuying.saveList')}
          </Button>
        </div>
      )}
    </section>
  );
}
