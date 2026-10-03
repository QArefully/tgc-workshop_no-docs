import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useReducer } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validatePromo } from '@/api/promo';
import { ApiError } from '@/api/client';
import { LocaleProvider, useLocalisation } from '@/i18n/LocaleContext';
import type { CheckoutEvent } from './checkoutState';
import { checkoutReducer, initialCheckoutState } from './checkoutState';
import { localizeCheckoutError } from './checkoutCopy';
import { usePromoQuote } from './usePromoQuote';

vi.mock('@/api/promo', () => ({ validatePromo: vi.fn() }));
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

function PromoHarness({
  quoteKey,
  promoCode = 'SAVE10',
  dispatch,
}: {
  quoteKey: string;
  promoCode?: string;
  dispatch: React.Dispatch<CheckoutEvent>;
}) {
  const applyPromo = usePromoQuote({
    cartId: 'cart-1',
    cartPresent: true,
    quoteKey,
    promoCode,
    dispatch,
    retryCart: vi.fn().mockResolvedValue(true),
  });
  return <button onClick={() => void applyPromo()}>Apply</button>;
}

function PromoErrorHarness() {
  const [state, dispatch] = useReducer(checkoutReducer, undefined, initialCheckoutState);
  const { translate } = useLocalisation();
  const applyPromo = usePromoQuote({
    cartId: 'cart-1',
    cartPresent: true,
    quoteKey: 'quote-a',
    promoCode: 'SAVE10',
    dispatch,
    retryCart: vi.fn().mockResolvedValue(true),
  });
  const error = localizeCheckoutError(state.promoErrorState, translate);
  return (
    <>
      <button onClick={() => void applyPromo()}>Apply</button>
      <output data-testid="promo-error">{error}</output>
      <output data-testid="promo-error-code">{state.promoErrorState?.code ?? ''}</output>
      <output data-testid="promo-error-key">{state.promoErrorState?.key ?? ''}</output>
    </>
  );
}

