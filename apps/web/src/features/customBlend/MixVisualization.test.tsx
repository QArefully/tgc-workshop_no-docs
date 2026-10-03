import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { deterministicMixColour, MixVisualization, mixColour } from './MixVisualization';

const base = { productId: '1', productName: 'Base', category: 'Sports Nutrition', percentage: 70 };
const ingredient = { productId: '998', productName: 'Filler', category: 'Unknown', percentage: 30 };

describe('MixVisualization', () => {
  it('maps base and ingredient shares to proportional, total-covering segments', () => {
    const { container } = render(<MixVisualization base={base} ingredients={[ingredient]} />);
    const segments = container.querySelectorAll<SVGRectElement>('[data-product-id]');

    expect(segments).toHaveLength(2);
    const baseSegment = segments.item(0);
    const ingredientSegment = segments.item(1);
    if (!baseSegment || !ingredientSegment) {
      throw new Error('Expected base and ingredient segments');
    }

    expect(baseSegment).toHaveAttribute('x', '148');
    expect(Number(baseSegment.getAttribute('width'))).toBeCloseTo(296.8);
    expect(Number(ingredientSegment.getAttribute('x'))).toBeCloseTo(444.8);
    expect(Number(ingredientSegment.getAttribute('width'))).toBeCloseTo(127.2);
  });

  it('uses the resolved catalog pigment, with a deterministic fallback only when unresolved', () => {
    expect(mixColour(base)).toBe('#b8d8c0');
    expect(mixColour(ingredient)).toBe(deterministicMixColour('998'));
    expect(deterministicMixColour('998')).toBe(deterministicMixColour('998'));
    expect(deterministicMixColour('998')).not.toBe(deterministicMixColour('999'));
  });

  it('links legend and keyboard-focusable segments in both directions', () => {
    const { container } = render(<MixVisualization base={base} ingredients={[ingredient]} />);
    const baseSegment = container.querySelector('[data-product-id="1"]');
    const ingredientSegment = container.querySelector('[data-product-id="998"]');

    fireEvent.focus(screen.getByRole('button', { name: /Filler 30%/ }));
    expect(ingredientSegment).toHaveAttribute('data-active', 'true');
    expect(baseSegment).toHaveAttribute('opacity', '0.45');

    fireEvent.focus(ingredientSegment!);
    expect(screen.getByRole('button', { name: /Filler 30%/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('is total for no ingredients and the maximum four ingredients', () => {
    const { rerender, container } = render(
      <MixVisualization base={{ ...base, percentage: 100 }} ingredients={[]} />,
    );
    expect(container.querySelectorAll('[data-product-id]')).toHaveLength(1);

    rerender(
      <MixVisualization
        base={{ ...base, percentage: 50 }}
        ingredients={[10, 15, 20, 5].map((percentage, index) => ({
          productId: String(900 + index),
          productName: `Ingredient ${index + 1}`,
          category: 'Unknown',
          percentage,
        }))}
      />,
    );
    expect(container.querySelectorAll('[data-product-id]')).toHaveLength(5);
  });
});
