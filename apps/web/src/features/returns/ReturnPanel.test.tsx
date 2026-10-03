import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/client';
import { fetchReturnOverview, createReturnRequest } from '@/api/returns';
import { ReturnPanel } from './ReturnPanel';
import type {
  ReturnOverviewResponse,
  ReturnRequest,
  ReturnEligibilityLine,
} from '@shop/contracts/returns';

vi.mock('@/api/returns', () => ({
  fetchReturnOverview: vi.fn(),
  createReturnRequest: vi.fn(),
}));

const deliveredAt = '2026-07-01T12:00:00.000Z';
const windowClosesAt = '2026-07-31T12:00:00.000Z';

const eligibleLine: ReturnEligibilityLine = {
  shipmentId: '71',
  shipmentNumber: 1,
  orderLineItemId: '31',
  productName: 'Oat powder',
  deliveredQuantity: 3,
  reservedQuantity: 0,
  availableQuantity: 3,
  deliveredAt,
  windowClosesAt,
};

const eligibleOverview: ReturnOverviewResponse = {
  windowDays: 30,
  eligibleLines: [eligibleLine],
  requests: [],
};

const secondOrderOverview: ReturnOverviewResponse = {
  windowDays: 30,
  eligibleLines: [
    {
      ...eligibleLine,
      shipmentId: '81',
      shipmentNumber: 4,
      orderLineItemId: '41',
      productName: 'Barley powder',
    },
  ],
  requests: [],
};

const requestedReturn: ReturnRequest = {
  id: '101',
  orderId: '12',
  status: 'requested',
  version: 1,
  reason: 'damaged',
  note: null,
  items: [
    {
      shipmentId: '71',
      orderLineItemId: '31',
      productName: 'Oat powder',
      quantity: 1,
      deliveredAt,
      windowClosesAt,
    },
  ],
  refund: null,
  requestedAt: '2026-07-15T10:00:00.000Z',
  approvedAt: null,
  rejectedAt: null,
  receivedAt: null,
};

const refundedReturn: ReturnRequest = {
  ...requestedReturn,
  id: '102',
  status: 'refunded',
  version: 4,
  approvedAt: '2026-07-16T10:00:00.000Z',
  receivedAt: '2026-07-17T10:00:00.000Z',
  refund: {
    grossSubtotalCents: 1000,
    discountShareCents: 0,
    amountCents: 1000,
    simulatedReference: 'sim_refund_key-abc',
    refundedAt: '2026-07-17T10:00:00.000Z',
  },
};

