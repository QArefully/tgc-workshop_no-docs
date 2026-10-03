import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import type { Cart, CartLine } from '@shop/contracts/cart';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { useCartContext } from '@/hooks/CartContext';
import type { useCart } from '@/hooks/useCart';
import { CountryProvider } from '@/hooks/CountryContext';
import { LocaleProvider } from '@/i18n/LocaleContext';
import type { CountryStorage } from '@/lib/countryStorage';
import { CartPage } from './CartPage';

vi.mock('@/hooks/CartContext', () => ({ useCartContext: vi.fn() }));

const plainLine: CartLine = {
  productId: '1',
  product: {
    id: '1',
    name: 'Pallet material',
    description: 'Test material.',
    priceCents: 1000,
    imageSetId: 'test-material',
    category: 'Trade',
    stock: 10,
    availability: 'in_stock',
    backorderable: false,
    backorderLeadDays: null,
    slug: 'test-material',
    salesCount: 0,
    createdAt: '2026-07-14T00:00:00.000Z',
    available: true,
    tags: [],
    specificationGroups: [],
  },
  variantSnap: {
    variantId: 1,
    sku: 'MAT-001',
    label: '25kg sack',
    weightGrams: 25000,
    deliveryClass: 'freight',
  },
  perTonneCents: 40000,
  resolvedUnitPriceCents: 1000,
  quantity: 1,
  configKey: '',
  materialSubtotalCents: 1000,
  blendingFeeCents: 0,
  discountableTotalCents: 1000,
  lineTotalCents: 1000,
};

const cart: Cart = {
  id: '58f1b5ed-3dbf-4c3c-908e-c71d7e7bf912',
  items: [plainLine],
  subtotalCents: 1000,
  discountableSubtotalCents: 1000,
  blendingFeeTotalCents: 0,
  totalItems: 1,
  deliveryPreview: {
    mode: 'freight',
    chargeCents: 999,
    weightGrams: 100000,
    reason: 'Freight threshold reached',
  },
};

interface CartContextOverrides {
  cart?: Cart;
  updateQuantity?: ReturnType<typeof vi.fn>;
  isActionPending?: ReturnType<typeof vi.fn>;
}

function renderCart(
  error: string | null = null,
  overrides: CartContextOverrides = {},
  country: 'US' | 'DE' = 'US',
) {
  vi.mocked(useCartContext).mockReturnValue({
    cart: overrides.cart ?? cart,
    isLoading: false,
    isInitializing: false,
    error,
    updateQuantity: overrides.updateQuantity ?? vi.fn(),
    removeItem: vi.fn(),
    retryCart: vi.fn(),
    isActionPending: overrides.isActionPending ?? vi.fn(),
  } as unknown as ReturnType<typeof useCart>);
  const content: ReactNode = (
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <CartPage />
    </MemoryRouter>
  );
  if (country === 'US') return render(content);
  const storage: CountryStorage = {
    getItem: () => country,
    setItem: () => undefined,
    removeItem: () => undefined,
  };
  return render(
    <CountryProvider storage={storage}>
      <LocaleProvider>{content}</LocaleProvider>
    </CountryProvider>,
  );
}

const CONFIG_KEY_A = 'a'.repeat(64);
const CONFIG_KEY_B = 'b'.repeat(64);

/**
 * Two configured lines over the SAME base variant, distinguished only by config key. This is the
 * only shape in which config-key line identity is load-bearing: drop the key from the render key or
 * the pending key and the two lines start sharing state.
 */
function blendLine(configKey: string, fillerName: string, quantity: number): CartLine {
  return {
    ...plainLine,
    configKey,
    quantity,
    blendingFeeCents: 2_500,
    lineTotalCents: 3_500,
    customBlend: {
      configKey,
      basePercentage: 80,
      mixingGroup: 'mineral',
      ingredients: [
        {
          variantId: 601,
          productId: '11',
          productName: fillerName,
          productDescription: 'Filler',
          mixingGroup: 'mineral',
          percentage: 20,
        },
      ],
      blendingFeeCents: 2_500,
      madeToOrder: true,
      returnable: false,
    },
  };
}

const twoBlendCart: Cart = {
  ...cart,
  items: [blendLine(CONFIG_KEY_A, 'Chalk Filler', 1), blendLine(CONFIG_KEY_B, 'Silica Flour', 4)],
  totalItems: 5,
  blendingFeeTotalCents: 5_000,
};

