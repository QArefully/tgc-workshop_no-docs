import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminFeatureFlagsPage } from './AdminFeatureFlagsPage';
const api = vi.hoisted(() => ({
  getAdminFeatureFlags: vi.fn(),
  createAdminFeatureFlag: vi.fn(),
  updateAdminFeatureFlag: vi.fn(),
  deleteAdminFeatureFlag: vi.fn(),
}));
vi.mock('@/api/adminFeatureFlags', () => api);
const flag = {
  key: 'checkout.new',
  description: 'New checkout',
  enabled: false,
  updatedAt: '2026-07-14T00:00:00.000Z',
  updatedByUserId: '1',
};
const createdFlag = {
  key: 'orders.beta',
  description: 'Order beta rollout',
  enabled: false,
  updatedAt: '2026-07-14T00:00:00.000Z',
  updatedByUserId: '1',
};
describe('AdminFeatureFlagsPage', () => {
  afterEach(() => vi.resetAllMocks());
  it('creates, toggles and deletes a flag', async () => {
    api.getAdminFeatureFlags
      .mockResolvedValueOnce({ items: [flag] })
      .mockResolvedValue({ items: [flag, createdFlag] });
    api.updateAdminFeatureFlag.mockResolvedValue({ ...flag, enabled: true });
    api.deleteAdminFeatureFlag.mockResolvedValue({ ok: true });
    api.createAdminFeatureFlag.mockResolvedValue(createdFlag);
    const events = userEvent.setup();
    render(<AdminFeatureFlagsPage />);
    expect(await screen.findByText('checkout.new')).toBeInTheDocument();
    await events.type(screen.getByLabelText('Flag key'), 'orders.beta');
    await events.type(screen.getByLabelText('Description'), 'Order beta rollout');
    await events.click(screen.getByRole('button', { name: 'Create flag' }));
    expect(api.createAdminFeatureFlag).toHaveBeenCalledWith({
      key: 'orders.beta',
      description: 'Order beta rollout',
      enabled: false,
    });
    expect(await screen.findByText('orders.beta')).toBeInTheDocument();
    await events.click(screen.getByLabelText('Enable checkout.new'));
    expect(api.updateAdminFeatureFlag).toHaveBeenCalledWith('checkout.new', { enabled: true });
    const [deleteButton] = screen.getAllByRole('button', { name: 'Delete' });
    if (!deleteButton) throw new Error('Expected a delete button');
    await events.click(deleteButton);
    expect(api.deleteAdminFeatureFlag).toHaveBeenCalledWith('checkout.new');
  });
});
