import { JOB_LEASE_MS, JOB_MAX_ATTEMPTS } from '@shop/contracts/jobs';
import type {
  AdminJob,
  AdminJobAttempt,
  AdminJobDetail,
  AdminJobListQuery,
  JobKind,
  JobStatus,
} from '@shop/contracts/jobs';
import type { UnitOfWork } from '../../db/unitOfWork.js';
import type { AuditContext } from '../audit/auditEvent.js';
import type { AuditWriter } from '../audit/auditService.js';
import { noFaults, type FaultSwitch } from './faultSwitch.js';
import { classifyAttemptOutcome, nextBackoffMs } from './jobRules.js';
import type { JobRepository, JobRecord } from './jobRepository.js';
import { JobHandlerRegistry } from './jobHandlerRegistry.js';

export interface JobServiceDependencies {
  repository: JobRepository;
  unitOfWork: UnitOfWork;
  registry: JobHandlerRegistry;
  clock: { now(): Date };
  leaseMs?: number;
  maxAttempts?: number;
  intervalMs?: number;
  audit?: AuditWriter;
  faults?: FaultSwitch;
}

export class JobAdminError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JobAdminError';
  }
}

export type AdminJobRetryResult =
  | { status: 'requeued'; job: AdminJob }
  | { status: 'already_retried'; job: AdminJob }
  | { status: 'not_found' }
  | { status: 'not_retryable'; job: AdminJob }
  | { status: 'idempotency_conflict' };

const jobStatuses = new Set<JobStatus>(['pending', 'running', 'succeeded', 'failed', 'dead']);
const jobKinds = new Set<JobKind>([
  'notification.deliver',
  'webhook.process',
  'standing_order.run',
  'back_in_stock.notify',
]);

function asAdminJob(record: JobRecord): AdminJob {
  return { ...record, id: String(record.id) };
}

function asAdminAttempt(record: import('./jobRepository.js').JobAttemptRecord): AdminJobAttempt {
  if (record.startedAt === null) throw new Error('Job attempt is missing startedAt');
  return {
    ...record,
    id: String(record.id),
    jobId: String(record.jobId),
    startedAt: record.startedAt,
  };
}

