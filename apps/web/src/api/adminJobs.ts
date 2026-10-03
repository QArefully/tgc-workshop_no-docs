import {
  AdminJob,
  AdminJobDetail,
  AdminJobDrainResponse,
  AdminJobPage,
} from '@shop/contracts/jobs';
import type { AdminJobListQuery, AdminJobRetryBody } from '@shop/contracts/jobs';
import { apiFetch } from './client';

export const getAdminJobs = (params: AdminJobListQuery, signal?: AbortSignal) => {
  const query = new URLSearchParams({
    page: String(params.page ?? 1),
    pageSize: String(params.pageSize ?? 10),
  });
  if (params.status) query.set('status', params.status);
  if (params.kind) query.set('kind', params.kind);
  return apiFetch(AdminJobPage, `/api/admin/jobs?${query}`, { signal });
};

export const getAdminJob = (jobId: string, signal?: AbortSignal) =>
  apiFetch(AdminJobDetail, `/api/admin/jobs/${jobId}`, { signal });

export const retryAdminJob = (jobId: string, body: AdminJobRetryBody, signal?: AbortSignal) =>
  apiFetch(AdminJob, `/api/admin/jobs/${jobId}/retry`, {
    method: 'POST',
    body: JSON.stringify(body satisfies AdminJobRetryBody),
    signal,
  });

export const drainAdminJobs = (signal?: AbortSignal) =>
  apiFetch(AdminJobDrainResponse, '/api/admin/jobs/run', { method: 'POST', signal });
