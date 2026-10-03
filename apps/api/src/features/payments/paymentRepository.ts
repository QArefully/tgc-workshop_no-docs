import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { parsePersistedCheckoutQuote as parseContractPersistedCheckoutQuote } from '@shop/contracts/payments';
import type {
  BillingSelection,
  DeliveryDestination,
  PersistedCheckoutQuote,
  PaymentMethod,
} from '@shop/contracts/payments';
import type { DeliverySlot } from '@shop/contracts/delivery';
import { formatPostalAddress } from '@shop/contracts/address';
import {
  normalizeOptionalText,
  normalizePostalAddress,
  normalizeText,
} from '../tradeAccount/addressRules.js';
import type { ValidCard } from './cardValidation.js';

export type { PersistedCheckoutQuote, PersistedCheckoutQuoteV7 } from '@shop/contracts/payments';

export type IntentPaymentStatus =
  | 'prepared'
  | 'authorized_pending_finalize'
  | 'succeeded'
  | 'declined'
  | 'timed_out'
  | 'failed_pre_gateway';

export interface PaymentRecord {
  id: number;
  idempotencyKey: string;
  fingerprint: string;
  status: IntentPaymentStatus;
  /** Payment instrument selected when this idempotency reservation was created. */
  paymentMethod: PaymentMethod;
  /** Server-resolved company authority for a credit intent; cards have no company. */
  companyId: number | null;
  /** Authenticated buyer identity for a credit intent; legacy cards remain anonymous here. */
  userId: number | null;
  /** Display-safe card metadata; both values are null for trade-credit intents. */
  cardLast4: string | null;
  cardBrand: string | null;
  amountCents: number;
  orderId: number | null;
  cartId: string | null;
  quoteJson: string | null;
  gatewayReference: string | null;
  failureReason: string | null;
  responseJson: string | null;
  reservationExpiresAt: string | null;
  createdAt: string;
  updatedAt: string | null;
}

interface PaymentRow {
  id: number;
  idempotency_key: string;
  request_fingerprint: string;
  status: unknown;
  amount_cents: unknown;
  card_last4: unknown;
  card_brand: unknown;
  payment_method: unknown;
  company_id: unknown;
  user_id: unknown;
  order_id: number | null;
  cart_id: string | null;
  quote_json: string | null;
  gateway_reference: string | null;
  failure_reason: string | null;
  response_json: string | null;
  reservation_expires_at: string | null;
  created_at: string;
  updated_at: string | null;
}

const intentStatuses = new Set<IntentPaymentStatus>([
  'prepared',
  'authorized_pending_finalize',
  'succeeded',
  'declined',
  'timed_out',
  'failed_pre_gateway',
]);

/** Rejects storage corruption before persisted quote data reaches checkout finalization. */
export function parsePersistedCheckoutQuote(value: string): PersistedCheckoutQuote {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('Invalid persisted checkout quote');
  }
  try {
    return parseContractPersistedCheckoutQuote(parsed);
  } catch {
    throw new Error('Invalid persisted checkout quote');
  }
}

export function serializePersistedCheckoutQuote(quote: PersistedCheckoutQuote): string {
  parsePersistedCheckoutQuote(JSON.stringify(quote));
  return JSON.stringify(quote);
}

/**
 * Stable rendering of a destination selection.
 *
 * A saved selection contributes its identifier, not the stored address: the fingerprint is computed
 * before the preparation transaction resolves anything, so hashing the resolved address would force
 * a database read onto the replay path — where a since-retired site would then break the idempotent
 * replay of an order that already succeeded. Editing a saved site is not a change of destination
 * selection, so it correctly leaves the fingerprint alone.
 *
 * An ad-hoc address is normalised with the same helper checkout resolution uses, so the casing and
 * spacing variations that resolve to one destination also hash to one fingerprint.
 */
function fingerprintDestination(destination: DeliveryDestination): string {
  return destination.kind === 'saved'
    ? `site:${destination.deliverySiteId}`
    : `address:${formatPostalAddress(normalizePostalAddress(destination.address))}`;
}

