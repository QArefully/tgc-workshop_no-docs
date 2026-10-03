import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { useSavedLists } from '@/hooks/useSavedLists';
import { useLocalisation } from '@/i18n/LocaleContext';
import {
  repeatBuyingMessages,
  type RepeatBuyingMessageKey,
} from '@shop/localisation/messages/repeatBuying';

/** Authenticated buyer index for named, server-owned saved lists. */
export function SavedListsPage() {
  const { lists, loading, error: contextError, createList } = useSavedLists();
  const { translate, formatCount } = useLocalisation();
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<RepeatBuyingMessageKey | null>(null);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || creating) return;
    setCreating(true);
    setError(null);
    const list = await createList({ name: name.trim() });
    setCreating(false);
    if (list) setName('');
    else setError('repeatBuying.error.savedListCreate');
  }

  if (loading && lists.length === 0) {
    return (
      <div className="flex justify-center py-20">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl pb-12">
      <header className="mb-7">
        <p className="section-eyebrow">
          {translate(repeatBuyingMessages, 'repeatBuying.savedLists')}
        </p>
        <h1 className="section-heading mt-2">
          {translate(repeatBuyingMessages, 'repeatBuying.materialLists')}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {translate(repeatBuyingMessages, 'repeatBuying.savedListsDescription')}
        </p>
      </header>
      {(error ?? contextError) && (
        <p
          role="alert"
          className="mb-4 rounded-md border border-destructive/40 p-3 text-sm text-destructive"
        >
          {contextError ?? (error ? translate(repeatBuyingMessages, error) : null)}
        </p>
      )}
      <form className="mb-6 flex flex-wrap gap-2" onSubmit={(event) => void handleCreate(event)}>
        <label className="sr-only" htmlFor="new-saved-list-name">
          {translate(repeatBuyingMessages, 'repeatBuying.newListName')}
        </label>
        <input
          id="new-saved-list-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={80}
          placeholder={translate(repeatBuyingMessages, 'repeatBuying.newListName')}
          className="h-8 rounded-md border bg-background px-2 text-sm"
          disabled={creating}
        />
        <Button type="submit" disabled={!name.trim() || creating}>
          {creating
            ? translate(repeatBuyingMessages, 'repeatBuying.creating')
            : translate(repeatBuyingMessages, 'repeatBuying.createList')}
        </Button>
      </form>
      {lists.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="font-medium">
            {translate(repeatBuyingMessages, 'repeatBuying.noSavedLists')}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {translate(repeatBuyingMessages, 'repeatBuying.createOrSaveHint')}
          </p>
        </div>
      ) : (
        <ul
          className="space-y-3"
          aria-label={translate(repeatBuyingMessages, 'repeatBuying.savedLists')}
        >
          {lists.map((list) => (
            <li
              key={list.listId}
              className="flex items-center justify-between rounded-lg border p-4"
            >
              <div>
                <p className="font-medium">
                  {list.name}
                  {list.isDefault
                    ? ` (${translate(repeatBuyingMessages, 'repeatBuying.defaultList')})`
                    : ''}
                </p>
                <p className="text-sm text-muted-foreground">
                  {translate(repeatBuyingMessages, 'repeatBuying.itemCount', {
                    count: list.itemCount,
                    displayCount: formatCount(list.itemCount),
                  })}
                </p>
              </div>
              <Link
                className="font-medium underline underline-offset-4"
                to={`/lists/${list.listId}`}
              >
                {translate(repeatBuyingMessages, 'repeatBuying.viewList')}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
