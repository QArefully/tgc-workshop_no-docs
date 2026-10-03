import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { AdminJobListQuery, JobKind, JobStatus } from '@shop/contracts/jobs';
import { drainAdminJobs, getAdminJobs } from '@/api/adminJobs';
import { ErrorMessage } from '@/components/ErrorMessage';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useLocalisation, useMessages } from '@/i18n/LocaleContext';
import {
  adminDiagnosticsMessages,
  localizeAdminDiagnosticsError,
  type AdminDiagnosticsMessageKey,
} from '@shop/localisation/messages/adminDiagnostics';

const PAGE_SIZE = 10;
const statuses: JobStatus[] = ['pending', 'running', 'succeeded', 'failed', 'dead'];
const kinds: JobKind[] = ['notification.deliver', 'webhook.process', 'standing_order.run'];
const JOB_STATUS_LABELS: Record<JobStatus, AdminDiagnosticsMessageKey> = {
  pending: 'admin.jobs.status.pending',
  running: 'admin.jobs.status.running',
  succeeded: 'admin.jobs.status.succeeded',
  failed: 'admin.jobs.status.failed',
  dead: 'admin.jobs.status.dead',
};
const readPage = (value: string | null) => {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
};
const readStatus = (value: string | null): JobStatus | undefined =>
  statuses.includes(value as JobStatus) ? (value as JobStatus) : undefined;
const readKind = (value: string | null): JobKind | undefined =>
  kinds.includes(value as JobKind) ? (value as JobKind) : undefined;
type QueryUpdate = Omit<Partial<AdminJobListQuery>, 'status' | 'kind'> & {
  status?: JobStatus | null;
  kind?: JobKind | null;
};