/**
 * Same rule for the billed party: identifier when saved, the whole party when ad-hoc.
 *
 * Every ad-hoc part is hashed through the helper checkout resolution uses to build the billing
 * snapshot, so one billed party re-typed with different casing or spacing stays one fingerprint
 * instead of a spurious conflict, and every part that reaches the snapshot reaches the hash.
 */
function fingerprintBilling(billing: BillingSelection): string {
  if (billing.kind === 'saved') return `entity:${billing.billingEntityId}`;
  const entity = billing.billingEntity;
  return [
    `legalName:${normalizeText(entity.legalName)}`,
    `registrationNumber:${normalizeOptionalText(entity.registrationNumber) ?? ''}`,
    `vatNumber:${normalizeOptionalText(entity.vatNumber) ?? ''}`,
    `address:${formatPostalAddress(normalizePostalAddress(entity.address))}`,
  ].join('|');
}

export interface SafeFingerprintParams {
  cartId: string;
  promoCode?: string;
  customerName: string;
  customerEmail: string;
  deliveryDestination: DeliveryDestination;
  billingSelection: BillingSelection;
  deliverySlot: DeliverySlot;
  purchaseOrderReference?: string;
  /** Required only for the card branch; credit requests intentionally carry no card fields. */
  cardExpiry?: string;
  paymentMethod?: PaymentMethod;
  /** Authenticated buyer identity. An omitted value preserves legacy anonymous-card hashing. */
  userId?: number | string | null;
  /** Server-resolved credit company identity. Never accepted for card requests. */
  companyId?: number | string | null;
}

/**
 * Hashes replay-relevant checkout commitments without retaining payment secrets. Card callers may
 * omit `paymentMethod` (the historic wire shape) and produce the same digest as explicit cards.
 * Credit callers include the authenticated buyer and server-resolved company in the digest, so a
 * key cannot be replayed by another member or against another company.
 */
