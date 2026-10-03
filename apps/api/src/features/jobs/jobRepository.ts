/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import type Database from 'better-sqlite3';
import type { JobKind, JobStatus } from '@shop/contracts/jobs';

export interface JobRecord {
  id: number;
  kind: JobKind;
  dedupeKey: string | null;
  payload: unknown;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  runAt: string;
  leaseExpiresAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface JobAttemptRecord {
  id: number;
  jobId: number;
  attemptNumber: number;
  startedAt: string | null;
  finishedAt: string | null;
  outcome: 'succeeded' | 'failed' | 'abandoned';
  error: string | null;
}
interface Row {
  id: number;
  kind: JobKind;
  dedupe_key: string | null;
  payload_json: string;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  run_at: string;
  lease_expires_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}
const cols =
  'id, kind, dedupe_key, payload_json, status, attempts, max_attempts, run_at, lease_expires_at, last_error, created_at, updated_at';
function job(row: Row): JobRecord {
  let payload: unknown;
  try {
    payload = JSON.parse(row.payload_json);
  } catch {
    throw new Error('Invalid job payload JSON');
  }
  return {
    id: row.id,
    kind: row.kind,
    dedupeKey: row.dedupe_key,
    payload,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    runAt: row.run_at,
    leaseExpiresAt: row.lease_expires_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
export interface JobRepository {
  enqueue(input: {
    kind: JobKind;
    dedupeKey: string | null;
    payload: unknown;
    maxAttempts: number;
    runAt: string;
    now: string;
  }): { created: boolean; job: JobRecord };
  get(id: number): JobRecord | undefined;
  listAttempts(jobId: number): JobAttemptRecord[];
  listAdmin(input: {
    status?: JobStatus;
    kind?: JobKind;
    page: number;
    pageSize: number;
  }): JobRecord[];
  countAdmin(input: { status?: JobStatus; kind?: JobKind }): number;
  /** Audit events form the durable idempotency ledger for administrator retry requests. */
  findAdminRetryJobId(idempotencyKey: string): number | undefined;
  requeueByAdmin(id: number, now: string): JobRecord | undefined;
  claimDue(now: string, leaseExpiresAt: string): JobRecord | undefined;
  settleSuccess(id: number, attempts: number, now: string): boolean;
  settleFailure(input: {
    id: number;
    attempts: number;
    status: 'pending' | 'dead';
    runAt: string;
    error: string;
    now: string;
  }): boolean;
  abandon(id: number, attempt: number, now: string): void;
}
export function createJobRepository(db: Database.Database): JobRepository {
  const get = (id: number) => {
    const row = db.prepare(`SELECT ${cols} FROM jobs WHERE id=?`).get(id) as Row | undefined;
    return row && job(row);
  };
  const append = (
    id: number,
    attempt: number,
    started: string,
    finished: string,
    outcome: 'succeeded' | 'failed' | 'abandoned',
    error: string | null,
  ) =>
    db
      .prepare(
        `INSERT INTO job_attempts (job_id,attempt_number,started_at,finished_at,outcome,error) VALUES (?,?,?,?,?,?)`,
      )
      .run(id, attempt, started, finished, outcome, error);
  return {
    enqueue(input) {
      const r = db
        .prepare(
          `INSERT INTO jobs (kind,dedupe_key,payload_json,status,max_attempts,run_at,created_at,updated_at) VALUES (?,?,?,'pending',?,?,?,?) ON CONFLICT(dedupe_key) DO NOTHING`,
        )
        .run(
          input.kind,
          input.dedupeKey,
          JSON.stringify(input.payload),
          input.maxAttempts,
          input.runAt,
          input.now,
          input.now,
        );
      if (r.changes) return { created: true, job: get(Number(r.lastInsertRowid))! };
      if (input.dedupeKey === null) throw new Error('Job insert failed');
      const row = db.prepare(`SELECT ${cols} FROM jobs WHERE dedupe_key=?`).get(input.dedupeKey) as
        Row | undefined;
      if (!row) throw new Error('Job dedupe reservation disappeared');
      return { created: false, job: job(row) };
    },
    get,
    listAttempts(jobId) {
      return db
        .prepare(
          'SELECT id, job_id, attempt_number, started_at, finished_at, outcome, error FROM job_attempts WHERE job_id=? ORDER BY attempt_number',
        )
        .all(jobId)
        .map((r: any) => ({
          id: r.id,
          jobId: r.job_id,
          attemptNumber: r.attempt_number,
          startedAt: r.started_at,
          finishedAt: r.finished_at,
          outcome: r.outcome,
          error: r.error,
        }));
    },
    listAdmin(input) {
      const clauses: string[] = [];
      const values: Array<string | number> = [];
      if (input.status) {
        clauses.push('status=?');
        values.push(input.status);
      }
      if (input.kind) {
        clauses.push('kind=?');
        values.push(input.kind);
      }
      const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
      return db
        .prepare(
          `SELECT ${cols} FROM jobs${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
        )
        .all(...values, input.pageSize, (input.page - 1) * input.pageSize)
        .map((row) => job(row as Row));
    },
    countAdmin(input) {
      const clauses: string[] = [];
      const values: string[] = [];
      if (input.status) {
        clauses.push('status=?');
        values.push(input.status);
      }
      if (input.kind) {
        clauses.push('kind=?');
        values.push(input.kind);
      }
      const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
      return (
        db.prepare(`SELECT COUNT(*) AS count FROM jobs${where}`).get(...values) as { count: number }
      ).count;
    },
    findAdminRetryJobId(idempotencyKey) {
      const row = db
        .prepare(
          "SELECT entity_id FROM audit_events WHERE action='job.retried_by_admin' AND request_id=? ORDER BY id DESC LIMIT 1",
        )
        .get(idempotencyKey) as { entity_id: string | null } | undefined;
      if (!row?.entity_id || !/^\d+$/.test(row.entity_id)) return undefined;
      return Number(row.entity_id);
    },
    requeueByAdmin(id, now) {
      const changed = db
        .prepare(
          "UPDATE jobs SET status='pending',run_at=?,lease_expires_at=NULL,last_error=NULL,updated_at=? WHERE id=? AND status IN ('failed','dead')",
        )
        .run(now, now, id).changes;
      return changed ? get(id) : undefined;
    },
    claimDue(now, leaseExpiresAt) {
      const candidate = db
        .prepare(
          `SELECT ${cols} FROM jobs WHERE (status='pending' AND run_at<=?) OR (status='running' AND lease_expires_at<=?) ORDER BY run_at,id LIMIT 1`,
        )
        .get(now, now) as Row | undefined;
      if (!candidate) return;
      if (candidate.status === 'running') this.abandon(candidate.id, candidate.attempts, now);
      const changed = db
        .prepare(
          `UPDATE jobs SET status='running', attempts=attempts+1, lease_expires_at=?, updated_at=? WHERE id=? AND (status='pending' OR (status='running' AND lease_expires_at<=?))`,
        )
        .run(leaseExpiresAt, now, candidate.id, now).changes;
      if (!changed) return;
      return get(candidate.id)!;
    },
    settleSuccess(id, attempts, now) {
      const changed =
        db
          .prepare(
            `UPDATE jobs SET status='succeeded', lease_expires_at=NULL,last_error=NULL,updated_at=? WHERE id=? AND status='running' AND attempts=?`,
          )
          .run(now, id, attempts).changes > 0;
      if (changed) append(id, attempts, now, now, 'succeeded', null);
      return changed;
    },
    settleFailure(i) {
      const changed =
        db
          .prepare(
            `UPDATE jobs SET status=?,run_at=?,lease_expires_at=NULL,last_error=?,updated_at=? WHERE id=? AND status='running' AND attempts=?`,
          )
          .run(i.status, i.runAt, i.error, i.now, i.id, i.attempts).changes > 0;
      if (changed) append(i.id, i.attempts, i.now, i.now, 'failed', i.error);
      return changed;
    },
    abandon(id, attempt, now) {
      append(id, attempt, now, now, 'abandoned', 'Lease expired');
    },
  };
}
