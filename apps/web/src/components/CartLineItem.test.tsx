import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import type { CartLine } from '@shop/contracts/cart';
import type { ResolvedCustomBlendSnapshot } from '@shop/contracts/custom-blends';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { CartLineItem } from './CartLineItem';
import { CUSTOM_BLEND_MADE_TO_ORDER_NOTE } from '@/features/customBlend/CustomBlendPackaging';
import { CountryProvider } from '@/hooks/CountryContext';
import { LocaleProvider } from '@/i18n/LocaleContext';
import type { CountryStorage } from '@/lib/countryStorage';

const item: CartLine = {
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
    variantId: 102,
    sku: 'MAT-102',
    label: '1 tonne pallet',
    weightGrams: 1000000,
    deliveryClass: 'freight',
  },
  perTonneCents: 100000,
  resolvedUnitPriceCents: 1000,
  quantity: 1,
  configKey: '',
  materialSubtotalCents: 1000,
  blendingFeeCents: 0,
  discountableTotalCents: 1000,
  lineTotalCents: 1000,
};

const CONFIG_KEY = 'a'.repeat(64);

const blendItem: CartLine = {
  ...item,
  configKey: CONFIG_KEY,
  quantity: 2,
  materialSubtotalCents: 2000,
  blendingFeeCents: 2500,
  discountableTotalCents: 2000,
  lineTotalCents: 4500,
  customBlend: {
    configKey: CONFIG_KEY,
    basePercentage: 80,
    mixingGroup: 'mineral',
    ingredients: [
      {
        variantId: 601,
        productId: '11',
        productName: 'Chalk Filler',
        productDescription: 'Filler',
        mixingGroup: 'mineral',
        percentage: 15,
      },
      {
        variantId: 602,
        productId: '12',
        productName: 'Silica Flour',
        productDescription: 'Filler',
        mixingGroup: 'mineral',
        percentage: 5,
      },
    ],
    blendingFeeCents: 2500,
    madeToOrder: true,
    returnable: false,
  },
};

