import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type {
  CustomBlendEvaluationResponse,
  CustomBlendOption,
  CustomBlendOptionsResponse,
  ResolvedCustomBlendSnapshot,
} from '@shop/contracts/custom-blends';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  evaluateCustomBlend,
  getCustomBlendBases,
  getCustomBlendOptions,
} from '@/api/customBlends';
import { useCartContext } from '@/hooks/CartContext';
import { useCategories } from '@/hooks/useCategories';
import { useProducts } from '@/hooks/useProducts';
import App from '@/App';

vi.mock('@/api/customBlends', () => ({
  evaluateCustomBlend: vi.fn(),
  getCustomBlendBases: vi.fn(),
  getCustomBlendOptions: vi.fn(),
  createCustomBlend: vi.fn(),
  replaceCustomBlend: vi.fn(),
}));
vi.mock('@/hooks/CartContext', () => ({ useCartContext: vi.fn() }));
vi.mock('@/hooks/useProducts', () => ({ useProducts: vi.fn() }));
vi.mock('@/hooks/useCategories', () => ({ useCategories: vi.fn() }));

// The real Layout pulls the whole shell (header, auth, cart sheet). Reachability only needs the
// nav that owns the Custom Blend slot rendered above the real router.
vi.mock('@/components/Layout', async () => {
  const { Outlet } = await import('react-router-dom');
  const { CategoryNav } = await import('@/components/CategoryNav');

  return {
    Layout: () => (
      <>
        <CategoryNav />
        <Outlet />
      </>
    ),
  };
});

function option(
  variantId: number,
  productName: string,
  overrides: {
    consumptionClassification?: CustomBlendOption['consumptionClassification'];
    mixingGroup?: CustomBlendOption['mixingGroup'];
    priceCents?: number;
    stockCount?: number;
  } = {},
): CustomBlendOption {
  const mixingGroup = overrides.mixingGroup ?? 'mineral';
  const consumptionClassification = overrides.consumptionClassification ?? 'non-food';
  return {
    productId: String(variantId),
    productName,
    productDescription: `${productName} description`,
    category: 'Trade & Creative Materials',
    consumptionClassification,
    categoryFacts: {
      texture: 'Fine powder',
      colour: 'Grey',
      source: 'Test source',
      intendedUse: 'Testing',
      storage: 'Dry and cool',
      consumptionClassification,
    },
    mixingGroup,
    variant: {
      variantId,
      productId: variantId,
      sku: `MAT-${variantId}`,
      label: '25 kg sack',
      weightGrams: 25_000,
      priceCents: overrides.priceCents ?? 1_200,
      moqSacks: 4,
      perTonneCents: 48_000,
      priceTiers: [{ minTonnes: 1, discountPct: 0 }],
      stockCount: overrides.stockCount ?? 40,
      backorderable: false,
      backorderLeadDays: null,
      deliveryClass: 'freight',
      active: true,
      sortOrder: 1,
    },
  };
}

/** A catalog row the base picker can offer: the 25 kg sack variant is the only eligible base. */
const baseProduct = {
  id: '9',
  name: 'Portland Cement',
  variants: [{ variantId: 501, weightGrams: 25_000, active: true }],
};

const options: CustomBlendOptionsResponse = {
  // Deliberately disagree with the evaluation prices: the review must render the current server
  // verdict rather than reconstructing a price from the option rows.
  base: option(501, 'Portland Cement', { mixingGroup: 'cleaning', priceCents: 1_000 }),
  ingredients: [
    option(601, 'Chalk Filler', {
      mixingGroup: 'pigments',
      consumptionClassification: 'caution',
      priceCents: 2_000,
    }),
    option(602, 'Silica Flour', {
      mixingGroup: 'pigments',
      consumptionClassification: 'caution',
      stockCount: 0,
    }),
  ],
};

