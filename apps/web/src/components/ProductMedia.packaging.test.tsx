import { render, screen } from '@testing-library/react';
import type { Product } from '@shop/contracts/products';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/BagArtwork', () => ({
  BagArtwork: ({ accent, powderAccent }: { accent?: string; powderAccent?: string }) => (
    <output data-testid="bag-artwork" data-accent={accent} data-powder-accent={powderAccent} />
  ),
}));

import { ProductMedia, resolveFoodBagArtwork } from './ProductMedia';

const product: Product = {
  id: 'powdered-water-1',
  name: 'Powdered Water',
  description: 'A bag of water, reconsidered.',
  priceCents: 1299,
  imageSetId: 'powdered-water',
  packaging: {
    labelColor: '#287fa6',
    powderColor: '#b9e2ee',
    mark: 'H2O',
    batchCode: 'IMP-07',
    quantity: 'Conceptual quantity',
    consumptionLabel: 'Not for consumption',
  },
  category: 'Impossible',
  stock: 10,
  slug: 'powdered-water',
  salesCount: 10,
  createdAt: '2026-07-14T00:00:00.000Z',
  available: true,
  availability: 'in_stock',
  backorderable: false,
  backorderLeadDays: null,
  tags: [],
  specificationGroups: [],
};

/** Mirrors a list response, which intentionally omits `packaging`. */
function withoutPackaging(source: Product): Product {
  const copy: Product = { ...source };
  delete copy.packaging;
  return copy;
}

describe('ProductMedia packaging mapping', () => {
  it('maps canonical label and powder colors to BagArtwork props', () => {
    render(<ProductMedia product={product} />);

    const artwork = screen.getByTestId('bag-artwork');
    expect(artwork).toHaveAttribute('data-accent', product.packaging?.labelColor);
    expect(artwork).toHaveAttribute('data-powder-accent', product.packaging?.powderColor);
  });

  it('derives deterministic food bag inputs from list-safe fields only', () => {
    const listProduct = {
      id: '8',
      category: 'Sports Nutrition',
      name: 'Whey Protein Isolate',
      imageSetId: 'whey-protein-isolate',
    } as const;

    const first = resolveFoodBagArtwork(listProduct);
    const second = resolveFoodBagArtwork(listProduct);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      // Sports Nutrition index (8 - 1) % 5 = 2 -> plum-berry.
      accent: '#5c426d',
      powderAccent: '#d6a6c9',
      schemeKey: 'plum-berry',
      mark: 'SN',
      category: 'Sports Nutrition',
      quantity: '1 kg',
    });
    expect(first?.batchCode).toMatch(/^F-[A-Z0-9]{6}$/);
  });

  it('does not invent food artwork for unknown categories', () => {
    expect(
      resolveFoodBagArtwork({
        id: '8',
        category: 'Retired Materials',
        name: 'Legacy Product',
        imageSetId: 'legacy-product',
      }),
    ).toBeUndefined();
  });

  it('does not invent food artwork for a non-canonical id', () => {
    expect(
      resolveFoodBagArtwork({
        id: 'powdered-water-1',
        category: 'Drinks',
        name: 'Powdered Water',
        imageSetId: 'powdered-water',
      }),
    ).toBeUndefined();
  });

  it('gives five products in one food category five distinct schemes and pigments', () => {
    const artworks = ['8', '9', '10', '11', '12'].map((id) =>
      resolveFoodBagArtwork({
        id,
        category: 'Sports Nutrition',
        name: `Product ${id}`,
        imageSetId: `product-${id}`,
      }),
    );

    expect(artworks.every(Boolean)).toBe(true);
    expect(new Set(artworks.map((artwork) => artwork?.schemeKey)).size).toBe(5);
    expect(new Set(artworks.map((artwork) => artwork?.powderAccent)).size).toBe(5);
    expect(new Set(artworks.map((artwork) => artwork?.accent)).size).toBe(5);
  });

  it('resolves the same id through each food category own palette', () => {
    const shared = { id: '2', name: 'Shared Id', imageSetId: 'shared-id' } as const;
    const baking = resolveFoodBagArtwork({ ...shared, category: 'Baking & Pantry' });
    const drinks = resolveFoodBagArtwork({ ...shared, category: 'Drinks' });

    expect(baking?.schemeKey).toBe('cocoa-cacao');
    expect(drinks?.schemeKey).toBe('espresso-latte');
    expect(baking?.powderAccent).not.toBe(drinks?.powderAccent);
  });

  it('keeps explicit product.packaging colours ahead of the resolved palette', () => {
    const canonicalWithPackaging: Product = {
      ...product,
      id: '8',
      category: 'Sports Nutrition',
      packaging: {
        labelColor: '#123456',
        powderColor: '#654321',
        mark: 'H2O',
        batchCode: 'IMP-07',
        quantity: 'Conceptual quantity',
        consumptionLabel: 'Not for consumption',
      },
    };

    render(<ProductMedia product={canonicalWithPackaging} />);

    const artwork = screen.getByTestId('bag-artwork');
    expect(artwork).toHaveAttribute('data-accent', '#123456');
    expect(artwork).toHaveAttribute('data-powder-accent', '#654321');
  });

  it('renders the resolved palette for a canonical food product without packaging', () => {
    render(
      <ProductMedia
        product={{ ...withoutPackaging(product), id: '8', category: 'Sports Nutrition' }}
      />,
    );

    const artwork = screen.getByTestId('bag-artwork');
    expect(artwork).toHaveAttribute('data-accent', '#5c426d');
    expect(artwork).toHaveAttribute('data-powder-accent', '#d6a6c9');
  });

  it('falls back to generic artwork when no palette resolves', () => {
    render(
      <ProductMedia
        product={{ ...withoutPackaging(product), id: 'powdered-water-1', category: 'Drinks' }}
      />,
    );

    expect(screen.queryByTestId('bag-artwork')).toBeNull();
    expect(screen.getByAltText(product.name)).toBeInTheDocument();
  });
});
