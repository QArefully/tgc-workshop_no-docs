import { apiFetch } from './client';
import { ValidatePromoResponse } from '@shop/contracts/promos';
import type { ValidatePromoBody } from '@shop/contracts/promos';

/**
 * Promo API module.
 */

export function validatePromo(cartId: string, promoCode: string): Promise<ValidatePromoResponse> {
  const body: ValidatePromoBody = { cartId, promoCode };
  return apiFetch(ValidatePromoResponse, '/api/promo/validate', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
