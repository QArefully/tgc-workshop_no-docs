import { useCallback, useEffect, useRef, useState } from 'react';
import type { AdminFeatureFlag } from '@shop/contracts/feature-flags';
import {
  createAdminFeatureFlag,
  deleteAdminFeatureFlag,
  getAdminFeatureFlags,
  updateAdminFeatureFlag,
} from '@/api/adminFeatureFlags';
import { ErrorMessage } from '@/components/ErrorMessage';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useLocalisation, useMessages } from '@/i18n/LocaleContext';
import {
  adminDiagnosticsMessages,
  localizeAdminDiagnosticsError,
} from '@shop/localisation/messages/adminDiagnostics';

export function AdminFeatureFlagsPage() {
  const { country } = useLocalisation();
  const t = useMessages(adminDiagnosticsMessages);
  const [flags, setFlags] = useState<AdminFeatureFlag[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [key, setKey] = useState('');
  const [description, setDescription] = useState('');
  const requestVersion = useRef(0);
  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    setError(null);
    try {
      const response = await getAdminFeatureFlags();
      if (version === requestVersion.current) setFlags(response.items);
    } catch (e) {
      if (version === requestVersion.current)
        setError(localizeAdminDiagnosticsError(e, country, 'admin.flags.loadError'));
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [country]);
  useEffect(() => {
    void load();
  }, [load]);
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createAdminFeatureFlag({ key, description, enabled: false });
      setKey('');
      setDescription('');
      await load();
    } catch (error) {
      setError(localizeAdminDiagnosticsError(error, country, 'admin.flags.createError'));
    }
  };
  const update = async (
    flag: AdminFeatureFlag,
    body: { enabled?: boolean; description?: string },
  ) => {
    try {
      await updateAdminFeatureFlag(flag.key, body);
      await load();
    } catch (e) {
      setError(localizeAdminDiagnosticsError(e, country, 'admin.flags.updateError'));
    }
  };
  if (loading && !flags) return <LoadingSpinner />;
  if (error && !flags) return <ErrorMessage message={error} onRetry={() => void load()} />;
  return (
    <section className="mx-auto max-w-4xl space-y-6" aria-labelledby="admin-feature-flags-heading">
      <div>
        <p className="section-eyebrow">{t('admin.common.administration')}</p>
        <h1 id="admin-feature-flags-heading" className="section-heading mt-2">
          {t('admin.flags.heading')}
        </h1>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <form className="flex flex-wrap gap-2" onSubmit={(e) => void create(e)}>
        <input
          aria-label={t('admin.flags.flagKey')}
          required
          pattern="[a-z][a-z0-9_.]{1,63}"
          className="rounded-md border border-input px-2 py-1"
          placeholder={t('admin.flags.keyPlaceholder')}
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <input
          aria-label={t('admin.flags.description')}
          className="rounded-md border border-input px-2 py-1"
          placeholder={t('admin.flags.descriptionPlaceholder')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <Button type="submit">{t('admin.flags.create')}</Button>
      </form>
      {flags?.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">{t('admin.flags.empty')}</CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {flags?.map((flag) => (
            <FlagCard
              key={flag.key}
              flag={flag}
              onUpdate={(flag, body) => void update(flag, body)}
              onDelete={() => {
                void (async () => {
                  try {
                    await deleteAdminFeatureFlag(flag.key);
                    await load();
                  } catch (e) {
                    setError(localizeAdminDiagnosticsError(e, country, 'admin.flags.deleteError'));
                  }
                })();
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}
function FlagCard({
  flag,
  onUpdate,
  onDelete,
}: {
  flag: AdminFeatureFlag;
  onUpdate: (flag: AdminFeatureFlag, body: { enabled?: boolean; description?: string }) => void;
  onDelete: () => void;
}) {
  const t = useMessages(adminDiagnosticsMessages);
  const [description, setDescription] = useState(flag.description);
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-3 py-4">
        <strong>{flag.key}</strong>
        <label className="text-sm">
          <input
            aria-label={t('admin.flags.enable', { key: flag.key })}
            type="checkbox"
            checked={flag.enabled}
            onChange={(e) => onUpdate(flag, { enabled: e.target.checked })}
          />{' '}
          {t('admin.flags.enabled')}
        </label>
        <input
          aria-label={t('admin.flags.descriptionFor', { key: flag.key })}
          className="rounded-md border border-input px-2 py-1"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <Button type="button" variant="outline" onClick={() => onUpdate(flag, { description })}>
          {t('admin.flags.save')}
        </Button>
        <Button type="button" variant="destructive" onClick={onDelete}>
          {t('admin.flags.delete')}
        </Button>
      </CardContent>
    </Card>
  );
}
