import type { CreditAccountMemberResponse } from '@shop/contracts/trade-credit';
import { CreditAccountMemberResponse as CreditAccountMemberResponseSchema } from '@shop/contracts/trade-credit';
import { apiFetch } from './client';

/** Options accepted by the member credit read so checkout can cancel stale requests. */
export interface TradeCreditRequestOptions {
  signal?: AbortSignal;
}

const MEMBER_CREDIT_PATH = '/api/company/credit';

/**
 * Loads the authenticated buyer's company credit summary.
 *
 * The API resolves company membership from the session and returns `null` when the buyer has no
 * active company account. No company identifier, exposure calculation, or VAT fact is accepted
 * from the browser.
 */
export function getTradeCreditSummary(
  options: TradeCreditRequestOptions = {},
): Promise<CreditAccountMemberResponse> {
  return apiFetch(CreditAccountMemberResponseSchema, MEMBER_CREDIT_PATH, {
    signal: options.signal,
  });
}

/** Compatibility name for callers that describe the same response as a company credit account. */
export const getCompanyCredit = getTradeCreditSummary;
export const getCreditSummary = getTradeCreditSummary;
export const getTradeCreditAccount = getTradeCreditSummary;
