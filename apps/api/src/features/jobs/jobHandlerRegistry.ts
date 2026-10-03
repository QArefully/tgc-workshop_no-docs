import type { JobKind } from '@shop/contracts/jobs';

export interface JobHandlerContext {
  jobId: number;
  kind: JobKind;
  payload: unknown;
  attempt: number;
}
export type JobHandlerResult = { ok: true } | { ok: false; error: string };
export type JobHandler = (
  context: JobHandlerContext,
) => Promise<JobHandlerResult> | JobHandlerResult;

export class JobHandlerRegistry {
  private readonly handlers = new Map<JobKind, JobHandler>();
  register(kind: JobKind, handler: JobHandler): void {
    if (this.handlers.has(kind)) throw new Error(`Job handler already registered: ${kind}`);
    this.handlers.set(kind, handler);
  }
  get(kind: JobKind): JobHandler | undefined {
    return this.handlers.get(kind);
  }
}
