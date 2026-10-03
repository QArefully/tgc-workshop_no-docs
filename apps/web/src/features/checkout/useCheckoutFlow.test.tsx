import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getTradeCreditSummary } from '@/api/tradeCredit';
import { useAuth } from '@/hooks/AuthContext';
import { useCartContext } from '@/hooks/CartContext';
import { useOptionalCountry } from '@/hooks/CountryContext';
import { useLocalisation } from '@/i18n/LocaleContext';
import { useTradeProfile } from '@/features/account/useTradeProfile';
import { useCheckoutNavigation } from './useCheckoutNavigation';
import { useDeliverySlots } from './useDeliverySlots';
import { usePaymentSubmission } from './usePaymentSubmission';
import { usePromoQuote } from './usePromoQuote';
import { useCheckoutFlow } from './useCheckoutFlow';

vi.mock('@/api/tradeCredit', () => ({ getTradeCreditSummary: vi.fn() }));
vi.mock('@/hooks/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/hooks/CartContext', () => ({ useCartContext: vi.fn() }));
vi.mock('@/hooks/CountryContext', () => ({ useOptionalCountry: vi.fn() }));
vi.mock('@/i18n/LocaleContext', () => ({ useLocalisation: vi.fn() }));
vi.mock('@/features/account/useTradeProfile', () => ({ useTradeProfile: vi.fn() }));
vi.mock('./useCheckoutNavigation', () => ({ useCheckoutNavigation: vi.fn() }));
vi.mock('./useDeliverySlots', () => ({ useDeliverySlots: vi.fn() }));
vi.mock('./usePaymentSubmission', () => ({ usePaymentSubmission: vi.fn() }));
vi.mock('./usePromoQuote', () => ({ usePromoQuote: vi.fn() }));

type TestCart = {
  id: string;
  subtotalCents: number;
  totalItems: number;
  items: { productId: string; quantity: number; lineTotalCents: number }[];
};

const context = vi.hoisted(
  (): { country: 'US' | 'DE'; user: { id: string } | null; cart: TestCart | null } => ({
    country: 'US',
    user: { id: 'user-1' },
    cart: {
      id: 'cart-1',
      subtotalCents: 100,
      totalItems: 1,
      items: [{ productId: 'product-1', quantity: 1, lineTotalCents: 100 }],
    },
  }),
);

const activeSummary = { state: 'active' } as never;

beforeEach(() => {
  context.country = 'US';
  context.user = { id: 'user-1' };
  context.cart = {
    id: 'cart-1',
    subtotalCents: 100,
    totalItems: 1,
    items: [{ productId: 'product-1', quantity: 1, lineTotalCents: 100 }],
  };
  vi.mocked(useAuth).mockImplementation(() => ({ user: context.user }) as never);
  vi.mocked(useCartContext).mockImplementation(
    () =>
      ({
        cart: context.cart,
        cartId: context.cart?.id ?? null,
        cartGeneration: 1,
        clearCart: vi.fn(),
        retryCart: vi.fn(),
      }) as never,
  );
  vi.mocked(useOptionalCountry).mockImplementation(
    () => ({ activeCountry: context.country }) as never,
  );
  vi.mocked(useLocalisation).mockImplementation(
    () =>
      ({
        activeCountry: context.country,
        translate: (_catalog: unknown, key: string) => key,
      }) as never,
  );
  vi.mocked(useTradeProfile).mockReturnValue({
    deliverySites: { items: [], loading: false, error: null, errorState: null },
    billingEntities: { items: [], loading: false, error: null, errorState: null },
    reloadDeliverySites: vi.fn(),
    reloadBillingEntities: vi.fn(),
  } as never);
  vi.mocked(useDeliverySlots).mockReturnValue({
    options: null,
    loading: false,
    error: null,
    errorState: null,
    reload: vi.fn(),
  });
  vi.mocked(useCheckoutNavigation).mockReturnValue({
    step: 'delivery',
    goToDelivery: vi.fn(),
    goToSchedule: vi.fn(),
    goToPayment: vi.fn(),
    replaceWithOrder: vi.fn(),
  } as never);
  vi.mocked(usePromoQuote).mockReturnValue(vi.fn() as never);
  vi.mocked(usePaymentSubmission).mockReturnValue(vi.fn() as never);
  vi.mocked(getTradeCreditSummary).mockReset();
});

