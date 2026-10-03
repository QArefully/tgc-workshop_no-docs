import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Product } from '@shop/contracts/products';
import { describe, expect, it, vi } from 'vitest';
import { ComparisonMatrix } from './ComparisonMatrix';

function product(id: string, name: string, specs: Product['specificationGroups']): Product {
  return {
    id,
    name,
    description: '',
    priceCents: 1000,
    imageSetId: 'none',
    category: 'Cooking',
    stock: 1,
    slug: id,
    salesCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    available: true,
    availability: 'in_stock',
    backorderable: false,
    backorderLeadDays: null,
    tags: [],
    specificationGroups: specs,
  };
}

const nutrition = (calories: string, withProtein = true): Product['specificationGroups'] => [
  {
    key: 'nutrition',
    label: 'Nutrition',
    order: 1,
    specifications: [
      { key: 'calories', label: 'Calories', valueKey: calories, value: `${calories} kcal` },
      ...(withProtein
        ? [{ key: 'protein', label: 'Protein', valueKey: '10g', value: '10 g' }]
        : []),
    ],
  },
];

describe('ComparisonMatrix', () => {
  it('keeps product columns in response order and puts differing values first', () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ComparisonMatrix
          products={[
            product('2', 'Second powder', nutrition('200')),
            product('1', 'First powder', nutrition('100')),
          ]}
          onRemove={vi.fn()}
        />
      </MemoryRouter>,
    );

    const headers = screen.getAllByRole('columnheader').map((header) => header.textContent);
    expect(headers[1]).toContain('Second powder');
    expect(headers[2]).toContain('First powder');
    const rows = screen.getAllByRole('row');
    expect(within(rows[1]!).getByRole('rowheader')).toHaveTextContent('Calories');
    expect(within(rows[2]!).getByRole('rowheader')).toHaveTextContent('Protein');
  });

  it('marks absent facts as not specified, which counts as a difference', () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ComparisonMatrix
          products={[
            product('1', 'One', nutrition('100')),
            product('2', 'Two', nutrition('100', false)),
          ]}
          onRemove={vi.fn()}
        />
      </MemoryRouter>,
    );

    const proteinRow = screen.getByRole('rowheader', { name: /Protein/ }).closest('tr')!;
    expect(within(proteinRow).getByText('Not specified')).toBeInTheDocument();
  });
});
