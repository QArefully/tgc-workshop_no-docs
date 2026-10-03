import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QuickOrderResponse } from '@shop/contracts/quick-order';
import { ApiContractError, ApiError } from './client';
import { submitQuickOrder } from './quickOrder';

const CART_ID = '3f1a2b4c-5d6e-4f70-8123-456789abcdef';

function quickOrderResponse(): QuickOrderResponse {
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
    skippedLineCount: 0,
    outcomes: [
      {
        lineNumber: 1,
        rawLine: 'CEM-0001-001, 4',
        sku: 'CEM-0001-001',
        requestedQuantity: 4,
        submittedQuantity: 4,
        moqAdjusted: false,
        duplicateSku: false,
        variantId: 101,
        productId: 'cement',
        productName: 'Rapid-set cement',
        resolvedUnitPriceCents: 1200,
        status: 'added',
        reason: null,
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

describe('quick order API', () => {
  it('posts text to the encoded cart quick-order endpoint', async () => {
    const fetchMock = stubFetch(quickOrderResponse());

    await submitQuickOrder('cart/a 1', 'CEM-0001-001, 4');

    const [path, init] = fetchMock.mock.calls[0]!;
    expect(path).toBe('/api/cart/cart%2Fa%201/quick-order');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ text: 'CEM-0001-001, 4' }));
    expect(init.credentials).toBe('include');
  });

  it('returns a response that satisfies the shared quick-order schema', async () => {
    const expected = quickOrderResponse();
    stubFetch(expected);

    await expect(submitQuickOrder(CART_ID, 'CEM-0001-001, 4')).resolves.toEqual(expected);
  });

  it('rejects a successful response that violates the quick-order contract', async () => {
    const { cart, addedLineCount, skippedLineCount } = quickOrderResponse();
    stubFetch({ cart, addedLineCount, skippedLineCount });

    await expect(submitQuickOrder(CART_ID, 'CEM-0001-001, 4')).rejects.toBeInstanceOf(
      ApiContractError,
    );
  });

  it('preserves rejection codes returned by the API', async () => {
    stubFetch({ error: 'Enter at least one line', code: 'NO_INPUT_LINES' }, 400);

    await expect(submitQuickOrder(CART_ID, ' ')).rejects.toMatchObject({
      constructor: ApiError,
      response: { code: 'NO_INPUT_LINES' },
    });
  });
});
