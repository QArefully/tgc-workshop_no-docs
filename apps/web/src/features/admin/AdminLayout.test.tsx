import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AdminRoute } from '@/components/AdminRoute';
import { LocaleProvider } from '@/i18n/LocaleContext';
import { AdminIndexPage } from './AdminIndexPage';
import { AdminLayout } from './AdminLayout';

const authState = vi.hoisted(() => ({
  loading: false,
  user: {
    id: 'admin-1',
    email: 'admin@example.test',
    displayName: 'Admin',
    role: 'admin',
  },
}));

vi.mock('@/hooks/AuthContext', () => ({ useAuth: () => authState }));

const countryState = vi.hoisted(() => ({ activeCountry: 'DE' as const }));

vi.mock('@/hooks/CountryContext', () => ({
  useCountry: () => ({
    activeCountry: countryState.activeCountry,
    isAccountBound: false,
    selectCountry: vi.fn(),
    countryStorage: null,
  }),
}));

describe('AdminLayout', () => {
  it('renders administration navigation and mounts the index inside AdminRoute', () => {
    render(
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        initialEntries={['/admin']}
      >
        <Routes>
          <Route
            path="/admin"
            element={
              <AdminRoute>
                <LocaleProvider>
                  <AdminLayout />
                </LocaleProvider>
              </AdminRoute>
            }
          >
            <Route index element={<AdminIndexPage />} />
          </Route>
          <Route path="/login" element={<p>Login</p>} />
          <Route path="/" element={<p>Home</p>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Administrationsübersicht' })).toBeInTheDocument();
    expect(screen.getByTestId('admin-standing-country')).toHaveTextContent('Aktuelles Land: DE');
    expect(
      screen.getByText('Jobs, Webhooks und Feature-Flags sind globale Bereiche.'),
    ).toBeInTheDocument();
    const navigation = screen.getByRole('navigation', { name: 'Administration' });
    expect(navigation).toHaveTextContent('Übersicht');
    expect(navigation).toHaveTextContent('Produkte');
    expect(navigation).toHaveTextContent('Varianten');
    expect(navigation).toHaveTextContent('Aktionen');
    expect(navigation).toHaveTextContent('Benutzer');
    expect(navigation).toHaveTextContent('Bestellungen');
    expect(navigation).toHaveTextContent('Kreditkonten');
    expect(navigation).toHaveTextContent('Rechnungen');
    expect(navigation).toHaveTextContent('Jobs');
    expect(navigation).toHaveTextContent('Webhooks');
    expect(navigation).toHaveTextContent('Feature-Flags');
    expect(navigation).toHaveTextContent('Bewertungsmoderation');

    expect(within(navigation).getByRole('link', { name: 'Produkte' })).toHaveAttribute(
      'href',
      '/admin/products',
    );
    expect(within(navigation).getByRole('link', { name: 'Bewertungsmoderation' })).toHaveAttribute(
      'href',
      '/admin/reviews',
    );
    expect(within(navigation).getByRole('link', { name: 'Kreditkonten' })).toHaveAttribute(
      'href',
      '/admin/credit-accounts',
    );
    expect(within(navigation).getByRole('link', { name: 'Rechnungen' })).toHaveAttribute(
      'href',
      '/admin/invoices',
    );
    expect(screen.getByRole('link', { name: 'Firmenkredit' })).toHaveAttribute(
      'href',
      '/admin/credit-accounts',
    );
    expect(
      screen.getByRole('link', { name: 'Rechnungen aus dem Kauf auf Rechnung' }),
    ).toHaveAttribute('href', '/admin/invoices');
  });
});
