import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdminProduct } from '@shop/contracts/admin-products';
import { getAdminProduct, getAdminProducts } from './adminProducts';

const product = {
  id: '42',
  name: 'Citric acid',
  description: 'Food-grade bulk powder',
  priceCents: 1_250,
  category: 'Baking & Pantry',
  stockCount: 20,
  imageSetId: null,
  slug: 'citric-acid',
  compareAtPriceCents: null,
  salesCount: 4,
  active: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  consumptionClassification: 'food',
  mixingGroup: 'food-grade',
  detailsJson: null,
  defaultVariantId: '7',
  blendSourceVariantId: null,
  blockedInCountry: true,
} satisfies AdminProduct & { blockedInCountry: boolean };

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('country-aware admin product API', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('parses blockedInCountry on list and detail responses', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ items: [product] }))
      .mockResolvedValueOnce(jsonResponse(product));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getAdminProducts()).resolves.toMatchObject({
      items: [{ id: '42', blockedInCountry: true }],
    });
    await expect(getAdminProduct('42')).resolves.toMatchObject({
      id: '42',
      blockedInCountry: true,
    });
  });

  it('rejects unrelated fields while accepting the country annotation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ items: [{ ...product, unexpected: 'reject-me' }] })),
    );

    await expect(getAdminProducts()).rejects.toMatchObject({
      name: 'ApiContractError',
      path: '/api/admin/products',
    });
  });
});