describe('CartPage', () => {
  it('frames session-held lines, resolved totals, and server delivery weight as an order', () => {
    renderCart();

    expect(screen.getByRole('heading', { name: 'Your pallet order' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Lines held in your order for this session. Adjust pallet quantities before checkout.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Resolved order subtotal (1 unit)')).toBeInTheDocument();
    expect(screen.getAllByText('$12.50')).not.toHaveLength(0);
    expect(screen.getByText(/Resolved pack price: \$12.50/)).toBeInTheDocument();
    expect(screen.getByText(/\$500.00 \/ tonne/)).toBeInTheDocument();
    expect(screen.getByText(/25 kg pack/)).toBeInTheDocument();
    expect(
      screen.getByText(/Pallet freight scheduled after order confirmation/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Total order weight: 100 kg/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Quick order by item code' })).toHaveAttribute(
      'href',
      '/quick-order',
    );
  });

  it('keeps two blends over one base variant as independent lines keyed by config key', async () => {
    const user = userEvent.setup();
    const updateQuantity = vi.fn().mockResolvedValue(true);
    const isActionPending = vi.fn().mockReturnValue(false);
    // React only reports colliding list keys through console.error, so a lost config-key segment is
    // otherwise silent.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    renderCart(null, { cart: twoBlendCart, updateQuantity, isActionPending });

    // Both compositions reach the screen: neither line is collapsed into or overwritten by the other.
    expect(screen.getByText('80% Pallet material — 20% Chalk Filler')).toBeInTheDocument();
    expect(screen.getByText('80% Pallet material — 20% Silica Flour')).toBeInTheDocument();

    const duplicateKeyWarnings = consoleError.mock.calls.filter((call) =>
      call.some((argument) => String(argument).includes('same key')),
    );
    consoleError.mockRestore();
    expect(duplicateKeyWarnings).toEqual([]);

    // Pending state is queried per config key, so a spinner on one line cannot disable the other.
    expect(isActionPending).toHaveBeenCalledWith('1', 'update', 1, CONFIG_KEY_A);
    expect(isActionPending).toHaveBeenCalledWith('1', 'update', 1, CONFIG_KEY_B);
    expect(isActionPending).toHaveBeenCalledWith('1', 'remove', 1, CONFIG_KEY_A);
    expect(isActionPending).toHaveBeenCalledWith('1', 'remove', 1, CONFIG_KEY_B);

    const lineB = screen.getByText('80% Pallet material — 20% Silica Flour').closest('div.py-3');
    expect(lineB).not.toBeNull();
    await user.click(
      within(lineB as HTMLElement).getByRole('button', { name: 'Increase quantity' }),
    );

    // Line B holds quantity 4, so the mutation must carry 5 and B's own config key.
    expect(updateQuantity).toHaveBeenCalledTimes(1);
    expect(updateQuantity).toHaveBeenCalledWith('1', 5, 1, CONFIG_KEY_B);
  });

  it('formats non-US grouping and semantic weights without changing mutation quantities', async () => {
    const user = userEvent.setup();
    const updateQuantity = vi.fn().mockResolvedValue(true);
    const isActionPending = vi.fn().mockReturnValue(false);
    renderCart(
      null,
      {
        cart: {
          ...cart,
          items: [
            {
              ...plainLine,
              quantity: 1_234,
              variantSnap: { ...plainLine.variantSnap!, weightGrams: 1_250_000 },
            },
          ],
          totalItems: 1_234,
          deliveryPreview: { ...cart.deliveryPreview!, weightGrams: 1_250_000 },
        },
        updateQuantity,
        isActionPending,
      },
      'DE',
    );

    expect(screen.getByText('1.234')).toBeInTheDocument();
    expect(screen.getAllByText(/1,25 tonnes/).length).toBeGreaterThan(0);
    expect(screen.getByText('Gesamtgewicht der Bestellung: 1,25 tonnes')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Menge erhöhen' }));
    expect(updateQuantity).toHaveBeenCalledWith('1', 1_235, 1, undefined);
  });

  it('shows the MOQ error returned by the cart hook', () => {
    renderCart('Minimum order quantity not met. Adjust pallet quantity and try again.');

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Minimum order quantity not met. Adjust pallet quantity and try again.',
    );
  });

  it('shows a server-supplied clearance note without deriving a price', () => {
    renderCart(null, {
      cart: {
        ...cart,
        items: [
          {
            ...plainLine,
            clearance: {
              priceCents: 800,
              perTonneCents: 32000,
              startsAt: '2026-07-01T00:00:00.000Z',
              endsAt: '2026-08-01T00:00:00.000Z',
            },
          },
        ],
      },
    });

    expect(screen.getByLabelText('Clearance price applied')).toHaveTextContent(
      'Clearance price applied: $10.00 per pack',
    );
  });

  it('renders server-supplied next-tier progress one sack below the next break', () => {
    renderCart(null, {
      cart: {
        ...cart,
        items: [
          {
            ...plainLine,
            nextTierProgress: {
              minTonnes: 5,
              discountPct: 5,
              sacksToNextTier: 1,
              weightToNextTierGrams: 25_000,
            },
          },
        ],
      },
    });

    expect(screen.getByLabelText('Next volume tier progress')).toHaveTextContent(
      '1 sack to 5-tonne tier (5% off)',
    );
  });

  it('omits clearance and next-tier progress when the server omits both at the top tier', () => {
    renderCart();

    expect(screen.queryByLabelText('Clearance price applied')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Next volume tier progress')).not.toBeInTheDocument();
  });
});
