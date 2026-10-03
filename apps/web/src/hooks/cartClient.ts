import type { Country } from '@shop/contracts/country';
import type { Cart } from '@shop/contracts/cart';
import * as api from '../api/cart';
import { isMissingCartError } from '../api/client';
import { clearCartId, getCartId, setCartId } from '../lib/cartStorage';

export function createCartClient(country: Country) {
  async function createAndLoad(): Promise<Cart> {
    const { cartId } = await api.createCart(country);
    setCartId(cartId, country);
    try {
      return await api.getCart(cartId);
    } catch (error) {
      if (getCartId(country) === cartId) clearCartId(country);
      throw error;
    }
  }

  async function loadOrCreate(): Promise<Cart> {
    const storedCartId = getCartId(country);
    if (storedCartId) {
      try {
        return await api.getCart(storedCartId);
      } catch (error) {
        if (!isMissingCartError(error)) throw error;
        if (getCartId(country) === storedCartId) clearCartId(country);
      }
    }

    return createAndLoad();
  }

  async function recoverMissingCart(missingCartId: string): Promise<Cart> {
    if (getCartId(country) === missingCartId) clearCartId(country);
    return loadOrCreate();
  }

  return { loadOrCreate, recoverMissingCart };
}
