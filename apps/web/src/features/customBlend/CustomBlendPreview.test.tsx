import { fireEvent, render, screen } from '@testing-library/react';
import type { CustomBlendOption, ResolvedCustomBlendSnapshot } from '@shop/contracts/custom-blends';
import { describe, expect, it } from 'vitest';
import { CustomBlendPreview, toPreviewBlend } from './CustomBlendPreview';

const base: CustomBlendOption = {
  productId: '9',
  productName: 'Portland Cement',
  productDescription: 'Base',
  mixingGroup: 'mineral',
  category: 'Trade & Creative Materials',
  consumptionClassification: 'non-food',
  categoryFacts: {
    texture: 'Fine',
    colour: 'Grey',
    source: 'Test',
    intendedUse: 'Test',
    storage: 'Dry',
    consumptionClassification: 'non-food',
  },
  variant: {
    variantId: 501,
    productId: 9,
    sku: 'MAT-501',
    label: '25 kg sack',
    weightGrams: 25000,
    priceCents: 1200,
    moqSacks: 4,
    perTonneCents: 48000,
    priceTiers: [{ minTonnes: 1, discountPct: 0 }],
    stockCount: 1,
    backorderable: false,
    backorderLeadDays: null,
    deliveryClass: 'freight',
    active: true,
    sortOrder: 1,
  },
};
const ingredient: CustomBlendOption = {
  ...base,
  productId: '11',
  productName: 'Chalk Filler',
  variant: { ...base.variant, variantId: 601, productId: 11 },
};

const resolved: ResolvedCustomBlendSnapshot = {
  configKey: 'f'.repeat(64),
  basePercentage: 80,
  mixingGroup: 'mineral',
  basePresentation: {
    category: base.category,
    consumptionClassification: 'non-food',
    categoryFacts: base.categoryFacts,
  },
  ingredients: [
    {
      variantId: 601,
      productId: '11',
      productName: 'Chalk Filler',
      productDescription: 'Ingredient from the server',
      mixingGroup: 'mineral',
      percentage: 20,
    },
  ],
  blendingFeeCents: 2_500,
  madeToOrder: true,
  returnable: false,
  ruleVersion: 1,
  resultClassification: 'non-food',
  quantity: 4,
  components: [
    {
      role: 'base',
      variantId: 501,
      productId: '9',
      productName: 'Portland Cement',
      productDescription: 'Base from the server',
      sku: 'MAT-501',
      variantLabel: '25 kg sack',
      mixingGroup: 'mineral',
      consumptionClassification: 'non-food',
      percentage: 80,
      weightGrams: 800_000,
      sourceUnitPriceCents: 1_200,
      tierDiscountPct: 0,
      unitContributionCents: 960,
      subtotalCents: 3_840,
    },
    {
      role: 'ingredient',
      variantId: 601,
      productId: '11',
      productName: 'Chalk Filler',
      productDescription: 'Ingredient from the server',
      sku: 'MAT-601',
      variantLabel: '25 kg sack',
      mixingGroup: 'mineral',
      consumptionClassification: 'non-food',
      percentage: 20,
      weightGrams: 200_000,
      sourceUnitPriceCents: 1_200,
      tierDiscountPct: 0,
      unitContributionCents: 240,
      subtotalCents: 960,
    },
  ],
  materialUnitPriceCents: 1_200,
  materialSubtotalCents: 4_800,
  discountableTotalCents: 4_800,
  lineTotalCents: 7_300,
};

