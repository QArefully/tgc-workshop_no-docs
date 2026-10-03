export type StandingOrderErrorCode =
  'NOT_FOUND' | 'INACTIVE' | 'SOURCE_NOT_FOUND' | 'CART_RESERVED' | 'CART_NOT_FOUND';
export type StandingOrderResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: StandingOrderErrorCode };
export const standingOrderOk = <T>(value: T): StandingOrderResult<T> => ({ ok: true, value });
export const standingOrderError = <T>(code: StandingOrderErrorCode): StandingOrderResult<T> => ({
  ok: false,
  code,
});
