import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/i18n/LocaleContext';
import { AdminIndexPage } from '../AdminIndexPage';
import { AdminLayout } from '../AdminLayout';
import { AdminFeatureFlagsPage } from '../featureFlags/AdminFeatureFlagsPage';
import { AdminJobDetailPage } from './AdminJobDetailPage';
import { AdminWebhookDetailPage } from '../webhooks/AdminWebhookDetailPage';

const countryState = vi.hoisted(() => ({ activeCountry: 'DE' as const }));
vi.mock('@/hooks/CountryContext', () => ({
  useCountry: () => ({
    activeCountry: countryState.activeCountry,
    isAccountBound: false,
    selectCountry: vi.fn(),
    countryStorage: null,
  }),
}));

const api = vi.hoisted(() => ({
  getAdminJob: vi.fn(),
  retryAdminJob: vi.fn(),
  getAdminWebhook: vi.fn(),
  getAdminFeatureFlags: vi.fn(),
  createAdminFeatureFlag: vi.fn(),
  updateAdminFeatureFlag: vi.fn(),
  deleteAdminFeatureFlag: vi.fn(),
}));
vi.mock('@/api/adminJobs', () => ({
  getAdminJob: api.getAdminJob,
  retryAdminJob: api.retryAdminJob,
}));
vi.mock('@/api/adminWebhooks', () => ({ getAdminWebhook: api.getAdminWebhook }));
vi.mock('@/api/adminFeatureFlags', () => ({
  getAdminFeatureFlags: api.getAdminFeatureFlags,
  createAdminFeatureFlag: api.createAdminFeatureFlag,
  updateAdminFeatureFlag: api.updateAdminFeatureFlag,
  deleteAdminFeatureFlag: api.deleteAdminFeatureFlag,
}));

const detail = {
  id: '1',
  kind: 'webhook.process' as const,
  dedupeKey: null,
  payload: { eventId: 'evt-1' },
  status: 'dead' as const,
  attempts: 5,
  maxAttempts: 5,
  runAt: '2026-08-01T00:00:00.000Z',
  leaseExpiresAt: null,
  lastError: 'handler failed',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
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
  failureReason: 'signature mismatch',
  jobId: '2',
};

function withLocale(children: React.ReactNode) {
  return <LocaleProvider>{children}</LocaleProvider>;
}

describe('admin diagnostics localisation', () => {
  afterEach(() => vi.resetAllMocks());

  it('keeps all nine admin sections reachable while translating shell labels', () => {
    render(
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        initialEntries={['/admin']}
      >
        <Routes>
          <Route path="/admin" element={withLocale(<AdminLayout />)}>
            <Route index element={<AdminIndexPage />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    const navigation = screen.getByRole('navigation', { name: 'Administration' });
    for (const label of [
      'Übersicht',
      'Produkte',
      'Varianten',
      'Aktionen',
      'Benutzer',
      'Bestellungen',
      'Jobs',
      'Webhooks',
      'Feature-Flags',
      'Bewertungsmoderation',
    ]) {
      expect(navigation).toHaveTextContent(label);
    }
  });

  it('translates job actions/statuses and formats instants while preserving raw errors', async () => {
    api.getAdminJob.mockResolvedValue(detail);
    api.retryAdminJob.mockResolvedValue({ ...detail, status: 'pending' });
    const user = userEvent.setup();
    render(
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        initialEntries={['/admin/jobs/1']}
      >
        <Routes>
          <Route path="/admin/jobs/:jobId" element={withLocale(<AdminJobDetailPage />)} />
        </Routes>
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole('button', { name: 'Toten Job erneut versuchen' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Fehlgeschlagen/)).toBeInTheDocument();
    expect(screen.getAllByText(/handler failed/)).toHaveLength(2);
    expect(screen.queryByText(/2026-08-01T00:00:00.000Z/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Toten Job erneut versuchen' }));
    expect(await screen.findByText('Job wurde erneut eingereiht.')).toBeInTheDocument();
  });

  it('translates webhook status/actions and keeps payload and failure text raw', async () => {
    api.getAdminWebhook.mockResolvedValue(webhook);
    render(
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        initialEntries={['/admin/webhooks/1']}
      >
        <Routes>
          <Route
            path="/admin/webhooks/:webhookId"
            element={withLocale(<AdminWebhookDetailPage />)}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/Verarbeitet:/)).toBeInTheDocument();
    expect(screen.getByText(/signature mismatch/)).toBeInTheDocument();
    expect(screen.getByText(/"eventId": "evt-1"/)).toBeInTheDocument();
    expect(screen.queryByText(/2026-08-01T00:00:00.000Z/)).not.toBeInTheDocument();
  });

  it('translates feature-flag controls while keeping operator key text unchanged', async () => {
    api.getAdminFeatureFlags.mockResolvedValue({
      items: [
        {
          key: 'admin.example_flag',
          description: 'Operator description',
          enabled: false,
          updatedAt: '2026-08-01T00:00:00.000Z',
          updatedByUserId: '1',
        },
      ],
    });
    api.updateAdminFeatureFlag.mockResolvedValue({});
    render(withLocale(<AdminFeatureFlagsPage />));

    expect(await screen.findByText('admin.example_flag')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Flag erstellen' })).toBeInTheDocument();
    expect(screen.getByText('Aktiviert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeInTheDocument();
  });
});
