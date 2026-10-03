/**
 * Field checks for trade record text inputs.
 *
 * Bounds mirror `@shop/contracts/trade-account`, which in turn mirrors the persistence CHECK
 * constraints. Validating here keeps a typo a field-level message instead of a round-trip 400.
 */

const MARKUP_PATTERN = /[<>]/;
/**
 * The two halves of the contract's `^(?=.*[0-9])[0-9 +()-]+$`, kept separate so each failure gets its
 * own buyer-facing message. A digit-free string of separators satisfies the length bound, so without
 * the digit check it would pass here and 400 at the server.
 */
const PHONE_CHARSET_PATTERN = /^[0-9 +()-]+$/;
const PHONE_DIGIT_PATTERN = /[0-9]/;

export const TRADE_FIELD_BOUNDS = {
  label: 80,
  contactName: 120,
  legalName: 120,
  registrationNumber: 40,
  vatNumber: 40,
} as const;

export const CONTACT_PHONE_BOUNDS = { min: 5, max: 32 } as const;

/** Required plain-text field. Returns a buyer-facing message, or `undefined` when valid. */
export function checkRequiredTradeText(
  value: string,
  label: string,
  maxLength: number,
): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return `${label} is required`;
  if (value.length > maxLength) return `${label} must be ${maxLength} characters or fewer`;
  if (MARKUP_PATTERN.test(value)) return `${label} cannot contain < or >`;
  return undefined;
}

/** Optional plain-text field. A blank value is valid and is omitted from the request body. */
export function checkOptionalTradeText(
  value: string,
  label: string,
  maxLength: number,
): string | undefined {
  if (value.trim().length === 0) return undefined;
  return checkRequiredTradeText(value, label, maxLength);
}

export function checkContactPhone(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return 'Contact phone is required';
  if (trimmed.length < CONTACT_PHONE_BOUNDS.min || trimmed.length > CONTACT_PHONE_BOUNDS.max) {
    return `Contact phone must be ${CONTACT_PHONE_BOUNDS.min}-${CONTACT_PHONE_BOUNDS.max} characters`;
  }
  if (!PHONE_CHARSET_PATTERN.test(trimmed)) {
    return 'Contact phone may use digits, spaces, and + ( ) - only';
  }
  if (!PHONE_DIGIT_PATTERN.test(trimmed)) {
    return 'Contact phone must include at least one digit';
  }
  return undefined;
}
