import { render, screen } from '@testing-library/react';
import type { ProductWithVariants, CategoryFacts } from '@shop/contracts/products';
import { describe, expect, it } from 'vitest';

import { ProductGallery } from './ProductGallery';

const defaultFacts: CategoryFacts = {
  texture: 'Fine',
  colour: 'White',
  source: 'Test',
  intendedUse: 'Testing',
  storage: 'Dry',
  consumptionClassification: 'non-food',
};

const product = (overrides: Partial<ProductWithVariants> = {}): ProductWithVariants => ({
  id: 'powdered-water',
  name: 'Powdered Water',
  description: 'Just-add-water water powder, 300g. Dry until required.',
  priceCents: 12999,
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
  stock: 8,
  slug: 'powdered-water',
  salesCount: 12,
  ...overrides,
  createdAt: overrides.createdAt ?? '2026-07-14T00:00:00.000Z',
  available: overrides.available ?? true,
  tags: overrides.tags ?? [],
  specificationGroups: overrides.specificationGroups ?? [],
  availability: overrides.availability ?? 'in_stock',
  backorderable: overrides.backorderable ?? false,
  backorderLeadDays: overrides.backorderLeadDays ?? null,
  variants: overrides.variants ?? [
    {
      variantId: 1,
      productId: 1,
      sku: 'PW-001',
      label: 'Standard',
      weightGrams: 500,
      priceCents: 12999,
      moqSacks: 4,
      perTonneCents: 25998,
      priceTiers: [{ minTonnes: 1, discountPct: 0 }],
      stockCount: 8,
      backorderable: false,
      backorderLeadDays: null,
      deliveryClass: 'parcel',
      active: true,
      sortOrder: 1,
    },
  ],
  defaultVariantId: overrides.defaultVariantId ?? 1,
  categoryFacts: overrides.categoryFacts ?? defaultFacts,
  consumptionClassification: overrides.consumptionClassification ?? 'non-food',
  mixingGroup: overrides.mixingGroup ?? null,
  priceRange: overrides.priceRange ?? { min: 12999, max: 12999 },
  baseAvailability: overrides.baseAvailability ?? 'in_stock',
});

describe('ProductGallery', () => {
  it('renders one canonical live packaging artwork without raster thumbnails', () => {
    render(<ProductGallery product={product()} />);

    expect(screen.getByRole('img', { name: 'Powdered Water bag' }).tagName).toBe('svg');
    expect(screen.queryByRole('button', { name: /view image/i })).not.toBeInTheDocument();
  });
});
