import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cart, CartLine } from '@shop/contracts/cart';
import type {
  CustomBlendBaseListResponse,
  CustomBlendEvaluationBody,
  CustomBlendEvaluationResponse,
  CustomBlendOption,
  CustomBlendOptionsResponse,
  ResolvedCustomBlendSnapshot,
} from '@shop/contracts/custom-blends';

import { ApiError } from '@/api/client';
import {
  evaluateCustomBlend,
  getCustomBlendBases,
  getCustomBlendOptions,
} from '@/api/customBlends';
import { useCartContext } from '@/hooks/CartContext';
import { CustomBlendPage } from './CustomBlendPage';

vi.mock('@/api/customBlends', () => ({
  evaluateCustomBlend: vi.fn(),
  getCustomBlendBases: vi.fn(),
  getCustomBlendOptions: vi.fn(),
}));
vi.mock('@/hooks/CartContext', () => ({ useCartContext: vi.fn() }));

const countryState = vi.hoisted(() => ({ activeCountry: 'US' as const }));
vi.mock('@/hooks/CountryContext', () => ({
  useCountry: () => ({ activeCountry: countryState.activeCountry }),
  useOptionalCountry: () => ({ activeCountry: countryState.activeCountry }),
}));

const EDIT_CONFIG_KEY = 'a'.repeat(64);
const CREATED_CONFIG_KEY = 'c'.repeat(64);
const REPLACED_CONFIG_KEY = 'b'.repeat(64);

