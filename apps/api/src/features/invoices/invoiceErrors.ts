import type { PublicErrorCode } from '@shop/contracts/public-errors';

/** Domain failures emitted by the invoice service before they reach a transport mapper. */
export const INVOICE_ERROR_CODES = [
  'INVOICE_NOT_FOUND',
  'INVOICE_FORBIDDEN',
  'INVOICE_ALREADY_PAID',
  'INVOICE_VOIDED',
  'INVOICE_ALREADY_SETTLED',
  'INVOICE_ALREADY_VOID',
  'INVOICE_NOT_SETTLEABLE',
  'INVOICE_SETTLEMENT_INVALID',
  'INVOICE_SETTLEMENT_CONFLICT',
  'INVOICE_TOTAL_MISMATCH',
  'STALE_VERSION',
  'IDEMPOTENCY_CONFLICT',
] as const satisfies readonly PublicErrorCode[];

export type InvoiceErrorCode = (typeof INVOICE_ERROR_CODES)[number];

const messages: Record<InvoiceErrorCode, string> = {
  INVOICE_NOT_FOUND: 'Invoice not found',
  INVOICE_FORBIDDEN: 'Invoice not found',
  INVOICE_ALREADY_PAID: 'Invoice has already been paid',
  INVOICE_VOIDED: 'Invoice has been voided',
  INVOICE_ALREADY_SETTLED: 'Invoice has already been settled',
  INVOICE_ALREADY_VOID: 'Invoice has already been voided',
  INVOICE_NOT_SETTLEABLE: 'Invoice cannot be settled',
  INVOICE_SETTLEMENT_INVALID: 'Invoice settlement is invalid',
  INVOICE_SETTLEMENT_CONFLICT: 'Invoice settlement conflicts with a newer change',
  INVOICE_TOTAL_MISMATCH: 'Invoice total is inconsistent',
  STALE_VERSION: 'Invoice has changed',
  IDEMPOTENCY_CONFLICT: 'Idempotency key conflicts with a different request',
};

export class InvoiceDomainError extends Error {
  constructor(
    public readonly code: InvoiceErrorCode,
    message = messages[code],
  ) {
    super(message);
    this.name = 'InvoiceDomainError';
  }
}
