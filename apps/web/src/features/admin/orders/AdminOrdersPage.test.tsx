import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Country } from '@shop/contracts/country';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/client';
import { LocaleProvider } from '@/i18n/LocaleContext';
import { AdminOrdersPage } from './AdminOrdersPage';

const countryState: { activeCountry: Country } = vi.hoisted(() => ({ activeCountry: 'US' }));

vi.mock('@/hooks/CountryContext', () => ({
  useCountry: () => ({ activeCountry: countryState.activeCountry }),
}));

const api = vi.hoisted(() => ({
  getAdminOrders: vi.fn(),
  getAdminOrder: vi.fn(),
  createAdminRefund: vi.fn(),
}));
vi.mock('@/api/adminOrders', () => ({
  getAdminOrders: api.getAdminOrders,
  getAdminOrder: api.getAdminOrder,
}));
vi.mock('@/api/adminRefunds', () => ({ createAdminRefund: api.createAdminRefund }));

const detail = {
  id: '1',
  status: 'processing' as const,
  version: 0,
  items: [],
  subtotalCents: 1000,
  discountCents: 0,
  totalCents: 1000,
  promoApplied: null,
  createdAt: '2026-07-14T00:00:00.000Z',
  shipments: [],
  events: [],
  canCancel: true,
  refundPayment: { paymentId: '9', remainingRefundableCents: 500 },
};
const orders = [
  {
    id: '1',
    status: 'processing',
    version: 0,
    totalCents: 1000,
    totalItems: 0,
    hasBackorder: false,
    createdAt: '2026-07-14T00:00:00.000Z',
    promoCode: null,
    buyer: { id: '2', email: 'buyer@example.test', name: 'Buyer' },
  },
  {
    id: '2',
    status: 'processing',
    version: 0,
    totalCents: 1000,
    totalItems: 0,
    hasBackorder: false,
    createdAt: '2026-07-14T00:00:00.000Z',
    promoCode: null,
    buyer: { id: '3', email: 'other@example.test', name: 'Other' },
  },
];
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
function list(items = [orders[0]]) {
  return { items, total: items.length, page: 1, pageSize: 10 };
}

function renderPage() {
  return render(
    <LocaleProvider>
      <AdminOrdersPage />
    </LocaleProvider>,
  );
}

describe('AdminOrdersPage', () => {
  afterEach(() => {
    countryState.activeCountry = 'US';
    vi.resetAllMocks();
  });

  it('submits one refund operation while a prior submit is in flight', async () => {
    const refund = deferred<void>();
    api.getAdminOrders.mockResolvedValue(list());
    api.getAdminOrder.mockResolvedValue(detail);
    api.createAdminRefund.mockReturnValue(refund.promise);
    const events = userEvent.setup();
    renderPage();
    await events.click(await screen.findByRole('button', { name: 'View detail' }));
    await screen.findByRole('heading', { name: 'Create refund' });
    await events.type(screen.getByRole('spinbutton'), '5');
    await events.type(screen.getByLabelText('Reason'), 'Duplicate');
    const submit = screen.getByRole('button', { name: 'Create refund' });
    await events.click(submit);
    await events.click(submit);
    expect(api.createAdminRefund).toHaveBeenCalledTimes(1);
    expect(api.createAdminRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: '1',
        paymentId: '9',
        amountCents: 500,
        reason: 'Duplicate',
        idempotencyKey: expect.any(String) as unknown,
      }),
    );
    await act(async () => {
      refund.resolve();
      await refund.promise;
    });
  });

  it('blocks a refund that exceeds the prior-refund remaining balance', async () => {
    api.getAdminOrders.mockResolvedValue(list());
    api.getAdminOrder.mockResolvedValue(detail);
    const events = userEvent.setup();
    renderPage();
    await events.click(await screen.findByRole('button', { name: 'View detail' }));
    await screen.findByRole('heading', { name: 'Create refund' });
    await events.type(screen.getByRole('spinbutton'), '5.01');
    await events.type(screen.getByLabelText('Reason'), 'Over remaining balance');
    await events.click(screen.getByRole('button', { name: 'Create refund' }));
    expect(api.createAdminRefund).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Refund amount exceeds the remaining refundable balance of £5.00.',
    );
  });

  it('keeps the latest order detail when requests resolve out of order', async () => {
    const first = deferred<typeof detail>();
    const second = deferred<typeof detail>();
    api.getAdminOrders.mockResolvedValue(list(orders));
    api.getAdminOrder.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const events = userEvent.setup();
    renderPage();
    const buttons = await screen.findAllByRole('button', { name: 'View detail' });
    const [firstButton, secondButton] = buttons;
    if (!firstButton || !secondButton) throw new Error('Expected two order detail buttons');
    await events.click(firstButton);
    await events.click(secondButton);
    second.resolve({ ...detail, id: '2' });
    expect(await screen.findByRole('heading', { name: 'Order #2' })).toBeInTheDocument();
    first.resolve(detail);
    expect(screen.getByRole('heading', { name: 'Order #2' })).toBeInTheDocument();
  });

  it('localizes non-UK money and shows authoritative GBP balance beside it', async () => {
    countryState.activeCountry = 'US';
    api.getAdminOrders.mockResolvedValue(list());
    api.getAdminOrder.mockResolvedValue(detail);
    const events = userEvent.setup();
    renderPage();

    await events.click(await screen.findByRole('button', { name: 'View detail' }));
    expect(await screen.findByText(/Remaining refundable balance: \$6\.25/)).toBeInTheDocument();
    expect(screen.getByText('Authoritative GBP balance: £5.00')).toBeInTheDocument();
    expect(screen.getByLabelText('Amount (GBP)')).toBeInTheDocument();
  });

  it('renders coded refund errors in the selected locale and hides legacy prose', async () => {
    api.getAdminOrders.mockResolvedValue(list());
    api.getAdminOrder.mockResolvedValue(detail);
    api.createAdminRefund.mockRejectedValue(
      new ApiError('backend payment detail', 409, {
        error: 'backend payment detail',
        code: 'PAYMENT_NOT_REFUNDABLE',
      }),
    );
    const events = userEvent.setup();
    renderPage();
    await events.click(await screen.findByRole('button', { name: 'View detail' }));
    await events.type(screen.getByRole('spinbutton'), '5');
    await events.type(screen.getByLabelText('Reason'), 'Duplicate');
    await events.click(screen.getByRole('button', { name: 'Create refund' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This payment cannot be refunded.');
    expect(screen.queryByText('backend payment detail')).not.toBeInTheDocument();
  });

  it('uses localized fallback for uncoded refund errors without backend diagnostics', async () => {
    api.getAdminOrders.mockResolvedValue(list());
    api.getAdminOrder.mockResolvedValue(detail);
    api.createAdminRefund.mockRejectedValue(new Error('backend refund detail'));
    const events = userEvent.setup();
    renderPage();
    await events.click(await screen.findByRole('button', { name: 'View detail' }));
    await events.type(screen.getByRole('spinbutton'), '5');
    await events.type(screen.getByLabelText('Reason'), 'Duplicate');
    await events.click(screen.getByRole('button', { name: 'Create refund' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Unable to create refund.');
    expect(alert).not.toHaveTextContent('backend refund detail');
  });
});
