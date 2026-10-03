import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from './client';
import { getCompanyCredit, getTradeCreditSummary } from './tradeCredit';
import { CreditAccountMemberResponse } from '@shop/contracts/trade-credit';

vi.mock('./client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./client')>();
  return { ...actual, apiFetch: vi.fn() };
});

describe('trade credit API', () => {
  beforeEach(() => vi.mocked(apiFetch).mockReset());

  it('uses the member-scoped endpoint and shared response schema', () => {
    const signal = new AbortController().signal;
    vi.mocked(apiFetch).mockResolvedValue(null);

    void getTradeCreditSummary({ signal });

    expect(apiFetch).toHaveBeenCalledWith(CreditAccountMemberResponse, '/api/company/credit', {
      signal,
    });
  });

  it('keeps the company-credit compatibility name on the same strict client', () => {
    vi.mocked(apiFetch).mockResolvedValue(null);

    void getCompanyCredit();

    expect(apiFetch).toHaveBeenCalledWith(CreditAccountMemberResponse, '/api/company/credit', {
      signal: undefined,
    });
  });

  it('does not add caller-supplied company or accounting fields', () => {
    const signal = new AbortController().signal;
    vi.mocked(apiFetch).mockResolvedValue(null);

    void getTradeCreditSummary({ signal });

    const options = vi.mocked(apiFetch).mock.calls[0]?.[2] as Record<string, unknown>;
    expect(Object.keys(options)).toEqual(['signal']);
    expect(options).not.toHaveProperty('body');
  });
});
