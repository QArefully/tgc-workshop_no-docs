import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DataExportResponse,
  SessionSummary,
  UserPreferences,
} from '@shop/contracts/account-depth';
import { ApiError } from '@/api/client';
import { exportAccountData } from '@/api/accountExport';
import { deleteAccount } from '@/api/accountDeletion';
import { getAccountPreferences, updateAccountPreferences } from '@/api/accountPreferences';
import { listAccountSessions, revokeAccountSession } from '@/api/accountSessions';
import { DataExportSection } from './DataExportSection';
import { DeleteAccountSection } from './DeleteAccountSection';
import { PreferencesSection } from './PreferencesSection';
import { SessionsSection } from './SessionsSection';

vi.mock('@/api/accountSessions', () => ({
  listAccountSessions: vi.fn(),
  revokeAccountSession: vi.fn(),
}));
vi.mock('@/api/accountPreferences', () => ({
  getAccountPreferences: vi.fn(),
  updateAccountPreferences: vi.fn(),
}));
vi.mock('@/api/accountExport', () => ({ exportAccountData: vi.fn() }));
vi.mock('@/api/accountDeletion', () => ({ deleteAccount: vi.fn() }));

const logout = vi.fn();
vi.mock('@/hooks/AuthContext', () => ({ useAuth: () => ({ logout }) }));

const NOW = '2026-07-29T10:00:00.000Z';
const SESSION: SessionSummary = {
  sessionId: '0123456789ab',
  createdAt: NOW,
  expiresAt: NOW,
  lastSeenAt: NOW,
  userAgent: 'Desktop',
  ipAddressHash: null,
  isCurrent: false,
};
const CURRENT_SESSION: SessionSummary = { ...SESSION, sessionId: 'abcdef012345', isCurrent: true };
const SECOND_SESSION: SessionSummary = { ...SESSION, sessionId: 'fedcba987654' };
const PREFERENCES: UserPreferences = {
  orderUpdatesEmail: true,
  marketingEmail: false,
  approvalRequestEmail: true,
};

function exportData(): DataExportResponse {
  return {
    exportedAt: NOW,
    profile: {
      id: '1',
      email: 'buyer@example.test',
      displayName: 'Buyer',
      role: 'customer',
      country: 'UK',
    },
    deliverySites: [],
    billingEntities: [],
    orders: [],
    savedLists: [],
    customBlends: [],
    sessions: [],
    preferences: PREFERENCES,
    companyMemberships: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  logout.mockResolvedValue(undefined);
  vi.mocked(listAccountSessions).mockResolvedValue([SESSION, CURRENT_SESSION]);
  vi.mocked(revokeAccountSession).mockResolvedValue({ success: true });
  vi.mocked(getAccountPreferences).mockResolvedValue(PREFERENCES);
  vi.mocked(updateAccountPreferences).mockImplementation((body) =>
    Promise.resolve({ ...PREFERENCES, ...body }),
  );
  vi.mocked(exportAccountData).mockResolvedValue(exportData());
  vi.mocked(deleteAccount).mockResolvedValue({ success: true });
});

describe('SessionsSection', () => {
  it('reconciles an optimistic revoke against a fresh session list and identifies current session accessibly', async () => {
    const user = userEvent.setup();
    vi.mocked(listAccountSessions)
      .mockResolvedValueOnce([SESSION, CURRENT_SESSION])
      .mockResolvedValueOnce([CURRENT_SESSION]);
    render(<SessionsSection />);
    expect(await screen.findByText('Signed-in session')).toBeInTheDocument();
    const currentButton = screen.getAllByRole('button', { name: 'Sign out this session' })[1]!;
    expect(currentButton).toBeDisabled();
    expect(currentButton).toHaveAccessibleDescription(
      'This is your current session and cannot be signed out here.',
    );
    await user.click(screen.getAllByRole('button', { name: 'Sign out this session' })[0]!);
    await waitFor(() => expect(revokeAccountSession).toHaveBeenCalledWith(SESSION.sessionId));
    await waitFor(() => expect(listAccountSessions).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Signed-in session')).not.toBeInTheDocument();
  });

  it('restores the optimistic session list when revocation fails', async () => {
    const user = userEvent.setup();
    vi.mocked(revokeAccountSession).mockRejectedValue(
      new ApiError('Request failed', 409, { error: 'Session no longer exists' }),
    );
    render(<SessionsSection />);
    await screen.findByText('Signed-in session');
    await user.click(screen.getAllByRole('button', { name: 'Sign out this session' })[0]!);
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to sign out this session');
    expect(screen.getByText('Signed-in session')).toBeInTheDocument();
  });

  it('blocks overlapping revokes so a rollback cannot restore another deleted session', async () => {
    const user = userEvent.setup();
    let resolveRevoke: ((result: { success: true }) => void) | undefined;
    vi.mocked(listAccountSessions)
      .mockResolvedValueOnce([SESSION, SECOND_SESSION, CURRENT_SESSION])
      .mockResolvedValueOnce([SECOND_SESSION, CURRENT_SESSION]);
    vi.mocked(revokeAccountSession).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRevoke = resolve;
        }),
    );
    render(<SessionsSection />);
    const buttons = await screen.findAllByRole('button', { name: 'Sign out this session' });
    await user.click(buttons[0]!);
    await waitFor(() => expect(revokeAccountSession).toHaveBeenCalledWith(SESSION.sessionId));
    expect(buttons[1]).toBeDisabled();
    await user.click(buttons[1]!);
    expect(revokeAccountSession).toHaveBeenCalledOnce();
    resolveRevoke?.({ success: true });
    await waitFor(() => expect(listAccountSessions).toHaveBeenCalledTimes(2));
    expect(screen.getAllByText('Signed-in session')).toHaveLength(1);
  });

  it('keeps a committed optimistic revoke removed when reconciliation fails', async () => {
    const user = userEvent.setup();
    vi.mocked(listAccountSessions)
      .mockResolvedValueOnce([SESSION, CURRENT_SESSION])
      .mockRejectedValueOnce(new Error('Unable to refresh sessions'));
    render(<SessionsSection />);
    await screen.findByText('Signed-in session');
    expect(screen.getAllByText(/Desktop · Last active/)).toHaveLength(2);
    await user.click(screen.getAllByRole('button', { name: 'Sign out this session' })[0]!);
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load signed-in sessions');
    expect(screen.queryByText('Signed-in session')).not.toBeInTheDocument();
  });
});

