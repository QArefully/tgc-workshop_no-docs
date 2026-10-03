import { useEffect, useState } from 'react';
import type { UserPreferences } from '@shop/contracts/account-depth';
import { getAccountPreferences, updateAccountPreferences } from '@/api/accountPreferences';
import { useLocalisation } from '@/i18n/LocaleContext';
import { identityAccountMessages } from '@shop/localisation/messages/identityAccount';
import { localizeAccountError } from './accountError';

const preferenceLabels: Array<{
  key: keyof UserPreferences;
  message:
    | 'account.preferences.orderUpdates'
    | 'account.preferences.marketing'
    | 'account.preferences.approval';
}> = [
  { key: 'orderUpdatesEmail', message: 'account.preferences.orderUpdates' },
  { key: 'marketingEmail', message: 'account.preferences.marketing' },
  { key: 'approvalRequestEmail', message: 'account.preferences.approval' },
];

export function PreferencesSection() {
  const { translate } = useLocalisation();
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void getAccountPreferences()
      .then((result) => {
        if (active) setPreferences(result);
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(localizeAccountError(loadError, translate, 'account.preferences.saveError'));
        }
      });
    return () => {
      active = false;
    };
  }, []);

  async function changePreference(key: keyof UserPreferences, checked: boolean) {
    if (!preferences) return;
    const previous = preferences;
    setError(null);
    setSaving(true);
    setPreferences({ ...preferences, [key]: checked });
    try {
      setPreferences(await updateAccountPreferences({ [key]: checked }));
    } catch (saveError) {
      setPreferences(previous);
      setError(localizeAccountError(saveError, translate, 'account.preferences.saveError'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="preferences-heading" className="mt-6 rounded-lg border p-6">
      <h2 id="preferences-heading" className="text-base font-medium">
        {translate(identityAccountMessages, 'account.preferences.title')}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {translate(identityAccountMessages, 'account.preferences.description')}
      </p>
      {error && (
        <p role="alert" className="mt-3 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {!preferences ? (
        <p className="mt-4 text-sm text-muted-foreground">
          {translate(identityAccountMessages, 'account.preferences.loading')}
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {preferenceLabels.map(({ key, message }) => (
            <label key={key} className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={preferences[key]}
                disabled={saving}
                onChange={(event) => void changePreference(key, event.target.checked)}
              />
              {translate(identityAccountMessages, message)}
            </label>
          ))}
        </div>
      )}
    </section>
  );
}