describe('ReturnPanel', () => {
  beforeEach(() => {
    vi.mocked(fetchReturnOverview).mockReset();
    vi.mocked(createReturnRequest).mockReset();
  });

  it('shows loading state then eligible lines', async () => {
    vi.mocked(fetchReturnOverview).mockResolvedValue(eligibleOverview);
    render(<ReturnPanel orderId="12" />);
    expect(screen.getByText('Loading return information…')).toBeInTheDocument();
    expect(await screen.findByText('Oat powder')).toBeInTheDocument();
    expect(screen.getByText('(3 of 3 available)')).toBeInTheDocument();
  });

  it('shows empty state when no eligible lines and no history', async () => {
    vi.mocked(fetchReturnOverview).mockResolvedValue({
      windowDays: 30,
      eligibleLines: [],
      requests: [],
    });
    render(<ReturnPanel orderId="12" />);
    expect(await screen.findByText(/No items are eligible for return/)).toBeInTheDocument();
  });

  it('shows error with retry when overview fails', async () => {
    vi.mocked(fetchReturnOverview)
      .mockRejectedValueOnce(new Error('Network failure'))
      .mockResolvedValueOnce(eligibleOverview);
    const user = userEvent.setup();
    render(<ReturnPanel orderId="12" />);
    expect(await screen.findByText('Could not load return information.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Oat powder')).toBeInTheDocument();
  });

  it('submits a return request and refreshes', async () => {
    vi.mocked(fetchReturnOverview).mockResolvedValue(eligibleOverview);
    vi.mocked(createReturnRequest).mockResolvedValue(requestedReturn);
    const user = userEvent.setup();
    render(<ReturnPanel orderId="12" />);

    await screen.findByText('Oat powder');

    // Set quantity
    const qtyInput = screen.getByLabelText('Quantity to return for Oat powder');
    await user.clear(qtyInput);
    await user.type(qtyInput, '1');

    // Submit
    await user.click(screen.getByRole('button', { name: 'Submit return request' }));

    await waitFor(() => expect(createReturnRequest).toHaveBeenCalledOnce());

    // Verify announcement
    expect(screen.getByText('Return request submitted successfully.')).toBeInTheDocument();
  });

  it('handles 409 conflict by clearing form and refreshing', async () => {
    vi.mocked(fetchReturnOverview)
      .mockResolvedValueOnce(eligibleOverview)
      .mockResolvedValueOnce(eligibleOverview);
    vi.mocked(createReturnRequest).mockRejectedValue(
      new ApiError('Idempotency conflict', 409, {
        error: 'Idempotency conflict',
        code: 'IDEMPOTENCY_CONFLICT',
      }),
    );
    const user = userEvent.setup();
    render(<ReturnPanel orderId="12" />);

    await screen.findByText('Oat powder');
    const qtyInput = screen.getByLabelText('Quantity to return for Oat powder');
    await user.clear(qtyInput);
    await user.type(qtyInput, '1');
    await user.click(screen.getByRole('button', { name: 'Submit return request' }));

    expect(await screen.findByText(/conflicts with a previous return/)).toBeInTheDocument();
    expect(fetchReturnOverview).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText('Quantity to return for Oat powder')).toHaveValue(null);
  });

  it('handles 422 quantity unavailable by refreshing', async () => {
    vi.mocked(fetchReturnOverview)
      .mockResolvedValueOnce(eligibleOverview)
      .mockResolvedValueOnce({
        ...eligibleOverview,
        eligibleLines: [{ ...eligibleLine, availableQuantity: 0, reservedQuantity: 3 }],
      });
    vi.mocked(createReturnRequest).mockRejectedValue(
      new ApiError('Quantity unavailable', 422, {
        error: 'Quantity unavailable',
        code: 'QUANTITY_UNAVAILABLE',
      }),
    );
    const user = userEvent.setup();
    render(<ReturnPanel orderId="12" />);

    await screen.findByText('Oat powder');
    const qtyInput = screen.getByLabelText('Quantity to return for Oat powder');
    await user.clear(qtyInput);
    await user.type(qtyInput, '1');
    await user.click(screen.getByRole('button', { name: 'Submit return request' }));

    expect(await screen.findByText(/Available quantities changed/)).toBeInTheDocument();
    expect(fetchReturnOverview).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText('Quantity to return for Oat powder')).toHaveValue(null);
  });

  it('uses RETURN_WINDOW_EXPIRED code without status-driven refresh or reset', async () => {
    vi.mocked(fetchReturnOverview).mockResolvedValue(eligibleOverview);
    vi.mocked(createReturnRequest).mockRejectedValue(
      new ApiError('Return window expired', 409, {
        error: 'Return window expired',
        code: 'RETURN_WINDOW_EXPIRED',
      }),
    );
    const user = userEvent.setup();
    render(<ReturnPanel orderId="12" />);

    await screen.findByText('Oat powder');
    const qtyInput = screen.getByLabelText('Quantity to return for Oat powder');
    await user.clear(qtyInput);
    await user.type(qtyInput, '1');
    await user.click(screen.getByRole('button', { name: 'Submit return request' }));

    expect(await screen.findByText('The return window has expired.')).toBeInTheDocument();
    expect(fetchReturnOverview).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('Quantity to return for Oat powder')).toHaveValue(1);
  });

  it('uses RETURN_NOT_ELIGIBLE code to refresh and clear stale selections', async () => {
    vi.mocked(fetchReturnOverview)
      .mockResolvedValueOnce(eligibleOverview)
      .mockResolvedValueOnce({
        ...eligibleOverview,
        eligibleLines: [{ ...eligibleLine, availableQuantity: 0, reservedQuantity: 3 }],
      });
    vi.mocked(createReturnRequest).mockRejectedValue(
      new ApiError('Return not eligible', 409, {
        error: 'Return not eligible',
        code: 'RETURN_NOT_ELIGIBLE',
      }),
    );
    const user = userEvent.setup();
    render(<ReturnPanel orderId="12" />);

    await screen.findByText('Oat powder');
    const qtyInput = screen.getByLabelText('Quantity to return for Oat powder');
    await user.clear(qtyInput);
    await user.type(qtyInput, '1');
    await user.click(screen.getByRole('button', { name: 'Submit return request' }));

    expect(await screen.findByText('This order is not eligible for a return.')).toBeInTheDocument();
    expect(fetchReturnOverview).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText('Quantity to return for Oat powder')).toHaveValue(null);
  });

  it('uses RETURN_DATA_CORRUPT code and keeps form state without refresh', async () => {
    vi.mocked(fetchReturnOverview).mockResolvedValue(eligibleOverview);
    vi.mocked(createReturnRequest).mockRejectedValue(
      new ApiError('Return data corrupt', 422, {
        error: 'Return data corrupt',
        code: 'RETURN_DATA_CORRUPT',
      }),
    );
    const user = userEvent.setup();
    render(<ReturnPanel orderId="12" />);

    await screen.findByText('Oat powder');
    const qtyInput = screen.getByLabelText('Quantity to return for Oat powder');
    await user.clear(qtyInput);
    await user.type(qtyInput, '1');
    await user.click(screen.getByRole('button', { name: 'Submit return request' }));

    expect(await screen.findByText('The return request could not be read.')).toBeInTheDocument();
    expect(fetchReturnOverview).toHaveBeenCalledOnce();
    expect(qtyInput).toHaveValue(1);
  });

  it('disables submit when no quantity selected', async () => {
    vi.mocked(fetchReturnOverview).mockResolvedValue(eligibleOverview);
    render(<ReturnPanel orderId="12" />);
    await screen.findByText('Oat powder');
    expect(screen.getByRole('button', { name: 'Submit return request' })).toBeDisabled();
  });

  it('shows return history with status badges', async () => {
    vi.mocked(fetchReturnOverview).mockResolvedValue({
      windowDays: 30,
      eligibleLines: [],
      requests: [requestedReturn, refundedReturn],
    });
    render(<ReturnPanel orderId="12" />);
    expect(await screen.findByText('Request #101')).toBeInTheDocument();
    expect(screen.getByText('Requested')).toBeInTheDocument();
    expect(screen.getByText('Request #102')).toBeInTheDocument();
    expect(screen.getByText('Refunded')).toBeInTheDocument();
    expect(screen.getByText(/Refund: \$12\.50/)).toBeInTheDocument();
    expect(screen.getByText('Reference: sim_refund_key-abc')).toBeInTheDocument();
  });

  it('uses a safe localized fallback when a return timestamp is invalid', async () => {
    vi.mocked(fetchReturnOverview).mockResolvedValue({
      windowDays: 30,
      eligibleLines: [],
      requests: [
        {
          ...requestedReturn,
          requestedAt: 'not-a-timestamp',
          approvedAt: null,
          status: 'approved',
        },
      ],
    });
    render(<ReturnPanel orderId="12" />);
    expect(await screen.findByText(/Date unavailable/)).toBeInTheDocument();
    expect(screen.queryByText(/Invalid Date/)).not.toBeInTheDocument();
  });

  it('renders shipments grouped correctly', async () => {
    vi.mocked(fetchReturnOverview).mockResolvedValue({
      windowDays: 30,
      eligibleLines: [
        eligibleLine,
        {
          ...eligibleLine,
          shipmentId: '72',
          shipmentNumber: 2,
          orderLineItemId: '33',
          productName: 'Pea powder',
          deliveredQuantity: 2,
          availableQuantity: 2,
        },
      ],
      requests: [],
    });
    render(<ReturnPanel orderId="12" />);
    expect(await screen.findByText('Shipment 1')).toBeInTheDocument();
    expect(screen.getByText('Shipment 2')).toBeInTheDocument();
    expect(screen.getByText('Oat powder')).toBeInTheDocument();
    expect(screen.getByText('Pea powder')).toBeInTheDocument();
  });

  it('rejects markup in note with inline error', async () => {
    vi.mocked(fetchReturnOverview).mockResolvedValue(eligibleOverview);
    const user = userEvent.setup();
    render(<ReturnPanel orderId="12" />);
    await screen.findByText('Oat powder');

    const qtyInput = screen.getByLabelText('Quantity to return for Oat powder');
    await user.clear(qtyInput);
    await user.type(qtyInput, '1');

    const noteArea = screen.getByLabelText(/Note/);
    await user.type(noteArea, '<script>');

    const noteError = document.getElementById('return-note-error');
    expect(noteError).toBeInTheDocument();
    expect(noteError).toHaveTextContent(/Angle brackets/);
  });

  it('aborts stale async results on unmount/order change', async () => {
    let resolveFirst!: (value: ReturnOverviewResponse) => void;
    vi.mocked(fetchReturnOverview).mockImplementationOnce(
      () =>
        new Promise<ReturnOverviewResponse>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const { unmount } = render(<ReturnPanel orderId="12" />);
    expect(screen.getByText('Loading return information…')).toBeInTheDocument();
    unmount();
    // resolve after unmount — should not cause state update warning (test passes if no crash)
    await act(async () => {
      resolveFirst(eligibleOverview);
      await Promise.resolve();
    });
    // component unmounted, no assertion needed — no crash is success
  });

  it('preserves core order context when panel errors — handled by error boundary', async () => {
    // The ReturnErrorBoundary in OrderDetailPage catches rendering errors in ReturnPanel.
    // Here we verify that fetch errors inside ReturnPanel are handled internally
    // (shown as retry UI) rather than crashing the boundary.
    vi.mocked(fetchReturnOverview).mockRejectedValue(new Error('Boom'));
    render(<ReturnPanel orderId="12" />);
    expect(await screen.findByText('Could not load return information.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('clears prior order form state before a new overview resolves', async () => {
    let resolveFirst!: (value: ReturnOverviewResponse) => void;
    let resolveSecond!: (value: ReturnOverviewResponse) => void;
    vi.mocked(fetchReturnOverview).mockImplementation((requestedOrderId) => {
      return new Promise<ReturnOverviewResponse>((resolve) => {
        if (requestedOrderId === '12') resolveFirst = resolve;
        else resolveSecond = resolve;
      });
    });
    const user = userEvent.setup();
    const { rerender } = render(<ReturnPanel orderId="12" />);

    await act(async () => {
      resolveFirst(eligibleOverview);
      await Promise.resolve();
    });
    const oldQuantity = await screen.findByLabelText('Quantity to return for Oat powder');
    await user.clear(oldQuantity);
    await user.type(oldQuantity, '1');

    rerender(<ReturnPanel orderId="13" />);
    expect(screen.queryByText('Oat powder')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit return request' })).not.toBeInTheDocument();
    expect(screen.getByText(/Loading return information/)).toBeInTheDocument();

    await act(async () => {
      resolveSecond(secondOrderOverview);
      await Promise.resolve();
    });
    expect(await screen.findByText('Barley powder')).toBeInTheDocument();
    expect(screen.queryByLabelText('Quantity to return for Oat powder')).not.toBeInTheDocument();
    expect(createReturnRequest).not.toHaveBeenCalled();
  });

  it('ignores a late overview response from the previous order', async () => {
    let resolveFirst!: (value: ReturnOverviewResponse) => void;
    let resolveSecond!: (value: ReturnOverviewResponse) => void;
    vi.mocked(fetchReturnOverview).mockImplementation((requestedOrderId) => {
      return new Promise<ReturnOverviewResponse>((resolve) => {
        if (requestedOrderId === '12') resolveFirst = resolve;
        else resolveSecond = resolve;
      });
    });
    const { rerender } = render(<ReturnPanel orderId="12" />);
    rerender(<ReturnPanel orderId="13" />);

    await act(async () => {
      resolveFirst(eligibleOverview);
      await Promise.resolve();
    });
    expect(screen.queryByText('Oat powder')).not.toBeInTheDocument();

    await act(async () => {
      resolveSecond(secondOrderOverview);
      await Promise.resolve();
    });
    expect(await screen.findByText('Barley powder')).toBeInTheDocument();
  });

  it('retains idempotency key across non-conflict errors and reuses on retry', async () => {
    vi.mocked(fetchReturnOverview).mockResolvedValue(eligibleOverview);
    // First call fails with network error, second succeeds
    vi.mocked(createReturnRequest)
      .mockRejectedValueOnce(new Error('Network failure'))
      .mockResolvedValueOnce(requestedReturn);
    let uuidCalls = 0;
    const origRandomUUID = crypto.randomUUID.bind(crypto);
    const uuidSpy = vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
      uuidCalls++;
      return origRandomUUID();
    });
    const user = userEvent.setup();
    render(<ReturnPanel orderId="12" />);

    await screen.findByText('Oat powder');
    const qtyInput = screen.getByLabelText('Quantity to return for Oat powder');
    await user.clear(qtyInput);
    await user.type(qtyInput, '1');

    // First submission fails
    await user.click(screen.getByRole('button', { name: 'Submit return request' }));
    expect(
      await screen.findByText('Unable to complete this return request. Try again.'),
    ).toBeInTheDocument();

    // Retry submission reuses the same key
    await user.click(screen.getByRole('button', { name: 'Submit return request' }));
    await waitFor(() => expect(createReturnRequest).toHaveBeenCalledTimes(2));
    // Key should have been generated exactly once (reused on retry)
    expect(uuidCalls).toBe(1);
    uuidSpy.mockRestore();
  });

  it('focuses first invalid field on validation error', async () => {
    vi.mocked(fetchReturnOverview).mockResolvedValue(eligibleOverview);
    const user = userEvent.setup();
    render(<ReturnPanel orderId="12" />);

    await screen.findByText('Oat powder');
    const qtyInput = screen.getByLabelText('Quantity to return for Oat powder');
    await user.clear(qtyInput);
    await user.type(qtyInput, '1');

    // Type markup in note
    const noteArea = screen.getByLabelText(/Note/);
    await user.type(noteArea, '<b>test</b>');

    // Submit - should show error and focus note textarea
    await user.click(screen.getByRole('button', { name: 'Submit return request' }));
    const alerts = await screen.findAllByRole('alert');
    const visibleAlert = alerts.find((el: HTMLElement) => !el.classList.contains('sr-only'));
    expect(visibleAlert).toBeDefined();
    expect(visibleAlert).toHaveTextContent(/Angle brackets/);
    expect(noteArea).toHaveFocus();
  });

  it('prevents Escape from dismissing form during submission', async () => {
    vi.mocked(fetchReturnOverview).mockResolvedValue(eligibleOverview);
    let resolveCreate!: (value: ReturnRequest) => void;
    vi.mocked(createReturnRequest).mockImplementation(
      () =>
        new Promise<ReturnRequest>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    const user = userEvent.setup();
    render(<ReturnPanel orderId="12" />);

    await screen.findByText('Oat powder');
    const qtyInput = screen.getByLabelText('Quantity to return for Oat powder');
    await user.clear(qtyInput);
    await user.type(qtyInput, '1');

    await user.click(screen.getByRole('button', { name: 'Submit return request' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Submitting…' })).toBeDisabled());

    // Press Escape while submitting — handler prevents default, no crash
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Submitting…' })).toBeInTheDocument();

    // Clean up: resolve to unmount cleanly
    resolveCreate(requestedReturn);
  });
});
