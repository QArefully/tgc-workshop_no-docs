import { apiFetch } from './client';
import { SessionListResponse } from '@shop/contracts/account-depth';
import { SuccessResponse } from '@shop/contracts/common';

const SESSIONS_PATH = '/api/account/sessions';

export interface AccountSessionsRequestOptions {
  signal?: AbortSignal;
}

/** Reads public session summaries only; browser session tokens remain httpOnly cookies. */
export function listAccountSessions(
  options: AccountSessionsRequestOptions = {},
): Promise<SessionListResponse> {
  return apiFetch(SessionListResponse, SESSIONS_PATH, { signal: options.signal });
}

export function revokeAccountSession(
  sessionId: string,
  options: AccountSessionsRequestOptions = {},
): Promise<SuccessResponse> {
  return apiFetch(SuccessResponse, `${SESSIONS_PATH}/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
    signal: options.signal,
  });
}
