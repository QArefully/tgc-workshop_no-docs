import type { ReturnErrorCode } from './returnTypes.js';

export class ReturnDomainError extends Error {
  constructor(
    public readonly code: ReturnErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'ReturnDomainError';
  }
}
