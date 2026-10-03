import { Type, type Static } from '@sinclair/typebox';
import {
  PublicErrorResponse,
  type PublicErrorResponse as PublicErrorResponseType,
} from './publicErrors.js';

/** Monetary value in cents. Safe integer >= 0. */
export const MoneyCents = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });

/**
 * Transition-compatible public error response. New producers should set `code` and safe `meta`;
 * `details` remains an explicitly deprecated legacy field while route packets migrate.
 */
export const ErrorResponse = PublicErrorResponse;
export type ErrorResponse = PublicErrorResponseType;

export const SuccessResponse = Type.Object({
  success: Type.Literal(true),
});
export type SuccessResponse = Static<typeof SuccessResponse>;

/** Bounded email accepted by transport. Domain normalizes it separately. */
export const EmailAddress = Type.String({
  minLength: 3,
  maxLength: 254,
  pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$',
});

export const Password = Type.String({ minLength: 8, maxLength: 128 });

/** Decimal route parameter for a positive database identifier. */
export const PositiveIntegerString = Type.String({ pattern: '^[1-9][0-9]*$' });

/** UUID v4-compatible transport identifier. */
export const Uuid = Type.String({
  pattern:
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
});

export const CustomerName = Type.String({ minLength: 1, maxLength: 120 });
export const PromoCodeValue = Type.String({ minLength: 1, maxLength: 64 });

/**
 * Pattern for a required plain-text field: markup delimiters excluded, and a value that is empty
 * once trimmed rejected. Consumers trim before rendering or persisting, so a whitespace-only value
 * would otherwise pass validation and then collapse to nothing downstream.
 */
export const REQUIRED_PLAIN_TEXT_PATTERN = '^(?!\\s*$)[^<>]*$';

/** Buyer-supplied purchase-order / requisition reference. Plain text, markup delimiters excluded. */
export const PurchaseOrderReference = Type.String({
  minLength: 1,
  maxLength: 64,
  pattern: '^[^<>]*$',
});
