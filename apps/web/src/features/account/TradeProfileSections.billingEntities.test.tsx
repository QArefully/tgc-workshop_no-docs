import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/client';
import type { BillingEntity } from '@shop/contracts/trade-account';
import {
  createBillingEntity,
  createDeliverySite,
  listBillingEntities,
  listDeliverySites,
  retireBillingEntity,
  retireDeliverySite,
  updateBillingEntity,
  updateDeliverySite,
} from '@/api/tradeAccount';
import {
  SECOND_ENTITY,
  SECOND_SITE,
  TradeProfileHarness,
  billingSection,
  deferred,
  entity,
  fillAddress,
  renderHarness,
  site,
} from './TradeProfileSections.test-fixtures';

interface MockUser {
  id: string;
  email: string;
  displayName: string;
  role: string;
}

const authState = vi.hoisted(() => {
  const state: { user: MockUser | null } = { user: null };
  return state;
});

vi.mock('@/api/tradeAccount', () => ({
  listDeliverySites: vi.fn(),
  createDeliverySite: vi.fn(),
  updateDeliverySite: vi.fn(),
  retireDeliverySite: vi.fn(),
  listBillingEntities: vi.fn(),
  createBillingEntity: vi.fn(),
  updateBillingEntity: vi.fn(),
  retireBillingEntity: vi.fn(),
}));
vi.mock('@/api/auth', () => ({
  changePassword: vi.fn(),
  getMe: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  signup: vi.fn(),
}));
vi.mock('@/hooks/AuthContext', () => ({
  useAuth: () => ({
    user: authState.user,
    loading: false,
    login: vi.fn(),
    signup: vi.fn(),
    logout: vi.fn(),
  }),
}));
vi.mock('@/hooks/useBackInStock', () => ({
  useBackInStock: () => ({
    subscriptions: [],
    pendingVariantIds: new Set<number>(),
    loading: false,
    error: null,
    errorState: null,
    refresh: vi.fn(),
    subscribe: vi.fn(),
    cancel: vi.fn(),
  }),
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listDeliverySites).mockResolvedValue([site(), SECOND_SITE]);
  vi.mocked(listBillingEntities).mockResolvedValue([entity(), SECOND_ENTITY]);
  vi.mocked(createDeliverySite).mockResolvedValue(site());
  vi.mocked(updateDeliverySite).mockResolvedValue(site());
  vi.mocked(retireDeliverySite).mockResolvedValue({ success: true });
  vi.mocked(createBillingEntity).mockResolvedValue(entity());
  vi.mocked(updateBillingEntity).mockResolvedValue(entity());
  vi.mocked(retireBillingEntity).mockResolvedValue({ success: true });
  authState.user = {
    id: '7',
    email: 'buyer@trade.test',
    displayName: 'Buyer',
    role: 'customer',
  };
});

