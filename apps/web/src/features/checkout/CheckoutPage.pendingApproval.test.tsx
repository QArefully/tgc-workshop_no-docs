import { act, render, renderHook, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/client';
import { pay } from '@/api/payments';
import { CheckoutPage } from './CheckoutPage';
import { cardFields, initialCheckoutState, type CheckoutEvent } from './checkoutState';
import { usePaymentSubmission } from './usePaymentSubmission';

vi.mock('./useCheckoutFlow', () => ({
  useCheckoutFlow: () => ({
    cart: { totalItems: 1 },
    conflict: { code: 'PENDING_APPROVAL', approvalRequestId: '7' },
    cartRecoveryMessage: null,
    paymentError: null,
    step: 'delivery',
    schedule: { slot: null },
  }),
}));
vi.mock('@/hooks/CartContext', () => ({
  useCartContext: () => ({
    isInitializing: false,
    isLoading: false,
    error: null,
    retryCart: vi.fn(),
    isCartAvailable: true,
  }),
}));
vi.mock('@/api/payments', () => ({ pay: vi.fn() }));
vi.mock('./DeliveryStep', () => ({ DeliveryStep: () => <div /> }));
vi.mock('./CheckoutSummary', () => ({ CheckoutSummary: () => <div /> }));

function readyPaymentState() {
  const initial = initialCheckoutState();
  return {
    ...initial,
    contact: { customerName: 'Ada Buyer', customerEmail: 'ada@example.test' },
    delivery: { ...initial.delivery, destinationKind: 'saved' as const, deliverySiteId: 'site-1' },
    schedule: { slot: { date: '2026-08-10', window: 'am' as const } },
    billing: { ...initial.billing, selectionKind: 'saved' as const, billingEntityId: 'billing-1' },
    card: { cardNumber: '4242 4242 4242 4242', cardExpiry: '12/30', cardCvc: '123' },
    idempotencyKey: 'original-approval-key',
  };
}

describe('CheckoutPage approval response', () => {
  it('keeps checkout visible and links to approval requests', () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <CheckoutPage />
      </MemoryRouter>,
    );
    expect(
      screen.getByText('Your order is awaiting approval from your company approvers.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View approval requests' })).toHaveAttribute(
      'href',
      '/account/approvals',
    );
  });

  it.each(['APPROVAL_EXPIRED', 'APPROVAL_TOTAL_DRIFT'] as const)(
    'submits a fresh approval request after %s',
    async (errorCode) => {
      const dispatch = vi.fn<(event: CheckoutEvent) => void>();
      const state = readyPaymentState();
      vi.mocked(pay).mockReset();
      vi.mocked(pay)
        .mockRejectedValueOnce(new ApiError(errorCode, 409, { error: errorCode }))
        .mockRejectedValueOnce(
          new ApiError('Pending approval', 409, { error: 'PENDING_APPROVAL' }),
        );
      const { result, rerender } = renderHook(
        ({ currentState }) =>
          usePaymentSubmission({
            cartId: 'cart-1',
            cartPresent: true,
            state: currentState,
            stepsAreValid: true,
            cardIsValid: true,
            appliedPromo: null,
            dispatch,
            clearCart: vi.fn(),
            replaceWithOrder: vi.fn(),
            cardFields,
          }),
        { initialProps: { currentState: state } },
      );

      await act(async () => {
        await result.current();
      });
      const conflictEvent = dispatch.mock.calls.find(([event]) => event.type === 'conflict')?.[0];
      if (!conflictEvent || conflictEvent.type !== 'conflict')
        throw new Error('Expected approval conflict');
      expect(conflictEvent.idempotencyKey).not.toBe(state.idempotencyKey);

      rerender({ currentState: { ...state, idempotencyKey: conflictEvent.idempotencyKey } });
      await act(async () => {
        await result.current();
      });
      expect(vi.mocked(pay).mock.calls[1]?.[0]).toEqual(
        expect.objectContaining({ idempotencyKey: conflictEvent.idempotencyKey }),
      );
      expect(vi.mocked(pay).mock.calls[1]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    },
  );
});
