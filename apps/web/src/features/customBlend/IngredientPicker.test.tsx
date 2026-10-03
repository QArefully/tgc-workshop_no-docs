import { fireEvent, render, screen } from '@testing-library/react';
import type { CustomBlendOption } from '@shop/contracts/custom-blends';
import { describe, expect, it, vi } from 'vitest';
import { IngredientPicker } from './IngredientPicker';

function option(
  variantId: number,
  productName: string,
  category: string,
  overrides: Partial<CustomBlendOption['variant']> = {},
): CustomBlendOption {
  return {
    productId: String(variantId),
    productName,
    productDescription: `${productName} description`,
    category,
    consumptionClassification: 'non-food',
    categoryFacts: {
      texture: 'Fine',
      colour: 'Grey',
      source: 'Test',
      intendedUse: 'Test',
      storage: 'Dry',
      consumptionClassification: 'non-food',
    },
    mixingGroup: 'mineral',
    variant: {
      variantId,
      productId: variantId,
      sku: `MAT-${variantId}`,
      label: '25 kg sack',
      weightGrams: 25_000,
      priceCents: 1200,
      moqSacks: 4,
      perTonneCents: 48_000,
      priceTiers: [{ minTonnes: 1, discountPct: 0 }],
      stockCount: 10,
      backorderable: false,
      backorderLeadDays: null,
      deliveryClass: 'freight',
      active: true,
      sortOrder: 1,
      ...overrides,
    },
  };
}

describe('IngredientPicker', () => {
  it('groups matching ingredients by category and filters them with search', () => {
    render(
      <IngredientPicker
        options={[option(1, 'Chalk Filler', 'Fillers'), option(2, 'Red Oxide', 'Pigments')]}
        selectedVariantIds={[]}
        isLimitReached={false}
        onToggle={vi.fn()}
      />,
    );

    expect(screen.getByRole('region', { name: 'Fillers ingredients' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Pigments ingredients' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search ingredients' }), {
      target: { value: 'oxide' },
    });
    expect(screen.queryByRole('region', { name: 'Fillers ingredients' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Red Oxide')).toBeInTheDocument();
  });

  it('keeps sold-out ingredients selectable with an advisory badge', () => {
    const onToggle = vi.fn();
    render(
      <IngredientPicker
        options={[option(1, 'Sold Out', 'Fillers', { stockCount: 0 })]}
        selectedVariantIds={[]}
        isLimitReached={false}
        onToggle={onToggle}
      />,
    );

    const soldOut = screen.getByLabelText('Sold Out');
    expect(soldOut).toBeEnabled();
    expect(screen.getByText('Out of stock')).toBeInTheDocument();
    fireEvent.click(soldOut);
    expect(onToggle).toHaveBeenCalledWith(1);
  });

  it('disables inactive tiles, including selected ones, with a visible reason', () => {
    const onToggle = vi.fn();
    render(
      <IngredientPicker
        options={[
          option(2, 'Inactive', 'Fillers', { active: false }),
          option(3, 'At Limit', 'Fillers'),
        ]}
        selectedVariantIds={[2, 9, 10, 11]}
        isLimitReached
        onToggle={onToggle}
      />,
    );

    expect(screen.getByLabelText('Inactive')).toBeDisabled();
    expect(screen.getByText('This ingredient is unavailable')).toBeInTheDocument();
    expect(screen.getByLabelText('At Limit')).toBeDisabled();
    expect(screen.getByText('Ingredient limit reached')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Inactive'));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('keeps a selected tile removable when the selection limit is reached', () => {
    const onToggle = vi.fn();
    render(
      <IngredientPicker
        options={[option(3, 'Selected At Limit', 'Fillers')]}
        selectedVariantIds={[3, 9, 10, 11]}
        isLimitReached
        onToggle={onToggle}
      />,
    );

    const selectedAtLimit = screen.getByLabelText('Selected At Limit');
    expect(selectedAtLimit).toBeEnabled();
    fireEvent.click(selectedAtLimit);
    expect(onToggle).toHaveBeenCalledWith(3);
  });
});
