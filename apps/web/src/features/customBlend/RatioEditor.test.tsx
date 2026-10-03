import { fireEvent, render, screen } from '@testing-library/react';
import type { CustomBlendOption } from '@shop/contracts/custom-blends';
import { describe, expect, it, vi } from 'vitest';
import { RatioEditor } from './RatioEditor';

const ingredient: CustomBlendOption = {
  productId: '1',
  productName: 'Chalk Filler',
  productDescription: 'Filler',
  category: 'Fillers',
  consumptionClassification: 'non-food',
  mixingGroup: 'mineral',
  categoryFacts: {
    texture: 'Fine',
    colour: 'Grey',
    source: 'Test',
    intendedUse: 'Test',
    storage: 'Dry',
    consumptionClassification: 'non-food',
  },
  variant: {
    variantId: 1,
    productId: 1,
    sku: 'MAT-1',
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
  },
};
const second = {
  ...ingredient,
  productId: '2',
  productName: 'Silica Flour',
  variant: { ...ingredient.variant, variantId: 2, productId: 2 },
};

describe('RatioEditor', () => {
  it('clamps range, number and stepper changes and reports remaining budget', () => {
    const onPercentageChange = vi.fn();
    render(
      <RatioEditor
        options={[ingredient]}
        selectedVariantIds={[1]}
        percentages={new Map([[1, 20]])}
        onPercentageChange={onPercentageChange}
        onBalanceEvenly={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('Chalk Filler percentage slider'), {
      target: { value: '53' },
    });
    fireEvent.change(screen.getByLabelText('Chalk Filler percentage'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Decrease Chalk Filler percentage' }));
    fireEvent.click(screen.getByRole('button', { name: 'Increase Chalk Filler percentage' }));
    expect(onPercentageChange).toHaveBeenNthCalledWith(1, 1, 50);
    expect(onPercentageChange).toHaveBeenNthCalledWith(2, 1, 5);
    expect(onPercentageChange).toHaveBeenNthCalledWith(3, 1, 19);
    expect(onPercentageChange).toHaveBeenNthCalledWith(4, 1, 21);
    expect(screen.getByText(/30% remaining/)).toBeInTheDocument();
  });

  it('never emits a change above the 50% total budget', () => {
    const onPercentageChange = vi.fn();
    render(
      <RatioEditor
        options={[ingredient, second]}
        selectedVariantIds={[1, 2]}
        percentages={
          new Map([
            [1, 25],
            [2, 25],
          ])
        }
        onPercentageChange={onPercentageChange}
        onBalanceEvenly={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('Chalk Filler percentage'), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Increase Chalk Filler percentage' }));
    expect(onPercentageChange).toHaveBeenNthCalledWith(1, 1, 25);
    expect(onPercentageChange).toHaveBeenNthCalledWith(2, 1, 25);
  });

  it('balances selected ingredients and focuses the added input then a removal neighbour', () => {
    const onBalanceEvenly = vi.fn();
    const props = {
      options: [ingredient, second],
      percentages: new Map([
        [1, 25],
        [2, 25],
      ]),
      onPercentageChange: vi.fn(),
      onBalanceEvenly,
    };
    const { rerender } = render(<RatioEditor {...props} selectedVariantIds={[]} />);
    rerender(<RatioEditor {...props} selectedVariantIds={[1]} />);
    expect(screen.getByLabelText('Chalk Filler percentage')).toHaveFocus();
    rerender(<RatioEditor {...props} selectedVariantIds={[1, 2]} />);
    expect(screen.getByLabelText('Silica Flour percentage')).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Balance evenly' }));
    expect(onBalanceEvenly).toHaveBeenCalledOnce();
    rerender(<RatioEditor {...props} selectedVariantIds={[1]} />);
    expect(screen.getByLabelText('Chalk Filler percentage')).toHaveFocus();
  });
});