function normalizeAdminQuery(
  input: Partial<AdminJobListQuery>,
): Required<Pick<AdminJobListQuery, 'page' | 'pageSize'>> &
  Pick<AdminJobListQuery, 'status' | 'kind'> {
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 50;
  if (!Number.isSafeInteger(page) || page < 1 || page > 10_000) {
    throw new JobAdminError('page must be an integer between 1 and 10000');
  }
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new JobAdminError('pageSize must be an integer between 1 and 100');
  }
  if (input.status !== undefined && !jobStatuses.has(input.status)) {
    throw new JobAdminError('status is not an allowed job status');
  }
  if (input.kind !== undefined && !jobKinds.has(input.kind)) {
    throw new JobAdminError('kind is not an allowed job kind');
  }
  return {
    page,
    pageSize,
    ...(input.status ? { status: input.status } : {}),
    ...(input.kind ? { kind: input.kind } : {}),
  };
}
export class JobService {
  private timer: ReturnType<typeof setInterval> | undefined;
  private activeDrain:
    Promise<{ processedCount: number; succeededCount: number; failedCount: number }> | undefined;
  private readonly leaseMs: number;
  private readonly maxAttempts: number;
  private readonly intervalMs: number;
  constructor(private readonly d: JobServiceDependencies) {
    this.leaseMs = d.leaseMs ?? JOB_LEASE_MS;
    this.maxAttempts = d.maxAttempts ?? JOB_MAX_ATTEMPTS;
    this.intervalMs = d.intervalMs ?? 1000;
  }
  enqueue(input: {
    kind: JobRecord['kind'];
    dedupeKey?: string | null;
    payload: unknown;
    runAt?: string;
    maxAttempts?: number;
  }) {
    const now = this.d.clock.now().toISOString();
    return this.d.unitOfWork.run(() =>
      this.d.repository.enqueue({
        kind: input.kind,
        dedupeKey: input.dedupeKey ?? null,
        payload: input.payload,
        maxAttempts: input.maxAttempts ?? this.maxAttempts,
        runAt: input.runAt ?? now,
        now,
      }),
    );
  }
  /** Owner-independent admin queue page, ordered newest first. */
  listAdmin(input: Partial<AdminJobListQuery> = {}) {
    const query = normalizeAdminQuery(input);
    return {
      items: this.d.repository.listAdmin(query).map(asAdminJob),
      total: this.d.repository.countAdmin(query),
      page: query.page,
      pageSize: query.pageSize,
    };
  }
  /** Route-friendly alias for owner-independent admin listing. */
  list(input: Partial<AdminJobListQuery> = {}) {
    return this.listAdmin(input);
  }
  /** Admin job with immutable execution-attempt ledger. */
  getAdminDetail(id: number): AdminJobDetail | undefined {
    if (!Number.isSafeInteger(id) || id < 1)
      throw new JobAdminError('job id must be a positive safe integer');
    const record = this.d.repository.get(id);
    return record
      ? {
          ...asAdminJob(record),
          attemptsLedger: this.d.repository.listAttempts(id).map(asAdminAttempt),
        }
      : undefined;
  }
  /** Route-friendly alias for one admin job detail. */
  get(id: number): AdminJobDetail | undefined {
    return this.getAdminDetail(id);
  }
  /** Route-friendly immutable attempt ledger accessor. */
  listAttempts(id: number): AdminJobAttempt[] | undefined {
    return this.getAdminDetail(id)?.attemptsLedger;
  }
  /** Requeues dead/failed jobs once per idempotency key and appends its planned audit event atomically. */
  retryByAdmin(input: {
    jobId: number;
    idempotencyKey: string;
    context: AuditContext;
  }): AdminJobRetryResult {
    if (!Number.isSafeInteger(input.jobId) || input.jobId < 1) {
      throw new JobAdminError('job id must be a positive safe integer');
    }
    if (!input.idempotencyKey) throw new JobAdminError('idempotencyKey is required');
    const audit = this.d.audit;
    if (!audit) throw new Error('Admin job retry requires an audit writer');
    return this.d.unitOfWork.run(() => {
      const previousJobId = this.d.repository.findAdminRetryJobId(input.idempotencyKey);
      if (previousJobId !== undefined) {
        if (previousJobId !== input.jobId) return { status: 'idempotency_conflict' };
        const existing = this.d.repository.get(input.jobId);
        return existing
          ? { status: 'already_retried', job: asAdminJob(existing) }
          : { status: 'not_found' };
      }
      const existing = this.d.repository.get(input.jobId);
      if (!existing) return { status: 'not_found' };
      const now = this.d.clock.now().toISOString();
      const requeued = this.d.repository.requeueByAdmin(input.jobId, now);
      if (!requeued) return { status: 'not_retryable', job: asAdminJob(existing) };
      audit.append({
        action: 'job.retried_by_admin',
        jobId: input.jobId,
        context: { ...input.context, requestId: input.idempotencyKey },
      });
      return { status: 'requeued', job: asAdminJob(requeued) };
    });
  }
  /** Route-friendly retry entrypoint; system context is used when no actor context is supplied. */
  retry(
    jobId: number,
    input: { idempotencyKey: string; context?: AuditContext },
  ): AdminJobRetryResult {
    return this.retryByAdmin({
      jobId,
      idempotencyKey: input.idempotencyKey,
      context: input.context ?? { actor: { type: 'system', userId: null }, requestId: null },
    });
  }
  async runDue(
    now = this.d.clock.now(),
  ): Promise<{ processedCount: number; succeededCount: number; failedCount: number }> {
    if (this.activeDrain) return this.activeDrain;
    const drain = this.runDueInternal(now);
    this.activeDrain = drain;
    try {
      return await drain;
    } finally {
      if (this.activeDrain === drain) this.activeDrain = undefined;
    }
  }
  private async runDueInternal(
    now: Date,
  ): Promise<{ processedCount: number; succeededCount: number; failedCount: number }> {
    let processedCount = 0,
      succeededCount = 0,
      failedCount = 0;
    for (;;) {
      const nowIso = now.toISOString();
      const claimed = this.d.unitOfWork.run(() =>
        this.d.repository.claimDue(nowIso, new Date(now.getTime() + this.leaseMs).toISOString()),
      );
      if (!claimed) break;
      processedCount++;
      let result: { ok: true } | { ok: false; error: string };
      try {
        if ((this.d.faults ?? noFaults).isEnabled('async.job_handler_failure')) {
          result = { ok: false, error: 'Simulated job handler failure' };
        } else {
          const handler = this.d.registry.get(claimed.kind);
          result = handler
            ? await handler({
                jobId: claimed.id,
                kind: claimed.kind,
                payload: claimed.payload,
                attempt: claimed.attempts,
              })
            : { ok: false, error: `Unknown job kind: ${claimed.kind}` };
        }
      } catch (error) {
        result = {
          ok: false,
          error: error instanceof Error ? error.message : 'Job handler failed',
        };
      }
      const settled = this.d.unitOfWork.run(() => {
        if (result.ok) return this.d.repository.settleSuccess(claimed.id, claimed.attempts, nowIso);
        const outcome = classifyAttemptOutcome(claimed.attempts, claimed.maxAttempts);
        return this.d.repository.settleFailure({
          id: claimed.id,
          attempts: claimed.attempts,
          status: outcome === 'dead' ? 'dead' : 'pending',
          runAt:
            outcome === 'dead'
              ? nowIso
              : new Date(now.getTime() + nextBackoffMs(claimed.attempts)).toISOString(),
          error: result.error,
          now: nowIso,
        });
      });
      if (settled && result.ok) succeededCount++;
      else if (settled) failedCount++;
    }
    return { processedCount, succeededCount, failedCount };
  }
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.runDue();
    }, this.intervalMs);
    this.timer.unref?.();
  }
  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }
}
