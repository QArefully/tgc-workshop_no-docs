import { render, screen, within } from '@testing-library/react';
import type { Product } from '@shop/contracts/products';
import { describe, expect, it } from 'vitest';
import { ProductSpecifications } from './ProductSpecifications';

const specificationGroups: Product['specificationGroups'] = [
  {
    key: 'preparation',
    label: 'Preparation',
    order: 2,
    specifications: [
      { key: 'format', label: 'Format', valueKey: 'powder', value: 'Powder' },
      { key: 'colour', label: 'Colour', valueKey: 'red', value: 'Red' },
    ],
  },
  {
    key: 'storage',
    label: 'Storage',
    order: 1,
    specifications: [{ key: 'format', label: 'Format', valueKey: 'sealed', value: 'Sealed' }],
  },
];

describe('ProductSpecifications', () => {
  it('preserves contract group and specification order', () => {
    render(<ProductSpecifications specificationGroups={specificationGroups} />);

    expect(
      screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent),
    ).toEqual(['Preparation', 'Storage']);
    expect(
      within(screen.getByRole('heading', { name: 'Preparation', level: 3 }).parentElement!)
        .getAllByRole('term')
        .map((term) => term.textContent),
    ).toEqual(['Format', 'Colour']);
  });

  it('keeps same labels in separate groups as separate description lists', () => {
    render(<ProductSpecifications specificationGroups={specificationGroups} />);

    expect(screen.getAllByText('Format')).toHaveLength(2);
    expect(screen.getAllByRole('definition')).toHaveLength(3);
  });

  it('omits empty groups and values without inventing specification content', () => {
    const { container } = render(
      <ProductSpecifications
        specificationGroups={[
          { key: 'empty', label: 'Empty', order: 1, specifications: [] },
          {
            key: 'partial',
            label: 'Partial',
            order: 2,
            specifications: [{ key: 'unknown', label: 'Unknown', valueKey: 'unknown', value: '' }],
          },
        ]}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