describe('usePromoQuote', () => {
  beforeEach(() => {
    vi.mocked(validatePromo).mockReset();
    countryState.activeCountry = 'US';
  });

  it('ignores a response for a cart quote replaced while validation is in flight', async () => {
    let resolvePromo!: (value: Awaited<ReturnType<typeof validatePromo>>) => void;
    const pending = new Promise<Awaited<ReturnType<typeof validatePromo>>>((resolve) => {
      resolvePromo = resolve;
    });
    const dispatch = vi.fn();
    vi.mocked(validatePromo).mockReturnValueOnce(pending);
    const user = userEvent.setup();
    const view = render(<PromoHarness quoteKey="quote-a" dispatch={dispatch} />);

    await user.click(screen.getByRole('button', { name: 'Apply' }));
    view.rerender(<PromoHarness quoteKey="quote-b" dispatch={dispatch} />);
    resolvePromo({
      valid: true,
      promoCode: {
        code: 'SAVE10',
        discountPercent: 10,
        minItemCount: 5,
        kind: 'percent',
      },
      discountCents: 100,
      totalCents: 900,
    });

    await pending;
    await waitFor(() => expect(validatePromo).toHaveBeenCalledOnce());
    expect(dispatch).toHaveBeenCalledWith({ type: 'promo-started' });
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'promo-applied' }));
  });

  it('starts a new request after a promo edit while the old request is pending', async () => {
    let resolveFirst!: (value: Awaited<ReturnType<typeof validatePromo>>) => void;
    let resolveSecond!: (value: Awaited<ReturnType<typeof validatePromo>>) => void;
    const first = new Promise<Awaited<ReturnType<typeof validatePromo>>>((resolve) => {
      resolveFirst = resolve;
    });
    const second = new Promise<Awaited<ReturnType<typeof validatePromo>>>((resolve) => {
      resolveSecond = resolve;
    });
    const dispatch = vi.fn();
    vi.mocked(validatePromo).mockReturnValueOnce(first).mockReturnValueOnce(second);
    const user = userEvent.setup();
    const view = render(<PromoHarness quoteKey="quote-a" dispatch={dispatch} />);

    await user.click(screen.getByRole('button', { name: 'Apply' }));
    view.rerender(<PromoHarness quoteKey="quote-a" promoCode="SAVE20" dispatch={dispatch} />);
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(validatePromo).toHaveBeenNthCalledWith(2, 'cart-1', 'SAVE20');

    resolveFirst({ valid: false, error: 'Old promo invalid' });
    await first;
    expect(dispatch).not.toHaveBeenCalledWith({ type: 'promo-failed', error: 'Old promo invalid' });

    resolveSecond({ valid: false, error: 'New promo invalid' });
    await second;
    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'promo-failed',
          error: 'checkout.promoError.invalid',
          errorState: {
            code: null,
            meta: null,
            key: 'checkout.promoError.invalid',
          },
          errorCode: null,
          minSubtotalCents: null,
        }),
      ),
    );
  });

  it('ignores original A after A-to-B-to-A candidate changes', async () => {
    let resolveOriginalA!: (value: Awaited<ReturnType<typeof validatePromo>>) => void;
    let resolveCurrentA!: (value: Awaited<ReturnType<typeof validatePromo>>) => void;
    const originalA = new Promise<Awaited<ReturnType<typeof validatePromo>>>((resolve) => {
      resolveOriginalA = resolve;
    });
    const currentA = new Promise<Awaited<ReturnType<typeof validatePromo>>>((resolve) => {
      resolveCurrentA = resolve;
    });
    const dispatch = vi.fn();
    vi.mocked(validatePromo).mockReturnValueOnce(originalA).mockReturnValueOnce(currentA);
    const user = userEvent.setup();
    const view = render(<PromoHarness quoteKey="quote-a" dispatch={dispatch} />);

    await user.click(screen.getByRole('button', { name: 'Apply' }));
    view.rerender(<PromoHarness quoteKey="quote-a" promoCode="SAVE20" dispatch={dispatch} />);
    view.rerender(<PromoHarness quoteKey="quote-a" dispatch={dispatch} />);
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(validatePromo).toHaveBeenCalledTimes(2);

    resolveOriginalA({ valid: false, error: 'Original A invalid' });
    await originalA;
    expect(dispatch).not.toHaveBeenCalledWith({
      type: 'promo-failed',
      error: 'Original A invalid',
    });

    resolveCurrentA({ valid: false, error: 'Current A invalid' });
    await currentA;
    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'promo-failed',
          error: 'checkout.promoError.invalid',
          errorState: {
            code: null,
            meta: null,
            key: 'checkout.promoError.invalid',
          },
          errorCode: null,
          minSubtotalCents: null,
        }),
      ),
    );
  });

  it.each([
    {
      label: 'network',
      failure: new ApiError('promo backend secret', null),
      code: '',
      key: 'checkout.error.network',
      copy: 'Shop-Server ist nicht erreichbar',
    },
    {
      label: 'unknown',
      failure: new Error('promo backend secret'),
      code: '',
      key: 'checkout.promoError.generic',
      copy: 'Aktionscode konnte nicht geprüft werden',
    },
    {
      label: 'coded',
      failure: new ApiError('promo backend secret', 400, {
        error: 'promo backend secret',
        code: 'PROMO_EXPIRED',
      }),
      code: 'PROMO_EXPIRED',
      key: 'checkout.promoError.generic',
      copy: 'Die Anfrage konnte nicht verarbeitet werden',
    },
  ])('localizes DE $label failures without API prose', async ({ failure, code, key, copy }) => {
    countryState.activeCountry = 'DE';
    vi.mocked(validatePromo).mockRejectedValueOnce(failure);
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <PromoErrorHarness />
      </LocaleProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByTestId('promo-error')).toHaveTextContent(copy);
    expect(screen.getByTestId('promo-error')).not.toHaveTextContent('promo backend secret');
    expect(screen.getByTestId('promo-error-code')).toHaveTextContent(code);
    expect(screen.getByTestId('promo-error-key')).toHaveTextContent(key);
  });
});
