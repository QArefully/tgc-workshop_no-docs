import { Type } from '@sinclair/typebox';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch, setActiveApiCountry } from './client';

const responseSchema = Type.Object({ ok: Type.Literal(true) });

afterEach(() => {
  vi.unstubAllGlobals();
  setActiveApiCountry(null);
});

describe('api error descriptors', () => {
  it('exposes stable code and safe metadata from a coded response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json(
          {
            error: 'There is not enough stock for this order.',
            code: 'INSUFFICIENT_STOCK',
            meta: { productIds: ['42'] },
          },
          { status: 409 },
        ),
      ),
    );
    setActiveApiCountry('DE');

    const error = await apiFetch(responseSchema, '/api/test').catch((value: unknown) => value);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('INSUFFICIENT_STOCK');
    expect((error as ApiError).meta).toEqual({ productIds: ['42'] });
    expect((error as ApiError).requestCountry).toBe('DE');
    expect((error as ApiError).country).toBe('DE');
  });

  it('captures the request country before a later country switch', async () => {
    let resolveResponse!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    const fetchMock = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockReturnValue(pending);
    vi.stubGlobal('fetch', fetchMock);
    setActiveApiCountry('DE');
    const request = apiFetch(responseSchema, '/api/test');
    setActiveApiCountry('FR');
    resolveResponse(Response.json({ error: 'failed', code: 'INTERNAL_ERROR' }, { status: 500 }));

    const error = await request.catch((value: unknown) => value);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/test',
      expect.objectContaining({ headers: expect.any(Headers) as unknown }),
    );
    const init = fetchMock.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get('x-shop-country')).toBe('DE');
    expect((error as ApiError).requestCountry).toBe('DE');
  });

  it('keeps legacy prose responses usable without a machine code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ error: 'Legacy failure' }, { status: 400 })),
    );

    const error = await apiFetch(responseSchema, '/api/test').catch((value: unknown) => value);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe('Legacy failure');
    expect((error as ApiError).code).toBeNull();
    expect((error as ApiError).meta).toBeNull();
  });
});