describe('PreferencesSection', () => {
  it('patches a toggled preference', async () => {
    const user = userEvent.setup();
    render(<PreferencesSection />);
    const checkbox = await screen.findByRole('checkbox', { name: 'Product and offer emails' });
    await user.click(checkbox);
    await waitFor(() =>
      expect(updateAccountPreferences).toHaveBeenCalledWith({ marketingEmail: true }),
    );
    expect(checkbox).toBeChecked();
  });

  it('shows a failure banner and restores the prior preference', async () => {
    const user = userEvent.setup();
    vi.mocked(updateAccountPreferences).mockRejectedValue(
      new ApiError('Request failed', 500, { error: 'Preferences unavailable' }),
    );
    render(<PreferencesSection />);
    const checkbox = await screen.findByRole('checkbox', { name: 'Product and offer emails' });
    await user.click(checkbox);
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to save preferences');
    expect(checkbox).not.toBeChecked();
  });

  it('disables every preference control during a patch to prevent stale overlapping responses', async () => {
    const user = userEvent.setup();
    let resolveUpdate: ((result: UserPreferences) => void) | undefined;
    vi.mocked(updateAccountPreferences).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpdate = resolve;
        }),
    );
    render(<PreferencesSection />);
    const marketing = await screen.findByRole('checkbox', { name: 'Product and offer emails' });
    const approval = screen.getByRole('checkbox', { name: 'Approval request emails' });
    await user.click(marketing);
    await waitFor(() => expect(updateAccountPreferences).toHaveBeenCalledOnce());
    expect(marketing).toBeDisabled();
    expect(approval).toBeDisabled();
    await user.click(approval);
    expect(updateAccountPreferences).toHaveBeenCalledOnce();
    resolveUpdate?.({ ...PREFERENCES, marketingEmail: true });
    await waitFor(() => expect(marketing).toBeChecked());
    expect(approval).toBeChecked();
  });
});

describe('DataExportSection', () => {
  it('downloads validated export JSON and confirms mailbox delivery', async () => {
    const user = userEvent.setup();
    const createObjectUrl = vi.fn(() => 'blob:test');
    const revokeObjectUrl = vi.fn();
    Object.defineProperties(URL, {
      createObjectURL: { configurable: true, value: createObjectUrl },
      revokeObjectURL: { configurable: true, value: revokeObjectUrl },
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    render(<DataExportSection />);
    await user.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(exportAccountData).toHaveBeenCalledOnce());
    expect(createObjectUrl).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:test');
    expect(await screen.findByRole('status')).toHaveTextContent('mailbox');
  });

  it('shows an export error', async () => {
    const user = userEvent.setup();
    vi.mocked(exportAccountData).mockRejectedValue(new Error('Export unavailable'));
    render(<DataExportSection />);
    await user.click(screen.getByRole('button', { name: 'Download' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to download your export');
  });
});

describe('DeleteAccountSection', () => {
  it('requires confirmation then logs out after successful deletion', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <DeleteAccountSection />
      </MemoryRouter>,
    );
    await user.type(screen.getByLabelText('Current password'), 'password123');
    await user.type(
      screen.getByLabelText('Type “delete my account” to confirm'),
      'delete my account',
    );
    await user.click(screen.getByRole('button', { name: 'Delete account' }));
    await waitFor(() =>
      expect(deleteAccount).toHaveBeenCalledWith({ currentPassword: 'password123' }),
    );
    expect(logout).toHaveBeenCalledOnce();
  });

  it('explains why a company owner cannot delete their account', async () => {
    const user = userEvent.setup();
    vi.mocked(deleteAccount).mockRejectedValue(
      new ApiError('Request failed', 409, {
        error: 'Transfer company ownership before deleting this account',
        code: 'OWNS_COMPANY',
      }),
    );
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <DeleteAccountSection />
      </MemoryRouter>,
    );
    await user.type(screen.getByLabelText('Current password'), 'password123');
    await user.type(
      screen.getByLabelText('Type “delete my account” to confirm'),
      'delete my account',
    );
    await user.click(screen.getByRole('button', { name: 'Delete account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Transfer company ownership');
    expect(logout).not.toHaveBeenCalled();
  });

  it('redirects after committed deletion when logout transport fails', async () => {
    const user = userEvent.setup();
    logout.mockRejectedValue(new Error('Logout unavailable'));
    render(
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        initialEntries={['/account']}
      >
        <Routes>
          <Route path="/account" element={<DeleteAccountSection />} />
          <Route path="/" element={<p>Signed out</p>} />
        </Routes>
      </MemoryRouter>,
    );
    await user.type(screen.getByLabelText('Current password'), 'password123');
    await user.type(screen.getByLabelText(/delete my account/), 'delete my account');
    await user.click(screen.getByRole('button', { name: 'Delete account' }));
    expect(await screen.findByText('Signed out')).toBeInTheDocument();
    expect(logout).toHaveBeenCalledOnce();
  });
});
