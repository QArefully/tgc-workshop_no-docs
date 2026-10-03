/**
 * Typed failure codes for the trade-account domain.
 *
 * Services never surface a raw `SQLITE_CONSTRAINT` error: every uniqueness and capacity rule is
 * pre-checked at domain level so the caller always receives one of these codes. The partial unique
 * indexes on `delivery_sites` / `billing_entities` remain as a persistence backstop only.
 */
export type TradeAccountErrorCode =
  | 'SITE_NOT_FOUND'
  | 'SITE_LIMIT_REACHED'
  | 'DUPLICATE_LABEL'
  | 'INVALID_POSTCODE'
  | 'DELIVERY_COUNTRY_NOT_ALLOWED'
  | 'BILLING_ENTITY_NOT_FOUND'
  | 'BILLING_ENTITY_LIMIT_REACHED'
  | 'DUPLICATE_LEGAL_NAME';

/**
 * Result of a trade-account operation. Failures are values, not exceptions, so route handlers map
 * a closed set of codes to status codes without a catch block.
 */
export type TradeAccountResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: TradeAccountErrorCode; readonly message?: string };

export function tradeAccountOk<T>(value: T): TradeAccountResult<T> {
  return { ok: true, value };
}

export function tradeAccountError<T>(
  code: TradeAccountErrorCode,
  message?: string,
): TradeAccountResult<T> {
  return { ok: false, code, ...(message === undefined ? {} : { message }) };
}