describe('useCheckoutFlow trade-credit state', () => {
  it('does not load anonymously and keeps a no-account response unavailable', async () => {
    context.user = null;
    vi.mocked(getTradeCreditSummary).mockResolvedValue(null);
    const { result } = renderHook(() => useCheckoutFlow());

    expect(getTradeCreditSummary).not.toHaveBeenCalled();
    act(() => result.current.updatePaymentMethod('trade_credit'));
    await waitFor(() => expect(result.current.creditSummaryStatus).toBe('unavailable'));
    expect(getTradeCreditSummary).not.toHaveBeenCalled();
    expect(result.current.creditSummaryUnavailable).toBe(true);
  });

  it('aborts and ignores an old summary when method, country, or cart changes', async () => {
    let resolveFirst!: (value: unknown) => void;
    let resolveSecond!: (value: unknown) => void;
    const first = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    const second = new Promise((resolve) => {
      resolveSecond = resolve;
    });
    vi.mocked(getTradeCreditSummary)
      .mockReturnValueOnce(first as never)
      .mockReturnValueOnce(second as never);
    const { result, rerender } = renderHook(() => useCheckoutFlow());

    act(() => result.current.updatePaymentMethod('trade_credit'));
    await waitFor(() => expect(getTradeCreditSummary).toHaveBeenCalledTimes(1));
    const firstSignal = vi.mocked(getTradeCreditSummary).mock.calls[0]![0]!.signal!;
    expect(firstSignal.aborted).toBe(false);

    context.country = 'DE';
    rerender();
    await waitFor(() => expect(getTradeCreditSummary).toHaveBeenCalledTimes(2));
    expect(firstSignal.aborted).toBe(true);

    resolveFirst(activeSummary);
    await act(async () => await first);
    expect(result.current.creditSummary).toBeNull();
    expect(result.current.creditSummaryStatus).toBe('loading');

    resolveSecond(activeSummary);
    await waitFor(() => expect(result.current.creditSummaryStatus).toBe('loaded'));

    act(() => result.current.updatePaymentMethod('card'));
    expect(result.current.creditSummary).toBe(activeSummary);
    expect(result.current.creditSummaryStatus).toBe('loaded');
    expect(result.current.creditSummaryUnavailable).toBe(false);
    expect(result.current.paymentMethod).toBe('card');

    act(() => result.current.updatePaymentMethod('trade_credit'));
    expect(result.current.creditSummary).toBe(activeSummary);
    expect(getTradeCreditSummary).toHaveBeenCalledTimes(2);
  });

  it('masks a loaded summary during the first render of a new credit identity', async () => {
    vi.mocked(getTradeCreditSummary).mockResolvedValue(activeSummary);
    const snapshots: Array<{
      creditSummary: unknown;
      creditSummaryStatus: string;
      creditSummaryUnavailable: boolean;
    }> = [];
    const { result, rerender } = renderHook(() => {
      const flow = useCheckoutFlow();
      snapshots.push({
        creditSummary: flow.creditSummary,
        creditSummaryStatus: flow.creditSummaryStatus,
        creditSummaryUnavailable: flow.creditSummaryUnavailable,
      });
      return flow;
    });

    act(() => result.current.updatePaymentMethod('trade_credit'));
    await waitFor(() => expect(result.current.creditSummaryStatus).toBe('loaded'));
    const snapshotCountBeforeIdentityChange = snapshots.length;
    const submissionCallCountBeforeIdentityChange =
      vi.mocked(usePaymentSubmission).mock.calls.length;

    context.country = 'DE';
    rerender();

    expect(snapshots[snapshotCountBeforeIdentityChange]).toEqual({
      creditSummary: null,
      creditSummaryStatus: 'idle',
      creditSummaryUnavailable: false,
    });
    expect(
      vi.mocked(usePaymentSubmission).mock.calls[submissionCallCountBeforeIdentityChange]?.[0]
        ?.tradeCreditAvailable,
    ).toBe(false);
    await waitFor(() => expect(result.current.creditSummaryStatus).toBe('loaded'));
  });

  it('rotates the key once for a changed method or checkout context, not for a duplicate method', async () => {
    vi.mocked(getTradeCreditSummary).mockResolvedValue(null);
    const { result, rerender } = renderHook(() => useCheckoutFlow());
    const initialKey = result.current.idempotencyKey;

    act(() => result.current.updatePaymentMethod('card'));
    expect(result.current.idempotencyKey).toBe(initialKey);
    act(() => result.current.updatePaymentMethod('trade_credit'));
    const methodKey = result.current.idempotencyKey;
    expect(methodKey).not.toBe(initialKey);
    act(() => result.current.updatePaymentMethod('trade_credit'));
    expect(result.current.idempotencyKey).toBe(methodKey);

    context.country = 'DE';
    rerender();
    await waitFor(() => expect(result.current.idempotencyKey).not.toBe(methodKey));
  });
});
