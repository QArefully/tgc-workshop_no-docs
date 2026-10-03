import { useCallback, useEffect, useRef, useState } from 'react';
import type { AdminUserView } from '@shop/contracts/auth';
import type { MessageParams } from '@shop/localisation';
import { apiErrors } from '@shop/localisation/messages/apiErrors';
import {
  adminCommerceMessages,
  type AdminCommerceMessageKey,
} from '@shop/localisation/messages/adminCommerce';
import {
  getAdminUsers,
  reactivateAdminUser,
  setAdminUserRole,
  suspendAdminUser,
  updateAdminUserDisplayName,
} from '@/api/adminUsers';
import { ApiError } from '@/api/client';
import { ErrorMessage } from '@/components/ErrorMessage';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useLocalisation } from '@/i18n/LocaleContext';

type Translate = (key: AdminCommerceMessageKey, params?: MessageParams) => string;
type TranslateApiError = (key: string, params?: MessageParams) => string;

function errorParams(error: ApiError): MessageParams {
  if (!error.meta || typeof error.meta !== 'object') return {};
  const params: Record<string, string | number | bigint> = {};
  for (const [key, value] of Object.entries(error.meta)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint')
      params[key] = value;
  }
  return params;
}

function errorMessage(
  error: unknown,
  fallback: AdminCommerceMessageKey,
  t: Translate,
  translateApiError: TranslateApiError,
): string {
  if (error instanceof ApiError) {
    if (error.code && error.code in apiErrors)
      return translateApiError(error.code, errorParams(error));
    return t(fallback);
  }
  return t(fallback);
}

export function AdminUsersPage() {
  const { translate } = useLocalisation();
  const t = useCallback<Translate>(
    (key, params = {}) => translate(adminCommerceMessages, key, params),
    [translate],
  );
  const translateApiError = useCallback<TranslateApiError>(
    (key, params = {}) => translate(apiErrors, key, params),
    [translate],
  );
  const [search, setSearch] = useState('');
  const [users, setUsers] = useState<AdminUserView[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    setError(null);
    try {
      const response = await getAdminUsers(search.trim() ? { search: search.trim() } : {});
      if (version === requestVersion.current) setUsers(response.items);
    } catch (requestError) {
      if (version === requestVersion.current)
        setError(
          errorMessage(requestError, 'adminCommerce.users.error.load', t, translateApiError),
        );
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [search, t, translateApiError]);
  useEffect(() => {
    void load();
  }, [load]);
  const mutate = async (id: string, action: () => Promise<AdminUserView>, success: string) => {
    setWorking(id);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(success);
      await load();
    } catch (requestError) {
      setError(
        errorMessage(requestError, 'adminCommerce.users.error.update', t, translateApiError),
      );
    } finally {
      setWorking(null);
    }
  };
  if (loading && !users) return <LoadingSpinner />;
  if (error && !users) return <ErrorMessage message={error} onRetry={() => void load()} />;
  return (
    <section className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="section-eyebrow">{t('adminCommerce.administration')}</p>
        <h1 className="section-heading mt-2">{t('adminCommerce.users.heading')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t('adminCommerce.users.description')}</p>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
      >
        <label className="sr-only" htmlFor="user-search">
          {t('adminCommerce.users.searchLabel')}
        </label>
        <input
          id="user-search"
          className="rounded-md border border-input px-3 py-2"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('adminCommerce.users.searchPlaceholder')}
        />
        <Button type="submit">{t('adminCommerce.users.search')}</Button>
      </form>
      {notice && (
        <p aria-live="polite" className="text-sm text-muted-foreground">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {users?.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            {t('adminCommerce.users.noMatch')}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3" aria-busy={loading}>
          {users?.map((user) => (
            <UserCard
              key={user.id}
              user={user}
              working={working === user.id}
              t={t}
              onUpdate={(action, success) => void mutate(user.id, action, success)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function UserCard({
  user,
  working,
  t,
  onUpdate,
}: {
  user: AdminUserView;
  working: boolean;
  t: Translate;
  onUpdate: (action: () => Promise<AdminUserView>, success: string) => void;
}) {
  const [name, setName] = useState(user.displayName);
  const [reason, setReason] = useState('');
  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div>
          <h2 className="font-semibold">{user.email}</h2>
          <p className="text-sm text-muted-foreground">
            {t(
              user.role === 'admin'
                ? 'adminCommerce.users.role.admin'
                : 'adminCommerce.users.role.customer',
            )}
            {user.suspendedAt ? ` · ${t('adminCommerce.users.suspended')}` : ''}
          </p>
        </div>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            onUpdate(
              () => updateAdminUserDisplayName(user.id, { displayName: name }),
              t('adminCommerce.users.updatedName'),
            );
          }}
        >
          <label className="sr-only" htmlFor={`name-${user.id}`}>
            {t('adminCommerce.users.displayName')}
          </label>
          <input
            id={`name-${user.id}`}
            className="rounded-md border border-input px-2 py-1"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Button type="submit" variant="outline" disabled={working}>
            {t('adminCommerce.users.saveName')}
          </Button>
          <label className="sr-only" htmlFor={`role-${user.id}`}>
            {t('adminCommerce.users.role')}
          </label>
          <select
            id={`role-${user.id}`}
            className="rounded-md border border-input px-2 py-1"
            value={user.role}
            disabled={working}
            onChange={(event) =>
              onUpdate(
                () =>
                  setAdminUserRole(user.id, { role: event.target.value as 'admin' | 'customer' }),
                t('adminCommerce.users.updatedRole'),
              )
            }
          >
            <option value="customer">{t('adminCommerce.users.role.customer')}</option>
            <option value="admin">{t('adminCommerce.users.role.admin')}</option>
          </select>
        </form>
        {user.suspendedAt ? (
          <Button
            type="button"
            disabled={working}
            onClick={() =>
              onUpdate(() => reactivateAdminUser(user.id), t('adminCommerce.users.reactivated'))
            }
          >
            {t('adminCommerce.users.reactivate')}
          </Button>
        ) : (
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (reason.trim())
                onUpdate(
                  () => suspendAdminUser(user.id, { reason: reason.trim() }),
                  t('adminCommerce.users.suspendedNotice'),
                );
            }}
          >
            <label className="sr-only" htmlFor={`reason-${user.id}`}>
              {t('adminCommerce.users.suspensionReason')}
            </label>
            <input
              id={`reason-${user.id}`}
              className="rounded-md border border-input px-2 py-1"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={t('adminCommerce.users.suspensionReason')}
              required
            />
            <Button type="submit" variant="destructive" disabled={working}>
              {t('adminCommerce.users.suspend')}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
