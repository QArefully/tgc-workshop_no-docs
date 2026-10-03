import { apiFetch } from './client';
import {
  DeleteAccountBody,
  type DeleteAccountBody as DeleteAccountPayload,
} from '@shop/contracts/account-depth';
import { SuccessResponse } from '@shop/contracts/common';

/** Irreversible server-side redaction command. The caller must confirm with their current password. */
export function deleteAccount(body: DeleteAccountPayload): Promise<SuccessResponse> {
  return apiFetch(SuccessResponse, '/api/account/delete', {
    method: 'POST',
    body: JSON.stringify(body satisfies DeleteAccountBody),
  });
}
