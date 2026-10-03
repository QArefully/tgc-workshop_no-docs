import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AdminJobDetailPage } from './AdminJobDetailPage';
import { AdminJobsPage } from './AdminJobsPage';

const api = vi.hoisted(() => ({
  getAdminJobs: vi.fn(),
  getAdminJob: vi.fn(),
  retryAdminJob: vi.fn(),
  drainAdminJobs: vi.fn(),
}));
vi.mock('@/api/adminJobs', () => api);
const dead = {
  id: '1',
  kind: 'webhook.process' as const,
  dedupeKey: null,
  payload: {},
  status: 'dead' as const,
  attempts: 5,
  maxAttempts: 5,
  runAt: '2026-08-01T00:00:00.000Z',
  leaseExpiresAt: null,
  lastError: 'failure',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  attemptsLedger: [],
};

describe('admin async journey', () => {
  it('retries a dead job then refreshes its list', async () => {
    api.getAdminJob.mockResolvedValue(dead);
    api.retryAdminJob.mockResolvedValue({ ...dead, status: 'pending' });
    api.getAdminJobs.mockResolvedValue({
      items: [{ ...dead, status: 'pending' }],
      total: 1,
      page: 1,
      pageSize: 10,
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter
        initialEntries={['/admin/jobs/1']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Link to="/admin/jobs">Job queue</Link>
        <Routes>
          <Route path="/admin/jobs" element={<AdminJobsPage />} />
          <Route path="/admin/jobs/:jobId" element={<AdminJobDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('button', { name: 'Retry dead job' }));
    expect(await screen.findByText('Job queued for retry.')).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Job queue' }));
    expect(await screen.findByText('#1 · Pending · 5/5 attempts')).toBeInTheDocument();
    expect(api.getAdminJobs).toHaveBeenCalled();
  });
});
