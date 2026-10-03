import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeliverySlotOptionsResponse } from '@shop/contracts/delivery';
import { ApiError } from '@/api/client';
import { getDeliverySlotOptions } from '@/api/deliverySlots';
import { LocaleProvider } from '@/i18n/LocaleContext';
import { useDeliverySlots } from './useDeliverySlots';

vi.mock('@/api/deliverySlots', () => ({ getDeliverySlotOptions: vi.fn() }));
const countryState = vi.hoisted(() => ({ activeCountry: 'US' }));
vi.mock('@/hooks/CountryContext', () => ({
  useOptionalCountry: () => ({ activeCountry: countryState.activeCountry }),
  useCountry: () => ({
    activeCountry: countryState.activeCountry,
    isAccountBound: false,
    selectCountry: vi.fn(),
    countryStorage: null,
  }),
}));

const cartId = '58f1b5ed-3dbf-4c3c-908e-c71d7e7bf912';

function withLocale(children: ReactNode) {
  return <LocaleProvider>{children}</LocaleProvider>;
}

function optionsFor(date: string, reason: string): DeliverySlotOptionsResponse {
  return {
    delivery: { mode: 'freight', chargeCents: 999, weightGrams: 25000, reason },
    leadTime: { earliestDate: date, latestDate: date, businessDays: 3, reason },
    slots: [{ date, window: 'am' }],
  };
}

describe('useDeliverySlots', () => {
  beforeEach(() => {
    vi.mocked(getDeliverySlotOptions).mockReset();
    countryState.activeCountry = 'US';
  });

  it('discards a stale response after the cart quote changes', async () => {
    let resolveStale!: (value: DeliverySlotOptionsResponse) => void;
    const stale = new Promise<DeliverySlotOptionsResponse>((resolve) => {
      resolveStale = resolve;
    });
    const fresh = optionsFor('2026-08-10', 'Heavier consignment needs 5 business days.');
    vi.mocked(getDeliverySlotOptions).mockReturnValueOnce(stale).mockResolvedValueOnce(fresh);

    const { result, rerender } = renderHook(
      ({ quoteKey }: { quoteKey: string }) => useDeliverySlots(cartId, quoteKey),
      { initialProps: { quoteKey: 'cart:1000' } },
    );

    rerender({ quoteKey: 'cart:2000' });
    await waitFor(() => expect(result.current.options).toEqual(fresh));

    await act(async () => {
      resolveStale(optionsFor('2026-08-03', 'Lighter consignment needs 3 business days.'));
      await stale;
    });

    expect(result.current.options).toEqual(fresh);
    expect(getDeliverySlotOptions).toHaveBeenCalledTimes(2);
  });

  it('aborts the superseded request when the cart changes', async () => {
    vi.mocked(getDeliverySlotOptions).mockImplementation(
      (_cartId, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );

    const { rerender } = renderHook(
      ({ quoteKey }: { quoteKey: string }) => useDeliverySlots(cartId, quoteKey),
      { initialProps: { quoteKey: 'cart:1000' } },
    );
    const firstSignal = vi.mocked(getDeliverySlotOptions).mock.calls[0]![1]!.signal!;
    expect(firstSignal.aborted).toBe(false);

    rerender({ quoteKey: 'cart:2000' });
    await waitFor(() => expect(firstSignal.aborted).toBe(true));
  });

  it('surfaces a load failure and clears it on reload', async () => {
    const recovered = optionsFor('2026-08-03', 'Freight needs 3 business days.');
    vi.mocked(getDeliverySlotOptions)
      .mockRejectedValueOnce(new ApiError('Delivery slots are unavailable', 500))
      .mockResolvedValue(recovered);

    const { result } = renderHook(() => useDeliverySlots(cartId, 'cart:1000'));
    await waitFor(() => expect(result.current.error).toBe('Delivery slots are unavailable.'));
    expect(result.current.options).toBeNull();

    act(() => result.current.reload());
    await waitFor(() => expect(result.current.options).toEqual(recovered));
    expect(result.current.error).toBeNull();
  });

  it.each([
    {
      label: 'network',
      failure: new ApiError('delivery backend secret', null),
      key: 'checkout.error.network',
      code: null,
      copy: 'Shop-Server ist nicht erreichbar',
    },
    {
      label: 'unknown',
      failure: new Error('delivery backend secret'),
      key: 'checkout.deliverySlotsUnavailable',
      code: null,
      copy: 'Lieferzeitfenster sind nicht verfügbar.',
    },
    {
      label: 'coded',
      failure: new ApiError('delivery backend secret', 409, {
        error: 'delivery backend secret',
        code: 'DELIVERY_SLOT_UNAVAILABLE',
        meta: { earliestDate: '2026-08-11' },
      }),
      key: 'checkout.deliverySlotsUnavailable',
      code: 'DELIVERY_SLOT_UNAVAILABLE',
      copy: 'Lieferzeitfenster',
    },
  ])('localizes DE $label failures without API prose', async ({ failure, key, code, copy }) => {
    countryState.activeCountry = 'DE';
    vi.mocked(getDeliverySlotOptions).mockRejectedValueOnce(failure);

    const { result } = renderHook(() => useDeliverySlots(cartId, 'cart:de'), {
      wrapper: ({ children }) => withLocale(children),
    });

    await waitFor(() => expect(result.current.error).toContain(copy));
    expect(result.current.error).not.toContain('delivery backend secret');
    expect(result.current.errorState).toMatchObject({ key, code });
  });

  it('holds no slots while the cart is unavailable', () => {
    const { result } = renderHook(() => useDeliverySlots(null, null));

    expect(result.current.options).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(getDeliverySlotOptions).not.toHaveBeenCalled();
  });
});
