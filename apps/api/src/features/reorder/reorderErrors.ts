/**
 * Typed failure codes for the reorder domain.
 *
 * Only whole-request rejections live here: a single source order line that cannot be re-added is a
 * per-line outcome, never an error. Ownership failure and a missing order deliberately collapse
 * into the same `ORDER_NOT_FOUND` code so a caller cannot probe for other buyers' order ids.
 */
export type ReorderErrorCode = 'ORDER_NOT_FOUND' | 'CART_NOT_FOUND' | 'CART_RESERVED';

/**
 * Result of a reorder operation. Failures are values, not exceptions, so a route handler maps a
 * closed set of codes to status codes without a catch block.
 */
export type ReorderResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: ReorderErrorCode };

export function reorderOk<T>(value: T): ReorderResult<T> {
  return { ok: true, value };
}

export function reorderError<T>(code: ReorderErrorCode): ReorderResult<T> {
  return { ok: false, code };
}
