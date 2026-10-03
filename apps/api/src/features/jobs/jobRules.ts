import { JOB_BACKOFF_BASE_MS, JOB_BACKOFF_CAP_MS, JOB_MAX_ATTEMPTS } from '@shop/contracts/jobs';

export function nextBackoffMs(attempts: number): number {
  return Math.min(JOB_BACKOFF_CAP_MS, JOB_BACKOFF_BASE_MS * 2 ** (attempts - 1));
}

export function isLeaseExpired(leaseExpiresAt: string | null, now: string): boolean {
  return leaseExpiresAt !== null && leaseExpiresAt <= now;
}

export function classifyAttemptOutcome(
  attempts: number,
  maxAttempts = JOB_MAX_ATTEMPTS,
): 'retry' | 'dead' {
  return attempts >= maxAttempts ? 'dead' : 'retry';
}
