import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./client')>();
  return { ...actual, apiFetch: vi.fn() };
});

import { Cart } from '@shop/contracts/cart';
import { apiFetch } from './client';
import { addToCart, removeFromCart, updateCartItem } from './cart';

describe('cart API', () => {
  beforeEach(() => vi.mocked(apiFetch).mockReset());

  it('sends an explicit selected-variant quantity when adding to the cart', () => {
    vi.mocked(apiFetch).mockResolvedValue({});

    void addToCart('cart', '1', 101, 8);

    expect(apiFetch).toHaveBeenCalledWith(Cart, '/api/cart/cart/items', {
      method: 'POST',
      body: JSON.stringify({ productId: '1', variantId: 101, quantity: 8 }),
    });
  });

  it('sends the selected variant when updating a cart line', () => {
    vi.mocked(apiFetch).mockResolvedValue({});

    void updateCartItem('cart', '1', 5, 101);

    expect(apiFetch).toHaveBeenCalledWith(Cart, '/api/cart/cart/items', {
      method: 'PATCH',
      body: JSON.stringify({ productId: '1', quantity: 5, variantId: 101 }),
    });
  });

  it('sends the selected variant in the remove request body', () => {
    vi.mocked(apiFetch).mockResolvedValue({});

    void removeFromCart('cart', '1', 102);

    expect(apiFetch).toHaveBeenCalledWith(Cart, '/api/cart/cart/items/1', {
      method: 'DELETE',
      body: JSON.stringify({ productId: '1', variantId: 102 }),
    });
  });
});
