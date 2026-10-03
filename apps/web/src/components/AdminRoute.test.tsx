import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { PublicUser } from '@shop/contracts/auth';
import { describe, expect, it, vi } from 'vitest';
import { AdminRoute } from './AdminRoute';

const authState = vi.hoisted(() => ({
  user: null as PublicUser | null,
  loading: false,
}));

vi.mock('@/hooks/AuthContext', () => ({ useAuth: () => authState }));

function Location() {
  const location = useLocation();
  return <output>{`${location.pathname}${location.search}${location.hash}`}</output>;
}

function renderRoute() {
  return render(
    <MemoryRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      initialEntries={['/admin/reviews?queue=hidden#item-1']}
    >
      <Routes>
        <Route
          path="/admin/reviews"
          element={
            <AdminRoute>
              <p>Admin review queue</p>
            </AdminRoute>
          }
        />
        <Route path="/login" element={<Location />} />
        <Route path="/" element={<Location />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AdminRoute', () => {
  it('does not render protected content while access is loading', () => {
    authState.user = null;
    authState.loading = true;
    renderRoute();

    expect(screen.getByLabelText('Checking access')).toBeInTheDocument();
    expect(screen.queryByText('Admin review queue')).not.toBeInTheDocument();
  });

  it('sends anonymous visitors to sign-in with full return location', () => {
    authState.user = null;
    authState.loading = false;
    renderRoute();

    expect(screen.getByText('/login')).toBeInTheDocument();
  });

  it('keeps customer visitors out of admin content', () => {
    authState.user = {
      id: 'customer-1',
      email: 'customer@example.test',
      displayName: 'Customer',
      role: 'customer',
      country: 'UK',
    };
    authState.loading = false;
    renderRoute();

    expect(screen.getByText('/')).toBeInTheDocument();
    expect(screen.queryByText('Admin review queue')).not.toBeInTheDocument();
  });

  it('renders content for administrators', () => {
    authState.user = {
      id: 'admin-1',
      email: 'admin@example.test',
      displayName: 'Admin',
      role: 'admin',
      country: 'UK',
    };
    authState.loading = false;
    renderRoute();

    expect(screen.getByText('Admin review queue')).toBeInTheDocument();
  });
});
