export type BackInStockErrorCode =
  | 'VARIANT_NOT_FOUND'
  | 'VARIANT_RETIRED'
  | 'VARIANT_AVAILABLE'
  | 'ALREADY_SUBSCRIBED'
  | 'SUBSCRIPTION_LIMIT_REACHED'
  | 'SUBSCRIPTION_NOT_FOUND';

/** Closed value result used by routes to map expected domain failures without catch blocks. */
export type BackInStockResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: BackInStockErrorCode };

export const backInStockOk = <T>(value: T): BackInStockResult<T> => ({ ok: true, value });
export const backInStockError = <T>(code: BackInStockErrorCode): BackInStockResult<T> => ({
  ok: false,
  code,
});
