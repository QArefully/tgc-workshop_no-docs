import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { Cart } from '@shop/contracts/cart';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as authApi from '@/api/auth';
import * as cartApi from '@/api/cart';
import * as productApi from '@/api/products';
import { ApiError } from '@/api/client';
import { CategoryNav } from '@/components/CategoryNav';
import { CountryBanner } from '@/components/CountryBanner';
import { AuthProvider } from '@/hooks/AuthContext';
import { CartProvider, useCartContext } from '@/hooks/CartContext';
import { CountryProvider } from '@/hooks/CountryContext';
import { LocaleProvider } from '@/i18n/LocaleContext';
import { setCartId, setCartStorage, type CartStorage } from '@/lib/cartStorage';
import { COUNTRY_STORAGE_KEY } from '@/lib/countryStorage';

vi.mock('@/api/auth');
vi.mock('@/api/cart', () => ({
  addToCart: vi.fn(),
  createCart: vi.fn(),
  getCart: vi.fn(),
  removeFromCart: vi.fn(),
  updateCartItem: vi.fn(),
}));
vi.mock('@/api/products', () => ({
  getCategories: vi.fn(),
  getProduct: vi.fn(),
  getSimilarProducts: vi.fn(),
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

function emptyCart(id: string): Cart {
  return {
    id,
    items: [],
    totalItems: 0,
    subtotalCents: 0,
    discountableSubtotalCents: 0,
    blendingFeeTotalCents: 0,
  };
}

function renderWithCountry(children: React.ReactNode) {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <CountryProvider storage={storage}>
          <LocaleProvider>{children}</LocaleProvider>
        </CountryProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

function AddItemProbe() {
  const { addItem, error, isCartAvailable } = useCartContext();
  return (
    <>
      <button
        type="button"
        disabled={!isCartAvailable}
        onClick={() => void addItem('country-availability-blocked-lot', 91, 4)}
      >
        Add blocked lot
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}

describe('Country availability buyer experience', () => {
  beforeEach(() => {
    STORAGE_STORE.clear();
    CART_STORE.clear();
    setCartStorage(cartStorage);
    vi.resetAllMocks();
    vi.mocked(authApi.getMe).mockReturnValue(new Promise<null>(() => {}));
  });

  afterEach(() => {
    setCartStorage(undefined);
  });

  it('renders the shared ES profile banner and no banner for a profile without copy', () => {
    STORAGE_STORE.set(COUNTRY_STORAGE_KEY, 'ES');
    const { unmount } = renderWithCountry(<CountryBanner />);
    expect(
      screen.getByText(
        'Pedidos para España: la disponibilidad y las opciones de entrega reflejan los requisitos locales.',
      ),
    ).toBeInTheDocument();
    unmount();

    STORAGE_STORE.set(COUNTRY_STORAGE_KEY, 'UK');
    const { container } = renderWithCountry(<CountryBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders only the category list returned by the country-scoped API', async () => {
    STORAGE_STORE.set(COUNTRY_STORAGE_KEY, 'CN');
    vi.mocked(productApi.getCategories).mockResolvedValue(['Baking & Pantry']);

    renderWithCountry(<CategoryNav />);

    expect(await screen.findByRole('link', { name: 'Baking & Pantry' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Sports Nutrition' })).not.toBeInTheDocument();
    expect(productApi.getCategories).toHaveBeenCalledOnce();
  });

  it('maps a blocked single-add response without stock or retirement wording', async () => {
    const user = userEvent.setup();
    STORAGE_STORE.set(COUNTRY_STORAGE_KEY, 'CN');
    setCartId('cart-cn', 'CN');
    vi.mocked(cartApi.getCart).mockResolvedValue(emptyCart('cart-cn'));
    vi.mocked(cartApi.addToCart).mockRejectedValue(
      new ApiError('This item is unavailable in the selected country.', 409, {
        error: 'This item is unavailable in the selected country.',
        code: 'BLOCKED_IN_COUNTRY',
      } as never),
    );

    renderWithCountry(
      <CartProvider>
        <AddItemProbe />
      </CartProvider>,
    );

    const addButton = screen.getByRole('button', { name: 'Add blocked lot' });
    await waitFor(() => expect(addButton).toBeEnabled());
    await user.click(addButton);

    const message = await screen.findByRole('alert');
    expect(message).toHaveTextContent('此商品无法在您所在的国家/地区订购。');
    expect(message).not.toHaveTextContent(/stock|retir|no longer sell/i);
  });
});
