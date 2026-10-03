import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useReducer } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/client';
import { pay } from '@/api/payments';
import { LocaleProvider, useLocalisation } from '@/i18n/LocaleContext';
import { cardFields, checkoutReducer, initialCheckoutState } from './checkoutState';
import { localizeCheckoutError } from './checkoutCopy';
import { buildPaymentBody, usePaymentSubmission } from './usePaymentSubmission';

vi.mock('@/api/payments', () => ({ pay: vi.fn() }));
const countryState = vi.hoisted(() => ({ activeCountry: 'US' }));
vi.mock('@/hooks/CountryContext', () => ({
  useOptionalCountry: () => countryState,
  useCountry: () => ({
    activeCountry: countryState.activeCountry,
    isAccountBound: false,
    selectCountry: vi.fn(),
    countryStorage: null,
  }),
}));

function CrossBorderSubmissionHarness() {
  const [state, dispatch] = useReducer(checkoutReducer, {
    ...initialCheckoutState(),
    contact: { customerName: 'Buyer', customerEmail: 'buyer@example.test' },
    delivery: {
      ...initialCheckoutState().delivery,
      destinationKind: 'saved',
      deliverySiteId: 'site-1',
    },
    schedule: { slot: { date: '2026-08-10', window: 'am' } },
    billing: {
      ...initialCheckoutState().billing,
      selectionKind: 'saved',
      billingEntityId: 'billing-1',
    },
    card: { cardNumber: '424242424242', cardExpiry: '01/30', cardCvc: '123' },
  });
  const submit = usePaymentSubmission({
    cartId: 'cart-1',
    cartPresent: true,
    state,
    stepsAreValid: true,
    cardIsValid: true,
    appliedPromo: null,
    dispatch,
    clearCart: vi.fn(),
    replaceWithOrder: vi.fn(),
    cardFields,
  });
  const { translate } = useLocalisation();
  const localizedPaymentError = localizeCheckoutError(state.paymentErrorState, translate);

  return (
    <div>
      <button type="button" onClick={() => void submit()}>
        Submit payment
      </button>
      {state.paymentErrorState?.code && <p role="alert">{state.paymentErrorState.code}</p>}
      <output data-testid="payment-localized-error">{localizedPaymentError}</output>
      <output data-testid="conflict-code">{state.conflict?.code}</output>
    </div>
  );
}

function PendingEditSubmissionHarness() {
  const [state, dispatch] = useReducer(checkoutReducer, {
    ...initialCheckoutState(),
    contact: { customerName: 'Buyer', customerEmail: 'buyer@example.test' },
    delivery: {
      ...initialCheckoutState().delivery,
      destinationKind: 'saved',
      deliverySiteId: 'site-1',
    },
    schedule: { slot: { date: '2026-08-10', window: 'am' } },
    billing: {
      ...initialCheckoutState().billing,
      selectionKind: 'saved',
      billingEntityId: 'billing-1',
    },
    card: { cardNumber: '424242424242', cardExpiry: '01/30', cardCvc: '123' },
  });
  const submit = usePaymentSubmission({
    cartId: 'cart-1',
    cartPresent: true,
    state,
    stepsAreValid: true,
    cardIsValid: true,
    appliedPromo: null,
    dispatch,
    clearCart: vi.fn(),
    replaceWithOrder: vi.fn(),
    cardFields,
  });

  return (
    <div>
      <button type="button" onClick={() => void submit()}>
        Submit payment
      </button>
      <button
        type="button"
        onClick={() =>
          dispatch({
            type: 'card-changed',
            field: 'cardCvc',
            value: '456',
            idempotencyKey: 'edited-key',
          })
        }
      >
        Edit payment
      </button>
      <output data-testid="submitting">{String(state.submitting)}</output>
    </div>
  );
}

