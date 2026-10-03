import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReorderResponse } from '@shop/contracts/reorder';
import { ApiContractError } from './client';
import { reorderFromOrder } from './reorder';

/**
 * The real client is exercised here rather than a stub: the reorder response is only useful if the
 * shared schema actually validates it, so these tests drive `fetch` directly.
 */

const CART_ID = '3f1a2b4c-5d6e-4f70-8123-456789abcdef';

function reorderResponse(): ReorderResponse {
  return {
    cart: {
      id: CART_ID,
      items: [],
      subtotalCents: 0,
      discountableSubtotalCents: 0,
      blendingFeeTotalCents: 0,
      totalItems: 0,
    },
    addedLineCount: 1,
    skippedLineCount: 1,
    outcomes: [
      {
        orderLineItemId: '11',
        productId: 'cement',
        productName: 'Rapid-set cement',
        variantId: 101,
        sku: 'MAT-101',
        configKey: '',
        quantity: 4,
        status: 'added',
        reason: null,
        orderedUnitPriceCents: 1200,
        currentUnitPriceCents: 1300,
        priceChanged: true,
      },
      {
        orderLineItemId: '12',
        productId: 'lime',
        productName: 'Hydrated lime',
        variantId: null,
        sku: null,
        configKey: '',
        quantity: 2,
        status: 'skipped',
        reason: 'VARIANT_RETIRED',
        orderedUnitPriceCents: 900,
        currentUnitPriceCents: null,
        priceChanged: false,
      },
    ],
  };
}

function stubFetch(body: unknown, status = 200) {
  const fetchMock = vi.fn<(path: string, init: RequestInit) => Promise<Response>>();
  fetchMock.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('reorder API', () => {
  it('posts the target cart to the source order reorder endpoint', async () => {
    const fetchMock = stubFetch(reorderResponse());

    await reorderFromOrder(CART_ID, '42');

    const [path, init] = fetchMock.mock.calls[0]!;
    expect(path).toBe('/api/orders/42/reorder');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ cartId: CART_ID }));
    expect(init.credentials).toBe('include');
  });

  it('encodes the order identifier into the request path', async () => {
    const fetchMock = stubFetch(reorderResponse());

    await reorderFromOrder(CART_ID, 'a/b 1');

    expect(fetchMock.mock.calls[0]![0]).toBe('/api/orders/a%2Fb%201/reorder');
  });

  it('returns a response that satisfies the shared reorder schema', async () => {
    const expected = reorderResponse();
    stubFetch(expected);

    await expect(reorderFromOrder(CART_ID, '42')).resolves.toEqual(expected);
  });

  it('rejects a successful response that violates the reorder contract', async () => {
    const { cart, addedLineCount, skippedLineCount } = reorderResponse();
    stubFetch({ cart, addedLineCount, skippedLineCount });

    await expect(reorderFromOrder(CART_ID, '42')).rejects.toBeInstanceOf(ApiContractError);
  });

  it('rejects an outcome whose skip reason contradicts its status', async () => {
    const response = reorderResponse();
    stubFetch({
      ...response,
      outcomes: [{ ...response.outcomes[0]!, status: 'skipped', reason: null }],
    });

    await expect(reorderFromOrder(CART_ID, '42')).rejects.toBeInstanceOf(ApiContractError);
  });
});
