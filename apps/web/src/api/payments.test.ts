import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PaymentSuccessResponse } from '@shop/contracts/payments';
import type { PaymentBody } from '@shop/contracts/payments';
import { apiFetch } from './client';
import { pay } from './payments';

vi.mock('./client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./client')>();
  return { ...actual, apiFetch: vi.fn() };
});

describe('payments API', () => {
  beforeEach(() => vi.mocked(apiFetch).mockReset());

  it('validates the successful order response and forwards an abort signal', () => {
    const signal = new AbortController().signal;
    const body = { paymentMethod: 'trade_credit' } as PaymentBody;
    vi.mocked(apiFetch).mockResolvedValue({});

    void pay(body, { signal });

    expect(apiFetch).toHaveBeenCalledWith(PaymentSuccessResponse, '/api/payments/pay', {
      method: 'POST',
      body: JSON.stringify(body),
      signal,
    });
  });

  it('keeps the historical call shape when no options are supplied', () => {
    const body = { cardNumber: '424242424242', cardExpiry: '01/30', cardCvc: '123' } as PaymentBody;
    vi.mocked(apiFetch).mockResolvedValue({});

    void pay(body);

    expect(apiFetch).toHaveBeenCalledWith(PaymentSuccessResponse, '/api/payments/pay', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  });
});
