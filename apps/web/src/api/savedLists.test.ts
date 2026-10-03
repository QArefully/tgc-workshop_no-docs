import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch } from './client';
import { SavedListDetail } from '@shop/contracts/saved-lists';

vi.mock('./client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./client')>();
  return { ...actual, apiFetch: vi.fn() };
});

import {
  addSavedListToCart,
  addSavedListItem,
  getSavedList,
  removeSavedListItem,
  saveOrderAsSavedList,
} from './savedLists';

describe('saved lists API', () => {
  beforeEach(() => vi.mocked(apiFetch).mockReset());

  it('encodes list and item identifiers in item requests', () => {
    vi.mocked(apiFetch).mockResolvedValue({});
    void addSavedListItem('list / one', { variantId: 101, quantity: 4 });
    void removeSavedListItem('list / one', 'item / one');
    expect(apiFetch).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      '/api/saved-lists/list%20%2F%20one/items',
      {
        method: 'POST',
        body: JSON.stringify({ variantId: 101, quantity: 4 }),
      },
    );
    expect(apiFetch).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      '/api/saved-lists/list%20%2F%20one/items/item%20%2F%20one',
      { method: 'DELETE' },
    );
  });

  it('sends the active cart id to the saved-list cart operation', () => {
    vi.mocked(apiFetch).mockResolvedValue({});
    void addSavedListToCart('12', { cartId: 'c3bf9009-3b1c-456a-b763-8adc0de75d4f' });
    expect(apiFetch).toHaveBeenCalledWith(expect.anything(), '/api/saved-lists/12/add-to-cart', {
      method: 'POST',
      body: JSON.stringify({ cartId: 'c3bf9009-3b1c-456a-b763-8adc0de75d4f' }),
    });
  });

  it('encodes order identifiers and propagates API errors', async () => {
    const error = new ApiError('Saved list not found', 404);
    vi.mocked(apiFetch).mockRejectedValue(error);
    await expect(getSavedList('a/b')).rejects.toBe(error);
    vi.mocked(apiFetch).mockResolvedValue({});
    void saveOrderAsSavedList('42 / x', { name: 'Restock' });
    expect(apiFetch).toHaveBeenLastCalledWith(
      expect.anything(),
      '/api/saved-lists/from-order/42%20%2F%20x',
      {
        method: 'POST',
        body: JSON.stringify({ name: 'Restock' }),
      },
    );
  });

  it('rejects a contract-violating successful response in the real client', async () => {
    const realClient = await vi.importActual<typeof import('./client')>('./client');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ listId: '1', name: 'Missing required fields' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(realClient.apiFetch(SavedListDetail, '/api/saved-lists/1')).rejects.toThrow(
      'Response contract violation',
    );
    vi.unstubAllGlobals();
  });
});
