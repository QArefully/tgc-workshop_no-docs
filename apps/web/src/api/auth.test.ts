import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMe } from './auth';
import { ApiError } from './client';

describe('getMe', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects malformed successful responses at browser boundary', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: 123, email: 'shopper@example.test' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await expect(getMe()).rejects.toMatchObject({ name: 'ApiContractError', path: '/me' });
  });

  it('returns successful values decoded by the response schema', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(null), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await expect(getMe()).resolves.toBeNull();
  });

  it('keeps non-success responses as ApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Not authenticated' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await expect(getMe()).rejects.toBeInstanceOf(ApiError);
  });
});
