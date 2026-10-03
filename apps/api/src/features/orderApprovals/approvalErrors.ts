export type ApprovalErrorCode =
  'APPROVAL_NOT_FOUND' | 'NOT_APPROVER' | 'APPROVAL_ALREADY_RESOLVED' | 'APPROVAL_EXPIRED';

export type ApprovalResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: ApprovalErrorCode };

export const approvalOk = <T>(value: T): ApprovalResult<T> => ({ ok: true, value });
export const approvalError = <T>(code: ApprovalErrorCode): ApprovalResult<T> => ({
  ok: false,
  code,
});