describe('CustomBlendPreview', () => {
  it('uses a draft mark rather than fabricating a server config key', () => {
    render(
      <CustomBlendPreview
        base={base}
        basePercentage={80}
        ingredients={[{ option: ingredient, percentage: 20 }]}
      />,
    );
    expect(screen.getByTestId('custom-blend-livery')).toHaveAttribute(
      'data-batch-mark',
      'CB-PREVIEW',
    );
    expect(screen.getByText(/80% Portland Cement.*20% Chalk Filler/)).toBeInTheDocument();
  });

  it('opens and dismisses zoom by keyboard', () => {
    render(
      <CustomBlendPreview
        base={base}
        basePercentage={80}
        ingredients={[{ option: ingredient, percentage: 20 }]}
      />,
    );
    const zoom = screen.getByRole('button', { name: 'Zoom packaging preview' });
    fireEvent.click(zoom);
    expect(zoom).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Zoom packaging preview' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('tracks the pointer as the zoom transform origin', () => {
    render(
      <CustomBlendPreview
        base={base}
        basePercentage={80}
        ingredients={[{ option: ingredient, percentage: 20 }]}
      />,
    );
    const zoom = screen.getByRole('button', { name: 'Zoom packaging preview' });
    Object.defineProperty(zoom, 'getBoundingClientRect', {
      value: () => ({ left: 10, top: 20, width: 200, height: 100 }),
    });

    fireEvent(zoom, new MouseEvent('pointermove', { bubbles: true, clientX: 60, clientY: 70 }));
    fireEvent.click(zoom);

    const zoomSurface = zoom.firstElementChild as HTMLElement;
    expect(zoomSurface.style.transformOrigin).toBe('25% 50%');
    expect(zoomSurface.style.transform).toBe('scale(1.5)');
  });

  it('does not treat an edit target key as an authoritative batch mark', () => {
    render(
      <CustomBlendPreview
        base={base}
        basePercentage={75}
        ingredients={[{ option: ingredient, percentage: 25 }]}
        configKey={'a'.repeat(64)}
      />,
    );

    expect(screen.getByTestId('custom-blend-livery')).toHaveAttribute(
      'data-batch-mark',
      'CB-PREVIEW',
    );
    expect(screen.getByText('Draft mark')).toBeInTheDocument();
  });

  it('uses a newly authoritative server key when one is supplied', () => {
    render(
      <CustomBlendPreview
        base={base}
        basePercentage={80}
        ingredients={[{ option: ingredient, percentage: 20 }]}
        authoritativeConfigKey={'abcdef'.padEnd(64, '0')}
      />,
    );

    expect(screen.getByTestId('custom-blend-livery')).toHaveAttribute(
      'data-batch-mark',
      'CB-ABCDEF',
    );
    expect(screen.getByText('Confirmed batch mark')).toBeInTheDocument();
  });

  it('updates the printed composition as the draft changes', () => {
    const { rerender } = render(
      <CustomBlendPreview
        base={base}
        basePercentage={80}
        ingredients={[{ option: ingredient, percentage: 20 }]}
      />,
    );
    expect(screen.getByText(/80% Portland Cement.*20% Chalk Filler/)).toBeInTheDocument();

    rerender(
      <CustomBlendPreview
        base={base}
        basePercentage={75}
        ingredients={[{ option: ingredient, percentage: 25 }]}
      />,
    );
    expect(screen.getByText(/75% Portland Cement.*25% Chalk Filler/)).toBeInTheDocument();
  });

  it('keeps zoom state accessible while reduced motion suppresses the transform', () => {
    const previousMatchMedia = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }),
    });
    try {
      render(
        <CustomBlendPreview
          base={base}
          basePercentage={80}
          ingredients={[{ option: ingredient, percentage: 20 }]}
        />,
      );
      const zoom = screen.getByRole('button', { name: 'Zoom packaging preview' });
      fireEvent.click(zoom);

      expect(zoom).toHaveAttribute('aria-pressed', 'true');
      expect((zoom.firstElementChild as HTMLElement).style.transform).toBe('');
    } finally {
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: previousMatchMedia,
      });
    }
  });

  it('builds only a render-time snapshot from draft facts', () => {
    expect(
      toPreviewBlend({
        base,
        basePercentage: 80,
        ingredients: [{ option: ingredient, percentage: 20 }],
      }).ingredients,
    ).toEqual([expect.objectContaining({ productName: 'Chalk Filler', percentage: 20 })]);
  });

  it('renders a successful server snapshot without rebuilding its composition', () => {
    const snapshot = toPreviewBlend({
      base,
      basePercentage: 50,
      ingredients: [],
      resolved,
    });
    expect(snapshot).toBe(resolved);

    render(
      <CustomBlendPreview base={base} basePercentage={50} ingredients={[]} resolved={resolved} />,
    );
    expect(screen.getByTestId('custom-blend-livery')).toHaveAttribute(
      'data-result-classification',
      'non-food',
    );
    expect(screen.getByText(/80% Portland Cement.*20% Chalk Filler/)).toBeInTheDocument();
  });
});
