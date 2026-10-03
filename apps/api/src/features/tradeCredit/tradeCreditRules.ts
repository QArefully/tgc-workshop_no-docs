import type { InvoiceLifecycleStatus } from '@shop/contracts/trade-credit';
import { TRADE_CREDIT_TERMS_DAYS } from '@shop/contracts/trade-credit';
import type { VatRateBasisPoints } from '@shop/contracts/country-profiles';
import { roundHalfUp } from '../pricing/pricingRules.js';

/** One hundred percent expressed in the basis-point representation used by country profiles. */
export const VAT_BASIS_POINTS_DENOMINATOR = 10_000;

/** Number of milliseconds in the fixed net-30 trade-credit term. */
export const TRADE_CREDIT_TERM_MS = TRADE_CREDIT_TERMS_DAYS * 24 * 60 * 60 * 1_000;

const ISO_UTC_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DATE_TIME_CLIP_MAX_MS = 8_640_000_000_000_000;
const INVOICE_LIFECYCLE_STATUSES = new Set<InvoiceLifecycleStatus>([
  'open',
  'overdue',
  'paid',
  'voided',
]);

/** Values that can be used as VAT rates after country-profile validation. */
export type InvoiceVatRate = VatRateBasisPoints | number;

function requireNonNegativeSafeInteger(value: unknown, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer.`);
  }
}

function requireSafeVatRate(value: unknown): asserts value is number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > VAT_BASIS_POINTS_DENOMINATOR
  ) {
    throw new RangeError(
      `vatRateBasisPoints must be a safe integer from 0 through ${VAT_BASIS_POINTS_DENOMINATOR}.`,
    );
  }
}

function safeAdd(left: number, right: number, name: string): number {
  requireNonNegativeSafeInteger(left, `${name} left operand`);
  requireNonNegativeSafeInteger(right, `${name} right operand`);
  if (right > Number.MAX_SAFE_INTEGER - left) {
    throw new RangeError(`${name} is outside the safe integer range.`);
  }
  return left + right;
}

function safeSubtract(left: number, right: number, name: string): number {
  requireNonNegativeSafeInteger(left, `${name} left operand`);
  requireNonNegativeSafeInteger(right, `${name} right operand`);
  if (right > left) throw new RangeError(`${name} would be negative.`);
  return left - right;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads one value from a set of compatibility aliases while rejecting conflicting aliases.
 * Canonical callers use the first name; aliases keep migration and route code readable without
 * creating a second calculation path.
 */
function readAlias(
  input: Record<string, unknown>,
  names: readonly string[],
  name: string,
  defaultValue?: number,
): number {
  let value: number | undefined;
  for (const key of names) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
    const candidate = input[key];
    requireNonNegativeSafeInteger(candidate, name);
    if (value !== undefined && value !== candidate) {
      throw new RangeError(`${name} aliases must agree.`);
    }
    value = candidate;
  }
  if (value !== undefined) return value;
  if (defaultValue !== undefined) return defaultValue;
  throw new RangeError(`${name} is required.`);
}

function readRateAlias(input: Record<string, unknown>): number {
  let value: number | undefined;
  for (const key of ['vatRateBasisPoints', 'rateBasisPoints', 'vatRate']) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
    const candidate = input[key];
    requireSafeVatRate(candidate);
    if (value !== undefined && value !== candidate) {
      throw new RangeError('VAT rate aliases must agree.');
    }
    value = candidate;
  }
  if (value === undefined) throw new RangeError('vatRateBasisPoints is required.');
  return value;
}

/** Inputs accepted by invoice-level VAT and gross-total calculation. */
export interface InvoiceTotalsInput {
  readonly merchandiseCents?: number;
  readonly merchandiseSubtotalCents?: number;
  readonly subtotalCents?: number;
  readonly promoDiscountCents?: number;
  readonly promoCents?: number;
  readonly discountCents?: number;
  readonly deliveryCents?: number;
  readonly deliveryChargeCents?: number;
  readonly shippingCents?: number;
  readonly vatRateBasisPoints?: InvoiceVatRate;
  readonly rateBasisPoints?: number;
  readonly vatRate?: number;
  readonly [key: string]: unknown;
}

/** The immutable money tuple persisted on an invoice document. */
export interface InvoiceAmounts {
  readonly netCents: number;
  readonly vatCents: number;
  readonly grossCents: number;
}

/** Computes invoice VAT in GBP pence using one half-up operation at invoice scope. */
export function calculateVatCents(netCents: number, vatRateBasisPoints: InvoiceVatRate): number;
export function calculateVatCents(input: {
  readonly netCents: number;
  readonly vatRateBasisPoints: InvoiceVatRate;
}): number;
export function calculateVatCents(
  netCentsOrInput:
    number | { readonly netCents: number; readonly vatRateBasisPoints: InvoiceVatRate },
  vatRateBasisPoints?: InvoiceVatRate,
): number {
  const netCents = typeof netCentsOrInput === 'number' ? netCentsOrInput : netCentsOrInput.netCents;
  const rate =
    typeof netCentsOrInput === 'number' ? vatRateBasisPoints : netCentsOrInput.vatRateBasisPoints;
  requireNonNegativeSafeInteger(netCents, 'netCents');
  requireSafeVatRate(rate);

  // Avoid multiplying by zero and guard the product before calling the rounding helper. This
  // keeps every intermediate integer safe, including a near-MAX_SAFE_INTEGER net amount.
  if (rate === 0 || netCents === 0) return 0;
  if (netCents > Math.floor(Number.MAX_SAFE_INTEGER / rate)) {
    throw new RangeError('VAT numerator is outside the safe integer range.');
  }
  const numerator = netCents * rate;
  if (!Number.isSafeInteger(numerator)) {
    throw new RangeError('VAT numerator is outside the safe integer range.');
  }
  return roundHalfUp(numerator, VAT_BASIS_POINTS_DENOMINATOR);
}

/** Computes merchandise minus promotion plus delivery as one non-negative safe total. */
export function calculateInvoiceNetCents(
  merchandiseCents: number,
  promoDiscountCents?: number,
  deliveryCents?: number,
): number;
export function calculateInvoiceNetCents(input: InvoiceTotalsInput): number;
export function calculateInvoiceNetCents(
  merchandiseOrInput: number | InvoiceTotalsInput,
  promoDiscountCents = 0,
  deliveryCents = 0,
): number {
  if (typeof merchandiseOrInput === 'number') {
    const merchandise = merchandiseOrInput;
    const discounted = safeSubtract(merchandise, promoDiscountCents, 'Invoice merchandise');
    return safeAdd(discounted, deliveryCents, 'Invoice net');
  }
  if (!isRecord(merchandiseOrInput)) throw new RangeError('Invoice totals input is invalid.');
  const merchandise = readAlias(
    merchandiseOrInput,
    ['merchandiseCents', 'merchandiseSubtotalCents', 'subtotalCents'],
    'merchandiseCents',
  );
  const promo = readAlias(
    merchandiseOrInput,
    ['promoDiscountCents', 'promoCents', 'discountCents'],
    'promoDiscountCents',
    0,
  );
  const delivery = readAlias(
    merchandiseOrInput,
    ['deliveryCents', 'deliveryChargeCents', 'shippingCents'],
    'deliveryCents',
    0,
  );
  const discounted = safeSubtract(merchandise, promo, 'Invoice merchandise');
  return safeAdd(discounted, delivery, 'Invoice net');
}

/**
 * Calculates the invoice net, VAT, and gross amounts. The VAT helper is called exactly once,
 * after net has been established; no per-line or display-currency calculation belongs here.
 */
export function calculateInvoiceTotals(input: InvoiceTotalsInput): InvoiceAmounts;
export function calculateInvoiceTotals(
  merchandiseCents: number,
  promoDiscountCents: number,
  deliveryCents: number,
  vatRateBasisPoints: InvoiceVatRate,
): InvoiceAmounts;
export function calculateInvoiceTotals(
  inputOrMerchandise: InvoiceTotalsInput | number,
  promoDiscountCents?: number,
  deliveryCents?: number,
  vatRateBasisPoints?: InvoiceVatRate,
): InvoiceAmounts {
  if (typeof inputOrMerchandise === 'number') {
    if (vatRateBasisPoints === undefined) {
      throw new RangeError('vatRateBasisPoints is required.');
    }
    const netCents = calculateInvoiceNetCents(
      inputOrMerchandise,
      promoDiscountCents ?? 0,
      deliveryCents ?? 0,
    );
    const vatCents = calculateVatCents(netCents, vatRateBasisPoints);
    const grossCents = safeAdd(netCents, vatCents, 'Invoice gross');
    return { netCents, vatCents, grossCents };
  }
  if (!isRecord(inputOrMerchandise)) throw new RangeError('Invoice totals input is invalid.');
  const netCents = calculateInvoiceNetCents(inputOrMerchandise);
  const vatCents = calculateVatCents(netCents, readRateAlias(inputOrMerchandise));
  const grossCents = safeAdd(netCents, vatCents, 'Invoice gross');
  return { netCents, vatCents, grossCents };
}

/** Alias used by invoice builders that call the result an amount tuple. */
export const calculateInvoiceAmounts = calculateInvoiceTotals;
export const calculateTradeCreditInvoiceTotals = calculateInvoiceTotals;

/** Input accepted by credit exposure calculation. All amounts are canonical GBP pence. */
export interface CreditExposureInput {
  readonly outstandingInvoiceCents?: number;
  readonly outstandingCents?: number;
  readonly preparedHoldCents?: number;
  readonly preparedCents?: number;
  readonly authorizedHoldCents?: number;
  readonly authorizedCents?: number;
  readonly authorizedPendingFinalizeCents?: number;
  readonly heldCents?: number;
  readonly creditLimitCents?: number;
  readonly [key: string]: unknown;
}

/** Canonical credit balance fields used to build a `CreditAccount` transport view. */
export interface CreditExposureSummary {
  readonly outstandingCents: number;
  readonly heldCents: number;
  readonly exposureCents: number;
  readonly availableCreditCents: number;
}

function creditAmountsFromInput(input: CreditExposureInput): {
  outstandingCents: number;
  preparedHoldCents: number;
  authorizedHoldCents: number;
  heldCents: number;
} {
  if (!isRecord(input)) throw new RangeError('Credit exposure input is invalid.');
  const outstandingCents = readAlias(
    input,
    ['outstandingInvoiceCents', 'outstandingCents'],
    'outstandingInvoiceCents',
    0,
  );
  const preparedHoldCents = readAlias(
    input,
    ['preparedHoldCents', 'preparedCents'],
    'preparedHoldCents',
    0,
  );
  const authorizedHoldCents = readAlias(
    input,
    ['authorizedHoldCents', 'authorizedCents', 'authorizedPendingFinalizeCents'],
    'authorizedHoldCents',
    0,
  );
  const calculatedHeldCents = safeAdd(
    preparedHoldCents,
    authorizedHoldCents,
    'Credit held exposure',
  );
  if (Object.prototype.hasOwnProperty.call(input, 'heldCents')) {
    const heldCents = readAlias(input, ['heldCents'], 'heldCents');
    if (heldCents !== calculatedHeldCents) {
      throw new RangeError('heldCents must equal prepared and authorized holds.');
    }
  }
  return {
    outstandingCents,
    preparedHoldCents,
    authorizedHoldCents,
    heldCents: calculatedHeldCents,
  };
}

/** Adds prepared and authorized payment holds with overflow protection. */
export function calculateHeldExposure(
  preparedHoldCents: number,
  authorizedHoldCents: number,
): number;
export function calculateHeldExposure(input: CreditExposureInput): number;
export function calculateHeldExposure(
  preparedOrInput: number | CreditExposureInput,
  authorizedHoldCents = 0,
): number {
  if (typeof preparedOrInput === 'number') {
    return safeAdd(preparedOrInput, authorizedHoldCents, 'Credit held exposure');
  }
  return creditAmountsFromInput(preparedOrInput).heldCents;
}

/**
 * Combines outstanding invoices with payment holds. Prepared and authorized-pending-finalize
 * holds both count; settled/failed/released payment states are expected to be omitted upstream.
 */
export function calculateCreditExposure(
  outstandingInvoiceCents: number,
  preparedHoldCents?: number,
  authorizedHoldCents?: number,
): number;
export function calculateCreditExposure(input: CreditExposureInput): number;
export function calculateCreditExposure(
  outstandingOrInput: number | CreditExposureInput,
  preparedHoldCents = 0,
  authorizedHoldCents = 0,
): number {
  if (typeof outstandingOrInput === 'number') {
    const heldCents = safeAdd(preparedHoldCents, authorizedHoldCents, 'Credit held exposure');
    return safeAdd(outstandingOrInput, heldCents, 'Credit exposure');
  }
  const amounts = creditAmountsFromInput(outstandingOrInput);
  return safeAdd(amounts.outstandingCents, amounts.heldCents, 'Credit exposure');
}

/** Available credit is never negative, even when exposure has crossed the account limit. */
export function calculateAvailableCredit(creditLimitCents: number, exposureCents: number): number {
  requireNonNegativeSafeInteger(creditLimitCents, 'creditLimitCents');
  requireNonNegativeSafeInteger(exposureCents, 'exposureCents');
  return exposureCents >= creditLimitCents ? 0 : creditLimitCents - exposureCents;
}

export const calculateAvailableCreditCents = calculateAvailableCredit;
export const availableCreditCents = calculateAvailableCredit;

/** Derives the account balance tuple from outstanding invoices, holds, and its credit limit. */
export function deriveCreditExposure(input: CreditExposureInput): CreditExposureSummary;
export function deriveCreditExposure(
  creditLimitCents: number,
  outstandingInvoiceCents: number,
  preparedHoldCents?: number,
  authorizedHoldCents?: number,
): CreditExposureSummary;
export function deriveCreditExposure(
  inputOrLimit: CreditExposureInput | number,
  outstandingInvoiceCents?: number,
  preparedHoldCents = 0,
  authorizedHoldCents = 0,
): CreditExposureSummary {
  if (typeof inputOrLimit === 'number') {
    if (outstandingInvoiceCents === undefined) {
      throw new RangeError('outstandingInvoiceCents is required.');
    }
    const heldCents = calculateHeldExposure(preparedHoldCents, authorizedHoldCents);
    const exposureCents = calculateCreditExposure(
      outstandingInvoiceCents,
      preparedHoldCents,
      authorizedHoldCents,
    );
    return {
      outstandingCents: outstandingInvoiceCents,
      heldCents,
      exposureCents,
      availableCreditCents: calculateAvailableCredit(inputOrLimit, exposureCents),
    };
  }
  if (!isRecord(inputOrLimit)) throw new RangeError('Credit exposure input is invalid.');
  const amounts = creditAmountsFromInput(inputOrLimit);
  const exposureCents = safeAdd(amounts.outstandingCents, amounts.heldCents, 'Credit exposure');
  const creditLimitCents = readAlias(
    inputOrLimit,
    ['creditLimitCents', 'limitCents'],
    'creditLimitCents',
  );
  return {
    outstandingCents: amounts.outstandingCents,
    heldCents: amounts.heldCents,
    exposureCents,
    availableCreditCents: calculateAvailableCredit(creditLimitCents, exposureCents),
  };
}

export const deriveCreditAccountExposure = deriveCreditExposure;

/** Eligibility input. Nested contract records and flattened route facts are both accepted. */
export interface TradeCreditEligibilityInput {
  readonly company?: { readonly active?: boolean; readonly id?: string | number } | boolean | null;
  readonly companyAccount?:
    { readonly active?: boolean; readonly id?: string | number } | boolean | null;
  readonly companyActive?: boolean;
  readonly activeCompany?: boolean;
  readonly membership?:
    | { readonly active?: boolean; readonly role?: string; readonly companyId?: string | number }
    | boolean
    | string
    | null;
  readonly companyMembership?:
    | { readonly active?: boolean; readonly role?: string; readonly companyId?: string | number }
    | boolean
    | string
    | null;
  readonly membershipActive?: boolean;
  readonly activeMembership?: boolean;
  readonly membershipRole?: string;
  readonly role?: string;
  readonly creditAccount?: {
    readonly state?: string;
    readonly status?: string;
    readonly companyId?: string | number;
  } | null;
  readonly account?: {
    readonly state?: string;
    readonly status?: string;
    readonly companyId?: string | number;
  } | null;
  readonly creditState?: string;
  readonly creditStatus?: string;
  readonly state?: string;
  /** Deliberately ignored: approval cannot turn an ineligible member into a credit buyer. */
  readonly approvalGranted?: boolean;
  readonly approved?: boolean;
  readonly [key: string]: unknown;
}

export type TradeCreditEligibilityFailureCode =
  | 'NO_ACTIVE_COMPANY'
  | 'NO_ACTIVE_MEMBERSHIP'
  | 'MEMBERSHIP_ROLE_NOT_ELIGIBLE'
  | 'CREDIT_ACCOUNT_NOT_ACTIVE';

export type TradeCreditEligibilityResult =
  | { readonly eligible: true }
  | { readonly eligible: false; readonly code: TradeCreditEligibilityFailureCode };

interface NestedRecordRead {
  readonly record: Record<string, unknown> | null;
  readonly conflict: boolean;
}

function readNestedAliasValue(
  record: Record<string, unknown>,
  names: readonly string[],
): { readonly present: boolean; readonly value: unknown } {
  for (const name of names) {
    if (record[name] !== undefined) return { present: true, value: record[name] };
  }
  return { present: false, value: undefined };
}

function nestedAliasesConflict(record: Record<string, unknown>, names: readonly string[]): boolean {
  let value: unknown;
  let present = false;
  for (const name of names) {
    if (record[name] === undefined) continue;
    if (present && value !== record[name]) return true;
    value = record[name];
    present = true;
  }
  return false;
}

function nestedRecordsConflict(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): boolean {
  for (const names of [['active'], ['role'], ['state', 'status'], ['id'], ['companyId']]) {
    const leftValue = readNestedAliasValue(left, names);
    const rightValue = readNestedAliasValue(right, names);
    if (leftValue.present && rightValue.present && leftValue.value !== rightValue.value) {
      return true;
    }
  }
  return false;
}

function readNestedRecord(
  input: Record<string, unknown>,
  names: readonly string[],
): NestedRecordRead {
  let record: Record<string, unknown> | null = null;
  let conflict = false;
  for (const name of names) {
    const value = input[name];
    if (!isRecord(value)) continue;
    if (
      nestedAliasesConflict(value, ['active']) ||
      nestedAliasesConflict(value, ['role']) ||
      nestedAliasesConflict(value, ['state', 'status']) ||
      nestedAliasesConflict(value, ['id']) ||
      nestedAliasesConflict(value, ['companyId'])
    ) {
      conflict = true;
    }
    if (record === null) {
      record = { ...value };
      continue;
    }
    // Treat conflicting aliases as malformed authorization input. A caller must not be able to
    // place an inactive company in one alias and an active company in another to bypass a gate.
    conflict ||= nestedRecordsConflict(record, value);
    for (const [key, candidate] of Object.entries(value)) {
      if (record[key] === undefined) record[key] = candidate;
    }
  }
  return { record, conflict };
}

function readBooleanFact(
  input: Record<string, unknown>,
  names: readonly string[],
  nested: Record<string, unknown> | null,
): boolean | undefined {
  let value: boolean | undefined;
  for (const name of names) {
    if (typeof input[name] !== 'boolean') continue;
    const candidate = input[name];
    if (value !== undefined && value !== candidate) return undefined;
    value = candidate;
  }
  if (nested && typeof nested.active === 'boolean') {
    if (value !== undefined && value !== nested.active) return undefined;
    value = nested.active;
  }
  return value;
}

function readStringFact(
  input: Record<string, unknown>,
  names: readonly string[],
  nested: Record<string, unknown> | null,
  nestedNames: readonly string[],
): string | undefined {
  let value: string | undefined;
  for (const name of names) {
    if (typeof input[name] !== 'string') continue;
    const candidate = input[name];
    if (value !== undefined && value !== candidate) return undefined;
    value = candidate;
  }
  if (nested) {
    for (const name of nestedNames) {
      if (typeof nested[name] !== 'string') continue;
      const candidate = nested[name];
      if (value !== undefined && value !== candidate) return undefined;
      value = candidate;
    }
  }
  return value;
}

function sameOptionalIdentity(
  left: Record<string, unknown> | null,
  right: Record<string, unknown> | null,
  leftNames: readonly string[],
  rightNames: readonly string[],
): boolean {
  if (!left || !right) return true;
  const read = (record: Record<string, unknown>, names: readonly string[]): string | undefined => {
    for (const name of names) {
      const value = record[name];
      if (typeof value === 'string' || typeof value === 'number') return String(value);
    }
    return undefined;
  };
  const leftId = read(left, leftNames);
  const rightId = read(right, rightNames);
  return leftId === undefined || rightId === undefined || leftId === rightId;
}

/** Returns a stable reasoned verdict for trade-credit checkout eligibility. */
export function evaluateTradeCreditEligibility(
  input: TradeCreditEligibilityInput,
): TradeCreditEligibilityResult {
  if (!isRecord(input)) return { eligible: false, code: 'NO_ACTIVE_COMPANY' };
  const companyRead = readNestedRecord(input, ['company', 'companyAccount']);
  const membershipRead = readNestedRecord(input, ['membership', 'companyMembership']);
  const accountRead = readNestedRecord(input, ['creditAccount', 'account']);
  const company = companyRead.record;
  const membership = membershipRead.record;
  const account = accountRead.record;
  if (companyRead.conflict) return { eligible: false, code: 'NO_ACTIVE_COMPANY' };
  if (membershipRead.conflict) return { eligible: false, code: 'NO_ACTIVE_MEMBERSHIP' };
  if (accountRead.conflict) return { eligible: false, code: 'CREDIT_ACCOUNT_NOT_ACTIVE' };
  const companyActive = readBooleanFact(input, ['companyActive', 'activeCompany'], company);
  if (companyActive !== true) return { eligible: false, code: 'NO_ACTIVE_COMPANY' };
  const membershipActive = readBooleanFact(
    input,
    ['membershipActive', 'activeMembership'],
    membership,
  );
  if (membershipActive !== true) return { eligible: false, code: 'NO_ACTIVE_MEMBERSHIP' };
  const role = readStringFact(
    input,
    ['membershipRole', 'role'],
    typeof input.membership === 'string' || typeof input.companyMembership === 'string'
      ? null
      : membership,
    ['role'],
  );
  if (role !== 'owner' && role !== 'buyer') {
    return { eligible: false, code: 'MEMBERSHIP_ROLE_NOT_ELIGIBLE' };
  }
  const state = readStringFact(input, ['creditState', 'creditStatus', 'state'], account, [
    'state',
    'status',
  ]);
  if (state !== 'active') return { eligible: false, code: 'CREDIT_ACCOUNT_NOT_ACTIVE' };
  if (
    !sameOptionalIdentity(company, membership, ['id'], ['companyId']) ||
    !sameOptionalIdentity(company, account, ['id'], ['companyId']) ||
    !sameOptionalIdentity(membership, account, ['companyId'], ['companyId'])
  ) {
    return { eligible: false, code: 'NO_ACTIVE_MEMBERSHIP' };
  }
  return { eligible: true };
}

/** Boolean authorization predicate used by checkout and payment workflows. */
export function isTradeCreditEligible(input: TradeCreditEligibilityInput): boolean;
export function isTradeCreditEligible(
  companyActive: boolean,
  membershipActive: boolean,
  membershipRole: string,
  creditState: string,
  approvalGranted?: boolean,
): boolean;
export function isTradeCreditEligible(
  companyOrInput: boolean | TradeCreditEligibilityInput,
  membershipActive?: boolean,
  membershipRole?: string,
  creditState?: string,
  approvalGranted?: boolean,
): boolean {
  if (typeof companyOrInput === 'boolean') {
    return evaluateTradeCreditEligibility({
      companyActive: companyOrInput,
      membershipActive,
      membershipRole,
      creditState,
      approvalGranted,
    }).eligible;
  }
  return evaluateTradeCreditEligibility(companyOrInput).eligible;
}

export const isEligibleForTradeCredit = isTradeCreditEligible;
export const isCreditEligible = isTradeCreditEligible;

function parseCreditUtcInstant(value: unknown, name: string): number {
  if (typeof value !== 'string' || !ISO_UTC_INSTANT_PATTERN.test(value)) {
    throw new RangeError(`${name} must be a canonical UTC ISO instant.`);
  }
  const milliseconds = Date.parse(value);
  if (
    !Number.isFinite(milliseconds) ||
    !Number.isSafeInteger(milliseconds) ||
    new Date(milliseconds).toISOString() !== value
  ) {
    throw new RangeError(`${name} must be a real UTC ISO instant.`);
  }
  return milliseconds;
}

/** Adds exactly thirty UTC days to an issued instant; no calendar/local-time arithmetic is used. */
export function calculateInvoiceDueAt(issuedAt: string): string {
  const issuedMilliseconds = parseCreditUtcInstant(issuedAt, 'issuedAt');
  if (issuedMilliseconds > DATE_TIME_CLIP_MAX_MS - TRADE_CREDIT_TERM_MS) {
    throw new RangeError('Invoice due date is outside the supported date range.');
  }
  const dueMilliseconds = issuedMilliseconds + TRADE_CREDIT_TERM_MS;
  if (!Number.isSafeInteger(dueMilliseconds) || dueMilliseconds > DATE_TIME_CLIP_MAX_MS) {
    throw new RangeError('Invoice due date is outside the supported date range.');
  }
  const dueAt = new Date(dueMilliseconds).toISOString();
  // The contract accepts four-digit years and millisecond precision only. This check also catches
  // a Date implementation that would emit an extended-year representation at the upper bound.
  if (!ISO_UTC_INSTANT_PATTERN.test(dueAt)) {
    throw new RangeError('Invoice due date is outside the supported date range.');
  }
  return dueAt;
}

export const calculateDueAt = calculateInvoiceDueAt;
export const dueAtFromIssuedAt = calculateInvoiceDueAt;

function isInvoiceLifecycleStatus(value: unknown): value is InvoiceLifecycleStatus {
  return (
    typeof value === 'string' && INVOICE_LIFECYCLE_STATUSES.has(value as InvoiceLifecycleStatus)
  );
}

/** Input for deriving buyer-facing open/overdue status from immutable due date facts. */
export interface InvoiceLifecycleDisplayInput {
  readonly dueAt: string;
  readonly now: string;
  readonly status?: InvoiceLifecycleStatus;
  readonly lifecycleStatus?: InvoiceLifecycleStatus;
  readonly lifecycle?: { readonly status?: InvoiceLifecycleStatus } | null;
}

/**
 * Derives display status at a supplied instant. Paid and voided are terminal and are never
 * rewritten by passage of time; open and overdue are projections of the due date boundary.
 */
export function deriveInvoiceLifecycleStatus(
  input: InvoiceLifecycleDisplayInput,
): InvoiceLifecycleStatus;
export function deriveInvoiceLifecycleStatus(
  dueAt: string,
  now: string,
  status?: InvoiceLifecycleStatus,
): InvoiceLifecycleStatus;
export function deriveInvoiceLifecycleStatus(
  invoiceOrDueAt: InvoiceLifecycleDisplayInput | string,
  now?: string,
  currentStatus: InvoiceLifecycleStatus = 'open',
): InvoiceLifecycleStatus {
  let dueAt: unknown;
  let evaluatedAt: unknown;
  let status: unknown;
  if (typeof invoiceOrDueAt === 'string') {
    dueAt = invoiceOrDueAt;
    evaluatedAt = now;
    status = currentStatus;
  } else {
    if (!isRecord(invoiceOrDueAt)) throw new RangeError('Invoice lifecycle input is invalid.');
    dueAt = invoiceOrDueAt.dueAt;
    evaluatedAt = invoiceOrDueAt.now;
    status =
      invoiceOrDueAt.status ??
      invoiceOrDueAt.lifecycleStatus ??
      invoiceOrDueAt.lifecycle?.status ??
      'open';
  }
  const dueMilliseconds = parseCreditUtcInstant(dueAt, 'dueAt');
  const nowMilliseconds = parseCreditUtcInstant(evaluatedAt, 'now');
  if (!isInvoiceLifecycleStatus(status)) {
    throw new RangeError('Invoice lifecycle status is invalid.');
  }
  if (status === 'paid' || status === 'voided') return status;
  return nowMilliseconds >= dueMilliseconds ? 'overdue' : 'open';
}

export const deriveInvoiceDisplayStatus = deriveInvoiceLifecycleStatus;
export const deriveInvoiceStatus = deriveInvoiceLifecycleStatus;
export const invoiceDisplayStatus = deriveInvoiceLifecycleStatus;

/** Convenience predicate for overdue labels; equality with dueAt counts as overdue. */
export function isInvoiceOverdue(dueAt: string, now: string): boolean {
  return deriveInvoiceLifecycleStatus(dueAt, now) === 'overdue';
}
