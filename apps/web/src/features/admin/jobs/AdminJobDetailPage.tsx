import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { JobAttemptOutcome, JobStatus } from '@shop/contracts/jobs';
import { getAdminJob, retryAdminJob } from '@/api/adminJobs';
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

const JOB_STATUS_LABELS: Record<JobStatus, AdminDiagnosticsMessageKey> = {
  pending: 'admin.jobs.status.pending',
  running: 'admin.jobs.status.running',
  succeeded: 'admin.jobs.status.succeeded',
  failed: 'admin.jobs.status.failed',
  dead: 'admin.jobs.status.dead',
};
const JOB_OUTCOME_LABELS: Record<JobAttemptOutcome, AdminDiagnosticsMessageKey> = {
  succeeded: 'admin.jobs.outcome.succeeded',
  failed: 'admin.jobs.outcome.failed',
  abandoned: 'admin.jobs.outcome.abandoned',
};

export function AdminJobDetailPage() {
  const { country, formatCount, formatInstant } = useLocalisation();
  const t = useMessages(adminDiagnosticsMessages);
  const { jobId } = useParams();
  const [job, setJob] = useState<Awaited<ReturnType<typeof getAdminJob>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const idempotencyKey = useRef<string | null>(null);
  const currentJobId = useRef(jobId);
  const retryGeneration = useRef(0);
  const retryController = useRef<AbortController | null>(null);
  const focusAfterReload = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const refresh = useCallback(() => setReloadVersion((value) => value + 1), []);

  currentJobId.current = jobId;

  useEffect(() => {
    idempotencyKey.current = null;
    retryGeneration.current += 1;
    retryController.current?.abort();
    retryController.current = null;
    setRetrying(false);
    setNotice(null);
  }, [jobId]);

  useEffect(() => {
    if (!jobId) return;
    const controller = new AbortController();
    let current = true;
    setLoading(true);
    setError(null);
    getAdminJob(jobId, controller.signal)
      .then((response) => {
        if (current) setJob(response);
      })
      .catch((requestError: unknown) => {
        if (current && !controller.signal.aborted)
          setError(
            localizeAdminDiagnosticsError(requestError, country, 'admin.jobs.detailLoadError'),
          );
      })
      .finally(() => {
        if (current && !controller.signal.aborted) setLoading(false);
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [country, jobId, reloadVersion]);
  useEffect(() => {
    if (job && focusAfterReload.current) {
      focusAfterReload.current = false;
      headingRef.current?.focus();
    }
  }, [job]);

  const retry = useCallback(async () => {
    if (!jobId || retrying || job?.status !== 'dead') return;
    const key = idempotencyKey.current ?? crypto.randomUUID();
    const generation = ++retryGeneration.current;
    const controller = new AbortController();
    idempotencyKey.current = key;
    retryController.current = controller;
    setRetrying(true);
    setError(null);
    setNotice(null);
    try {
      await retryAdminJob(jobId, { idempotencyKey: key }, controller.signal);
      if (generation !== retryGeneration.current || currentJobId.current !== jobId) return;
      focusAfterReload.current = true;
      setNotice(t('admin.jobs.retryNotice'));
      refresh();
    } catch (requestError) {
      if (
        generation === retryGeneration.current &&
        currentJobId.current === jobId &&
        !controller.signal.aborted
      ) {
        setError(localizeAdminDiagnosticsError(requestError, country, 'admin.jobs.retryError'));
      }
    } finally {
      if (generation === retryGeneration.current && currentJobId.current === jobId) {
        retryController.current = null;
        setRetrying(false);
      }
    }
  }, [country, job?.status, jobId, refresh, retrying, t]);

  if (!jobId)
    return (
      <ErrorMessage
        message={t('admin.common.identifierRequired', {
          resource: t('admin.jobs.identifierResource'),
        })}
        onRetry={refresh}
      />
    );
  if (loading && !job) return <LoadingSpinner />;
  if (error && !job) return <ErrorMessage message={error} onRetry={refresh} />;
  if (!job)
    return (
      <ErrorMessage
        message={t('admin.common.unavailable', {
          resource: t('admin.jobs.unavailableResource'),
        })}
        onRetry={refresh}
      />
    );
  return (
    <section className="mx-auto max-w-4xl space-y-6" aria-labelledby="admin-job-heading">
      <div>
        <p className="section-eyebrow">{t('admin.common.administration')}</p>
        <h1 ref={headingRef} tabIndex={-1} id="admin-job-heading" className="section-heading mt-2">
          {t('admin.jobs.detailHeading', { id: job.id })}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t('admin.jobs.summary', {
            kind: job.kind,
            status: t(JOB_STATUS_LABELS[job.status]),
          })}
        </p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <p aria-live="polite" className="text-sm text-muted-foreground">
        {notice}
      </p>
      <Card>
        <CardContent className="space-y-2 py-5">
          <h2 className="font-semibold">{t('admin.jobs.queueDetails')}</h2>
          <p>
            {t('admin.jobs.attemptsLabel', {
              attempts: formatCount(job.attempts),
              maxAttempts: formatCount(job.maxAttempts),
            })}
          </p>
          <p>{t('admin.jobs.scheduled', { value: formatInstant(job.runAt) })}</p>
          {job.lastError && (
            <p role="alert" className="whitespace-pre-wrap text-sm text-destructive">
              {t('admin.jobs.lastError', { value: job.lastError })}
            </p>
          )}
          <Button
            type="button"
            disabled={retrying || job.status !== 'dead'}
            onClick={() => void retry()}
          >
            {retrying ? t('admin.jobs.retrying') : t('admin.jobs.retryDead')}
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-3 py-5">
          <h2 className="font-semibold">{t('admin.jobs.attemptLedger')}</h2>
          {job.attemptsLedger.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('admin.jobs.noAttempts')}</p>
          ) : (
            <ol className="space-y-3">
              {job.attemptsLedger.map((attempt) => (
                <li key={attempt.id} className="rounded-md border border-border p-3">
                  <p className="font-medium">
                    {t('admin.jobs.attemptSummary', {
                      attemptNumber: formatCount(attempt.attemptNumber),
                      outcome: t(JOB_OUTCOME_LABELS[attempt.outcome]),
                    })}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {t('admin.jobs.startedFinished', {
                      started: formatInstant(attempt.startedAt),
                      finished: attempt.finishedAt
                        ? formatInstant(attempt.finishedAt)
                        : t('admin.jobs.inProgress'),
                    })}
                  </p>
                  {attempt.error && (
                    <p className="mt-1 whitespace-pre-wrap text-sm text-destructive">
                      {attempt.error}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
