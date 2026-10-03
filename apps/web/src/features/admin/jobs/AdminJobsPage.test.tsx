/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminJobDetailPage } from './AdminJobDetailPage';
import { AdminJobsPage } from './AdminJobsPage';

const api = vi.hoisted(() => ({
  getAdminJobs: vi.fn(),
  getAdminJob: vi.fn(),
  retryAdminJob: vi.fn(),
  drainAdminJobs: vi.fn(),
}));
vi.mock('@/api/adminJobs', () => api);
const job = {
  id: '1',
  kind: 'webhook.process' as const,
  dedupeKey: null,
  payload: {},
  status: 'dead' as const,
  attempts: 5,
  maxAttempts: 5,
  runAt: '2026-08-01T00:00:00.000Z',
  leaseExpiresAt: null,
  lastError: 'handler failed',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};
const page = (overrides = {}) => ({ items: [job], total: 1, page: 1, pageSize: 10, ...overrides });
const detail = {
  ...job,
  attemptsLedger: [
    {
      id: '2',
      jobId: '1',
      attemptNumber: 5,
      startedAt: '2026-08-01T00:00:00.000Z',
      finishedAt: '2026-08-01T00:00:01.000Z',
      outcome: 'failed' as const,
      error: 'handler failed',
    },
  ],
};
function Location() {
  const location = useLocation();
  return <output data-testid="location">{location.search}</output>;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe('AdminJobsPage', () => {
  afterEach(() => vi.resetAllMocks());
  it('filters from URL and clamps an out-of-range page', async () => {
    api.getAdminJobs.mockResolvedValue(page({ total: 1, page: 3 }));
    render(
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        initialEntries={['/admin/jobs?status=dead&kind=webhook.process&page=9']}
      >
        <AdminJobsPage />
        <Location />
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { name: 'webhook.process' });
    expect(api.getAdminJobs).toHaveBeenCalledWith(
      { status: 'dead', kind: 'webhook.process', page: 9, pageSize: 10 },
      expect.any(AbortSignal),
    );
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('status=dead&kind=webhook.process'),
    );
    await waitFor(() =>
      expect(api.getAdminJobs).toHaveBeenLastCalledWith(
        { status: 'dead', kind: 'webhook.process', page: 1, pageSize: 10 },
        expect.any(AbortSignal),
      ),
    );
  });
  it('reports drain counts', async () => {
    api.getAdminJobs.mockResolvedValue(page());
    api.drainAdminJobs.mockResolvedValue({ processedCount: 3, succeededCount: 2, failedCount: 1 });
    const user = userEvent.setup();
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AdminJobsPage />
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('button', { name: 'Drain due jobs' }));
    expect(await screen.findByText('Processed 3; succeeded 2; failed 1.')).toBeInTheDocument();
  });
  it('disables dead-job retry during an in-flight request', async () => {
    const retry = deferred<typeof job>();
    api.getAdminJob.mockResolvedValue(detail);
    api.retryAdminJob.mockReturnValue(retry.promise);
    const user = userEvent.setup();
    render(
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        initialEntries={['/admin/jobs/1']}
      >
        <Routes>
          <Route path="/admin/jobs/:jobId" element={<AdminJobDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    const button = await screen.findByRole('button', { name: 'Retry dead job' });
    await user.click(button);
    expect(button).toBeDisabled();
    expect(api.retryAdminJob).toHaveBeenCalledWith(
      '1',
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
      expect.any(AbortSignal),
    );
    await act(async () => {
      retry.resolve(job);
      await retry.promise;
    });
  });

  it('uses a new retry idempotency key after the route job changes', async () => {
    api.getAdminJob.mockImplementation((id: string) => Promise.resolve({ ...detail, id }));
    api.retryAdminJob.mockResolvedValue(job);
    const user = userEvent.setup();
    render(
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        initialEntries={['/admin/jobs/1']}
      >
        <Link to="/admin/jobs/2">Job 2</Link>
        <Routes>
          <Route path="/admin/jobs/:jobId" element={<AdminJobDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('button', { name: 'Retry dead job' }));
    await screen.findByText('Job queued for retry.');
    await user.click(screen.getByRole('link', { name: 'Job 2' }));
    await user.click(await screen.findByRole('button', { name: 'Retry dead job' }));
    const firstKey = api.retryAdminJob.mock.calls[0]?.[1].idempotencyKey;
    const secondKey = api.retryAdminJob.mock.calls[1]?.[1].idempotencyKey;
    expect(firstKey).not.toBe(secondKey);
  });

  it('ignores a job-one retry completion after navigating to job two', async () => {
    const retry = deferred<typeof job>();
    api.getAdminJob.mockImplementation((id: string) => Promise.resolve({ ...detail, id }));
    api.retryAdminJob.mockReturnValue(retry.promise);
    const user = userEvent.setup();
    render(
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        initialEntries={['/admin/jobs/1']}
      >
        <Link to="/admin/jobs/2">Job 2</Link>
        <Routes>
          <Route path="/admin/jobs/:jobId" element={<AdminJobDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('button', { name: 'Retry dead job' }));
    await user.click(screen.getByRole('link', { name: 'Job 2' }));
    expect(await screen.findByRole('heading', { name: 'Job #2' })).toBeInTheDocument();
    await act(async () => {
      retry.resolve(job);
      await retry.promise;
    });
    expect(screen.queryByText('Job queued for retry.')).not.toBeInTheDocument();
    expect(api.getAdminJob).toHaveBeenCalledTimes(2);
  });
});
