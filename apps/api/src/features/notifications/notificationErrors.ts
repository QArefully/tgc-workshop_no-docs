export type NotificationErrorCode = 'NOT_FOUND' | 'FORBIDDEN';

export type NotificationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: NotificationErrorCode };

export const notificationOk = <T>(value: T): NotificationResult<T> => ({ ok: true, value });
export const notificationError = <T>(code: NotificationErrorCode): NotificationResult<T> => ({
  ok: false,
  code,
});