describe('usePaymentSubmission delivery country conflict', () => {
  beforeEach(() => {
    vi.mocked(pay).mockReset();
    countryState.activeCountry = 'US';
  });

  it('maps the exact cross-border 400 and renders the delivery restriction', async () => {
    vi.mocked(pay).mockRejectedValue(
      new ApiError('Selected delivery country is not available', 400, {
        error: 'Selected delivery country is not available',
      }),
    );
    const user = userEvent.setup();
    render(<CrossBorderSubmissionHarness />);

    await user.click(screen.getByRole('button', { name: 'Submit payment' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('DELIVERY_COUNTRY_NOT_ALLOWED');
    expect(screen.getByTestId('conflict-code')).toHaveTextContent('DELIVERY_COUNTRY_NOT_ALLOWED');
  });

  it('ignores delayed US completion after switching to a populated DE cart', async () => {
    let resolvePayment!: (value: { id: string }) => void;
    const pending = new Promise<{ id: string }>((resolve) => {
      resolvePayment = resolve;
    });
    vi.mocked(pay).mockReturnValue(pending as never);
    const clearCart = vi.fn();
    const replaceWithOrder = vi.fn();
    const dispatch = vi.fn();
    const state = {
      ...initialCheckoutState(),
      contact: { customerName: 'Buyer', customerEmail: 'buyer@example.test' },
      delivery: {
        ...initialCheckoutState().delivery,
        destinationKind: 'saved' as const,
        deliverySiteId: 'site-1',
      },
      schedule: { slot: { date: '2026-08-10', window: 'am' as const } },
      billing: {
        ...initialCheckoutState().billing,
        selectionKind: 'saved' as const,
        billingEntityId: 'billing-1',
      },
      card: { cardNumber: '424242424242', cardExpiry: '01/30', cardCvc: '123' },
    };
    const { result, rerender } = renderHook(
      ({ currentCartId, generation }: { currentCartId: string; generation: number }) =>
        usePaymentSubmission({
          cartId: currentCartId,
          cartGeneration: generation,
          cartPresent: true,
          state,
          stepsAreValid: true,
          cardIsValid: true,
          appliedPromo: null,
          dispatch,
          clearCart,
          replaceWithOrder,
          cardFields,
        }),
      { initialProps: { currentCartId: 'cart-us', generation: 1 } },
    );

    let submission!: Promise<void>;
    await act(async () => {
      submission = result.current();
      await Promise.resolve();
    });
    countryState.activeCountry = 'DE';
    rerender({ currentCartId: 'cart-de', generation: 2 });
    resolvePayment({ id: 'order-us' });
    await act(async () => {
      await submission;
    });

    expect(clearCart).not.toHaveBeenCalled();
    expect(replaceWithOrder).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'submission-failed' }),
    );
  });

  it('clears captured cart identity and navigates on same-country success', async () => {
    vi.mocked(pay).mockResolvedValue({ id: 'order-us' } as never);
    const clearCart = vi.fn().mockReturnValue(true);
    const replaceWithOrder = vi.fn();
    const dispatch = vi.fn();
    const state = {
      ...initialCheckoutState(),
      contact: { customerName: 'Buyer', customerEmail: 'buyer@example.test' },
      delivery: {
        ...initialCheckoutState().delivery,
        destinationKind: 'saved' as const,
        deliverySiteId: 'site-1',
      },
      schedule: { slot: { date: '2026-08-10', window: 'am' as const } },
      billing: {
        ...initialCheckoutState().billing,
        selectionKind: 'saved' as const,
        billingEntityId: 'billing-1',
      },
      card: { cardNumber: '424242424242', cardExpiry: '01/30', cardCvc: '123' },
    };
    const { result } = renderHook(() =>
      usePaymentSubmission({
        cartId: 'cart-us',
        cartGeneration: 7,
        cartPresent: true,
        state,
        stepsAreValid: true,
        cardIsValid: true,
        appliedPromo: null,
        dispatch,
        clearCart,
        replaceWithOrder,
        cardFields,
      }),
    );

    await act(async () => {
      await result.current();
    });
    expect(clearCart).toHaveBeenCalledWith({ country: 'US', cartId: 'cart-us', generation: 7 });
    expect(replaceWithOrder).toHaveBeenCalledWith('order-us');
  });

  it('releases the submit lock when a payment edit cancels a pending request, then retries', async () => {
    let resolveFirst!: (value: { id: string }) => void;
    const first = new Promise<{ id: string }>((resolve) => {
      resolveFirst = resolve;
    });
    vi.mocked(pay)
      .mockReturnValueOnce(first as never)
      .mockResolvedValueOnce({ id: 'order-retry' } as never);
    const user = userEvent.setup();
    render(<PendingEditSubmissionHarness />);

    await user.click(screen.getByRole('button', { name: 'Submit payment' }));
    expect(screen.getByTestId('submitting')).toHaveTextContent('true');

    await user.click(screen.getByRole('button', { name: 'Edit payment' }));
    expect(screen.getByTestId('submitting')).toHaveTextContent('false');

    await act(async () => {
      resolveFirst({ id: 'stale-order' });
      await first;
    });
    await user.click(screen.getByRole('button', { name: 'Submit payment' }));

    await waitFor(() => expect(pay).toHaveBeenCalledTimes(2));
    expect(vi.mocked(pay).mock.calls[1]![0].idempotencyKey).toBe('edited-key');
  });

  it.each([
    {
      label: 'network',
      failure: new ApiError('payment backend secret', null),
      code: '',
      copy: 'Shop-Server ist nicht erreichbar',
    },
    {
      label: 'unknown',
      failure: new Error('payment backend secret'),
      code: '',
      copy: 'Zahlung fehlgeschlagen',
    },
    {
      label: 'coded',
      failure: new ApiError('payment backend secret', 402, {
        error: 'payment backend secret',
        code: 'CARD_DECLINED',
      }),
      code: 'CARD_DECLINED',
      copy: 'Die Anfrage konnte nicht verarbeitet werden',
    },
  ])('localizes DE $label failures without API prose', async ({ failure, code, copy }) => {
    countryState.activeCountry = 'DE';
    vi.mocked(pay).mockRejectedValueOnce(failure);
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <CrossBorderSubmissionHarness />
      </LocaleProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Submit payment' }));
    expect(await screen.findByTestId('payment-localized-error')).toHaveTextContent(copy);
    expect(screen.getByTestId('payment-localized-error')).not.toHaveTextContent(
      'payment backend secret',
    );
    expect(screen.getByTestId('conflict-code')).toHaveTextContent('');
    if (code) expect(screen.getByRole('alert')).toHaveTextContent(code);
  });
});

