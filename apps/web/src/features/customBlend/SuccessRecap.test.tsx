import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { CustomBlendOption } from '@shop/contracts/custom-blends';
import { describe, expect, it } from 'vitest';
import { CUSTOM_BLEND_MADE_TO_ORDER_NOTE } from './CustomBlendPackaging';
import { SuccessRecap } from './SuccessRecap';

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

describe('SuccessRecap', () => {
  it('shows packaging, composition and the shared made-to-order note', () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <SuccessRecap
          result="created"
          base={base}
          basePercentage={80}
          ingredients={[
            {
              option: {
                ...base,
                productId: '11',
                productName: 'Chalk Filler',
                variant: { ...base.variant, variantId: 601, productId: 11 },
              },
              percentage: 20,
            },
          ]}
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('custom-blend-livery')).toBeInTheDocument();
    expect(screen.getByText('80% Portland Cement')).toBeInTheDocument();
    expect(screen.getByText('20% Chalk Filler')).toBeInTheDocument();
    expect(screen.getByText(CUSTOM_BLEND_MADE_TO_ORDER_NOTE)).toBeInTheDocument();
  });

  it('keeps an edited-composition success recap on the preview mark until a new key is authoritative', () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <SuccessRecap
          result="replaced"
          base={base}
          basePercentage={75}
          ingredients={[
            {
              option: {
                ...base,
                productId: '11',
                productName: 'Chalk Filler',
                variant: { ...base.variant, variantId: 601, productId: 11 },
              },
              percentage: 25,
            },
          ]}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Custom blend updated' })).toBeInTheDocument();
    expect(screen.getByText('75% Portland Cement')).toBeInTheDocument();
    expect(screen.getByText('25% Chalk Filler')).toBeInTheDocument();
    expect(screen.getByTestId('custom-blend-livery')).toHaveAttribute(
      'data-batch-mark',
      'CB-PREVIEW',
    );
  });
});
