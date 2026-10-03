import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedCustomBlendSnapshot } from '@shop/contracts/custom-blends';
import { validatePromo } from '@/api/promo';
import { getDeliverySlotOptions } from '@/api/deliverySlots';
import { useCartContext } from '@/hooks/CartContext';
import {
  cart,
  cartContext,
  mockAnonymous,
  renderCheckout,
  slotOptions,
} from './CheckoutPage.test-fixtures';

vi.mock('@/api/payments', () => ({ pay: vi.fn() }));
vi.mock('@/api/promo', () => ({ validatePromo: vi.fn() }));
vi.mock('@/hooks/CartContext', () => ({ useCartContext: vi.fn() }));
vi.mock('@/api/deliverySlots', () => ({ getDeliverySlotOptions: vi.fn() }));
vi.mock('@/api/tradeAccount', () => ({
  listDeliverySites: vi.fn(),
  createDeliverySite: vi.fn(),
  updateDeliverySite: vi.fn(),
  retireDeliverySite: vi.fn(),
  listBillingEntities: vi.fn(),
  createBillingEntity: vi.fn(),
  updateBillingEntity: vi.fn(),
  retireBillingEntity: vi.fn(),
}));
vi.mock('@/hooks/AuthContext', () => ({ useAuth: vi.fn() }));

beforeEach(() => {
  vi.mocked(useCartContext).mockReturnValue(cartContext);
  vi.mocked(validatePromo).mockReset();
  vi.mocked(getDeliverySlotOptions).mockReset();
  vi.mocked(getDeliverySlotOptions).mockResolvedValue(slotOptions);
  mockAnonymous();
});

const resolvedBlend: ResolvedCustomBlendSnapshot = {
  configKey: 'b'.repeat(64),
  basePercentage: 80,
  mixingGroup: 'mineral',
  ingredients: [
    {
      variantId: 601,
      productId: '11',
      productName: 'Chalk Filler',
      productDescription: 'Filler',
      mixingGroup: 'mineral',
      percentage: 20,
    },
  ],
  blendingFeeCents: 2_500,
  madeToOrder: true,
  returnable: false,
  ruleVersion: 1,
  resultClassification: 'non-food',
  quantity: 2,
  components: [
    {
      role: 'base',
      variantId: 1,
      productId: '1',
      productName: 'Powdered Water',
      productDescription: 'Water in powder form.',
      sku: 'H2O-001',
      variantLabel: '25kg sack',
      mixingGroup: 'mineral',
      consumptionClassification: 'non-food',
      percentage: 80,
      weightGrams: 40_000,
      sourceUnitPriceCents: 1_000,
      tierDiscountPct: 0,
      unitContributionCents: 800,
      subtotalCents: 1_600,
    },
    {
      role: 'ingredient',
      variantId: 601,
      productId: '11',
      productName: 'Chalk Filler',
      productDescription: 'Filler',
      sku: 'CHALK-601',
      variantLabel: '25kg sack',
      mixingGroup: 'mineral',
      consumptionClassification: 'non-food',
      percentage: 20,
      weightGrams: 10_000,
      sourceUnitPriceCents: 2_000,
      tierDiscountPct: 0,
      unitContributionCents: 400,
      subtotalCents: 800,
    },
  ],
  materialUnitPriceCents: 1_200,
  materialSubtotalCents: 2_400,
  discountableTotalCents: 2_400,
  lineTotalCents: 4_900,
};

