import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreditAccountMemberView } from '@shop/contracts/trade-credit';
import { CompanyPage } from './CompanyPage';
import * as companyApi from '@/api/companyAccounts';
import { getTradeCreditSummary } from '@/api/tradeCredit';

vi.mock('@/api/companyAccounts', () => ({
  getCompany: vi.fn(),
  createCompany: vi.fn(),
  listMembers: vi.fn(),
  listInvites: vi.fn(),
  inviteMember: vi.fn(),
  revokeInvite: vi.fn(),
  revokeMember: vi.fn(),
  updateMemberRole: vi.fn(),
  updateThreshold: vi.fn(),
}));
vi.mock('@/api/tradeCredit', () => ({ getTradeCreditSummary: vi.fn() }));
const owner = {
  company: {
    id: '1',
    name: 'Acme',
    createdByUserId: '1',
    active: true,
    approvalThresholdCents: 50000,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  },
  membership: {
    id: '1',
    companyId: '1',
    userId: '1',
    role: 'owner' as const,
    active: true,
    createdAt: '2026-07-01T00:00:00.000Z',
  },
};
const creditSummary = {
  companyId: '1',
  state: 'active' as const,
  creditLimitCents: 100_000,
  outstandingCents: 20_000,
  heldCents: 5_000,
  exposureCents: 25_000,
  availableCreditCents: 75_000,
  terms: 'net_30' as const,
  holdReason: null,
  version: 1,
  updatedAt: '2026-07-01T00:00:00.000Z',
} satisfies CreditAccountMemberView;
describe('CompanyPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getTradeCreditSummary).mockResolvedValue(null);
  });
  it('creates a company for a non-member', async () => {
    vi.mocked(companyApi.getCompany).mockResolvedValue(null);
    vi.mocked(companyApi.createCompany).mockResolvedValue(owner);
    const user = userEvent.setup();
    render(<CompanyPage />);
    await user.type(await screen.findByLabelText('Company name'), 'Acme');
    await user.click(screen.getByRole('button', { name: 'Create company' }));
    await waitFor(() => expect(companyApi.createCompany).toHaveBeenCalledWith({ name: 'Acme' }));
  });
  it('shows owner-only invite controls from fetched membership', async () => {
    vi.mocked(companyApi.getCompany).mockResolvedValue(owner);
    vi.mocked(companyApi.listMembers).mockResolvedValue([owner.membership]);
    vi.mocked(companyApi.listInvites).mockResolvedValue([]);
    render(<CompanyPage />);
    expect(await screen.findByRole('heading', { name: 'Invite a member' })).toBeInTheDocument();
  });
  it('shows server credit values for a non-owner company role', async () => {
    vi.mocked(companyApi.getCompany).mockResolvedValue({
      ...owner,
      membership: { ...owner.membership, role: 'buyer' as const },
    });
    vi.mocked(companyApi.listMembers).mockResolvedValue([owner.membership]);
    vi.mocked(getTradeCreditSummary).mockResolvedValue(creditSummary);
    render(<CompanyPage />);
    expect(await screen.findByRole('heading', { name: 'Trade credit' })).toBeInTheDocument();
    expect(screen.getByText('Credit limit (GBP): £1,000.00')).toBeInTheDocument();
    expect(screen.getByText('Available credit (GBP): £750.00')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Invite a member' })).not.toBeInTheDocument();
  });
  it('distinguishes company load failure from no company and retries the primary load', async () => {
    vi.mocked(companyApi.getCompany)
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(null);
    const user = userEvent.setup();
    render(<CompanyPage />);
    expect(await screen.findByText('Unable to load company details.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByText('Join or create a company to view trade-credit details.'),
    ).toBeInTheDocument();
  });
  it('uses exact decimal cents and rejects fractions beyond pence precision', async () => {
    vi.mocked(companyApi.getCompany).mockResolvedValue(owner);
    vi.mocked(companyApi.listMembers).mockResolvedValue([owner.membership]);
    vi.mocked(companyApi.listInvites).mockResolvedValue([]);
    vi.mocked(companyApi.updateThreshold).mockResolvedValue(owner.company);
    const user = userEvent.setup();
    render(<CompanyPage />);
    const input = await screen.findByRole('textbox', { name: /Threshold/ });
    expect(screen.getByText(/GBP/)).toBeInTheDocument();
    await user.clear(input);
    await user.type(input, '1.005');
    await user.click(screen.getByRole('button', { name: 'Save threshold' }));
    expect(companyApi.updateThreshold).not.toHaveBeenCalled();
    await user.clear(input);
    await user.type(input, '1.01');
    await user.click(screen.getByRole('button', { name: 'Save threshold' }));
    await waitFor(() =>
      expect(companyApi.updateThreshold).toHaveBeenCalledWith({ approvalThresholdCents: 101 }),
    );
  });
});
