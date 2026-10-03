import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Type } from '@sinclair/typebox';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicUser } from '@shop/contracts/auth';
import { apiFetch } from '@/api/client';
import { CountryProvider, useCountry } from './CountryContext';
import type { CountryStorage } from '@/lib/countryStorage';
import { readSelectedCountry, writeSelectedCountry } from '@/lib/countryStorage';

vi.mock('@/hooks/AuthContext', () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from '@/hooks/AuthContext';

function guestUser(): ReturnType<typeof useAuth> {
  return { user: null, loading: false, login: null!, signup: null!, logout: null! };
}

function authenticatedUser(country: string): ReturnType<typeof useAuth> {
  return {
    user: {
      id: '123',
      email: 'test@example.com',
      displayName: 'Test',
      role: 'customer',
      country,
    } as PublicUser,
    loading: false,
    login: null!,
    signup: null!,
    logout: null!,
  };
}

function adminUser(country: string): ReturnType<typeof useAuth> {
  return {
    user: {
      id: 'admin-123',
      email: 'admin@example.com',
      displayName: 'Admin',
      role: 'admin',
      country,
    } as PublicUser,
    loading: false,
    login: null!,
    signup: null!,
    logout: null!,
  };
}

function memoryStorage(): CountryStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
}

describe('CountryContext', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to DEFAULT_GUEST_COUNTRY for a guest visitor with no stored selection', () => {
    vi.mocked(useAuth).mockReturnValue(guestUser());
    const storage = memoryStorage();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <CountryProvider storage={storage}>{children}</CountryProvider>
    );
    const { result } = renderHook(() => useCountry(), { wrapper });
    expect(result.current.activeCountry).toBe('US');
    expect(result.current.isAccountBound).toBe(false);
  });

  it('reads a stored guest selection on mount', () => {
    vi.mocked(useAuth).mockReturnValue(guestUser());
    const storage = memoryStorage();
    writeSelectedCountry(storage, 'DE');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <CountryProvider storage={storage}>{children}</CountryProvider>
    );
    const { result } = renderHook(() => useCountry(), { wrapper });
    expect(result.current.activeCountry).toBe('DE');
    expect(result.current.isAccountBound).toBe(false);
  });

  it('persists a guest country change through selectCountry', () => {
    vi.mocked(useAuth).mockReturnValue(guestUser());
    const storage = memoryStorage();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <CountryProvider storage={storage}>{children}</CountryProvider>
    );
    const { result } = renderHook(() => useCountry(), { wrapper });

    act(() => {
      result.current.selectCountry('FR');
    });

    expect(result.current.activeCountry).toBe('FR');
    expect(readSelectedCountry(storage)).toBe('FR');
  });

  it('prevents selectCountry from overriding the account country', () => {
    vi.mocked(useAuth).mockReturnValue(authenticatedUser('UK'));
    const storage = memoryStorage();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <CountryProvider storage={storage}>{children}</CountryProvider>
    );
    const { result } = renderHook(() => useCountry(), { wrapper });

    expect(result.current.activeCountry).toBe('UK');
    expect(result.current.isAccountBound).toBe(true);

    act(() => {
      result.current.selectCountry('US');
    });

    expect(result.current.activeCountry).toBe('UK');
    expect(readSelectedCountry(storage)).toBe('US');
  });

  it('account country wins when user is present', () => {
    vi.mocked(useAuth).mockReturnValue(authenticatedUser('CN'));
    const storage = memoryStorage();
    writeSelectedCountry(storage, 'US');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <CountryProvider storage={storage}>{children}</CountryProvider>
    );
    const { result } = renderHook(() => useCountry(), { wrapper });
    expect(result.current.activeCountry).toBe('CN');
    expect(result.current.isAccountBound).toBe(true);
  });

  it('lets an admin persist a browsing-country selection', () => {
    vi.mocked(useAuth).mockReturnValue(adminUser('UK'));
    const storage = memoryStorage();
    writeSelectedCountry(storage, 'US');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <CountryProvider storage={storage}>{children}</CountryProvider>
    );
    const { result, unmount } = renderHook(() => useCountry(), { wrapper });

    expect(result.current.activeCountry).toBe('US');
    expect(result.current.isAccountBound).toBe(false);

    act(() => {
      result.current.selectCountry('FR');
    });

    expect(result.current.activeCountry).toBe('FR');
    expect(readSelectedCountry(storage)).toBe('FR');

    unmount();
    const remounted = renderHook(() => useCountry(), { wrapper });
    expect(remounted.result.current.activeCountry).toBe('FR');
  });

  it('updates and clears the API country header with the provider lifecycle', async () => {
    vi.mocked(useAuth).mockReturnValue(guestUser());
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return Promise.resolve(
        new Response('true', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const storage = memoryStorage();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <CountryProvider storage={storage}>{children}</CountryProvider>
    );
    const { result, unmount } = renderHook(() => useCountry(), { wrapper });

    await apiFetch(Type.Boolean(), '/api/header-probe');
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('x-shop-country')).toBe('US');

    act(() => {
      result.current.selectCountry('DE');
    });
    await apiFetch(Type.Boolean(), '/api/header-probe');
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get('x-shop-country')).toBe('DE');

    unmount();
    await apiFetch(Type.Boolean(), '/api/header-probe');
    expect(new Headers(fetchMock.mock.calls[2]?.[1]?.headers).has('x-shop-country')).toBe(false);
  });

  it('exposes countryStorage for test inspection', () => {
    vi.mocked(useAuth).mockReturnValue(guestUser());
    const storage = memoryStorage();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <CountryProvider storage={storage}>{children}</CountryProvider>
    );
    const { result } = renderHook(() => useCountry(), { wrapper });
    expect(result.current.countryStorage).toBe(storage);
  });
});