function option(
  variantId: number,
  productName: string,
  overrides: {
    category?: string;
    mixingGroup?: CustomBlendOption['mixingGroup'];
    stockCount?: number;
  } = {},
): CustomBlendOption {
  const mixingGroup = overrides.mixingGroup ?? 'mineral';
  const classification = mixingGroup === 'food-grade' ? 'food' : 'non-food';
  return {
    productId: String(variantId),
    productName,
    productDescription: `${productName} description`,
    mixingGroup,
    category: overrides.category ?? 'Trade & Creative Materials',
    consumptionClassification: classification,
    categoryFacts: {
      texture: 'Fine',
      colour: 'Grey',
      source: 'Test source',
      intendedUse: 'Testing',
      storage: 'Dry cool',
      consumptionClassification: classification,
    },
    variant: {
      variantId,
      productId: variantId,
      sku: `MAT-${variantId}`,
      label: '25 kg sack',
      weightGrams: 25_000,
      priceCents: 1_200,
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

function optionsFor(baseName: string, ingredients: readonly CustomBlendOption[]) {
  return {
    base: option(501, baseName),
    ingredients: [...ingredients],
  } satisfies CustomBlendOptionsResponse;
}

function basesResponse(items: readonly CustomBlendOption[]): CustomBlendBaseListResponse {
  return { items: [...items], total: items.length, page: 1, pageSize: 12 };
}

function component(
  role: 'base' | 'ingredient',
  item: CustomBlendOption,
  percentage: number,
  quantity: number,
  sourceUnitPriceCents = 1_200,
) {
  const weightGrams = (quantity * 25_000 * percentage) / 100;
  const unitContributionCents = Math.round((sourceUnitPriceCents * percentage) / 100);
  return {
    role,
    variantId: item.variant.variantId,
    productId: item.productId,
    productName: item.productName,
    productDescription: item.productDescription,
    sku: item.variant.sku,
    variantLabel: item.variant.label,
    mixingGroup: item.mixingGroup,
    consumptionClassification: item.consumptionClassification,
    percentage,
    weightGrams,
    sourceUnitPriceCents,
    tierDiscountPct: 0,
    unitContributionCents,
    subtotalCents: unitContributionCents * quantity,
  };
}

function evaluationFor(
  body: CustomBlendEvaluationBody,
  overrides: {
    quantity?: number;
    resultClassification?: 'food' | 'non-food';
    configKey?: string;
    sourceUnitPriceCents?: number;
  } = {},
): CustomBlendEvaluationResponse {
  const quantity = overrides.quantity ?? body.quantity ?? 4;
  const base = option(
    body.baseVariantId,
    body.baseVariantId === 501 ? 'Portland Cement' : `Base ${body.baseVariantId}`,
  );
  const ingredientItems = body.ingredients.map((ingredient) =>
    option(
      ingredient.variantId,
      ingredient.variantId === 601 ? 'Chalk Filler' : `Ingredient ${ingredient.variantId}`,
    ),
  );
  const basePercentage =
    100 - body.ingredients.reduce((sum, ingredient) => sum + ingredient.percentage, 0);
  const sourceUnitPriceCents = overrides.sourceUnitPriceCents ?? 1_200;
  const components = [
    component('base', base, basePercentage, quantity, sourceUnitPriceCents),
    ...ingredientItems.map((item, index) =>
      component(
        'ingredient',
        item,
        body.ingredients[index]!.percentage,
        quantity,
        sourceUnitPriceCents,
      ),
    ),
  ];
  const ingredients = ingredientItems.map((item, index) => ({
    variantId: item.variant.variantId,
    productId: item.productId,
    productName: item.productName,
    productDescription: item.productDescription,
    mixingGroup: item.mixingGroup,
    percentage: body.ingredients[index]!.percentage,
  }));
  const materialUnitPriceCents = components.reduce(
    (sum, item) => sum + item.unitContributionCents,
    0,
  );
  const materialSubtotalCents = components.reduce((sum, item) => sum + item.subtotalCents, 0);
  const customBlend: ResolvedCustomBlendSnapshot = {
    configKey: overrides.configKey ?? 'e'.repeat(64),
    basePercentage,
    mixingGroup: base.mixingGroup,
    basePresentation: {
      category: base.category,
      consumptionClassification: base.consumptionClassification,
      categoryFacts: base.categoryFacts,
    },
    ingredients,
    blendingFeeCents: 2_500,
    madeToOrder: true,
    returnable: false,
    ruleVersion: 1,
    resultClassification: overrides.resultClassification ?? 'non-food',
    quantity,
    components,
    materialUnitPriceCents,
    materialSubtotalCents,
    discountableTotalCents: materialSubtotalCents,
    lineTotalCents: materialSubtotalCents + 2_500,
  };
  return { quantity, customBlend };
}

function configuredLine(): CartLine {
  return {
    productId: '9',
    configKey: EDIT_CONFIG_KEY,
    product: {
      id: '9',
      name: 'Portland Cement',
      description: 'Base',
      priceCents: 1_200,
      imageSetId: 'cement',
      category: 'Trade & Creative Materials',
      stock: 40,
      availability: 'in_stock',
      backorderable: false,
      backorderLeadDays: null,
      slug: 'portland-cement',
      salesCount: 0,
      createdAt: '2026-07-14T00:00:00.000Z',
      available: true,
      tags: [],
      specificationGroups: [],
    },
    variantSnap: {
      variantId: 501,
      sku: 'MAT-501',
      label: '25 kg sack',
      weightGrams: 25_000,
      deliveryClass: 'freight',
    },
    perTonneCents: 48_000,
    resolvedUnitPriceCents: 1_200,
    quantity: 7,
    materialSubtotalCents: 8_400,
    blendingFeeCents: 2_500,
    discountableTotalCents: 8_400,
    lineTotalCents: 10_900,
    customBlend: {
      configKey: EDIT_CONFIG_KEY,
      basePercentage: 70,
      mixingGroup: 'mineral',
      ingredients: [
        {
          variantId: 601,
          productId: '601',
          productName: 'Chalk Filler',
          productDescription: 'Filler',
          mixingGroup: 'mineral',
          percentage: 30,
        },
      ],
      blendingFeeCents: 2_500,
      madeToOrder: true,
      returnable: false,
    },
  };
}

function returnedCart(configKey: string): Cart {
  const line = configuredLine();
  return {
    id: 'cart',
    items: [{ ...line, configKey, customBlend: { ...line.customBlend!, configKey } }],
    subtotalCents: line.lineTotalCents,
    discountableSubtotalCents: line.discountableTotalCents,
    blendingFeeTotalCents: line.blendingFeeCents,
    totalItems: line.quantity,
  };
}

const addCustomBlend = vi.fn();
const replaceCustomBlend = vi.fn();

function mockCart(cart: Cart | null) {
  vi.mocked(useCartContext).mockReturnValue({
    cart,
    error: null,
    isCartAvailable: true,
    addCustomBlend,
    replaceCustomBlend,
    retryCart: vi.fn(),
  } as unknown as ReturnType<typeof useCartContext>);
}

function renderPage(search: string, extra?: React.ReactNode) {
  return render(
    <MemoryRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      initialEntries={[`/custom-blend${search}`]}
    >
      {extra}
      <CustomBlendPage />
    </MemoryRouter>,
  );
}

function TargetSwitcher() {
  const [, setSearchParams] = useSearchParams();
  return (
    <button type="button" onClick={() => setSearchParams({ baseVariantId: '502' })}>
      switch base
    </button>
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  countryState.activeCountry = 'US';
  addCustomBlend.mockResolvedValue(returnedCart(CREATED_CONFIG_KEY));
  replaceCustomBlend.mockResolvedValue(returnedCart(REPLACED_CONFIG_KEY));
  mockCart({
    id: 'cart',
    items: [],
    subtotalCents: 0,
    discountableSubtotalCents: 0,
    blendingFeeTotalCents: 0,
    totalItems: 0,
  });
  vi.mocked(getCustomBlendBases).mockResolvedValue(
    basesResponse([option(501, 'Portland Cement'), option(502, 'Fresh Base')]),
  );
  vi.mocked(getCustomBlendOptions).mockResolvedValue(
    optionsFor('Portland Cement', [option(601, 'Chalk Filler'), option(602, 'Fine Sand')]),
  );
  vi.mocked(evaluateCustomBlend).mockImplementation((body) => Promise.resolve(evaluationFor(body)));
});

describe('CustomBlendPage', () => {
  it('keeps the submit gate closed until the exact current draft has a server verdict', async () => {
    const user = userEvent.setup();
    renderPage('?baseVariantId=501');

    const ingredient = await screen.findByLabelText('Chalk Filler');
    await user.click(ingredient);
    const submit = screen.getByRole('button', { name: 'Add blend to cart' });
    expect(submit).toBeDisabled();
    expect(await screen.findByText('Checking your blend and current price…')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Chalk Filler percentage'), {
      target: { value: '20' },
    });
    await waitFor(() => expect(submit).toBeEnabled());
    expect(evaluateCustomBlend).toHaveBeenLastCalledWith(
      { baseVariantId: 501, ingredients: [{ variantId: 601, percentage: 20 }] },
      expect.any(AbortSignal),
      'US',
    );
    expect(screen.getByText('Non-food blend')).toBeInTheDocument();
    expect(screen.getByText(/Material total:/)).toBeInTheDocument();
    expect(screen.getByText(/Blending fee:/)).toBeInTheDocument();
    expect(screen.getByText(/Blend total:/)).toBeInTheDocument();
  });

  it('sends the evaluated quantity when creating and uses the returned authoritative key', async () => {
    const user = userEvent.setup();
    vi.mocked(evaluateCustomBlend).mockImplementation((body) =>
      Promise.resolve(evaluationFor(body, { quantity: 9, configKey: CREATED_CONFIG_KEY })),
    );
    addCustomBlend.mockResolvedValue(returnedCart(CREATED_CONFIG_KEY));
    renderPage('?baseVariantId=501');

    await user.click(await screen.findByLabelText('Chalk Filler'));
    fireEvent.change(screen.getByLabelText('Chalk Filler percentage'), { target: { value: '20' } });
    const submit = screen.getByRole('button', { name: 'Add blend to cart' });
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);

    expect(addCustomBlend).toHaveBeenCalledWith({
      baseVariantId: 501,
      ingredients: [{ variantId: 601, percentage: 20 }],
      quantity: 9,
    });
    expect(await screen.findByText('Custom blend added to your cart')).toBeInTheDocument();
    expect(screen.getByTestId('custom-blend-livery')).toHaveAttribute(
      'data-batch-mark',
      'CB-CCCCCC',
    );
  });

  it('keeps a sold-out server ingredient selectable', async () => {
    const user = userEvent.setup();
    vi.mocked(getCustomBlendOptions).mockResolvedValue(
      optionsFor('Portland Cement', [option(601, 'Chalk Filler', { stockCount: 0 })]),
    );
    renderPage('?baseVariantId=501');

    const ingredient = await screen.findByLabelText('Chalk Filler');
    expect(ingredient).toBeEnabled();
    expect(screen.getByText('Out of stock')).toBeInTheDocument();
    await user.click(ingredient);
    expect(ingredient).toBeChecked();
  });

  it('excludes a server-returned base variant without filtering other groups', async () => {
    const user = userEvent.setup();
    vi.mocked(getCustomBlendOptions).mockResolvedValue(
      optionsFor('Portland Cement', [
        option(501, 'Base Returned As Ingredient'),
        option(701, 'Food Binder', { mixingGroup: 'food-grade' }),
      ]),
    );
    renderPage('?baseVariantId=501');

    expect(screen.queryByLabelText('Base Returned As Ingredient')).not.toBeInTheDocument();
    const crossGroup = await screen.findByLabelText('Food Binder');
    expect(crossGroup).toBeEnabled();
    await user.click(crossGroup);
    await waitFor(() => expect(evaluateCustomBlend).toHaveBeenCalled());
  });

  it('renders a coded pigment-cap verdict and keeps submit disabled', async () => {
    const user = userEvent.setup();
    vi.mocked(evaluateCustomBlend).mockRejectedValue(
      new ApiError('private backend detail', 400, {
        error: 'private backend detail',
        code: 'CUSTOM_BLEND_PIGMENT_CAP_EXCEEDED',
        meta: { maxPercentage: 10, actualPercentage: 20 },
      }),
    );
    renderPage('?baseVariantId=501');

    await user.click(await screen.findByLabelText('Chalk Filler'));
    fireEvent.change(screen.getByLabelText('Chalk Filler percentage'), { target: { value: '20' } });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Pigment content cannot exceed 10% (selected: 20%).');
    expect(alert).not.toHaveTextContent('private backend detail');
    expect(screen.getByRole('button', { name: 'Add blend to cart' })).toBeDisabled();
  });

  it('drops a stale evaluation when the percentage changes before the fresh verdict', async () => {
    const user = userEvent.setup();
    let resolveStale!: (response: CustomBlendEvaluationResponse) => void;
    let resolveFresh!: (response: CustomBlendEvaluationResponse) => void;
    const stale = new Promise<CustomBlendEvaluationResponse>((resolve) => {
      resolveStale = resolve;
    });
    const fresh = new Promise<CustomBlendEvaluationResponse>((resolve) => {
      resolveFresh = resolve;
    });
    vi.mocked(evaluateCustomBlend).mockReturnValueOnce(stale).mockReturnValueOnce(fresh);
    renderPage('?baseVariantId=501');

    await user.click(await screen.findByLabelText('Chalk Filler'));
    await waitFor(() => expect(evaluateCustomBlend).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('Chalk Filler percentage'), { target: { value: '20' } });
    expect(screen.getByRole('button', { name: 'Add blend to cart' })).toBeDisabled();
    resolveFresh(
      evaluationFor({ baseVariantId: 501, ingredients: [{ variantId: 601, percentage: 20 }] }),
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add blend to cart' })).toBeEnabled(),
    );
    await act(async () => {
      resolveStale(
        evaluationFor({ baseVariantId: 501, ingredients: [{ variantId: 601, percentage: 50 }] }),
      );
      await stale;
    });
    expect(screen.getByRole('button', { name: 'Add blend to cart' })).toBeEnabled();
  });

  it('shows non-food classification from the server result without inferring from the base', async () => {
    const user = userEvent.setup();
    vi.mocked(evaluateCustomBlend).mockImplementation((body) =>
      Promise.resolve(evaluationFor(body, { resultClassification: 'non-food' })),
    );
    renderPage('?baseVariantId=501');

    await user.click(await screen.findByLabelText('Chalk Filler'));
    fireEvent.change(screen.getByLabelText('Chalk Filler percentage'), { target: { value: '20' } });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add blend to cart' })).toBeEnabled(),
    );
    expect(screen.getByText('Non-food blend')).toBeInTheDocument();
    expect(screen.getByText('Not for consumption')).toBeInTheDocument();
  });

  it('preserves edit quantity while replacing with a newly resolved key', async () => {
    const user = userEvent.setup();
    const line = configuredLine();
    mockCart({
      id: 'cart',
      items: [line],
      subtotalCents: line.lineTotalCents,
      discountableSubtotalCents: line.discountableTotalCents,
      blendingFeeTotalCents: line.blendingFeeCents,
      totalItems: line.quantity,
    });
    vi.mocked(getCustomBlendOptions).mockResolvedValue(
      optionsFor('Portland Cement', [option(601, 'Chalk Filler'), option(602, 'Fine Sand')]),
    );
    vi.mocked(evaluateCustomBlend).mockImplementation((body) =>
      Promise.resolve(evaluationFor(body, { quantity: 7, configKey: REPLACED_CONFIG_KEY })),
    );
    replaceCustomBlend.mockResolvedValue(returnedCart(REPLACED_CONFIG_KEY));
    renderPage(`?baseVariantId=501&editConfigKey=${EDIT_CONFIG_KEY}`);

    expect(await screen.findByLabelText('Chalk Filler')).toBeChecked();
    expect(screen.getByText(/Quantity: 7 sacks/)).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: 'Update blend' });
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);
    expect(replaceCustomBlend).toHaveBeenCalledWith({
      baseVariantId: 501,
      configKey: EDIT_CONFIG_KEY,
      ingredients: [{ variantId: 601, percentage: 30 }],
    });
    expect(await screen.findByText('Custom blend updated')).toBeInTheDocument();
    expect(screen.getByTestId('custom-blend-livery')).toHaveAttribute(
      'data-batch-mark',
      'CB-BBBBBB',
    );
  });

  it('aborts options and immediately invalidates the old target when the base changes', async () => {
    const user = userEvent.setup();
    const oldOptions = new Promise<CustomBlendOptionsResponse>(() => {});
    vi.mocked(getCustomBlendOptions)
      .mockReturnValueOnce(oldOptions)
      .mockResolvedValueOnce(optionsFor('Fresh Base', [option(701, 'Fresh Ingredient')]));
    renderPage('?baseVariantId=501', <TargetSwitcher />);

    const oldSignal = vi.mocked(getCustomBlendOptions).mock.calls[0]?.[1];
    await user.click(screen.getByRole('button', { name: 'switch base' }));
    expect(await screen.findByLabelText('Fresh Ingredient')).toBeInTheDocument();
    expect(oldSignal?.aborted).toBe(true);
    expect(screen.queryByLabelText('Chalk Filler')).not.toBeInTheDocument();
  });
});