describe('BillingEntitiesSection', () => {
  it('creates a billing entity and omits blank optional identifiers', async () => {
    const user = userEvent.setup();
    await renderHarness();

    const section = billingSection();
    await user.click(within(section).getByRole('button', { name: 'Add billing details' }));
    await user.type(
      within(section).getByLabelText(/Registered company name/),
      'Kiln Lane Supplies Ltd',
    );
    await fillAddress(user, section, { keyboard: true });
    await user.click(within(section).getByRole('button', { name: 'Save billing details' }));

    await waitFor(() =>
      expect(createBillingEntity).toHaveBeenCalledWith({
        legalName: 'Kiln Lane Supplies Ltd',
        address: {
          line1: '2 Kiln Lane',
          city: 'Leeds',
          postcode: 'LS9 8QQ',
          countryCode: 'GB',
        },
        isDefault: false,
      }),
    );
    await waitFor(() => expect(listBillingEntities).toHaveBeenCalledTimes(2));
  });

  it('sends the optional identifiers when the buyer provides them', async () => {
    const user = userEvent.setup();
    await renderHarness();

    const section = billingSection();
    await user.click(within(section).getByRole('button', { name: 'Add billing details' }));
    await user.type(within(section).getByLabelText(/Registered company name/), 'Kiln Lane Ltd');
    await user.type(within(section).getByLabelText(/Company registration number/), '07654321');
    await user.type(within(section).getByLabelText(/VAT number/), 'GB987654321');
    await fillAddress(user, section);
    await user.click(within(section).getByRole('button', { name: 'Save billing details' }));

    await waitFor(() =>
      expect(createBillingEntity).toHaveBeenCalledWith(
        expect.objectContaining({ registrationNumber: '07654321', vatNumber: 'GB987654321' }),
      ),
    );
  });

  it('edits an existing billing entity from a prefilled form', async () => {
    const user = userEvent.setup();
    await renderHarness();

    const section = billingSection();
    await user.click(
      await within(section).findByRole('button', { name: 'Edit Northgate Builders Ltd' }),
    );

    const nameField = within(section).getByLabelText(/Registered company name/);
    expect(nameField).toHaveValue('Northgate Builders Ltd');
    expect(within(section).getByLabelText(/VAT number/)).toHaveValue('GB123456789');
    await user.clear(nameField);
    await user.type(nameField, 'Northgate Builders (UK) Ltd');
    await user.click(within(section).getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(updateBillingEntity).toHaveBeenCalledWith(
        '1',
        expect.objectContaining({
          legalName: 'Northgate Builders (UK) Ltd',
          registrationNumber: '09123456',
        }),
      ),
    );
  });

  it('sends explicit null when the buyer clears a saved identifier', async () => {
    // Clearing the VAT field must reach the server as `vatNumber: null`. Omitting the key would
    // read as "leave it alone": the form would close reporting success while the row kept the old
    // number. The untouched registration number still travels as its value, not as null.
    const user = userEvent.setup();
    await renderHarness();

    const section = billingSection();
    await user.click(
      await within(section).findByRole('button', { name: 'Edit Northgate Builders Ltd' }),
    );

    const vatField = within(section).getByLabelText(/VAT number/);
    expect(vatField).toHaveValue('GB123456789');
    await user.clear(vatField);
    await user.click(within(section).getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(updateBillingEntity).toHaveBeenCalledWith(
        '1',
        expect.objectContaining({ vatNumber: null, registrationNumber: '09123456' }),
      ),
    );
  });

  it('clears both identifiers independently of each other', async () => {
    const user = userEvent.setup();
    await renderHarness();

    const section = billingSection();
    await user.click(
      await within(section).findByRole('button', { name: 'Edit Northgate Builders Ltd' }),
    );
    await user.clear(within(section).getByLabelText(/VAT number/));
    await user.clear(within(section).getByLabelText(/Company registration number/));
    await user.click(within(section).getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(updateBillingEntity).toHaveBeenCalledWith(
        '1',
        expect.objectContaining({ vatNumber: null, registrationNumber: null }),
      ),
    );
  });

  it('retires a billing entity rather than deleting it locally', async () => {
    const user = userEvent.setup();
    await renderHarness();

    const section = billingSection();
    await user.click(
      await within(section).findByRole('button', { name: 'Remove Northgate Builders Ltd' }),
    );

    await waitFor(() => expect(retireBillingEntity).toHaveBeenCalledWith('1'));
    await waitFor(() => expect(listBillingEntities).toHaveBeenCalledTimes(2));
  });

  it('hides retired billing entities returned by the server', async () => {
    vi.mocked(listBillingEntities).mockResolvedValue([
      entity(),
      entity({ id: '3', legalName: 'Dormant Holdings Ltd', isDefault: false, active: false }),
    ]);
    await renderHarness();

    await waitFor(() => expect(screen.getByText('Northgate Builders Ltd')).toBeInTheDocument());
    expect(screen.queryByText('Dormant Holdings Ltd')).not.toBeInTheDocument();
  });

  it('sets a non-default billing entity as the default', async () => {
    const user = userEvent.setup();
    await renderHarness();

    const section = billingSection();
    const buttons = await within(section).findAllByRole('button', { name: 'Set as default' });
    expect(buttons).toHaveLength(1);
    await user.click(buttons[0]!);

    await waitFor(() => expect(updateBillingEntity).toHaveBeenCalledWith('2', { isDefault: true }));
  });

  it('reports field validation messages and sends no request', async () => {
    const user = userEvent.setup();
    await renderHarness();

    const section = billingSection();
    await user.click(within(section).getByRole('button', { name: 'Add billing details' }));
    await user.click(within(section).getByRole('button', { name: 'Save billing details' }));

    expect(
      await within(section).findByText('Registered company name is required'),
    ).toBeInTheDocument();
    expect(within(section).getByText('Address line 1 is required')).toBeInTheDocument();
    expect(createBillingEntity).not.toHaveBeenCalled();
  });

  it('shows a load failure with a working retry', async () => {
    const user = userEvent.setup();
    vi.mocked(listBillingEntities)
      .mockRejectedValueOnce(new ApiError('Request failed', 500, { error: 'Billing unavailable' }))
      .mockResolvedValue([entity()]);

    await renderHarness();

    const section = billingSection();
    expect(await within(section).findByText('Unable to load billing details')).toBeInTheDocument();
    await user.click(within(section).getByRole('button', { name: 'Try again' }));

    await waitFor(() =>
      expect(within(section).getByText('Northgate Builders Ltd')).toBeInTheDocument(),
    );
  });

  it('surfaces a row action failure without clearing the list', async () => {
    const user = userEvent.setup();
    vi.mocked(retireBillingEntity).mockRejectedValue(
      new ApiError('Request failed', 409, { error: 'Billing party is on an open invoice' }),
    );
    await renderHarness();

    const section = billingSection();
    await user.click(
      await within(section).findByRole('button', { name: 'Remove Northgate Builders Ltd' }),
    );

    expect(await within(section).findByText('Action failed')).toBeInTheDocument();
    expect(within(section).getByText('Northgate Builders Ltd')).toBeInTheDocument();
  });

  it('discards a superseded in-flight list response', async () => {
    const user = userEvent.setup();
    const stale = deferred<BillingEntity[]>();
    vi.mocked(listBillingEntities)
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValue([entity({ id: '9', legalName: 'Fresh Trading Ltd' })]);

    render(<TradeProfileHarness />);
    await waitFor(() => expect(listBillingEntities).toHaveBeenCalledTimes(1));

    const section = billingSection();
    await user.click(within(section).getByRole('button', { name: 'Add billing details' }));
    await user.type(within(section).getByLabelText(/Registered company name/), 'Fresh Trading Ltd');
    await fillAddress(user, section);
    await user.click(within(section).getByRole('button', { name: 'Save billing details' }));

    await waitFor(() => expect(within(section).getByText('Fresh Trading Ltd')).toBeInTheDocument());

    await act(async () => {
      stale.resolve([entity({ id: '99', legalName: 'Stale Trading Ltd' })]);
      await stale.promise;
    });

    expect(within(section).queryByText('Stale Trading Ltd')).not.toBeInTheDocument();
    expect(within(section).getByText('Fresh Trading Ltd')).toBeInTheDocument();
  });

  it('gives every field in the create form an accessible label', async () => {
    const user = userEvent.setup();
    await renderHarness();

    const section = billingSection();
    await user.click(within(section).getByRole('button', { name: 'Add billing details' }));

    const form = within(section)
      .getByRole('button', { name: 'Save billing details' })
      .closest('form');
    expect(form).not.toBeNull();
    for (const field of Array.from(form!.querySelectorAll('input'))) {
      expect(field).toHaveAccessibleName();
    }
    expect(within(section).getByLabelText('Use as my default billing details')).toBeInTheDocument();
  });
});
