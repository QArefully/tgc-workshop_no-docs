import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RatioGauge } from './RatioGauge';

describe('RatioGauge', () => {
  it('announces the current integer composition and exposes the valid state', () => {
    const { container, rerender } = render(
      <RatioGauge basePercentage={75} totalPercentage={25} ingredientCount={2} isValid />,
    );

    const liveComposition = screen.getByText(
      'Base 75% · ingredients 25% · 2 of 4 ingredients selected',
    );
    expect(liveComposition).toHaveAttribute('aria-live', 'polite');
    expect(liveComposition).toHaveAttribute('aria-atomic', 'true');
    expect(container.querySelector('.custom-blend-gauge')).not.toHaveClass(
      'custom-blend-gauge--invalid',
    );

    rerender(
      <RatioGauge basePercentage={45} totalPercentage={55} ingredientCount={2} isValid={false} />,
    );
    expect(liveComposition).toHaveTextContent(
      'Base 45% · ingredients 55% · 2 of 4 ingredients selected',
    );
    expect(container.querySelector('.custom-blend-gauge')).toHaveClass(
      'custom-blend-gauge--invalid',
    );
  });
});
