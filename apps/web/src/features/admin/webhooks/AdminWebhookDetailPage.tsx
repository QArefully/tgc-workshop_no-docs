import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { CapturedWebhookStatus } from '@shop/contracts/webhooks';
import { getAdminWebhook } from '@/api/adminWebhooks';
import { ErrorMessage } from '@/components/ErrorMessage';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { Card, CardContent } from '@/components/ui/card';
import { useLocalisation, useMessages } from '@/i18n/LocaleContext';
import {
  adminDiagnosticsMessages,
  localizeAdminDiagnosticsError,
  type AdminDiagnosticsMessageKey,
} from '@shop/localisation/messages/adminDiagnostics';

const WEBHOOK_STATUS_LABELS: Record<CapturedWebhookStatus, AdminDiagnosticsMessageKey> = {
  captured: 'admin.webhooks.status.captured',
  processed: 'admin.webhooks.status.processed',
  ignored_stale: 'admin.webhooks.status.ignored_stale',
  rejected: 'admin.webhooks.status.rejected',
};

export function AdminWebhookDetailPage() {
  const { country, formatInstant } = useLocalisation();
  const t = useMessages(adminDiagnosticsMessages);
  const { webhookId } = useParams();
  const [webhook, setWebhook] = useState<Awaited<ReturnType<typeof getAdminWebhook>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadVersion, setReloadVersion] = useState(0);
  useEffect(() => {
    if (!webhookId) return;
    const controller = new AbortController();
    let current = true;
    setLoading(true);
    setError(null);
    getAdminWebhook(webhookId, controller.signal)
      .then((response) => {
        if (current) setWebhook(response);
      })
      .catch((requestError: unknown) => {
        if (current && !controller.signal.aborted)
          setError(
            localizeAdminDiagnosticsError(requestError, country, 'admin.webhooks.detailLoadError'),
          );
      })
      .finally(() => {
        if (current && !controller.signal.aborted) setLoading(false);
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [country, reloadVersion, webhookId]);
  if (!webhookId)
    return (
      <ErrorMessage
        message={t('admin.common.identifierRequired', {
          resource: t('admin.webhooks.identifierResource'),
        })}
        onRetry={() => setReloadVersion((value) => value + 1)}
      />
    );
  if (loading && !webhook) return <LoadingSpinner />;
  if (error && !webhook)
    return <ErrorMessage message={error} onRetry={() => setReloadVersion((value) => value + 1)} />;
  if (!webhook)
    return (
      <ErrorMessage
        message={t('admin.common.unavailable', {
          resource: t('admin.webhooks.unavailableResource'),
        })}
        onRetry={() => setReloadVersion((value) => value + 1)}
      />
    );
  return (
    <section className="mx-auto max-w-4xl space-y-6" aria-labelledby="admin-webhook-heading">
      <div>
        <p className="section-eyebrow">{t('admin.common.administration')}</p>
        <h1 id="admin-webhook-heading" className="section-heading mt-2">
          {t('admin.webhooks.detailHeading', { id: webhook.id })}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t('admin.webhooks.summary', {
            eventType: webhook.eventType,
            status: t(WEBHOOK_STATUS_LABELS[webhook.status]),
          })}
        </p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Card>
        <CardContent className="space-y-2 py-5">
          <h2 className="font-semibold">{t('admin.webhooks.deliveryDetails')}</h2>
          <p>{t('admin.webhooks.eventId', { value: webhook.eventId })}</p>
          <p>{t('admin.webhooks.received', { value: formatInstant(webhook.receivedAt) })}</p>
          {webhook.processedAt && (
            <p>{t('admin.webhooks.processed', { value: formatInstant(webhook.processedAt) })}</p>
          )}
          {webhook.failureReason && (
            <p role="alert" className="whitespace-pre-wrap text-sm text-destructive">
              {webhook.failureReason}
            </p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-3 py-5">
          <h2 className="font-semibold">{t('admin.webhooks.capturedPayload')}</h2>
          <pre className="overflow-auto rounded-md bg-muted p-3 text-sm">
            {JSON.stringify(webhook.payload, null, 2)}
          </pre>
        </CardContent>
      </Card>
    </section>
  );
}