export function createSafeFingerprint(
  params: SafeFingerprintParams,
  card?: Pick<ValidCard, 'brand' | 'last4'> | null,
): string {
  const paymentMethod = normalizePaymentMethod(params.paymentMethod);
  const companyId = normalizeCompanyId(params.companyId);
  // Buyer identity is deliberately only part of the new trade-credit commitment. Legacy card
  // retries (including authenticated retries) must retain their historical byte representation.
  const userId = paymentMethod === 'trade_credit' ? normalizeUserId(params.userId) : undefined;

  if (paymentMethod === 'card') {
    if (companyId !== null || !card || typeof params.cardExpiry !== 'string') {
      throw new Error('Card fingerprint requires card metadata');
    }
  } else if (card !== undefined && card !== null) {
    throw new Error('Credit fingerprint cannot include card metadata');
  }

  // PAN and CVC are deliberately absent. Last four and brand are display-safe payment metadata.
  // Every other buyer-visible commitment is present, so replaying one key under a changed
  // destination, billing party, slot, buyer reference, buyer, or credit company is a conflict
  // rather than a silent repeat.
  const body: Record<string, unknown> = {
    cartId: params.cartId,
    promoCode: params.promoCode ?? null,
    customerName: params.customerName.trim(),
    customerEmail: params.customerEmail.trim().toLowerCase(),
    deliveryDestination: fingerprintDestination(params.deliveryDestination),
    billingSelection: fingerprintBilling(params.billingSelection),
    deliverySlotDate: params.deliverySlot.date,
    deliverySlotWindow: params.deliverySlot.window,
    // Same normalisation resolution applies, so `po  123` and `po 123` are one buyer reference.
    purchaseOrderReference: normalizeOptionalText(params.purchaseOrderReference),
  };

  if (paymentMethod === 'card') {
    // Keep the historical card body byte-for-byte compatible. An explicit `paymentMethod: 'card'`
    // therefore hashes identically to an omitted method, including for existing idempotency rows.
    body.cardExpiry = params.cardExpiry!.trim();
    body.cardBrand = card!.brand;
    body.cardLast4 = card!.last4;
  } else {
    if (userId === undefined || userId === null || companyId === null) {
      throw new Error('Credit fingerprint requires authenticated buyer and company');
    }
    body.paymentMethod = paymentMethod;
    body.userId = userId;
    body.companyId = companyId;
  }

  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

function toRecord(row: PaymentRow): PaymentRecord {
  if (!intentStatuses.has(row.status as IntentPaymentStatus)) {
    throw new Error('Invalid persisted payment intent');
  }
  const paymentMethod = row.payment_method;
  if (paymentMethod !== 'card' && paymentMethod !== 'trade_credit') {
    throw new Error('Invalid persisted payment intent');
  }
  if (
    typeof row.amount_cents !== 'number' ||
    !Number.isSafeInteger(row.amount_cents) ||
    row.amount_cents < 0
  ) {
    throw new Error('Invalid persisted payment intent');
  }

  const cardLast4 = row.card_last4;
  const cardBrand = row.card_brand;
  const companyId = row.company_id;
  if (companyId !== null && (typeof companyId !== 'number' || !isSafePositiveInteger(companyId))) {
    throw new Error('Invalid persisted payment intent');
  }
  const userId = row.user_id;
  if (userId !== null && !isSafePositiveInteger(userId)) {
    throw new Error('Invalid persisted payment intent');
  }
  if (paymentMethod === 'card') {
    if (
      typeof cardLast4 !== 'string' ||
      !/^\d{4}$/.test(cardLast4) ||
      typeof cardBrand !== 'string' ||
      cardBrand.trim() === '' ||
      companyId !== null ||
      userId !== null
    ) {
      throw new Error('Invalid persisted payment intent');
    }
  } else if (cardLast4 !== null || cardBrand !== null || companyId === null || userId === null) {
    throw new Error('Invalid persisted payment intent');
  }

  return {
    id: row.id,
    idempotencyKey: row.idempotency_key,
    fingerprint: row.request_fingerprint,
    status: row.status as IntentPaymentStatus,
    paymentMethod,
    companyId,
    userId,
    cardLast4,
    cardBrand,
    amountCents: row.amount_cents,
    orderId: row.order_id,
    cartId: row.cart_id,
    quoteJson: row.quote_json,
    gatewayReference: row.gateway_reference,
    failureReason: row.failure_reason,
    responseJson: row.response_json,
    reservationExpiresAt: row.reservation_expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const paymentColumns = `id, idempotency_key, request_fingerprint, status, order_id, cart_id,
  quote_json, gateway_reference, failure_reason, response_json, reservation_expires_at, created_at,
  updated_at, amount_cents, card_last4, card_brand, payment_method, company_id, user_id`;

function isSafePositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

function normalizeCompanyId(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') {
    if (!isSafePositiveInteger(value)) throw new Error('Invalid payment company');
    return value;
  }
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) {
    throw new Error('Invalid payment company');
  }
  const parsed = Number(value);
  if (!isSafePositiveInteger(parsed)) throw new Error('Invalid payment company');
  return parsed;
}

function normalizePaymentMethod(value: unknown): PaymentMethod {
  if (value === undefined || value === 'card') return 'card';
  if (value === 'trade_credit') return 'trade_credit';
  throw new Error('Invalid payment method');
}

function normalizeUserId(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'number') {
    if (!isSafePositiveInteger(value)) throw new Error('Invalid payment user');
    return value;
  }
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) {
    throw new Error('Invalid payment user');
  }
  const parsed = Number(value);
  if (!isSafePositiveInteger(parsed)) throw new Error('Invalid payment user');
  return parsed;
}

function isV10Quote(
  quote: PersistedCheckoutQuote,
): quote is Extract<PersistedCheckoutQuote, { version: 10 }> {
  return quote.version === 10;
}

function quotePaymentFacts(quote: PersistedCheckoutQuote): {
  paymentMethod: PaymentMethod;
  companyId: number | null;
  userId: number | null;
} {
  if (!isV10Quote(quote)) {
    return { paymentMethod: 'card', companyId: null, userId: quote.userId };
  }
  const paymentMethod = normalizePaymentMethod(quote.paymentMethod);
  const companyId = normalizeCompanyId(quote.companyId);
  const userId = normalizeUserId(quote.userId);
  if (userId === undefined) throw new Error('Invalid persisted checkout quote');
  if (paymentMethod === 'card' && companyId !== null) {
    throw new Error('Invalid persisted checkout quote');
  }
  if (
    paymentMethod === 'card' &&
    ((quote.terms !== undefined && quote.terms !== null) ||
      (quote.termsDays !== undefined && quote.termsDays !== null))
  ) {
    throw new Error('Invalid persisted checkout quote');
  }
  if (paymentMethod === 'trade_credit' && companyId === null) {
    throw new Error('Invalid persisted checkout quote');
  }
  return { paymentMethod, companyId, userId };
}

