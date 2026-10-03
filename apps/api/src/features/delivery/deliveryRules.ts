import type {
  DeliveryMode,
  DeliverySummary,
  DeliveryQuoteInputLine,
} from '@shop/contracts/delivery';
import type { Cart } from '@shop/contracts/cart';
import {
  FREIGHT_WEIGHT_THRESHOLD_GRAMS,
  FREIGHT_CHARGE_CENTS,
  PARCEL_CHARGE_CENTS,
} from '@shop/contracts/delivery';

export interface DeliveryLine {
  deliveryClass: DeliveryQuoteInputLine['deliveryClass'];
  unitWeightGrams: number;
  quantity: number;
}

export function quoteDelivery(lines: readonly DeliveryLine[]): DeliverySummary {
  let totalWeight = 0;
  let forcedFreight = false;

  for (const line of lines) {
    if (line.deliveryClass === 'freight') {
      forcedFreight = true;
    }
    totalWeight += line.unitWeightGrams * line.quantity;
  }

  const mode: DeliveryMode =
    forcedFreight || totalWeight >= FREIGHT_WEIGHT_THRESHOLD_GRAMS ? 'freight' : 'parcel';

  const chargeCents = mode === 'freight' ? FREIGHT_CHARGE_CENTS : PARCEL_CHARGE_CENTS;

  const reason = forcedFreight
    ? 'A freight-class item requires freight delivery'
    : mode === 'freight'
      ? `Total weight ${totalWeight}g meets or exceeds ${FREIGHT_WEIGHT_THRESHOLD_GRAMS}g freight threshold`
      : `Total weight ${totalWeight}g is under ${FREIGHT_WEIGHT_THRESHOLD_GRAMS}g freight threshold`;

  return { mode, chargeCents, weightGrams: totalWeight, reason };
}

/** Maps current cart lines to the same server-side delivery quote used at checkout. */
export function quoteCartDelivery(cart: Pick<Cart, 'items'>): DeliverySummary {
  return quoteDelivery(
    cart.items.map((item) => ({
      deliveryClass: item.variantSnap?.deliveryClass ?? 'parcel',
      unitWeightGrams: item.variantSnap?.weightGrams ?? 1000,
      quantity: item.quantity,
    })),
  );
}
