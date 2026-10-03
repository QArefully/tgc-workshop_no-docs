import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { SavedListDetail } from '@shop/contracts/saved-lists';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { useCartContext } from '@/hooks/CartContext';
import { useSavedLists } from '@/hooks/useSavedLists';
import { useLocalisation } from '@/i18n/LocaleContext';
import { repeatBuyingMessages } from '@shop/localisation/messages/repeatBuying';
import { SavedListOutcomeList } from './SavedListOutcomeList';
import { SAVED_LIST_ADD_FAILURE_KEY, type SavedListAddState } from './savedListsPresentation';

/** Server-resolved saved-list detail. Prices, availability and MOQ remain API facts. */
export function SavedListDetailPage() {
  const { listId = '' } = useParams();
  const { loadList, updateItem, removeItem, error: contextError } = useSavedLists();
  const { addSavedListToCart, isActionPending, isCartAvailable } = useCartContext();
  const { translate, formatDisplayMoney, formatCount, formatWeightGrams } = useLocalisation();
  const [list, setList] = useState<SavedListDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<'repeatBuying.error.savedListLoad' | null>(null);
  const [mutatingItem, setMutatingItem] = useState<string | null>(null);
  const [addState, setAddState] = useState<SavedListAddState>({ kind: 'idle' });
  const pendingAdd = isActionPending(listId, 'saved-list-add');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    void loadList(listId).then((result) => {
      if (!active) return;
      if (result) setList(result);
      else setLoadError('repeatBuying.error.savedListLoad');
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [listId, loadList]);

  async function changeQuantity(itemId: string, quantity: number) {
    if (!list || !Number.isSafeInteger(quantity) || quantity < 1) return;
    setMutatingItem(itemId);
    const next = await updateItem(list.listId, itemId, { quantity });
    setMutatingItem(null);
    if (next) setList(next);
  }

  async function remove(itemId: string) {
    if (!list) return;
    setMutatingItem(itemId);
    const removed = await removeItem(list.listId, itemId);
    setMutatingItem(null);
    if (removed)
      setList((current) =>
        current
          ? { ...current, items: current.items.filter((item) => item.itemId !== itemId) }
          : current,
      );
  }

  async function addToCart() {
    if (!list || pendingAdd || !isCartAvailable) return;
    setAddState({ kind: 'pending' });
    const response = await addSavedListToCart(list.listId);
    setAddState(
      response
        ? { kind: 'result', response }
        : {
            kind: 'error',
            message: translate(repeatBuyingMessages, SAVED_LIST_ADD_FAILURE_KEY),
            messageKey: SAVED_LIST_ADD_FAILURE_KEY,
          },
    );
  }

  if (loading)
    return (
      <div className="flex justify-center py-20">
        <LoadingSpinner />
      </div>
    );
  if (loadError || !list)
    return (
      <div className="mx-auto max-w-3xl">
        <p role="alert" className="rounded-md border border-destructive/40 p-3 text-destructive">
          {contextError ??
            (loadError
              ? translate(repeatBuyingMessages, loadError)
              : translate(repeatBuyingMessages, 'repeatBuying.error.savedListNotFound'))}
        </p>
        <Link className="mt-4 inline-block underline" to="/lists">
          {translate(repeatBuyingMessages, 'repeatBuying.backToSavedLists')}
        </Link>
      </div>
    );

  return (
    <div className="mx-auto max-w-3xl pb-12">
      <Link className="text-sm underline underline-offset-4" to="/lists">
        {translate(repeatBuyingMessages, 'repeatBuying.backToSavedLists')}
      </Link>
      <header className="mb-6 mt-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="section-eyebrow">
            {translate(repeatBuyingMessages, 'repeatBuying.savedListDetail')}
          </p>
          <h1 className="section-heading mt-2">{list.name}</h1>
        </div>
        <Button
          onClick={() => void addToCart()}
          disabled={!isCartAvailable || pendingAdd || list.items.length === 0}
        >
          {pendingAdd
            ? translate(repeatBuyingMessages, 'repeatBuying.addingToCart')
            : translate(repeatBuyingMessages, 'repeatBuying.addToCart')}
        </Button>
      </header>
      {contextError && (
        <p role="alert" className="mb-4 text-sm text-destructive">
          {contextError}
        </p>
      )}
      {list.items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {translate(repeatBuyingMessages, 'repeatBuying.emptySavedList')}
        </div>
      ) : (
        <ul
          className="space-y-3"
          aria-label={translate(repeatBuyingMessages, 'repeatBuying.listItemsAria', {
            listName: list.name,
          })}
        >
          {list.items.map((item) => {
            const packUnitKey =
              item.weightGrams === 25_000
                ? 'repeatBuying.sackUnit'
                : item.weightGrams === 1_000_000
                  ? 'repeatBuying.palletUnit'
                  : 'repeatBuying.packUnit';
            const packLabel = `${formatWeightGrams(item.weightGrams)} ${translate(
              repeatBuyingMessages,
              packUnitKey,
            )}`;
            return (
              <li key={item.itemId} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <Link
                      className="font-medium underline underline-offset-4"
                      to={`/products/${item.productId}`}
                    >
                      {item.productName}
                    </Link>
                    <p className="text-sm text-muted-foreground">
                      {packLabel} · {item.sku}
                    </p>
                    <p className="mt-1 text-sm">
                      {item.unitPriceCents === null
                        ? translate(repeatBuyingMessages, 'repeatBuying.priceUnavailable')
                        : `${formatDisplayMoney(item.unitPriceCents)} ${translate(
                            repeatBuyingMessages,
                            'repeatBuying.perPack',
                          )}`}{' '}
                      {item.perTonneCents === null
                        ? ''
                        : `· ${formatDisplayMoney(item.perTonneCents)} ${translate(
                            repeatBuyingMessages,
                            'repeatBuying.perTonne',
                          )}`}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {translate(repeatBuyingMessages, 'repeatBuying.moq', {
                        count: item.moqSacks,
                        displayCount: formatCount(item.moqSacks),
                      })}{' '}
                      ·{' '}
                      {item.availableToSell
                        ? item.backorderable
                          ? translate(repeatBuyingMessages, 'repeatBuying.availableBackorder')
                          : translate(repeatBuyingMessages, 'repeatBuying.available')
                        : translate(repeatBuyingMessages, 'repeatBuying.unavailable')}
                      {!item.active
                        ? ` · ${translate(repeatBuyingMessages, 'repeatBuying.retired')}`
                        : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="sr-only" htmlFor={`saved-list-quantity-${item.itemId}`}>
                      {translate(repeatBuyingMessages, 'repeatBuying.quantityFor', {
                        productName: item.productName,
                      })}
                    </label>
                    <input
                      id={`saved-list-quantity-${item.itemId}`}
                      type="number"
                      min="1"
                      defaultValue={item.quantity}
                      disabled={mutatingItem === item.itemId}
                      onBlur={(event) =>
                        void changeQuantity(item.itemId, Number(event.target.value))
                      }
                      className="h-8 w-20 rounded-md border bg-background px-2 text-sm"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={mutatingItem === item.itemId}
                      onClick={() => void remove(item.itemId)}
                    >
                      {translate(repeatBuyingMessages, 'repeatBuying.remove')}
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-6">
        <SavedListOutcomeList state={addState} />
      </div>
    </div>
  );
}
