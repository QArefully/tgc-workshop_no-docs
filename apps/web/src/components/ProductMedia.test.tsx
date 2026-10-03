import { render, screen } from '@testing-library/react';
import type { Product } from '@shop/contracts/products';
import { describe, expect, it } from 'vitest';

import { ProductMedia } from './ProductMedia';

const packaging = {
  labelColor: '#287fa6',
  powderColor: '#b9e2ee',
  mark: 'H2O',
  batchCode: 'IMP-07',
  quantity: 'Conceptual quantity',
  consumptionLabel: 'Not for consumption',
} as const;

const product = (overrides: Partial<Product> = {}): Product => ({
  id: 'powdered-water-1',
  name: 'Powdered Water',
  description: 'A 250g bag of water, reconsidered.',
  priceCents: 1299,
  imageSetId: 'powdered-water',
  packaging,
  category: 'Impossible',
  stock: 10,
  slug: 'powdered-water',
  salesCount: 10,
  ...overrides,
  createdAt: overrides.createdAt ?? '2026-07-14T00:00:00.000Z',
  available: overrides.available ?? true,
  tags: overrides.tags ?? [],
  specificationGroups: overrides.specificationGroups ?? [],
  availability: overrides.availability ?? 'in_stock',
  backorderable: overrides.backorderable ?? false,
  backorderLeadDays: overrides.backorderLeadDays ?? null,
});