describe('Checkout summary and promotions', { timeout: 20_000 }, () => {
  it('renders server-resolved pack, tonne, and pack-weight values in the order summary', async () => {
    await renderCheckout();

    expect(screen.getByText(/Resolved pack price: \$12.50/)).toBeInTheDocument();
    expect(screen.getByText(/\$500.00 \/ tonne/)).toBeInTheDocument();
    expect(screen.getByText(/25 kg pack/)).toBeInTheDocument();
  });

  it('discloses blend composition, the fee split, and the made-to-order terms', async () => {
    const configKey = 'b'.repeat(64);
    const blendLine = {
      ...cart.items[0]!,
      configKey,
      materialSubtotalCents: 1000,
      blendingFeeCents: 2500,
      discountableTotalCents: 1000,
      lineTotalCents: 3500,
      customBlend: {
        configKey,
        basePercentage: 80,
        mixingGroup: 'mineral' as const,
        basePresentation: {
          category: 'Trade & Creative Materials',
          consumptionClassification: 'non-food' as const,
          categoryFacts: {
            texture: 'Fine powder',
            colour: 'Grey',
            source: 'Mineral',
            intendedUse: 'Construction',
            storage: 'Keep dry',
            consumptionClassification: 'non-food' as const,
          },
        },
        ingredients: [
          {
            variantId: 601,
            productId: '11',
            productName: 'Chalk Filler',
            productDescription: 'Filler',
            mixingGroup: 'mineral' as const,
            percentage: 20,
          },
        ],
        blendingFeeCents: 2500,
        madeToOrder: true as const,
        returnable: false as const,
      },
    };
    vi.mocked(useCartContext).mockReturnValue({
      ...cartContext,
      cart: {
        ...cart,
        items: [blendLine],
        subtotalCents: 3500,
        discountableSubtotalCents: 1000,
        blendingFeeTotalCents: 2500,
      },
    });

    await renderCheckout();

    expect(screen.getByText(/80% Powdered Water.*20% Chalk Filler/)).toBeInTheDocument();
    expect(screen.getByText('Custom blend')).toBeInTheDocument();
    expect(screen.getByTestId('custom-blend-livery')).toHaveAttribute('data-vessel', 'neutral');
    expect(screen.getByTestId('custom-blend-livery')).toHaveAttribute(
      'data-colour-scheme',
      'neutral',
    );
    expect(screen.queryByText('Not for consumption')).not.toBeInTheDocument();
    expect(screen.getByText(/Base material: \$12.50.*Blending fee: \$31.25/)).toBeInTheDocument();
    expect(screen.queryByText('Blending fees')).not.toBeInTheDocument();
    expect(
      screen.getByText(/Made to order\. Custom blends cannot be returned/),
    ).toBeInTheDocument();
  });

  it('renders the resolved result, component pricing facts, and safety warning from the server', async () => {
    const resolvedLine = {
      ...cart.items[0]!,
      configKey: resolvedBlend.configKey,
      quantity: resolvedBlend.quantity,
      resolvedUnitPriceCents: resolvedBlend.materialUnitPriceCents,
      materialSubtotalCents: resolvedBlend.materialSubtotalCents,
      blendingFeeCents: resolvedBlend.blendingFeeCents,
      discountableTotalCents: resolvedBlend.discountableTotalCents,
      lineTotalCents: resolvedBlend.lineTotalCents,
      customBlend: resolvedBlend,
    };
    vi.mocked(useCartContext).mockReturnValue({
      ...cartContext,
      cart: {
        ...cart,
        items: [resolvedLine],
        subtotalCents: resolvedBlend.lineTotalCents,
        discountableSubtotalCents: resolvedBlend.discountableTotalCents,
        blendingFeeTotalCents: resolvedBlend.blendingFeeCents,
        totalItems: resolvedBlend.quantity,
      },
    });

    await renderCheckout();

    expect(screen.getByTestId('checkout-blend-result')).toHaveTextContent('Non-food blend');
    expect(screen.getByTestId('checkout-blend-safety')).toHaveTextContent('Not for consumption');
    expect(screen.getByText('Component weight: 40 kg')).toBeInTheDocument();
    expect(screen.getByText('Unit contribution: $10.00')).toBeInTheDocument();
    expect(screen.getByText('Material price per sack: $15.00')).toBeInTheDocument();
    expect(screen.getByText('Material total: $30.00')).toBeInTheDocument();
    expect(screen.getAllByText('Blending fee: $31.25')).toHaveLength(1);
    expect(screen.getByText('Blend total: $61.25')).toBeInTheDocument();
    expect(screen.queryByText('Blending fees')).not.toBeInTheDocument();
    expect(screen.queryByText(/Next volume tier progress/)).not.toBeInTheDocument();
  });

  it('adds the server-provided delivery preview to the checkout total', async () => {
    await renderCheckout();

    expect(screen.getByText('$12.49')).toBeInTheDocument();
    expect(screen.getByText('$24.99')).toBeInTheDocument();
  });

  it('displays the freight-inclusive total returned by a valid promo quote', async () => {
    const eligibleCart = {
      ...cart,
      items: [{ ...cart.items[0]!, quantity: 5, lineTotalCents: 5000 }],
      subtotalCents: 5000,
      totalItems: 5,
    };
    vi.mocked(useCartContext).mockReturnValue({
      ...cartContext,
      cart: eligibleCart,
      cartId: eligibleCart.id,
    });
    vi.mocked(validatePromo).mockResolvedValue({
      valid: true,
      promoCode: {
        code: 'SAVE10',
        discountPercent: 10,
        minItemCount: 5,
        kind: 'percent',
      },
      discountCents: 500,
      totalCents: 5499,
    });
    const user = userEvent.setup();
    await renderCheckout();

    await user.type(screen.getByLabelText('Order promotion'), 'SAVE10');
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(await screen.findByText('$68.74')).toBeInTheDocument();
    expect(screen.getByText('$12.49')).toBeInTheDocument();
  });

  it('renders server-provided scoped promo details without recalculating totals', async () => {
    const eligibleCart = {
      ...cart,
      items: [{ ...cart.items[0]!, quantity: 5, lineTotalCents: 5000 }],
      subtotalCents: 5000,
      totalItems: 5,
    };
    vi.mocked(useCartContext).mockReturnValue({
      ...cartContext,
      cart: eligibleCart,
      cartId: eligibleCart.id,
    });
    vi.mocked(validatePromo).mockResolvedValue({
      valid: true,
      promoCode: {
        code: 'AGG10',
        discountPercent: 10,
        minItemCount: 1,
        kind: 'percent',
        categoryScope: 'aggregates',
      },
      discountBaseCents: 3200,
      discountCents: 320,
      totalCents: 4879,
    });
    const user = userEvent.setup();
    await renderCheckout();

    await user.type(screen.getByLabelText('Order promotion'), 'AGG10');
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(await screen.findByText('Eligible subtotal (aggregates)')).toBeInTheDocument();
    expect(screen.getByText('$40.00')).toBeInTheDocument();
    expect(screen.getByText(/Discount .*AGG10.*aggregates/)).toBeInTheDocument();
    expect(screen.getByText('$60.99')).toBeInTheDocument();
  });

  it('carries a clearance-priced catalog line into a scoped-promo checkout total', async () => {
    const clearanceCart = {
      ...cart,
      items: [
        {
          ...cart.items[0]!,
          product: {
            ...cart.items[0]!.product,
            name: 'Lawn Feed',
            category: 'Garden & Outdoors',
          },
          variantSnap: {
            ...cart.items[0]!.variantSnap!,
            sku: 'GDN-1043-001',
            label: '10 kg Bag',
            weightGrams: 10_000,
          },
          resolvedUnitPriceCents: 2_400,
          perTonneCents: 240_000,
          quantity: 5,
          materialSubtotalCents: 12_000,
          discountableTotalCents: 12_000,
          lineTotalCents: 12_000,
          clearance: {
            priceCents: 2_400,
            perTonneCents: 240_000,
            startsAt: '2026-07-21T12:00:00.000Z',
            endsAt: '2026-08-04T12:00:00.000Z',
          },
        },
      ],
      subtotalCents: 12_000,
      discountableSubtotalCents: 12_000,
      totalItems: 5,
    };
    vi.mocked(useCartContext).mockReturnValue({
      ...cartContext,
      cart: clearanceCart,
      cartId: clearanceCart.id,
    });
    vi.mocked(validatePromo).mockResolvedValue({
      valid: true,
      promoCode: {
        code: 'GARDEN10',
        discountPercent: 10,
        minItemCount: 0,
        kind: 'percent',
        categoryScope: 'Garden & Outdoors',
      },
      discountBaseCents: 12_000,
      discountCents: 1_200,
      totalCents: 11_799,
    });
    const user = userEvent.setup();
    await renderCheckout();

    expect(screen.getByText(/Resolved pack price: \$30.00/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Order promotion'), 'GARDEN10');
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(await screen.findByText('Eligible subtotal (Garden & Outdoors)')).toBeInTheDocument();
    expect(screen.getAllByText('$150.00')).toHaveLength(3);
    expect(screen.getByText(/Discount .*GARDEN10.*Garden & Outdoors/)).toBeInTheDocument();
    expect(screen.getByText('$147.49')).toBeInTheDocument();
  });

  it('renders a category mismatch promo error', async () => {
    const eligibleCart = {
      ...cart,
      items: [{ ...cart.items[0]!, quantity: 5, lineTotalCents: 5000 }],
      subtotalCents: 5000,
      totalItems: 5,
    };
    vi.mocked(useCartContext).mockReturnValue({
      ...cartContext,
      cart: eligibleCart,
      cartId: eligibleCart.id,
    });
    vi.mocked(validatePromo).mockResolvedValue({
      valid: false,
      error: 'Promo cannot be used',
      errorCode: 'CATEGORY_MISMATCH',
    });
    const user = userEvent.setup();
    await renderCheckout();

    await user.type(screen.getByLabelText('Order promotion'), 'AGG10');
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(
      await screen.findByText('This promo does not apply to any items in your cart.'),
    ).toBeInTheDocument();
  });
});
