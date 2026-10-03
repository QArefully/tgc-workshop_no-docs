import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeliverySite } from '@shop/contracts/trade-account';
import { ApiError } from '@/api/client';
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
  deferred,
  deliverySection,
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

describe('DeliverySitesSection', () => {
  it('creates a delivery site and reloads the list', async () => {
    const user = userEvent.setup();
    await renderHarness();

    const section = deliverySection();
    await user.click(within(section).getByRole('button', { name: 'Add delivery site' }));
    await user.type(within(section).getByLabelText('Site name'), 'West depot');
    await user.type(within(section).getByLabelText('Contact name'), 'Sam Ali');
    await user.type(within(section).getByLabelText('Contact phone'), '01133 999888');
    await fillAddress(user, section, { keyboard: true });
    await user.click(within(section).getByRole('button', { name: 'Save delivery site' }));

    await waitFor(() =>
      expect(createDeliverySite).toHaveBeenCalledWith({
        label: 'West depot',
        contactName: 'Sam Ali',
        contactPhone: '01133 999888',
        address: {
          line1: '2 Kiln Lane',
          city: 'Leeds',
          postcode: 'LS9 8QQ',
          countryCode: 'GB',
        },
        isDefault: false,
      }),
    );
    await waitFor(() => expect(listDeliverySites).toHaveBeenCalledTimes(2));
  });

  it('edits an existing delivery site from a prefilled form', async () => {
    const user = userEvent.setup();
    await renderHarness();

    const section = deliverySection();
    await user.click(await within(section).findByRole('button', { name: 'Edit Main yard' }));

    const labelField = within(section).getByLabelText('Site name');
    expect(labelField).toHaveValue('Main yard');
    await user.clear(labelField);
    await user.type(labelField, 'Main yard east');
    await user.click(within(section).getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(updateDeliverySite).toHaveBeenCalledWith(
        '1',
        expect.objectContaining({ label: 'Main yard east', contactName: 'Dana Reed' }),
      ),
    );
  });

  it('retires a delivery site rather than deleting it locally', async () => {
    const user = userEvent.setup();
    await renderHarness();

    const section = deliverySection();
    await user.click(await within(section).findByRole('button', { name: 'Remove Main yard' }));

    await waitFor(() => expect(retireDeliverySite).toHaveBeenCalledWith('1'));
    await waitFor(() => expect(listDeliverySites).toHaveBeenCalledTimes(2));
  });

  it('hides retired sites returned by the server', async () => {
    vi.mocked(listDeliverySites).mockResolvedValue([
      site(),
      site({ id: '3', label: 'Closed yard', isDefault: false, active: false }),
    ]);
    await renderHarness();

    await waitFor(() => expect(screen.getByText('Main yard')).toBeInTheDocument());
    expect(screen.queryByText('Closed yard')).not.toBeInTheDocument();
  });

  it('sets a non-default site as the default and offers the action only on non-defaults', async () => {
    const user = userEvent.setup();
    await renderHarness();

    const section = deliverySection();
    const buttons = await within(section).findAllByRole('button', { name: 'Set as default' });
    expect(buttons).toHaveLength(1);
    await user.click(buttons[0]!);

    await waitFor(() => expect(updateDeliverySite).toHaveBeenCalledWith('2', { isDefault: true }));
  });

  it('reports field validation messages and sends no request', async () => {
    const user = userEvent.setup();
    await renderHarness();

    const section = deliverySection();
    await user.click(within(section).getByRole('button', { name: 'Add delivery site' }));
    await user.click(within(section).getByRole('button', { name: 'Save delivery site' }));

    expect(await within(section).findByText('Site name is required')).toBeInTheDocument();
    expect(within(section).getByText('Contact name is required')).toBeInTheDocument();
    expect(within(section).getByText('Contact phone is required')).toBeInTheDocument();
    expect(within(section).getByText('Address line 1 is required')).toBeInTheDocument();
    expect(within(section).getByText('City is required')).toBeInTheDocument();
    expect(within(section).getByText('Postcode is required')).toBeInTheDocument();
    expect(createDeliverySite).not.toHaveBeenCalled();
  });

  it('rejects a whitespace-only site name', async () => {
    const user = userEvent.setup();
    await renderHarness();

    const section = deliverySection();
    await user.click(within(section).getByRole('button', { name: 'Add delivery site' }));
    await user.type(within(section).getByLabelText('Site name'), '   ');
    await user.click(within(section).getByRole('button', { name: 'Save delivery site' }));

    expect(await within(section).findByText('Site name is required')).toBeInTheDocument();
    expect(createDeliverySite).not.toHaveBeenCalled();
  });

  it('rejects a contact phone outside the accepted bounds', async () => {
    const user = userEvent.setup();
    await renderHarness();

    const section = deliverySection();
    await user.click(within(section).getByRole('button', { name: 'Add delivery site' }));
    await user.type(within(section).getByLabelText('Contact phone'), '123');
    await user.click(within(section).getByRole('button', { name: 'Save delivery site' }));

    expect(
      await within(section).findByText('Contact phone must be 5-32 characters'),
    ).toBeInTheDocument();
  });

  it('rejects a digit-free contact phone before it reaches the server', async () => {
    // '+()- ' clears the length bound and the allowed character set, so only the digit requirement
    // stops it. The contract enforces the same rule, so passing here would mean a 400 round-trip
    // instead of a field-level message.
    const user = userEvent.setup();
    await renderHarness();

    const section = deliverySection();
    await user.click(within(section).getByRole('button', { name: 'Add delivery site' }));
    await user.type(within(section).getByLabelText('Contact phone'), '+()- ()');
    await user.click(within(section).getByRole('button', { name: 'Save delivery site' }));

    expect(
      await within(section).findByText('Contact phone must include at least one digit'),
    ).toBeInTheDocument();
    expect(createDeliverySite).not.toHaveBeenCalled();
  });

  it('renders a site with no contact phone without an empty separator', async () => {
    // contactPhone is optional on the contract because the column is nullable; an absent one must
    // render as just the contact name, with no dangling ' Â· '.
    const phoneless = site({ id: '3', label: 'Quiet yard', isDefault: false });
    delete (phoneless as { contactPhone?: string }).contactPhone;
    vi.mocked(listDeliverySites).mockResolvedValue([phoneless]);
    await renderHarness();

    const section = deliverySection();
    expect(await within(section).findByText('Dana Reed')).toBeInTheDocument();
    expect(within(section).queryByText(/Â·/)).not.toBeInTheDocument();
  });

  it('rejects a country code that is not two letters', async () => {
    const user = userEvent.setup();
    await renderHarness();

    const section = deliverySection();
    await user.click(within(section).getByRole('button', { name: 'Add delivery site' }));
    await user.clear(within(section).getByLabelText('Country code'));
    await user.type(within(section).getByLabelText('Country code'), 'G');
    await user.click(within(section).getByRole('button', { name: 'Save delivery site' }));

    expect(
      await within(section).findByText('Country code must be two letters, for example GB'),
    ).toBeInTheDocument();
  });

  it('shows a load failure with a working retry', async () => {
    const user = userEvent.setup();
    vi.mocked(listDeliverySites)
      .mockRejectedValueOnce(new ApiError('Request failed', 500, { error: 'Sites unavailable' }))
      .mockResolvedValue([site()]);

    await renderHarness();

    const section = deliverySection();
    expect(await within(section).findByText('Unable to load delivery sites')).toBeInTheDocument();
    await user.click(within(section).getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(within(section).getByText('Main yard')).toBeInTheDocument());
    expect(within(section).queryByText('Unable to load delivery sites')).not.toBeInTheDocument();
  });

  it('surfaces a row action failure without clearing the list', async () => {
    const user = userEvent.setup();
    vi.mocked(retireDeliverySite).mockRejectedValue(
      new ApiError('Request failed', 409, { error: 'Site is on an open order' }),
    );
    await renderHarness();

    const section = deliverySection();
    await user.click(await within(section).findByRole('button', { name: 'Remove Main yard' }));

    expect(await within(section).findByText('Action failed')).toBeInTheDocument();
    expect(within(section).getByText('Main yard')).toBeInTheDocument();
  });

  it('discards a superseded in-flight list response', async () => {
    const user = userEvent.setup();
    const stale = deferred<DeliverySite[]>();
    vi.mocked(listDeliverySites)
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValue([site({ id: '9', label: 'Fresh yard' })]);

    render(<TradeProfileHarness />);
    await waitFor(() => expect(listDeliverySites).toHaveBeenCalledTimes(1));

    // A create finishes first and triggers the newer read.
    const section = deliverySection();
    await user.click(within(section).getByRole('button', { name: 'Add delivery site' }));
    await user.type(within(section).getByLabelText('Site name'), 'Fresh yard');
    await user.type(within(section).getByLabelText('Contact name'), 'Sam Ali');
    await user.type(within(section).getByLabelText('Contact phone'), '01133 999888');
    await fillAddress(user, section);
    await user.click(within(section).getByRole('button', { name: 'Save delivery site' }));

    await waitFor(() => expect(within(section).getByText('Fresh yard')).toBeInTheDocument());

    // The original slow read now resolves. It must not overwrite the newer list.
    await act(async () => {
      stale.resolve([site({ id: '99', label: 'Stale yard' })]);
      await stale.promise;
    });

    expect(within(section).queryByText('Stale yard')).not.toBeInTheDocument();
    expect(within(section).getByText('Fresh yard')).toBeInTheDocument();
  });

  it('gives every field in the create form an accessible label', async () => {
    const user = userEvent.setup();
    await renderHarness();

    const section = deliverySection();
    await user.click(within(section).getByRole('button', { name: 'Add delivery site' }));

    const form = within(section)
      .getByRole('button', { name: 'Save delivery site' })
      .closest('form');
    expect(form).not.toBeNull();
    for (const field of Array.from(form!.querySelectorAll('input'))) {
      expect(field).toHaveAccessibleName();
    }
    expect(within(section).getByLabelText('Use as my default delivery site')).toBeInTheDocument();
  });
});
