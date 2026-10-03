import { apiFetch } from './client';
import { DataExportResponse } from '@shop/contracts/account-depth';

/** Export stays a regular JSON transport response so the shared client validates it before download. */
export function exportAccountData(): Promise<DataExportResponse> {
  return apiFetch(DataExportResponse, '/api/account/export');
}
