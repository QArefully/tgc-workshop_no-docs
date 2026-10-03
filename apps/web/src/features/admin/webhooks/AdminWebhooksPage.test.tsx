import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminWebhookDetailPage } from './AdminWebhookDetailPage';
import { AdminWebhooksPage } from './AdminWebhooksPage';
const api = vi.hoisted(() => ({ getAdminWebhooks: vi.fn(), getAdminWebhook: vi.fn() }));
vi.mock('@/api/adminWebhooks', () => api);
const webhook = {
  id: '1',
  source: 'simulated_payments' as const,
  eventId: 'evt-1',
  eventType: 'payment.succeeded' as const,
  payload: {
    eventId: 'evt-1',
    eventType: 'payment.succeeded' as const,
    idempotencyKey: '00000000-0000-4000-8000-000000000000',
  },
  receivedAt: '2026-08-01T00:00:00.000Z',
  status: 'processed' as const,
  processedAt: '2026-08-01T00:00:01.000Z',
  failureReason: null,
  jobId: '2',
};
describe('AdminWebhooksPage', () => {
  afterEach(() => vi.resetAllMocks());
  it('filters by status', async () => {
    api.getAdminWebhooks.mockResolvedValue({ items: [webhook], total: 1, page: 1, pageSize: 10 });
    const user = userEvent.setup();
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AdminWebhooksPage />
      </MemoryRouter>,
    );
    await user.selectOptions(await screen.findByLabelText('Status'), 'processed');
    expect(api.getAdminWebhooks).toHaveBeenLastCalledWith(
      { status: 'processed', page: 1, pageSize: 10 },
      expect.any(AbortSignal),
    );
  });
  it('renders payload only', async () => {
    api.getAdminWebhook.mockResolvedValue(webhook);
    render(
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        initialEntries={['/admin/webhooks/1']}
      >
        <Routes>
          <Route path="/admin/webhooks/:webhookId" element={<AdminWebhookDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Captured payload')).toBeInTheDocument();
    expect(screen.getByText(/"eventId": "evt-1"/)).toBeInTheDocument();
    expect(screen.queryByText(/signature/i)).not.toBeInTheDocument();
  });
});
