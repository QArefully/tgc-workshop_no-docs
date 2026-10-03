import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { translateUnchecked } from '@shop/localisation';
import { identityAccountMessages } from '@shop/localisation/messages/identityAccount';
import { LoginPage } from './LoginPage';
import { AuthProvider } from '@/hooks/AuthContext';
import { CountryProvider, useCountry } from '@/hooks/CountryContext';
import type { CountryStorage } from '@/lib/countryStorage';

const storage: CountryStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

function BrowseCountryActions() {
  const { selectCountry } = useCountry();
  return (
    <>
      <button type="button" onClick={() => selectCountry('DE')}>
        Browse DE
      </button>
      <button type="button" onClick={() => selectCountry('FR')}>
        Browse FR
      </button>
    </>
  );
}

function requestPath(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function requestBody(init?: RequestInit): string {
  if (typeof init?.body !== 'string') throw new Error('Expected JSON request body');
  return init.body;
}

describe('LoginPage client-path country error authority', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = requestPath(input);
        if (path === '/me') return Response.json(null);
        if (path === '/login') {
          expect(JSON.parse(requestBody(init))).toEqual({
            email: 'dealer@example.test',
            password: 'password',
            country: 'DE',
          });
          return Response.json(
            { error: 'Invalid credentials', code: 'UNAUTHORIZED' },
            { status: 401 },
          );
        }
        throw new Error(`Unexpected request ${path}`);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses submitted DE sign-in copy when active browsing country remains US', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter
        initialEntries={['/login']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <AuthProvider>
          <CountryProvider storage={storage}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
            </Routes>
            <BrowseCountryActions />
          </CountryProvider>
        </AuthProvider>
      </MemoryRouter>,
    );

    await user.type(await screen.findByLabelText('Email'), 'dealer@example.test');
    await user.type(screen.getByLabelText('Password'), 'password');
    await user.selectOptions(screen.getByLabelText('Country'), 'DE');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));

    expect(
      await screen.findByText(
        translateUnchecked(identityAccountMessages, 'DE', 'auth.signIn.failed'),
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(translateUnchecked(identityAccountMessages, 'US', 'auth.signIn.failed')),
    ).not.toBeInTheDocument();
  });

  it('relocalizes validation fallback after active browsing-country switch', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter
        initialEntries={['/login']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <AuthProvider>
          <CountryProvider storage={storage}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
            </Routes>
            <BrowseCountryActions />
          </CountryProvider>
        </AuthProvider>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole('button', { name: 'Sign In' }));
    expect(
      await screen.findByText(
        translateUnchecked(identityAccountMessages, 'US', 'auth.signIn.required'),
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Browse DE' }));
    expect(
      await screen.findByText(
        translateUnchecked(identityAccountMessages, 'DE', 'auth.signIn.required'),
      ),
    ).toBeInTheDocument();
  });

  it('keeps submitted DE API copy after active browsing-country switch during request', async () => {
    const user = userEvent.setup();
    let resolveLogin!: (response: Response) => void;
    const loginResponse = new Promise<Response>((resolve) => {
      resolveLogin = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = requestPath(input);
        if (path === '/me') return Response.json(null);
        if (path === '/login') {
          expect(JSON.parse(requestBody(init))).toMatchObject({ country: 'DE' });
          return loginResponse;
        }
        throw new Error(`Unexpected request ${path}`);
      }),
    );

    render(
      <MemoryRouter
        initialEntries={['/login']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <AuthProvider>
          <CountryProvider storage={storage}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
            </Routes>
            <BrowseCountryActions />
          </CountryProvider>
        </AuthProvider>
      </MemoryRouter>,
    );

    await user.type(await screen.findByLabelText('Email'), 'dealer@example.test');
    await user.type(screen.getByLabelText('Password'), 'password');
    await user.selectOptions(screen.getByLabelText('Country'), 'DE');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Signing in/ })).toBeDisabled());

    await user.click(screen.getByRole('button', { name: 'Browse FR' }));
    resolveLogin(
      Response.json({ error: 'Invalid credentials', code: 'UNAUTHORIZED' }, { status: 401 }),
    );

    expect(
      await screen.findByText(
        translateUnchecked(identityAccountMessages, 'DE', 'auth.signIn.failed'),
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(translateUnchecked(identityAccountMessages, 'FR', 'auth.signIn.failed')),
    ).not.toBeInTheDocument();
  });
});
