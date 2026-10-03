import type { CartLine } from '@shop/contracts/cart';

/**
 * Line identity for every surface that renders cart lines.
 *
 * A configured line shares its base variant with its plain counterpart and with any other blend
 * over the same base, so `productId:variantId` alone is not unique. Drop the config key from either
 * helper and two blends over one base variant silently share a React key and a pending-action slot.
 * Single ownership keeps cart page, cart sheet, and checkout summary from drifting apart on it.
 */
export function cartItemKey(item: CartLine): string {
  return `${item.productId}:${item.variantSnap?.variantId ?? 'no-variant'}:${item.configKey}`;
}

/** `undefined` for plain lines preserves the historic pending-key shape. */
export function pendingConfigKey(item: CartLine): string | undefined {
  return item.configKey === '' ? undefined : item.configKey;
}