export interface PaymentRepository {
  reservePreGateway(params: {
    idempotencyKey: string;
    fingerprint: string;
    /** Omitted for the historic card request shape; defaults to `card`. */
    paymentMethod?: 'card';
    card: Pick<ValidCard, 'last4' | 'brand'>;
    companyId?: null;
    userId?: number | string | null;
    createdAt: string;
  }): { reserved: true } | { reserved: false; payment: PaymentRecord };
  reservePreGateway(params: {
    idempotencyKey: string;
    fingerprint: string;
    paymentMethod: 'trade_credit';
    /** Authenticated company selected by the server; buyer input cannot choose this value. */
    companyId: number | string;
    userId: number | string;
    card?: never;
    createdAt: string;
  }): { reserved: true } | { reserved: false; payment: PaymentRecord };
  /** Structural compatibility for workflows that narrow method/card facts inside the call. */
  reservePreGateway(params: {
    idempotencyKey: string;
    fingerprint: string;
    paymentMethod?: PaymentMethod;
    card?: Pick<ValidCard, 'last4' | 'brand'> | null;
    companyId?: number | string | null;
    userId?: number | string | null;
    createdAt: string;
  }): { reserved: true } | { reserved: false; payment: PaymentRecord };
  persistQuote(params: {
    idempotencyKey: string;
    cartId: string;
    quote: PersistedCheckoutQuote;
    updatedAt: string;
    reservationExpiresAt: string;
    /** Optional assertions let workflow callers bind quote facts to the reservation. */
    paymentMethod?: PaymentMethod;
    companyId?: number | string | null;
    userId?: number | string | null;
  }): boolean;
  load(idempotencyKey: string): PaymentRecord | undefined;
  transition(params: {
    idempotencyKey: string;
    expectedStatus: IntentPaymentStatus;
    nextStatus: IntentPaymentStatus;
    updatedAt?: string;
    orderId?: number | null;
    amountCents?: number;
    failureReason?: string | null;
    gatewayReference?: string | null;
    responseJson?: string | null;
  }): boolean;
}

