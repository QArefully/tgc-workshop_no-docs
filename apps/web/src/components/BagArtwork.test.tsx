import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BagArtwork } from './BagArtwork';

describe('BagArtwork', () => {
  it('uses catalog accent for the paper-square label and balances title lines by characters', () => {
    const { container } = render(
      <BagArtwork
        name="Supercalifragilistic Tiny Tiny"
        category="Test"
        quantity="1kg"
        batchCode="TST-01"
        mark="TST"
        accent="#287fa6"
        powderAccent="#b9e2ee"
        consumptionLabel={null}
      />,
    );

    expect(container.querySelector('rect[width="320"][height="236"]')).toHaveAttribute(
      'fill',
      '#287fa6',
    );
    expect(screen.getByText('SUPERCALIFRAGILISTIC')).toBeInTheDocument();
    expect(screen.getByText('TINY TINY')).toBeInTheDocument();
    expect(screen.getByText('QAREFULLY MATERIALS EXCHANGE')).toBeInTheDocument();
  });

  it('defaults the accessible label to the bag without the retired "powder" wording', () => {
    render(
      <BagArtwork
        name="Portland Cement"
        category="Trade & Creative Materials"
        quantity="25 kg"
        batchCode="TCM-01"
        mark="CEM"
        consumptionLabel={null}
      />,
    );

    expect(screen.getByRole('img', { name: 'Portland Cement bag' })).toBeInTheDocument();
  });

  it('gives independently rendered painted bags distinct gradient identifiers', () => {
    const { container } = render(
      <>
        <BagArtwork
          name="First mix"
          category="Custom mix"
          quantity="500g"
          batchCode="batch-v1"
          mark="MIX"
          paint={{ kind: 'linear-gradient', colors: ['#9b5de5', '#00d9ff'] }}
          consumptionLabel={null}
        />
        <BagArtwork
          name="Second mix"
          category="Custom mix"
          quantity="500g"
          batchCode="batch-v1"
          mark="MIX"
          paint={{ kind: 'linear-gradient', colors: ['#ff7b00', '#ffe66d'] }}
          consumptionLabel={null}
        />
      </>,
    );

    const gradients = Array.from(container.querySelectorAll('linearGradient'));
    expect(gradients).toHaveLength(2);
    expect(new Set(gradients.map((gradient) => gradient.id)).size).toBe(2);
  });
});
