import { apiFetch } from './client';
import { MailboxListResponse } from '@shop/contracts/mailbox';

export function getMailbox(): Promise<MailboxListResponse> {
  return apiFetch(MailboxListResponse, '/api/dev/mailbox');
}
