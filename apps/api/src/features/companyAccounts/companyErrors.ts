export type CompanyErrorCode =
  | 'NO_ACTIVE_MEMBERSHIP'
  | 'ALREADY_MEMBER'
  | 'NOT_OWNER'
  | 'SOLE_OWNER'
  | 'MEMBERSHIP_NOT_FOUND'
  | 'INVITE_NOT_FOUND'
  | 'INVITE_EXPIRED'
  | 'INVITE_ALREADY_USED'
  | 'COMPANY_NOT_FOUND'
  | 'INVALID_ROLE';

export type CompanyResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: CompanyErrorCode };

export const companyOk = <T>(value: T): CompanyResult<T> => ({ ok: true, value });
export const companyError = <T>(code: CompanyErrorCode): CompanyResult<T> => ({ ok: false, code });
