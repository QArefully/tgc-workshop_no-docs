import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrderApproval } from '@shop/contracts/order-approvals';
import { ApprovalsPage } from './ApprovalsPage';
import * as companyApi from '@/api/companyAccounts';
import * as approvalsApi from '@/api/orderApprovals';

vi.mock('@/api/companyAccounts', () => ({ getCompany: vi.fn() }));
vi.mock('@/api/orderApprovals', () => ({
  listApprovals: vi.fn(),
  listMyApprovalRequests: vi.fn(),
  decideApproval: vi.fn(),
}));
const company = {
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
    role: 'approver' as const,
    active: true,
    createdAt: '2026-07-01T00:00:00.000Z',
  },
};
const approval: OrderApproval = {
  id: '4',
  companyId: '1',
  requestedByUserId: '2',
  cartId: '11111111-1111-4111-8111-111111111111',
  idempotencyKey: '22222222-2222-4222-8222-222222222222',
  quoteTotalCents: 51000,
  deliverySiteId: null,
  deliveryAddress: { line1: '1 Yard', city: 'Leeds', postcode: 'LS1 1AA', countryCode: 'GB' },
  billingEntity: {
    legalName: 'Acme',
    registrationNumber: '12345678',
    vatNumber: null,
    address: { line1: '1 Yard', city: 'Leeds', postcode: 'LS1 1AA', countryCode: 'GB' },
  },
  deliverySlot: { date: '2026-08-10', window: 'am' as const },
  purchaseOrderReference: null,
  status: 'pending' as const,
  approvedByUserId: null,
  decisionReason: null,
  requestedAt: '2026-07-01T00:00:00.000Z',
  resolvedAt: null,
  leaseExpiresAt: '2026-07-02T00:00:00.000Z',
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
describe('ApprovalsPage request ordering', () => {
  it('ignores an older decision reload after a newer reload completes', async () => {
    const firstDecision = deferred<typeof approval>();
    const secondDecision = deferred<typeof approval>();
    const staleInbox = deferred<(typeof approval)[]>();
    const latestInbox = deferred<(typeof approval)[]>();
    const secondApproval = { ...approval, id: '5' };
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(companyApi.getCompany).mockResolvedValue(company);
    vi.mocked(approvalsApi.listMyApprovalRequests).mockResolvedValue([]);
    vi.mocked(approvalsApi.decideApproval)
      .mockReturnValueOnce(firstDecision.promise)
      .mockReturnValueOnce(secondDecision.promise);
    vi.mocked(approvalsApi.listApprovals)
      .mockReturnValueOnce(Promise.resolve([approval, secondApproval]))
      .mockReturnValueOnce(staleInbox.promise)
      .mockReturnValueOnce(latestInbox.promise);
    const user = userEvent.setup();
    render(<ApprovalsPage />);
    const approveButtons = await screen.findAllByRole('button', { name: 'Approve' });
    await user.click(approveButtons[0]!);
    await user.click(approveButtons[1]!);
    await waitFor(() => expect(approvalsApi.decideApproval).toHaveBeenCalledTimes(2));
    firstDecision.resolve({
      ...approval,
      status: 'approved',
      approvedByUserId: '1',
      resolvedAt: '2026-07-01T01:00:00.000Z',
    });
    await waitFor(() => expect(approvalsApi.listApprovals).toHaveBeenCalledTimes(2));
    secondDecision.resolve({
      ...secondApproval,
      status: 'approved',
      approvedByUserId: '1',
      resolvedAt: '2026-07-01T01:00:00.000Z',
    });
    await waitFor(() => expect(approvalsApi.listApprovals).toHaveBeenCalledTimes(3));
    latestInbox.resolve([]);
    expect(await screen.findByText('No orders are awaiting your approval.')).toBeInTheDocument();
    staleInbox.resolve([approval]);
    await Promise.resolve();
    expect(screen.getByText('No orders are awaiting your approval.')).toBeInTheDocument();
  });
});
describe('ApprovalsPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(companyApi.getCompany).mockResolvedValue(company);
    vi.mocked(approvalsApi.listApprovals).mockResolvedValue([approval]);
    vi.mocked(approvalsApi.listMyApprovalRequests).mockResolvedValue([]);
  });
  it('shows pending approver work from fetched membership', async () => {
    render(<ApprovalsPage />);
    expect(await screen.findByText('£510.00')).toBeInTheDocument();
  });
  it('confirms then submits a decision once', async () => {
    vi.mocked(approvalsApi.decideApproval).mockResolvedValue({
      ...approval,
      status: 'approved',
      approvedByUserId: '1',
      resolvedAt: '2026-07-01T01:00:00.000Z',
    });
    const user = userEvent.setup();
    render(<ApprovalsPage />);
    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(approvalsApi.decideApproval).toHaveBeenCalledTimes(1));
  });
});