const EVALUATION_CONFIG_KEY = 'b'.repeat(64);
const resolvedEvaluation: CustomBlendEvaluationResponse = {
  quantity: 7,
  customBlend: {
    configKey: EVALUATION_CONFIG_KEY,
    basePercentage: 90,
    mixingGroup: 'cleaning',
    basePresentation: {
      category: options.base.category,
      consumptionClassification: 'non-food',
      categoryFacts: options.base.categoryFacts,
    },
    ingredients: [
      {
        variantId: 601,
        productId: '601',
        productName: 'Chalk Filler',
        productDescription: 'Chalk Filler description',
        mixingGroup: 'pigments',
        percentage: 10,
      },
    ],
    blendingFeeCents: 2_500,
    madeToOrder: true,
    returnable: false,
    ruleVersion: 1,
    resultClassification: 'non-food',
    quantity: 7,
    components: [
      {
        role: 'base',
        variantId: 501,
        productId: '501',
        productName: 'Portland Cement',
        productDescription: 'Portland Cement description',
        sku: 'MAT-501',
        variantLabel: '25 kg sack',
        mixingGroup: 'cleaning',
        consumptionClassification: 'non-food',
        percentage: 90,
        weightGrams: 157_500,
        sourceUnitPriceCents: 4_000,
        tierDiscountPct: 0,
        unitContributionCents: 3_600,
        subtotalCents: 25_200,
      },
      {
        role: 'ingredient',
        variantId: 601,
        productId: '601',
        productName: 'Chalk Filler',
        productDescription: 'Chalk Filler description',
        sku: 'MAT-601',
        variantLabel: '25 kg sack',
        mixingGroup: 'pigments',
        consumptionClassification: 'caution',
        percentage: 10,
        weightGrams: 17_500,
        sourceUnitPriceCents: 8_000,
        tierDiscountPct: 0,
        unitContributionCents: 800,
        subtotalCents: 5_600,
      },
    ],
    materialUnitPriceCents: 4_400,
    materialSubtotalCents: 30_800,
    discountableTotalCents: 30_800,
    lineTotalCents: 33_300,
  } satisfies ResolvedCustomBlendSnapshot,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function evaluationForPercentage(percentage: number): CustomBlendEvaluationResponse {
  const basePercentage = 100 - percentage;
  const quantity = resolvedEvaluation.quantity;
  const baseComponent = resolvedEvaluation.customBlend.components.find(
    (component) => component.role === 'base',
  )!;
  const ingredientComponent = resolvedEvaluation.customBlend.components.find(
    (component) => component.role === 'ingredient',
  )!;
  const baseUnitContributionCents = Math.round(
    (baseComponent.sourceUnitPriceCents * basePercentage) / 100,
  );
  const ingredientUnitContributionCents = Math.round(
    (ingredientComponent.sourceUnitPriceCents * percentage) / 100,
  );
  const components = [
    {
      ...baseComponent,
      percentage: basePercentage,
      weightGrams: (quantity * 25_000 * basePercentage) / 100,
      unitContributionCents: baseUnitContributionCents,
      subtotalCents: baseUnitContributionCents * quantity,
    },
    {
      ...ingredientComponent,
      percentage,
      weightGrams: (quantity * 25_000 * percentage) / 100,
      unitContributionCents: ingredientUnitContributionCents,
      subtotalCents: ingredientUnitContributionCents * quantity,
    },
  ];
  const materialUnitPriceCents = components.reduce(
    (total, component) => total + component.unitContributionCents,
    0,
  );
  const materialSubtotalCents = components.reduce(
    (total, component) => total + component.subtotalCents,
    0,
  );
  return {
    quantity,
    customBlend: {
      ...resolvedEvaluation.customBlend,
      basePercentage,
      ingredients: resolvedEvaluation.customBlend.ingredients.map((ingredient) => ({
        ...ingredient,
        percentage,
      })),
      components,
      materialUnitPriceCents,
      materialSubtotalCents,
      discountableTotalCents: materialSubtotalCents,
      lineTotalCents: materialSubtotalCents + resolvedEvaluation.customBlend.blendingFeeCents,
    },
  };
}

function renderApp(initialEntry: string) {
  return render(
    <MemoryRouter
      initialEntries={[initialEntry]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <App />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useCategories).mockReturnValue({
    categories: ['Trade & Creative Materials'],
    isLoading: false,
    error: null,
  });
  vi.mocked(useProducts).mockReturnValue({
    products: [baseProduct],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useProducts>);
  vi.mocked(useCartContext).mockReturnValue({
    cart: null,
    error: null,
    isCartAvailable: true,
    addCustomBlend: vi.fn().mockResolvedValue(true),
    replaceCustomBlend: vi.fn().mockResolvedValue(true),
    retryCart: vi.fn(),
  } as unknown as ReturnType<typeof useCartContext>);
  vi.mocked(getCustomBlendBases).mockResolvedValue({
    items: [options.base],
    total: 1,
    page: 1,
    pageSize: 12,
  });
  vi.mocked(getCustomBlendOptions).mockResolvedValue(options);
  vi.mocked(evaluateCustomBlend).mockResolvedValue(resolvedEvaluation);
});

describe('custom blend reachability', () => {
  it('reaches the configurator from the nav link a customer can actually see', async () => {
    const user = userEvent.setup();

    // Starts on a static route so the assertion is about the nav reaching the configurator, not
    // about whatever page happened to be mounted underneath it. The help index also links the
    // Custom Blend article, so the click is scoped to the category nav.
    renderApp('/help');

    const nav = screen.getByRole('navigation', { name: 'Product categories' });
    await user.click(within(nav).getByRole('link', { name: 'Custom Blend' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Build a custom blend' }),
    ).toBeVisible();
    expect(screen.getByRole('heading', { level: 2, name: 'Base material' })).toBeInTheDocument();
  });

  it('honours a baseVariantId deep link and keeps sold-out ingredients selectable', async () => {
    const user = userEvent.setup();
    renderApp('/custom-blend?baseVariantId=501');

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Base material' }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(getCustomBlendOptions).toHaveBeenCalledWith(501, expect.anything());
    });

    // Inventory is advisory in Custom Blend; server-side validation remains authoritative.
    expect(screen.getByText('Out of stock')).toBeInTheDocument();
    const ingredient = screen.getByRole('checkbox', { name: 'Silica Flour' });
    expect(ingredient).toBeEnabled();
    await user.click(ingredient);
    expect(ingredient).toBeChecked();
  });

  it('uses server bases and evaluation for mixed-group totals, classification, and submit gating', async () => {
    const user = userEvent.setup();
    let resolveCurrentEvaluation: ((value: CustomBlendEvaluationResponse) => void) | undefined;
    vi.mocked(evaluateCustomBlend).mockImplementation(
      () =>
        new Promise<CustomBlendEvaluationResponse>((resolve) => {
          resolveCurrentEvaluation = resolve;
        }),
    );
    const addCustomBlend = vi.fn().mockResolvedValue({
      items: [{ configKey: EVALUATION_CONFIG_KEY, variantSnap: { variantId: 501 } }],
    });
    vi.mocked(useCartContext).mockReturnValue({
      cart: null,
      error: null,
      isCartAvailable: true,
      addCustomBlend,
      replaceCustomBlend: vi.fn().mockResolvedValue(true),
      retryCart: vi.fn(),
    } as unknown as ReturnType<typeof useCartContext>);

    renderApp('/custom-blend');
    expect(await screen.findByRole('list', { name: 'Base material options' })).toBeInTheDocument();
    expect(getCustomBlendBases).toHaveBeenCalledWith({}, expect.anything());
    await user.click(screen.getByRole('button', { name: 'Use Portland Cement as base' }));
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Base material' }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(getCustomBlendOptions).toHaveBeenCalledWith(501, expect.anything());
    });

    await user.click(screen.getByRole('checkbox', { name: 'Chalk Filler' }));
    const pigmentPercentage = await screen.findByRole('spinbutton', {
      name: 'Chalk Filler percentage',
    });
    // Set the whole value in one input event; the control clamps each individual change to the
    // shared 50% ingredient budget, so typing "10" character-by-character would be misleading.
    fireEvent.change(pigmentPercentage, { target: { value: '10' } });

    const submit = screen.getByRole('button', { name: 'Add blend to cart' });
    expect(submit).toBeDisabled();
    await waitFor(() => expect(evaluateCustomBlend).toHaveBeenCalled());
    const latestCall = vi.mocked(evaluateCustomBlend).mock.calls.at(-1);
    expect(latestCall?.[0]).toEqual({
      baseVariantId: 501,
      ingredients: [{ variantId: 601, percentage: 10 }],
    });
    resolveCurrentEvaluation?.(resolvedEvaluation);

    expect(await screen.findByText('Non-food blend')).toBeInTheDocument();
    expect(screen.getByText('Not for consumption')).toBeInTheDocument();
    expect(screen.getByText('Material price per sack: $55.00')).toBeInTheDocument();
    expect(screen.getByText('Material total: $385.00')).toBeInTheDocument();
    expect(screen.getByText('Blending fee: $31.25')).toBeInTheDocument();
    expect(screen.getByText('Blend total: $416.25')).toBeInTheDocument();
    expect(screen.getByText('Source price: $50.00 per sack')).toBeInTheDocument();
    expect(screen.getByText('Source price: $100.00 per sack')).toBeInTheDocument();
    expect(screen.getByText('Component subtotal: $315.00')).toBeInTheDocument();
    expect(screen.getByText('Component subtotal: $70.00')).toBeInTheDocument();
    expect(screen.getByText('Portland Cement · 90%')).toBeInTheDocument();
    expect(screen.getByText('Chalk Filler · 10%')).toBeInTheDocument();
    expect(submit).not.toBeDisabled();

    await user.click(submit);
    await waitFor(() => {
      expect(addCustomBlend).toHaveBeenCalledWith({
        baseVariantId: 501,
        ingredients: [{ variantId: 601, percentage: 10 }],
        quantity: 7,
      });
    });
  });

  it('keeps submit gated while evaluating and drops a stale verdict after a ratio change', async () => {
    const user = userEvent.setup();
    const stale = deferred<CustomBlendEvaluationResponse>();
    const fresh = deferred<CustomBlendEvaluationResponse>();
    vi.mocked(evaluateCustomBlend)
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(fresh.promise);

    renderApp('/custom-blend?baseVariantId=501');
    await user.click(await screen.findByRole('checkbox', { name: 'Chalk Filler' }));
    const percentage = await screen.findByRole('spinbutton', {
      name: 'Chalk Filler percentage',
    });
    fireEvent.change(percentage, { target: { value: '10' } });

    await waitFor(() => expect(evaluateCustomBlend).toHaveBeenCalledTimes(1));
    const submit = screen.getByRole('button', { name: 'Add blend to cart' });
    expect(submit).toBeDisabled();
    expect(await screen.findByText('Checking your blend and current price…')).toBeInTheDocument();

    fireEvent.change(percentage, { target: { value: '20' } });
    expect(submit).toBeDisabled();
    await waitFor(() => expect(evaluateCustomBlend).toHaveBeenCalledTimes(2));
    expect(vi.mocked(evaluateCustomBlend).mock.calls[0]?.[1]?.aborted).toBe(true);

    await act(async () => {
      fresh.resolve(evaluationForPercentage(20));
      await fresh.promise;
    });
    await waitFor(() => expect(submit).toBeEnabled());
    expect(screen.getByText('Chalk Filler · 20%')).toBeInTheDocument();

    await act(async () => {
      stale.resolve(evaluationForPercentage(10));
      await stale.promise;
    });
    expect(screen.getByText('Chalk Filler · 20%')).toBeInTheDocument();
    expect(screen.queryByText('Chalk Filler · 10%')).not.toBeInTheDocument();
  });

  it('rejects an unusable baseVariantId instead of rendering a broken configurator', async () => {
    renderApp('/custom-blend?baseVariantId=not-a-number');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That base material is not available for Custom Blend.',
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Base material' })).toBeInTheDocument();
  });

  it('serves the Custom Blend help article on its own route', async () => {
    renderApp('/help/custom-blend');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Custom Blend' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/flat blending fee of \$31\.25/)).toBeInTheDocument();
  });
});
