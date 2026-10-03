import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { PublicUser } from '@shop/contracts/auth';
import type { Cart } from '@shop/contracts/cart';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as authApi from '@/api/auth';
import * as cartApi from '@/api/cart';
import { getCartId, setCartId, setCartStorage, type CartStorage } from '@/lib/cartStorage';
import { COUNTRY_STORAGE_KEY } from '@/lib/countryStorage';
import { AuthProvider } from '@/hooks/AuthContext';
import { CartProvider } from '@/hooks/CartContext';
import { CountryProvider } from '@/hooks/CountryContext';
import { NotificationsProvider } from '@/hooks/NotificationsContext';
import { SavedListsProvider } from '@/hooks/SavedListsContext';
import { Header } from '@/components/Header';
import { LoginPage } from './LoginPage';

vi.mock('@/api/auth');
vi.mock('@/api/cart', () => ({
  addToCart: vi.fn(),
  createCart: vi.fn(),
  getCart: vi.fn(),
  removeFromCart: vi.fn(),
  updateCartItem: vi.fn(),
}));
vi.mock('@/api/notifications', () => ({
  getNotifications: vi
    .fn()
    .mockResolvedValue({ items: [], total: 0, unreadTotal: 0, page: 1, pageSize: 25 }),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
}));
vi.mock('../components/CategoryNav', () => ({
  CategoryNav: () => <nav aria-label="Product categories">Materials</nav>,
}));
vi.mock('../components/SearchBar', () => ({
  SearchBar: () => <input aria-label="Search materials" />,
}));
vi.mock('../components/AccountMenu', () => ({
  AccountMenu: () => <button type="button">Account</button>,
}));
vi.mock('../hooks/useSavedLists', () => ({
  useSavedLists: () => ({ defaultList: null }),
}));
vi.mock('../components/CartSheet', () => ({
  CartSheet: () => <button type="button">Cart</button>,
}));

const STORAGE_STORE = new Map<string, string>();
const storage = {
  getItem: (key: string) => STORAGE_STORE.get(key) ?? null,
  setItem: (key: string, value: string) => {
    STORAGE_STORE.set(key, value);
  },
  removeItem: (key: string) => {
    STORAGE_STORE.delete(key);
  },
};

const CART_STORE = new Map<string, string>();
const cartStorage: CartStorage = {
  getItem: (key: string) => CART_STORE.get(key) ?? null,
  setItem: (key: string, value: string) => {
    CART_STORE.set(key, value);
  },
  removeItem: (key: string) => {
    CART_STORE.delete(key);
  },
};

function cart(id: string): Cart {
  return {
    id,
    items: [],
    totalItems: 0,
    subtotalCents: 0,
    discountableSubtotalCents: 0,
    blendingFeeTotalCents: 0,
  };
}

const DE_USER: PublicUser = {
  id: '1',
  email: 'dealer@example.test',
  displayName: 'DE Dealer',
  role: 'customer',
  country: 'DE',
};

function Home() {
  return <h1>Home</h1>;
}

function renderLoginJourney() {
  return render(
    <MemoryRouter
      initialEntries={['/login']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <AuthProvider>
        <CountryProvider storage={storage}>
          <CartProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/" element={<Home />} />
            </Routes>
          </CartProvider>
        </CountryProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

function renderHeader(user: PublicUser | null) {
  vi.mocked(authApi.getMe).mockResolvedValue(user);
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <CountryProvider storage={storage}>
          <NotificationsProvider>
            <CartProvider>
              <SavedListsProvider>
                <Header />
              </SavedListsProvider>
            </CartProvider>
          </NotificationsProvider>
        </CountryProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('Country login integration', () => {
  beforeEach(() => {
    STORAGE_STORE.clear();
    CART_STORE.clear();
    setCartStorage(cartStorage);
    vi.resetAllMocks();
    vi.mocked(authApi.getMe).mockResolvedValue(null);
    vi.mocked(cartApi.getCart).mockImplementation((id: string) => Promise.resolve(cart(id)));
  });

  afterEach(() => {
    setCartStorage(undefined);
  });

  it('sends country DE in the login request body', async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.login).mockResolvedValue(DE_USER);
    renderLoginJourney();

    await user.type(screen.getByLabelText('Email'), 'dealer@example.test');
    await user.type(screen.getByLabelText('Password'), 'password');
    await user.selectOptions(screen.getByLabelText('Country'), 'DE');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(authApi.login).toHaveBeenCalledWith({
        email: 'dealer@example.test',
        password: 'password',
        country: 'DE',
      });
    });
    expect(await screen.findByText('Home')).toBeInTheDocument();
  });

  it('shows account country disabled in header after login', async () => {
    // A conflicting guest selection must exist, otherwise "account country wins" is vacuous.
    STORAGE_STORE.set(COUNTRY_STORAGE_KEY, 'FR');
    setCartId('cart-fr', 'FR');
    setCartId('cart-de', 'DE');

    renderHeader(DE_USER);

    await waitFor(() => {
      const picker = screen.getByTestId('country-picker');
      expect(picker).toHaveValue('DE');
      expect(picker).toBeDisabled();
    });
    expect(screen.getByText('Account country')).toBeInTheDocument();
    // The account country also wins for the cart. The guest country applies only while the
    // session is still loading, so the settled cart, not the first one requested, is asserted.
    await waitFor(() => expect(vi.mocked(cartApi.getCart).mock.calls.at(-1)).toEqual(['cart-de']));
    expect(getCartId('DE')).toBe('cart-de');
    expect(getCartId('FR')).toBe('cart-fr');
    // The guest selection survives the account binding; it is overridden, not overwritten.
    expect(STORAGE_STORE.get(COUNTRY_STORAGE_KEY)).toBe('FR');
  });

  it('does not let the guest cart follow a country switch', async () => {
    const user = userEvent.setup();
    setCartId('cart-us', 'US');
    setCartId('cart-de', 'DE');
    renderHeader(null);

    await waitFor(() => expect(cartApi.getCart).toHaveBeenCalledWith('cart-us'));
    await waitFor(() => {
      expect(screen.getByTestId('country-picker')).not.toBeDisabled();
    });

    await user.selectOptions(screen.getByTestId('country-picker'), 'DE');

    // The DE cart is resolved fresh; the US cart id is neither reused nor overwritten.
    await waitFor(() => expect(cartApi.getCart).toHaveBeenCalledWith('cart-de'));
    expect(cartApi.createCart).not.toHaveBeenCalled();
    expect(getCartId('US')).toBe('cart-us');
    expect(getCartId('DE')).toBe('cart-de');
    expect(vi.mocked(cartApi.getCart).mock.calls.at(-1)).toEqual(['cart-de']);
  });

  it('does not show cart message on country change with empty guest cart', async () => {
    const user = userEvent.setup();
    renderHeader(null);

    await waitFor(() => {
      expect(screen.getByTestId('country-picker')).not.toBeDisabled();
    });

    await user.selectOptions(screen.getByTestId('country-picker'), 'DE');

    expect(screen.queryByTestId('country-cart-message')).not.toBeInTheDocument();
  });
});
