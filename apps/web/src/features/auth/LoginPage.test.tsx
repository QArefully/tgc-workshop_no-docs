import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { PublicUser } from '@shop/contracts/auth';
import { translateUnchecked } from '@shop/localisation';
import { identityAccountMessages } from '@shop/localisation/messages/identityAccount';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/client';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { LoginPage } from './LoginPage';

const authState = vi.hoisted(() => ({
  user: null as PublicUser | null,
  loading: false,
  login: vi.fn(),
}));

vi.mock('@/hooks/AuthContext', () => ({
  useAuth: () => authState,
}));

vi.mock('@/hooks/CountryContext', () => ({
  useCountry: () => ({ activeCountry: 'DE' as const }),
}));

function Location() {
  const location = useLocation();
  return <output>{`${location.pathname}${location.search}${location.hash}`}</output>;
}

function LoginLocation() {
  const location = useLocation();
  return <output>{JSON.stringify(location.state)}</output>;
}

function renderLogin(initialEntry: string | { pathname: string; state?: unknown }) {
  return render(
    <MemoryRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      initialEntries={[initialEntry]}
    >
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Location />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function submitLogin() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Email'), 'shopper@example.test');
  await user.type(screen.getByLabelText('Password'), 'password');
  await user.click(screen.getByRole('button', { name: 'Sign In' }));
}

describe('login return navigation', () => {
  it('returns to a safe product URL after successful login', async () => {
    authState.login.mockReset().mockResolvedValue({});
    renderLogin({
      pathname: '/login',
      state: { from: '/products/powdered-water?sort=highest#reviews' },
    });

    await submitLogin();

    expect(
      await screen.findByText('/products/powdered-water?sort=highest#reviews'),
    ).toBeInTheDocument();
    expect(authState.login).toHaveBeenCalledWith('shopper@example.test', 'password', 'DE');
  });

  it('falls back to home for direct and hostile return values', async () => {
    authState.login.mockReset().mockResolvedValue({});
    const direct = renderLogin('/login');
    await submitLogin();
    expect(await screen.findByText('/')).toBeInTheDocument();
    direct.unmount();

    renderLogin({ pathname: '/login', state: { from: '//evil.example' } });
    await submitLogin();
    expect(await screen.findByText('/')).toBeInTheDocument();
  });

  it('does not navigate after a failed login', async () => {
    authState.login
      .mockReset()
      .mockRejectedValue(
        new ApiError(
          'Invalid credentials',
          401,
          { error: 'Invalid credentials', code: 'UNAUTHORIZED' },
          'DE',
        ),
      );
    renderLogin({ pathname: '/login', state: { from: '/products/powdered-water' } });

    await submitLogin();

    expect(
      screen.getByText(translateUnchecked(identityAccountMessages, 'DE', 'auth.signIn.failed')),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sign In' })).toBeInTheDocument();
  });

  it('preserves pathname, search, and hash when redirecting a protected route', async () => {
    authState.user = null;
    authState.loading = false;
    render(
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        initialEntries={['/account?tab=orders#recent']}
      >
        <Routes>
          <Route
            path="/account"
            element={
              <ProtectedRoute>
                <p>Account</p>
              </ProtectedRoute>
            }
          />
          <Route path="/login" element={<LoginLocation />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('{"from":"/account?tab=orders#recent"}')).toBeInTheDocument();
  });
});
