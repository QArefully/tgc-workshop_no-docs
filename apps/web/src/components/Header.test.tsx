import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Header } from './Header';

const savedLists = vi.hoisted(() => ({ defaultList: null as { items: unknown[] } | null }));
const authState = vi.hoisted(() => ({
  user: null as { id?: string; country?: string; role?: string } | null,
}));
const countryState = vi.hoisted(() => ({
  activeCountry: 'US',
  isAccountBound: false,
  selectCountry: vi.fn(),
}));
const cartState = vi.hoisted(() => ({ cart: null as { totalItems: number } | null }));

vi.mock('./CategoryNav', () => ({
  CategoryNav: () => <nav aria-label="Product categories">Materials</nav>,
}));
vi.mock('./SearchBar', () => ({ SearchBar: () => <input aria-label="Search materials" /> }));
vi.mock('./AccountMenu', () => ({ AccountMenu: () => <button type="button">Account</button> }));
vi.mock('./CountryPicker', () => ({
  CountryPicker: ({
    value,
    disabled,
    onChange,
  }: {
    value: string;
    disabled?: boolean;
    onChange: (country: string) => void;
  }) => (
    <select
      data-testid="country-picker"
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      {value !== 'US' && value !== 'DE' && <option value={value}>{value}</option>}
      <option value="US">US</option>
      <option value="DE">DE</option>
    </select>
  ),
}));
vi.mock('@/hooks/useSavedLists', () => ({
  useSavedLists: () => savedLists,
}));
vi.mock('@/hooks/AuthContext', () => ({
  useAuth: () => authState,
}));
vi.mock('@/hooks/CountryContext', () => ({
  useCountry: () => countryState,
}));
vi.mock('@/hooks/CartContext', () => ({
  useCartContext: () => cartState,
}));
vi.mock('./CartSheet', () => ({ CartSheet: () => <button type="button">Cart</button> }));
vi.mock('@/features/notifications/NotificationBell', () => ({
  NotificationBell: () => null,
}));

describe('Header', () => {
  beforeEach(() => {
    savedLists.defaultList = null;
    authState.user = null;
    countryState.activeCountry = 'US';
    countryState.isAccountBound = false;
    countryState.selectCountry.mockClear();
    cartState.cart = null;
  });

  it('presents QArefully Materials Exchange without a category-nav tagline', () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Header />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'QArefully Materials Exchange' })).toHaveAttribute(
      'href',
      '/',
    );
    expect(screen.queryByText(/Materials data/)).not.toBeInTheDocument();
  });

  it('links to saved lists and shows the default-list item count', () => {
    savedLists.defaultList = { items: [{}, {}] };
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Header />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Saved lists (2)' })).toHaveAttribute('href', '/lists');
    expect(screen.getByText('2')).toBeInTheDocument();
    savedLists.defaultList = null;
  });

  it('renders the country picker inside the customer tools group', () => {
    countryState.activeCountry = 'DE' as const;
    authState.user = null;
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Header />
      </MemoryRouter>,
    );

    const picker = screen.getByTestId('country-picker');
    expect(picker).toHaveValue('DE');
    expect(picker).not.toBeDisabled();
  });

  it('disables the country picker for signed-in non-admin users', () => {
    authState.user = { id: '1', country: 'UK', role: 'customer' };
    countryState.activeCountry = 'UK' as const;
    countryState.isAccountBound = true;
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Header />
      </MemoryRouter>,
    );

    const picker = screen.getByTestId('country-picker');
    expect(picker).toBeDisabled();
  });

  // Stage 2 decision: admins can switch the browsing country while customer accounts stay pinned.
  it('allows admins to change the country picker in stage 2', () => {
    authState.user = { id: '2', country: 'UK', role: 'admin' };
    countryState.activeCountry = 'UK' as const;
    countryState.isAccountBound = false;
    countryState.selectCountry.mockClear();
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Header />
      </MemoryRouter>,
    );

    const picker = screen.getByTestId('country-picker');
    expect(picker).not.toBeDisabled();

    fireEvent.change(picker, { target: { value: 'DE' } });
    expect(countryState.selectCountry).toHaveBeenCalledWith('DE');
  });

  it('shows the cart country notice below the navigation instead of in the customer tools row', () => {
    cartState.cart = { totalItems: 3 };
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Header />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByTestId('country-picker'), { target: { value: 'DE' } });

    const notice = screen.getByTestId('country-cart-message');
    const categoryNav = screen.getByRole('navigation', { name: 'Product categories' });
    const customerTools = screen.getByRole('group');
    expect(notice).toHaveTextContent(
      'Your cart is tied to the previous country and will not follow this switch.',
    );
    expect(categoryNav.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(within(customerTools).queryByTestId('country-cart-message')).not.toBeInTheDocument();
  });

  it('clears the cart country notice when the buyer switches back to the origin country', () => {
    cartState.cart = { totalItems: 3 };
    const view = render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Header />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByTestId('country-picker'), { target: { value: 'DE' } });
    expect(screen.getByTestId('country-cart-message')).toBeInTheDocument();

    countryState.activeCountry = 'DE';
    view.rerender(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Header />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByTestId('country-picker'), { target: { value: 'US' } });
    expect(screen.queryByTestId('country-cart-message')).not.toBeInTheDocument();
  });
});
