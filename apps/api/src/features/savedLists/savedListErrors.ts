export type SavedListErrorCode =
  | 'LIST_NOT_FOUND'
  | 'ITEM_NOT_FOUND'
  | 'NAME_INVALID'
  | 'NAME_TAKEN'
  | 'LIST_LIMIT_REACHED'
  | 'ITEM_LIMIT_REACHED'
  | 'VARIANT_NOT_FOUND'
  | 'DEFAULT_LIST_IMMUTABLE'
  | 'CART_NOT_FOUND'
  | 'CART_RESERVED'
  | 'CART_EMPTY'
  | 'ORDER_NOT_FOUND';

/** Closed value result used by routes to map expected domain failures without catch blocks. */
export type SavedListResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: SavedListErrorCode };

export const savedListOk = <T>(value: T): SavedListResult<T> => ({ ok: true, value });
export const savedListError = <T>(code: SavedListErrorCode): SavedListResult<T> => ({
  ok: false,
  code,
});
