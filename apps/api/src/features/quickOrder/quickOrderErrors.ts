/** Typed whole-request failures for the Quick Order workflow. */
export type QuickOrderErrorCode =
  'NO_INPUT_LINES' | 'TOO_MANY_LINES' | 'CART_NOT_FOUND' | 'CART_RESERVED';

/** Quick Order failures are values so route handlers map a closed code set without catch blocks. */
export type QuickOrderResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: QuickOrderErrorCode };

export function quickOrderOk<T>(value: T): QuickOrderResult<T> {
  return { ok: true, value };
}

export function quickOrderError<T>(code: QuickOrderErrorCode): QuickOrderResult<T> {
  return { ok: false, code };
}