describe('usePaymentSubmission payment method payloads', () => {
  it('builds a strict trade-credit body without card or client accounting fields', () => {
    const state = {
      ...initialCheckoutState(),
      paymentMethod: 'trade_credit' as const,
      card: { cardNumber: '424242424242', cardExpiry: '01/30', cardCvc: '123' },
    };
    const body = buildPaymentBody(state, {
      cartId: 'cart-1',
      promoCode: undefined,
      customerName: 'Buyer',
      customerEmail: 'buyer@example.test',
      deliveryDestination: { kind: 'saved', deliverySiteId: 'site-1' },
      billingSelection: { kind: 'saved', billingEntityId: 'billing-1' },
      deliverySlot: { date: '2026-08-10', window: 'am' },
      purchaseOrderReference: '',
      idempotencyKey: 'credit-key',
    });

    expect(body).toEqual({
      cartId: 'cart-1',
      customerName: 'Buyer',
      customerEmail: 'buyer@example.test',
      deliveryDestination: { kind: 'saved', deliverySiteId: 'site-1' },
      billingSelection: { kind: 'saved', billingEntityId: 'billing-1' },
      deliverySlot: { date: '2026-08-10', window: 'am' },
      idempotencyKey: 'credit-key',
      paymentMethod: 'trade_credit',
    });
    expect(body).not.toHaveProperty('cardNumber');
    expect(body).not.toHaveProperty('companyId');
    expect(body).not.toHaveProperty('vatCents');
    expect(body).not.toHaveProperty('availableCreditCents');
  });
});