const resolvedBlend: ResolvedCustomBlendSnapshot = {
  ...blendItem.customBlend!,
  blendingFeeCents: 2_500,
  basePresentation: {
    category: 'Trade & Creative Materials',
    consumptionClassification: 'non-food',
    categoryFacts: {
      composition: 'Cementitious powder',
      source: 'Mineral',
      intendedUse: 'Construction',
      storage: 'Keep dry',
      colour: 'Grey',
      texture: 'Fine powder',
      consumptionClassification: 'non-food',
    },
  },
  ruleVersion: 1,
  resultClassification: 'non-food',
  quantity: 2,
  components: [
    {
      role: 'base',
      variantId: 102,
      productId: '1',
      productName: 'Pallet material',
      productDescription: 'Test material.',
      sku: 'MAT-102',
      variantLabel: '25 kg sack',
      mixingGroup: 'mineral',
      consumptionClassification: 'non-food',
      percentage: 80,
      weightGrams: 40_000,
      sourceUnitPriceCents: 1_000,
      tierDiscountPct: 0,
      nextTierProgress: {
        minTonnes: 10,
        discountPct: 5,
        sacksToNextTier: 398,
        weightToNextTierGrams: 9_950_000,
      },
      unitContributionCents: 800,
      subtotalCents: 1_600,
    },
    {
      role: 'ingredient',
      variantId: 601,
      productId: '11',
      productName: 'Chalk Filler',
      productDescription: 'Filler',
      sku: 'MAT-601',
      variantLabel: '25 kg sack',
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

const resolvedBlendItem: CartLine = {
  ...blendItem,
  quantity: 2,
  resolvedUnitPriceCents: 1_200,
  materialSubtotalCents: 2_400,
  discountableTotalCents: 2_400,
  lineTotalCents: 4_900,
  customBlend: resolvedBlend,
};

function renderBlendLine(overrides?: Partial<CartLineItemCallbacks>) {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <CartLineItem
        item={blendItem}
        onUpdateQuantity={overrides?.onUpdateQuantity ?? vi.fn().mockResolvedValue(true)}
        onRemove={overrides?.onRemove ?? vi.fn().mockResolvedValue(true)}
      />
    </MemoryRouter>,
  );
}

function renderGerman(ui: ReactNode) {
  const storage: CountryStorage = {
    getItem: () => 'DE',
    setItem: () => undefined,
    removeItem: () => undefined,
  };
  return render(
    <CountryProvider storage={storage}>
      <LocaleProvider>{ui}</LocaleProvider>
    </CountryProvider>,
  );
}

interface CartLineItemCallbacks {
  onUpdateQuantity: ReturnType<typeof vi.fn>;
  onRemove: ReturnType<typeof vi.fn>;
}

describe('CartLineItem', () => {
  it('renders the server-resolved pack price without recalculating the line total', () => {
    render(
      <CartLineItem
        item={{ ...item, quantity: 4, lineTotalCents: 3_999 }}
        onUpdateQuantity={vi.fn().mockResolvedValue(true)}
        onRemove={vi.fn().mockResolvedValue(true)}
      />,
    );

    expect(screen.getByText('Resolved pack price: $12.50')).toBeInTheDocument();
  });

  it('passes the line variant identity to quantity and remove callbacks', async () => {
    const user = userEvent.setup();
    const onUpdateQuantity = vi.fn().mockResolvedValue(true);
    const onRemove = vi.fn().mockResolvedValue(true);
    render(<CartLineItem item={item} onUpdateQuantity={onUpdateQuantity} onRemove={onRemove} />);

    await user.click(screen.getByRole('button', { name: 'Increase quantity' }));
    await user.click(screen.getByRole('button', { name: 'Remove' }));

    expect(onUpdateQuantity).toHaveBeenCalledWith('1', 2, 102, undefined);
    expect(onRemove).toHaveBeenCalledWith('1', 102, undefined);
  });

  it('formats quantity grouping and semantic weight for the active country', () => {
    renderGerman(
      <CartLineItem
        item={{
          ...item,
          quantity: 1_234,
          variantSnap: { ...item.variantSnap!, weightGrams: 1_250_000 },
        }}
        onUpdateQuantity={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    expect(screen.getByText('1.234')).toBeInTheDocument();
    expect(screen.getByText(/1,25 tonnes/)).toBeInTheDocument();
  });

  it('leaves a plain line free of blend disclosures and the edit action', () => {
    render(<CartLineItem item={item} onUpdateQuantity={vi.fn()} onRemove={vi.fn()} />);

    expect(screen.queryByTestId('cart-line-custom-blend')).not.toBeInTheDocument();
    expect(screen.queryByTestId('custom-blend-livery')).not.toBeInTheDocument();
    expect(screen.queryByTestId('cart-line-made-to-order')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Edit blend' })).not.toBeInTheDocument();
  });

  it('discloses made-to-order and non-returnable status on the cart line itself', () => {
    renderBlendLine();

    expect(screen.getByTestId('cart-line-made-to-order')).toHaveTextContent(
      CUSTOM_BLEND_MADE_TO_ORDER_NOTE,
    );
  });

  it('keeps the base product name as the title and shows the breakdown and fee split', () => {
    renderBlendLine();

    expect(screen.getByText('Pallet material')).toBeInTheDocument();
    expect(
      screen.getByText('80% Pallet material — 15% Chalk Filler, 5% Silica Flour'),
    ).toBeInTheDocument();
    expect(screen.getByText('Base material: $25.00')).toBeInTheDocument();
    expect(screen.getByText('Blending fee: $31.25')).toBeInTheDocument();
  });

  it('renders resolved component facts, classification safety, and one server fee without aggregate tier progress', () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <CartLineItem item={resolvedBlendItem} onUpdateQuantity={vi.fn()} onRemove={vi.fn()} />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('cart-line-blend-result')).toHaveTextContent('Non-food blend');
    expect(screen.getByTestId('cart-line-blend-safety')).toHaveTextContent('Not for consumption');
    expect(screen.getByText('Component weight: 40 kg')).toBeInTheDocument();
    expect(screen.getByText('Source price: $12.50 per sack')).toBeInTheDocument();
    expect(screen.getByText('398 sacks to the 10-tonne tier (5% off)')).toBeInTheDocument();
    expect(screen.getByText('Unit contribution: $10.00')).toBeInTheDocument();
    expect(screen.getByText('Component subtotal: $20.00')).toBeInTheDocument();
    expect(screen.getByText('Material price per sack: $15.00')).toBeInTheDocument();
    expect(screen.getByText('Material total: $30.00')).toBeInTheDocument();
    expect(screen.getByText('Blending fee: $31.25')).toBeInTheDocument();
    expect(screen.getByText('Blend total: $61.25')).toBeInTheDocument();
    expect(screen.queryByText(/Next volume tier progress/)).not.toBeInTheDocument();
  });

  it('prints the fixed charcoal livery on the base category vessel with a config-key batch mark', () => {
    renderBlendLine();

    const livery = screen.getByTestId('custom-blend-livery');
    expect(livery).toHaveAttribute('data-vessel', 'food-bag');
    expect(livery).toHaveAttribute('data-colour-scheme', 'custom-blend');
    expect(livery).toHaveAttribute('data-batch-mark', 'CB-AAAAAA');
  });

  it('links the edit action to the configurator target for this config key', () => {
    renderBlendLine();

    expect(screen.getByRole('link', { name: 'Edit blend' })).toHaveAttribute(
      'href',
      `/custom-blend?baseVariantId=102&editConfigKey=${CONFIG_KEY}`,
    );
  });

  it('carries the config key into the quantity and remove callbacks', async () => {
    const user = userEvent.setup();
    const onUpdateQuantity = vi.fn().mockResolvedValue(true);
    const onRemove = vi.fn().mockResolvedValue(true);
    renderBlendLine({ onUpdateQuantity, onRemove });

    await user.click(screen.getByRole('button', { name: 'Increase quantity' }));
    await user.click(screen.getByRole('button', { name: 'Remove' }));

    expect(onUpdateQuantity).toHaveBeenCalledWith('1', 3, 102, CONFIG_KEY);
    expect(onRemove).toHaveBeenCalledWith('1', 102, CONFIG_KEY);
  });
});