export function createPaymentRepository(db: Database.Database): PaymentRepository {
  const load = (idempotencyKey: string): PaymentRecord | undefined => {
    const row = db
      .prepare(`SELECT ${paymentColumns} FROM payments WHERE idempotency_key = ?`)
      .get(idempotencyKey) as PaymentRow | undefined;
    return row ? toRecord(row) : undefined;
  };
  const reserve = (params: {
    idempotencyKey: string;
    fingerprint: string;
    paymentMethod?: PaymentMethod;
    card?: Pick<ValidCard, 'last4' | 'brand'> | null;
    companyId?: number | string | null;
    userId?: number | string | null;
    createdAt: string;
    status: 'prepared';
    cartId?: string;
    quoteJson?: string;
  }): { reserved: true } | { reserved: false; payment: PaymentRecord } => {
    const paymentMethod = normalizePaymentMethod(params.paymentMethod);
    const companyId = normalizeCompanyId(params.companyId);
    const userId = normalizeUserId(params.userId);
    if (paymentMethod === 'card') {
      if (
        !params.card ||
        companyId !== null ||
        typeof params.card.last4 !== 'string' ||
        !/^\d{4}$/.test(params.card.last4) ||
        typeof params.card.brand !== 'string' ||
        params.card.brand.trim() === ''
      ) {
        throw new Error('Card payment reservation requires card metadata');
      }
    } else if (params.card || companyId === null || userId === undefined || userId === null) {
      throw new Error(
        'Credit payment reservation requires company, authenticated user, and no card metadata',
      );
    }

    const result = db
      .prepare(
        `INSERT INTO payments
          (idempotency_key, request_fingerprint, status, amount_cents, card_last4, card_brand,
           cart_id, quote_json, created_at, updated_at, payment_method, company_id, user_id)
         VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(idempotency_key) DO NOTHING`,
      )
      .run(
        params.idempotencyKey,
        params.fingerprint,
        params.status,
        paymentMethod === 'card' ? params.card!.last4 : null,
        paymentMethod === 'card' ? params.card!.brand : null,
        params.cartId ?? null,
        params.quoteJson ?? null,
        params.createdAt,
        params.createdAt,
        paymentMethod,
        companyId,
        paymentMethod === 'trade_credit' ? userId : null,
      );
    if (result.changes === 1) return { reserved: true };
    const payment = load(params.idempotencyKey);
    if (!payment) throw new Error('Payment idempotency reservation disappeared');
    return { reserved: false, payment };
  };

  return {
    reservePreGateway(params) {
      return reserve({ ...params, status: 'prepared' });
    },
    persistQuote(params) {
      const quoteJson = serializePersistedCheckoutQuote(params.quote);
      const stored = load(params.idempotencyKey);
      if (!stored || stored.status !== 'prepared') return false;
      const quoteFacts = quotePaymentFacts(params.quote);
      const expectedMethod = normalizePaymentMethod(params.paymentMethod);
      const expectedCompany = normalizeCompanyId(params.companyId);
      const expectedUser = normalizeUserId(params.userId);
      // V10 is the current immutable snapshot. Its buyer identity must be explicitly carried by
      // the reservation hand-off; older V8/V9 card snapshots remain readable and replayable.
      if (isV10Quote(params.quote) && params.userId === undefined) {
        throw new Error('Checkout quote user must be bound to payment reservation');
      }
      if (
        quoteFacts.paymentMethod === 'trade_credit' &&
        (quoteFacts.userId === null || expectedUser === undefined || expectedUser === null)
      ) {
        throw new Error('Trade-credit quote requires an authenticated user binding');
      }
      if (
        stored.paymentMethod !== quoteFacts.paymentMethod ||
        stored.companyId !== quoteFacts.companyId ||
        (quoteFacts.paymentMethod === 'trade_credit' && stored.userId !== quoteFacts.userId) ||
        (params.paymentMethod !== undefined && expectedMethod !== quoteFacts.paymentMethod) ||
        (params.companyId !== undefined && expectedCompany !== quoteFacts.companyId) ||
        (params.userId !== undefined && expectedUser !== quoteFacts.userId) ||
        params.cartId !== params.quote.cartId
      ) {
        throw new Error('Checkout quote does not match payment reservation');
      }
      return (
        db
          .prepare(
            `UPDATE payments SET cart_id = ?, quote_json = ?, reservation_expires_at = ?, updated_at = ?
             WHERE idempotency_key = ? AND status = 'prepared'`,
          )
          .run(
            params.cartId,
            quoteJson,
            params.reservationExpiresAt,
            params.updatedAt,
            params.idempotencyKey,
          ).changes > 0
      );
    },
    load,
    transition(params) {
      if (!intentStatuses.has(params.expectedStatus) || !intentStatuses.has(params.nextStatus)) {
        throw new Error('Unsupported checkout intent state');
      }
      return (
        db
          .prepare(
            `UPDATE payments
             SET status = ?, order_id = COALESCE(?, order_id), amount_cents = COALESCE(?, amount_cents),
                 failure_reason = ?, gateway_reference = COALESCE(?, gateway_reference),
                 response_json = COALESCE(?, response_json),
                 reservation_expires_at = CASE WHEN ? = 'authorized_pending_finalize' THEN NULL ELSE reservation_expires_at END,
                 updated_at = ?
             WHERE idempotency_key = ? AND status = ?`,
          )
          .run(
            params.nextStatus,
            params.orderId ?? null,
            params.amountCents ?? null,
            params.failureReason ?? null,
            params.gatewayReference ?? null,
            params.responseJson ?? null,
            params.nextStatus,
            params.updatedAt,
            params.idempotencyKey,
            params.expectedStatus,
          ).changes > 0
      );
    },
  };
}