export function AdminJobsPage() {
  const { country, formatCount } = useLocalisation();
  const t = useMessages(adminDiagnosticsMessages);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const status = readStatus(searchParams.get('status'));
  const kind = readKind(searchParams.get('kind'));
  const page = readPage(searchParams.get('page'));
  const [result, setResult] = useState<Awaited<ReturnType<typeof getAdminJobs>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [draining, setDraining] = useState(false);
  const [drainMessage, setDrainMessage] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstItemRef = useRef<HTMLElement>(null);
  const focusAfterReloadRef = useRef(false);

  const updateParams = useCallback(
    (next: QueryUpdate) => {
      const params = new URLSearchParams();
      const nextStatus = next.status === undefined ? status : (next.status ?? undefined);
      const nextKind = next.kind === undefined ? kind : (next.kind ?? undefined);
      const nextPage = next.page ?? page;
      if (nextStatus) params.set('status', nextStatus);
      if (nextKind) params.set('kind', nextKind);
      if (nextPage > 1) params.set('page', String(nextPage));
      setSearchParams(params, { replace: true });
    },
    [kind, page, setSearchParams, status],
  );
  const refresh = useCallback(() => setReloadVersion((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setLoading(true);
    setError(null);
    getAdminJobs({ status, kind, page, pageSize: PAGE_SIZE }, controller.signal)
      .then((response) => {
        if (!current) return;
        setResult(response);
        const maximumPage = Math.max(1, Math.ceil(response.total / response.pageSize));
        if (page > maximumPage) updateParams({ page: maximumPage });
      })
      .catch((requestError: unknown) => {
        if (current && !controller.signal.aborted)
          setError(localizeAdminDiagnosticsError(requestError, country, 'admin.jobs.loadError'));
      })
      .finally(() => {
        if (current && !controller.signal.aborted) setLoading(false);
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [country, kind, page, reloadVersion, status, updateParams]);

  useEffect(() => {
    if (!focusAfterReloadRef.current || !result) return;
    focusAfterReloadRef.current = false;
    (firstItemRef.current ?? headingRef.current)?.focus();
  }, [result]);

  const drain = useCallback(async () => {
    if (draining) return;
    setDraining(true);
    setError(null);
    setDrainMessage(null);
    try {
      const response = await drainAdminJobs();
      focusAfterReloadRef.current = true;
      setDrainMessage(
        t('admin.jobs.drainSummary', {
          processed: formatCount(response.processedCount),
          succeeded: formatCount(response.succeededCount),
          failed: formatCount(response.failedCount),
        }),
      );
      refresh();
    } catch (requestError) {
      setError(localizeAdminDiagnosticsError(requestError, country, 'admin.jobs.drainError'));
    } finally {
      setDraining(false);
    }
  }, [country, draining, formatCount, refresh, t]);

  if (loading && !result) return <LoadingSpinner />;
  if (error && !result) return <ErrorMessage message={error} onRetry={refresh} />;
  if (!result) return <ErrorMessage message={t('admin.jobs.queueUnavailable')} onRetry={refresh} />;
  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));

  return (
    <section className="mx-auto max-w-4xl space-y-6" aria-labelledby="admin-jobs-heading">
      <div>
        <p className="section-eyebrow">{t('admin.common.administration')}</p>
        <h1 ref={headingRef} id="admin-jobs-heading" tabIndex={-1} className="section-heading mt-2">
          {t('admin.jobs.heading')}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{t('admin.jobs.description')}</p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <p aria-live="polite" className="text-sm text-muted-foreground">
        {drainMessage}
      </p>
      <div className="flex flex-wrap gap-3">
        <label className="text-sm font-medium">
          {t('admin.jobs.statusLabel')}
          <select
            aria-label={t('admin.jobs.statusLabel')}
            className="ml-2 rounded-md border border-input bg-background px-2 py-1"
            value={status ?? ''}
            onChange={(event) =>
              updateParams({ status: readStatus(event.target.value) ?? null, page: 1 })
            }
          >
            <option value="">{t('admin.common.all')}</option>
            {statuses.map((item) => (
              <option key={item} value={item}>
                {t(JOB_STATUS_LABELS[item])}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium">
          {t('admin.jobs.kindLabel')}
          <select
            aria-label={t('admin.jobs.kindLabel')}
            className="ml-2 rounded-md border border-input bg-background px-2 py-1"
            value={kind ?? ''}
            onChange={(event) =>
              updateParams({ kind: readKind(event.target.value) ?? null, page: 1 })
            }
          >
            <option value="">{t('admin.common.all')}</option>
            {kinds.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <Button type="button" disabled={draining} onClick={() => void drain()}>
          {draining ? t('admin.jobs.draining') : t('admin.jobs.drain')}
        </Button>
      </div>
      {result.items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">{t('admin.jobs.empty')}</CardContent>
        </Card>
      ) : (
        <div className="space-y-3" aria-busy={loading}>
          {result.items.map((job, index) => (
            <article key={job.id} ref={index === 0 ? firstItemRef : undefined} tabIndex={-1}>
              <Card>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                  <div>
                    <h2 className="font-semibold">{job.kind}</h2>
                    <p className="text-sm text-muted-foreground">
                      #{job.id} · {t(JOB_STATUS_LABELS[job.status])} ·{' '}
                      {t('admin.jobs.attempts', {
                        attempts: formatCount(job.attempts),
                        maxAttempts: formatCount(job.maxAttempts),
                      })}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => navigate(`/admin/jobs/${job.id}`)}
                  >
                    {t('admin.common.viewDetail')}
                  </Button>
                </CardContent>
              </Card>
            </article>
          ))}
        </div>
      )}
      <nav className="flex items-center justify-between" aria-label={t('admin.jobs.queuePages')}>
        <Button
          type="button"
          variant="outline"
          disabled={page <= 1 || loading}
          onClick={() => updateParams({ page: page - 1 })}
        >
          {t('admin.common.previous')}
        </Button>
        <span className="text-sm text-muted-foreground">
          {t('admin.common.page', {
            page: formatCount(result.page),
            totalPages: formatCount(totalPages),
          })}
        </span>
        <Button
          type="button"
          variant="outline"
          disabled={page >= totalPages || loading}
          onClick={() => updateParams({ page: page + 1 })}
        >
          {t('admin.common.next')}
        </Button>
      </nav>
    </section>
  );
}