describe('ProductMedia', () => {
  it('renders canonical packaging data as the locked live bag', () => {
    render(<ProductMedia product={product()} />);

    const artwork = screen.getByRole('img', { name: 'Powdered Water bag' });
    expect(artwork.tagName).toBe('svg');
    expect(artwork).toHaveTextContent('CONCEPTUAL QUANTITY');
    expect(artwork).toHaveTextContent('NOT FOR CONSUMPTION');
  });

  it('omits a warning label for consumable packaging', () => {
    render(
      <ProductMedia product={product({ packaging: { ...packaging, consumptionLabel: null } })} />,
    );

    expect(screen.getByRole('img', { name: 'Powdered Water bag' })).not.toHaveTextContent(
      'NOT FOR CONSUMPTION',
    );
  });

  it('uses an accessible generic fallback for noncanonical products', () => {
    render(<ProductMedia product={product({ imageSetId: 'retired-set', packaging: undefined })} />);

    const image = screen.getByRole('img', { name: 'Powdered Water' });
    expect(image).toHaveAttribute('src', expect.stringContaining('data:image/svg+xml,'));
    expect(image).toHaveAttribute('width', '720');
    expect(image).toHaveAttribute('height', '720');
  });

  // Ids are canonical positive integers from each category so the decorative palette resolves;
  // a non-canonical id deliberately falls through to the generic artwork instead.
  it.each([
    ['Sports Nutrition', 'Whey Protein Isolate', '8'],
    ['Baking & Pantry', 'All-Purpose Flour', '1'],
    ['Drinks', 'Matcha Green Tea Powder', '14'],
  ])('renders a food bag for list products in %s without packaging', (category, name, id) => {
    render(
      <ProductMedia
        product={product({
          id,
          category,
          name,
          imageSetId: name.toLowerCase().replaceAll(' ', '-'),
          packaging: undefined,
        })}
      />,
    );

    const artwork = screen.getByRole('img', { name: `${name} bag` });
    expect(artwork.tagName).toBe('svg');
    expect(artwork).toHaveTextContent(category.toUpperCase());
    expect(artwork).toHaveTextContent('1 KG');
  });

  // One representative canonical catalog product per category, with the vessel its category owns.
  // Ids are the first canonical id of each category, so every palette resolves. The expected scheme
  // key and pigment are the literal `CATALOG_PACKAGING_PALETTES` row at index `(Number(id) - 1) % 5`
  // for that category; both come from the SAME row, so a mismatched key/pigment pairing, a wrong
  // category table, or an off-by-one in the index arithmetic all fail here.
  it.each([
    ['Sports Nutrition', '8', 'Whey Protein Isolate', 'bag', 'plum-berry', '#d6a6c9'],
    ['Baking & Pantry', '1', 'All-Purpose Flour', 'bag', 'rust-flour', '#e8dcc1'],
    ['Drinks', '14', 'Matcha Green Tea Powder', 'bag', 'citrus-leaf', '#d9d56e'],
    ['Household & Cleaning', '20', 'Laundry Detergent Powder', 'keg', 'pine-sage', '#b3d1b6'],
    [
      'Garden & Outdoors',
      '27',
      'All-Purpose Garden Fertilizer',
      'woven sack',
      'earth-straw',
      '#c7a46a',
    ],
    [
      'Trade & Creative Materials',
      '33',
      'Portland Cement',
      'stitched kraft sack',
      'ultramarine-blue',
      '#5878c5',
    ],
  ])(
    'renders %s on its vessel with the exact scheme and pigment its palette row defines',
    (category, id, name, vessel, expectedScheme, expectedPigment) => {
      const { container } = render(
        <ProductMedia
          product={product({
            id,
            category,
            name,
            imageSetId: name.toLowerCase().replaceAll(' ', '-'),
            packaging: undefined,
          })}
        />,
      );

      const artwork = screen.getByRole('img', { name: `${name} ${vessel}` });
      expect(artwork.tagName).toBe('svg');
      expect(artwork.getAttribute('data-colour-scheme')).toMatch(/^[a-z]+(-[a-z]+)+$/);
      expect(artwork.getAttribute('data-colour-scheme')).toBe(expectedScheme);

      const pigmentSamples = container.querySelectorAll('[data-pigment]');
      expect(pigmentSamples).toHaveLength(1);
      expect(pigmentSamples[0]).toHaveAttribute('aria-hidden', 'true');
      expect(pigmentSamples[0]?.getAttribute('data-pigment')).toMatch(/^#[0-9a-f]{6}$/i);
      expect(pigmentSamples[0]?.getAttribute('data-pigment')?.toLowerCase()).toBe(expectedPigment);
    },
  );

  it('gives five canonical ids of one category five distinct schemes and pigments', () => {
    const ids = ['33', '34', '35', '36', '37'];
    const { container } = render(
      <>
        {ids.map((id) => (
          <ProductMedia
            key={id}
            product={product({
              id,
              category: 'Trade & Creative Materials',
              name: `Trade Material ${id}`,
              imageSetId: `trade-material-${id}`,
              packaging: undefined,
            })}
          />
        ))}
      </>,
    );

    const schemes = Array.from(container.querySelectorAll('svg[data-colour-scheme]')).map((svg) =>
      svg.getAttribute('data-colour-scheme'),
    );
    const pigments = Array.from(container.querySelectorAll('[data-pigment]')).map((group) =>
      group.getAttribute('data-pigment'),
    );

    expect(schemes).toHaveLength(ids.length);
    expect(new Set(schemes).size).toBe(ids.length);
    expect(pigments).toHaveLength(ids.length);
    expect(new Set(pigments).size).toBe(ids.length);
  });

  it('renders the heavy-duty vessel for a non-food category instead of the fallback', () => {
    render(
      <ProductMedia
        product={product({
          // Palette resolution needs a canonical integer id; 'powdered-water-1' would instead fall
          // through to the generic artwork (covered by the next test).
          id: '33',
          name: 'Portland Cement',
          category: 'Trade & Creative Materials',
          consumptionClassification: 'caution',
          packaging: undefined,
        })}
      />,
    );

    const artwork = screen.getByRole('img', { name: 'Portland Cement stitched kraft sack' });
    expect(artwork.tagName).toBe('svg');
    expect(artwork).toHaveTextContent('QAREFULLY MATERIALS EXCHANGE');
  });

  it('falls back to the generic artwork when a non-food category has an unresolvable id', () => {
    const { container } = render(
      <ProductMedia
        product={product({
          // Non-canonical id: no palette resolves, so the heavy-duty vessel must not be printed with
          // an invented neutral scheme (plan invariant 7).
          id: 'powdered-water-1',
          name: 'Portland Cement',
          category: 'Trade & Creative Materials',
          consumptionClassification: 'caution',
          packaging: undefined,
        })}
      />,
    );

    const image = screen.getByRole('img', { name: 'Portland Cement' });
    expect(image.tagName).toBe('IMG');
    expect(image).toHaveAttribute('src', expect.stringContaining('data:image/svg+xml,'));
    expect(
      screen.queryByRole('img', { name: 'Portland Cement stitched kraft sack' }),
    ).not.toBeInTheDocument();
    expect(container.querySelector('svg[data-colour-scheme]')).toBeNull();
    expect(container.querySelector('[data-pigment]')).toBeNull();
  });
});
