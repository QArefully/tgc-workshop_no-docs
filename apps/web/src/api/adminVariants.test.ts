import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdminVariant } from '@shop/contracts/admin-variants';
import { getAdminProductVariants } from './adminVariants';

const variant = {
  id: '7',
  productId: '42',
  sku: 'CITRIC-25KG',
  label: '25 kg sack',
  weightGrams: 25_000,
  priceCents: 1_250,
  moqSacks: 1,
  compareAtPriceCents: null,
  clearance: null,
  stockCount: 20,
  backorderable: false,
  backorderLeadDays: null,
  deliveryClass: 'freight',
  active: true,
  sortOrder: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  blockedInCountry: false,
} satisfies AdminVariant & { blockedInCountry: boolean };

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('country-aware admin lot API', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('parses blockedInCountry on lot listings', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ items: [variant] })));

    await expect(getAdminProductVariants('42')).resolves.toMatchObject({
      items: [{ id: '7', blockedInCountry: false }],
    });
  });

  it('rejects unrelated fields while accepting the country annotation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ items: [{ ...variant, unexpected: 'reject-me' }] })),
    );

    await expect(getAdminProductVariants('42')).rejects.toMatchObject({
      name: 'ApiContractError',
      path: '/api/admin/products/42/variants',
    });
  });
});
