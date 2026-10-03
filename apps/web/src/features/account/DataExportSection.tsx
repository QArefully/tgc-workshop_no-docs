import { useState } from 'react';
import { exportAccountData } from '@/api/accountExport';
import { Button } from '@/components/ui/button';
import { useLocalisation } from '@/i18n/LocaleContext';
import { identityAccountMessages } from '@shop/localisation/messages/identityAccount';
import { localizeAccountError } from './accountError';

export function DataExportSection() {
  const { translate } = useLocalisation();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [downloading, setDownloading] = useState(false);

  async function download() {
    setError(null);
    setSuccess(false);
    setDownloading(true);
    try {
      const data = await exportAccountData();
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = 'qarefully-account-export.json';
      link.click();
      URL.revokeObjectURL(url);
      setSuccess(true);
    } catch (downloadError) {
      setError(localizeAccountError(downloadError, translate, 'account.export.error'));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <section aria-labelledby="data-export-heading" className="mt-6 rounded-lg border p-6">
      <h2 id="data-export-heading" className="text-base font-medium">
        {translate(identityAccountMessages, 'account.export.title')}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {translate(identityAccountMessages, 'account.export.description')}
      </p>
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="mt-3 text-sm text-green-700">
          {translate(identityAccountMessages, 'account.export.success')}
        </p>
      )}
      <Button type="button" className="mt-4" onClick={() => void download()} disabled={downloading}>
        {downloading
          ? translate(identityAccountMessages, 'account.export.preparing')
          : translate(identityAccountMessages, 'account.export.download')}
      </Button>
    </section>
  );
}
