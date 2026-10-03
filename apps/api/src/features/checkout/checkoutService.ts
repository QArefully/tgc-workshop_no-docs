import { getCart } from '../cart/cartService.js';
import type { Cart } from '@shop/contracts/cart';
import type { CartRepository } from '../cart/cartRepository.js';
import type { PostalAddress } from '@shop/contracts/address';
import type { Country } from '@shop/contracts/country';
import { countryProfile } from '@shop/contracts/country-profiles';
import type { PaymentMethod } from '@shop/contracts/payments';
import type { BillingEntitySnapshot } from '@shop/contracts/trade-account';
import type { ResolvedCustomBlendSnapshot } from '@shop/contracts/custom-blends';
import { isDeepStrictEqual } from 'node:util';
import { isSlotBookable } from '../delivery/deliverySlotRules.js';
import {
  normalizeOptionalText,
  normalizePostalAddress,
  normalizeText,
  isDeliverableCountryCode,
} from '../tradeAccount/addressRules.js';
import { toBillingEntitySnapshot } from '../tradeAccount/billingEntityRepository.js';
import { validateCard, type ValidCard } from '../payments/cardValidation.js';
import { createSafeFingerprint, type PaymentRecord } from '../payments/paymentRepository.js';
import { AUTHORITATIVE_CURRENCY } from '../payments/paymentGateway.js';
import {
  calculateDiscount,
  resolvePromoScope,
  validatePromo,
  type PromoValidation,
} from '../promos/promoService.js';
import { quoteCartDelivery } from '../delivery/deliveryRules.js';
import { createCheckoutQuote } from './checkoutQuote.js';
import { finalizeAuthorizedCheckout } from './checkoutFinalizer.js';
import { InventoryError } from '../inventory/inventoryTypes.js';
import { CreditAccountError } from '../tradeCredit/creditAccountService.js';
import { calculateInvoiceTotals } from '../tradeCredit/tradeCreditRules.js';
import {
  minimumOrderQuantity,
  resolveTierDiscountPct,
  validateMoq,
} from '../pricing/pricingRules.js';
import type { PreGatewayFailureCode } from '../audit/auditEvent.js';
import type {
  CheckoutDependencies,
  CheckoutParams,
  CheckoutResult,
  CheckoutService,
  ResolvedCheckoutCommitments,
} from './checkoutTypes.js';

export type {
  CheckoutDependencies,
  CheckoutParams,
  CheckoutResult,
  CheckoutService,
  ResolvedCheckoutCommitments,
} from './checkoutTypes.js';

type Preparation =
  | CheckoutResult
  | { quoteTotalCents: number; card: ValidCard; country: Country }
  | { resume: true; country: Country };
type PreparationStatus = 'prepared' | 'failed_pre_gateway';
type RequestedPaymentMethod = PaymentMethod | 'invalid';
type CreditPreparationError =
  | 'CREDIT_LIMIT_EXCEEDED'
  | 'CREDIT_ACCOUNT_ON_HOLD'
  | 'CREDIT_ACCOUNT_SUSPENDED'
  | 'CREDIT_NOT_ELIGIBLE'
  | 'CREDIT_PAYMENT_UNAVAILABLE'
  | 'COMPANY_REQUIRED'
  | 'PAYMENT_METHOD_INVALID'
  | 'CARD_FIELDS_FORBIDDEN'
  | 'NO_ACTIVE_MEMBERSHIP'
  | 'MEMBERSHIP_ROLE_NOT_ELIGIBLE';
type PaymentPreparationContext =
  | { paymentMethod: 'card'; card: ValidCard; companyId: null }
  | { paymentMethod: 'trade_credit'; card: null; companyId: number; userId: number };
const RESERVATION_LEASE_MS = 15 * 60_000;

function requestedPaymentMethod(params: CheckoutParams): RequestedPaymentMethod {
  const value = (params as { paymentMethod?: unknown }).paymentMethod;
  if (value === undefined || value === 'card') return 'card';
  if (value === 'trade_credit') return 'trade_credit';
  return 'invalid';
}

function hasCardFields(params: CheckoutParams): boolean {
  return (
    params.cardNumber !== undefined ||
    params.cardExpiry !== undefined ||
    params.cardCvc !== undefined
  );
}

function positiveCompanyId(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Company identity is resolved from the authenticated membership, never from checkout input. An
 * existing intent's stored company is a safe replay fallback: an authorized intent must remain
 * resumable even if the member is later retired before finalization retries.
 */
function resolveCreditCompanyId(
  params: CheckoutParams,
  existing: PaymentRecord | undefined,
  dependencies: CheckoutDependencies,
): number | null {
  if (existing?.paymentMethod === 'trade_credit' && existing.companyId !== null) {
    return existing.companyId;
  }
  if (params.userId === null || !Number.isSafeInteger(params.userId) || params.userId < 1)
    return null;
  const active = dependencies.companies?.findActiveByUser(params.userId);
  const activeCompanyId = positiveCompanyId(active?.company.id);
  if (activeCompanyId !== null) return activeCompanyId;
  // Keep direct service compositions useful while the app composition converges on the company
  // service. The member read is still server-owned and does not accept a caller company id.
  const member = dependencies.creditAccounts?.getMember?.(params.userId);
  return positiveCompanyId(member?.companyId);
}

function mapCreditFailure(
  error: CreditPreparationError,
  requestedCents: number,
  availableCreditCents?: number,
): CheckoutResult {
  switch (error) {
    case 'CREDIT_LIMIT_EXCEEDED':
      return {
        success: false,
        error,
        requestedCents,
        availableCreditCents: availableCreditCents ?? 0,
      };
    case 'CREDIT_ACCOUNT_ON_HOLD':
    case 'CREDIT_ACCOUNT_SUSPENDED':
    case 'CREDIT_NOT_ELIGIBLE':
    case 'CREDIT_PAYMENT_UNAVAILABLE':
    case 'COMPANY_REQUIRED':
    case 'PAYMENT_METHOD_INVALID':
    case 'CARD_FIELDS_FORBIDDEN':
      return { success: false, error };
    case 'NO_ACTIVE_MEMBERSHIP':
    case 'MEMBERSHIP_ROLE_NOT_ELIGIBLE':
      return { success: false, error: 'CREDIT_NOT_ELIGIBLE' };
    default:
      return { success: false, error: 'CHECKOUT_FAILED' };
  }
}

function mapCreditAccountError(error: CreditAccountError, requestedCents: number): CheckoutResult {
  switch (error.code) {
    case 'CREDIT_LIMIT_EXCEEDED':
      return mapCreditFailure(
        error.code,
        requestedCents,
        typeof error.meta?.availableCreditCents === 'number'
          ? error.meta.availableCreditCents
          : undefined,
      );
    case 'CREDIT_ACCOUNT_ON_HOLD':
    case 'CREDIT_ACCOUNT_SUSPENDED':
      return mapCreditFailure(error.code, requestedCents);
    case 'NO_ACTIVE_MEMBERSHIP':
    case 'MEMBERSHIP_ROLE_NOT_ELIGIBLE':
    case 'CREDIT_NOT_ELIGIBLE':
      return mapCreditFailure('CREDIT_NOT_ELIGIBLE', requestedCents);
    case 'IDEMPOTENCY_CONFLICT':
      return { success: false, error: 'IDEMPOTENT_CONFLICT' };
    default:
      return mapCreditFailure('CREDIT_PAYMENT_UNAVAILABLE', requestedCents);
  }
}

/** Releases a hold only while it is still in the prepared phase. */
function releasePreparedCreditHold(
  idempotencyKey: string,
  dependencies: CheckoutDependencies,
): void {
  if (!dependencies.creditAccounts) return;
  try {
    dependencies.creditAccounts.releaseHold(idempotencyKey, dependencies.clock.now().toISOString());
  } catch (error) {
    // A hold may already have been released by expiry maintenance. Other transitions are a real
    // invariant failure and must roll back the preparation transaction rather than being hidden.
    if (error instanceof CreditAccountError && error.code === 'HOLD_INVALID_TRANSITION') return;
    throw error;
  }
}

function preGatewayFailureCode(result: CheckoutResult): PreGatewayFailureCode {
  if (!result.success) {
    switch (result.error) {
      case 'CART_NOT_FOUND':
      case 'CART_EMPTY':
      case 'PROMO_INVALID':
      case 'PENDING_APPROVAL':
      case 'CHECKOUT_FAILED':
        return result.error;
    }
  }
  return 'CHECKOUT_FAILED';
}

function replay(
  payment: PaymentRecord,
  fingerprint: string,
  dependencies: CheckoutDependencies,
): Preparation {
  if (payment.fingerprint !== fingerprint) return { success: false, error: 'IDEMPOTENT_CONFLICT' };
  if (payment.status === 'prepared') return { success: false, error: 'IDEMPOTENT_IN_PROGRESS' };
  if (payment.status === 'authorized_pending_finalize') {
    const country = payment.cartId ? dependencies.carts.country(payment.cartId) : undefined;
    return country ? { resume: true, country } : { success: false, error: 'CART_NOT_FOUND' };
  }
  if (payment.status === 'succeeded' && payment.orderId !== null) {
    const order = dependencies.orders.findById(payment.orderId);
    return order ? { success: true, order } : { success: false, error: 'CHECKOUT_FAILED' };
  }
  if (payment.responseJson) {
    try {
      const result = JSON.parse(payment.responseJson) as CheckoutResult;
      if (typeof result === 'object' && result !== null && 'success' in result) return result;
    } catch {
      return { success: false, error: 'CHECKOUT_FAILED' };
    }
  }
  if (payment.status === 'declined') return { success: false, error: 'DECLINED' };
  if (payment.status === 'timed_out') return { success: false, error: 'TIMEOUT' };
  return { success: false, error: 'CHECKOUT_FAILED' };
}

function isPendingApprovalPayment(payment: PaymentRecord): boolean {
  if (payment.status !== 'failed_pre_gateway' || !payment.responseJson) return false;
  try {
    const result = JSON.parse(payment.responseJson) as { success?: unknown; error?: unknown };
    return result.success === false && result.error === 'PENDING_APPROVAL';
  } catch {
    return false;
  }
}

function quoteTotalBeforeReservation(
  cart: Cart,
  promo: PromoValidation | undefined,
  paymentMethod: PaymentMethod,
  country: Country,
): number {
  const validPromo = promo && promo.valid ? promo.promoCode : undefined;
  const promoScope = validPromo ? resolvePromoScope({ promo: validPromo, cart }) : undefined;
  const discountCents = validPromo
    ? calculateDiscount({
        promo: validPromo,
        discountableSubtotalCents: promoScope!.discountBaseCents,
      })
    : 0;
  const deliveryChargeCents = quoteCartDelivery(cart).chargeCents;
  if (paymentMethod === 'card') {
    return cart.subtotalCents - discountCents + deliveryChargeCents;
  }
  return calculateInvoiceTotals({
    merchandiseCents: cart.subtotalCents,
    promoDiscountCents: discountCents,
    deliveryCents: deliveryChargeCents,
    vatRateBasisPoints: countryProfile(country).vatRateBasisPoints,
  }).grossCents;
}

/**
 * Adapts the immutable resolver-backed cart to the promo service's legacy repository read. Promo
 * eligibility is still evaluated by the shared promo rules, but configured-line material prices
 * come from the resolver outcome rather than the base variant price; the one-off fee remains
 * separate in getCart's configured-line arithmetic.
 */
function promoValidationCartRepository(repository: CartRepository, cart: Cart): CartRepository {
  const resolvedLines = new Map(
    cart.items.map(
      (item) => [`${item.variantSnap?.variantId ?? 0}:${item.configKey}`, item] as const,
    ),
  );
  return {
    ...repository,
    listLines(cartId) {
      return repository.listLines(cartId).map((row) => {
        if (row.config_key === '') return row;
        const resolved = resolvedLines.get(`${row.variant_id}:${row.config_key}`);
        if (!resolved?.customBlend) return row;
        return {
          ...row,
          // Disable the base lot's standalone clearance for this projection: the resolver has
          // already selected each component's source/clearance price before blend math.
          // getCart applies the ordinary tier ladder to a source price. Invert that one
          // projection so the already component-tiered resolver total is not discounted twice.
          price_cents: inverseTierPriceForProjection(
            resolved.resolvedUnitPriceCents,
            row.quantity,
            row.variant_weight_grams,
          ),
          variant_clearance_price_cents: null,
          variant_clearance_starts_at: null,
          variant_clearance_ends_at: null,
        };
      });
    },
  };
}

/**
 * Return a source price which the legacy promo read path resolves back to an exact material unit
 * price. Component tiers can differ by percentage, so simply supplying the aggregate price would
 * apply the aggregate tier a second time. The resolver and pricing contracts use safe integers;
 * BigInt keeps this inverse safe at the upper boundary before getCart performs its normal check.
 */
function inverseTierPriceForProjection(
  resolvedUnitPriceCents: number,
  quantity: number,
  weightGrams: number,
): number {
  const discountPct = resolveTierDiscountPct(quantity, weightGrams);
  const multiplier = BigInt(100 - discountPct);
  if (multiplier <= 0n) throw new Error('Promo price projection has no positive tier multiplier.');

  const target = BigInt(resolvedUnitPriceCents);
  const floor = (target * 100n) / multiplier;
  const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
  for (const candidate of [floor - 1n, floor, floor + 1n, floor + 2n]) {
    if (candidate < 0n || candidate > maxSafe) continue;
    const rounded = (candidate * multiplier + 50n) / 100n;
    if (rounded === target && candidate * multiplier <= maxSafe) return Number(candidate);
  }
  throw new Error('Promo price projection could not preserve the resolved material price.');
}

/**
 * Resolves the buyer's delivery and billing commitments server-side and re-validates the submitted
 * slot, inside the preparation transaction and before any reservation is taken.
 *
 * A `saved` selection is loaded from the buyer's own live records: an unknown id, a retired record,
 * another user's record, and an anonymous checkout all collapse to the same failure so the response
 * cannot be used to probe which records exist. A client-supplied address is never consulted for a
 * saved selection.
 *
 * The slot is checked against a lead time re-derived from the live cart through the same service
 * that answered the slot endpoint, so an offered slot and an accepted slot cannot drift.
 */
function resolveCommitments(
  params: CheckoutParams,
  cartCountry: Country,
  dependencies: CheckoutDependencies,
): { resolved: ResolvedCheckoutCommitments } | { failure: CheckoutResult } {
  const destination = params.deliveryDestination;
  let deliverySiteId: number | null = null;
  let deliveryAddress: PostalAddress;
  if (destination.kind === 'saved') {
    if (params.userId === null)
      return { failure: { success: false, error: 'DELIVERY_SITE_NOT_FOUND' } };
    const siteId = Number(destination.deliverySiteId);
    const site = dependencies.tradeAccount.sites.get(params.userId, siteId);
    if (!site.ok) return { failure: { success: false, error: 'DELIVERY_SITE_NOT_FOUND' } };
    deliverySiteId = siteId;
    deliveryAddress = site.value.address;
  } else {
    // Saved addresses are normalized on the way into storage; an ad-hoc one is normalized here so
    // both destinations produce the same rendering and the same fingerprint for the same place.
    deliveryAddress = normalizePostalAddress(destination.address);
  }
  if (!isDeliverableCountryCode(countryProfile(cartCountry), deliveryAddress.countryCode)) {
    return { failure: { success: false, error: 'DELIVERY_COUNTRY_NOT_ALLOWED' } };
  }

  const billing = params.billingSelection;
  let billingEntity: BillingEntitySnapshot;
  if (billing.kind === 'saved') {
    if (params.userId === null)
      return { failure: { success: false, error: 'BILLING_ENTITY_INVALID' } };
    const entity = dependencies.tradeAccount.billingEntities.get(
      params.userId,
      Number(billing.billingEntityId),
    );
    if (!entity.ok) return { failure: { success: false, error: 'BILLING_ENTITY_INVALID' } };
    billingEntity = toBillingEntitySnapshot(entity.value);
  } else {
    billingEntity = {
      legalName: normalizeText(billing.billingEntity.legalName),
      registrationNumber: normalizeOptionalText(billing.billingEntity.registrationNumber),
      vatNumber: normalizeOptionalText(billing.billingEntity.vatNumber),
      address: normalizePostalAddress(billing.billingEntity.address),
    };
  }

  const options = dependencies.deliverySlots.optionsForCart(params.cartId);
  if (options === 'CART_NOT_FOUND') return { failure: { success: false, error: 'CART_NOT_FOUND' } };
  if (
    !isSlotBookable(
      params.deliverySlot,
      options.leadTime,
      dependencies.clock.now(),
      countryProfile(cartCountry),
    )
  ) {
    return {
      failure: {
        success: false,
        error: 'DELIVERY_SLOT_UNAVAILABLE',
        earliestDate: options.leadTime.earliestDate,
      },
    };
  }

  return {
    resolved: {
      deliverySiteId,
      deliveryAddress,
      billingEntity,
      deliverySlot: params.deliverySlot,
      purchaseOrderReference: normalizeOptionalText(params.purchaseOrderReference),
    },
  };
}

function prepare(
  params: CheckoutParams,
  method: PaymentPreparationContext,
  dependencies: CheckoutDependencies,
): Preparation {
  const fingerprint = createSafeFingerprint(
    method.paymentMethod === 'trade_credit'
      ? { ...params, paymentMethod: 'trade_credit', companyId: method.companyId }
      : params,
    method.card,
  );
  expirePreparedReservations(dependencies);
  const existing = dependencies.payments.load(params.idempotencyKey);
  const approvalRetry = existing !== undefined && isPendingApprovalPayment(existing);
  let preparationStatus: PreparationStatus = approvalRetry ? 'failed_pre_gateway' : 'prepared';
  if (existing) {
    if (existing.paymentMethod !== method.paymentMethod)
      return { success: false, error: 'IDEMPOTENT_CONFLICT' };
    if (existing.fingerprint !== fingerprint)
      return { success: false, error: 'IDEMPOTENT_CONFLICT' };
    if (!approvalRetry) return replay(existing, fingerprint, dependencies);
  }
  return dependencies.unitOfWork.run(() => {
    if (!approvalRetry) {
      const createdAt = dependencies.clock.now().toISOString();
      const reservation =
        method.paymentMethod === 'trade_credit'
          ? dependencies.payments.reservePreGateway({
              idempotencyKey: params.idempotencyKey,
              fingerprint,
              paymentMethod: 'trade_credit',
              companyId: method.companyId,
              userId: method.userId,
              createdAt,
            })
          : dependencies.payments.reservePreGateway({
              idempotencyKey: params.idempotencyKey,
              fingerprint,
              card: method.card,
              createdAt,
            });
      if (!reservation.reserved) return replay(reservation.payment, fingerprint, dependencies);
    }
    const cart = getCart(
      dependencies.carts,
      params.cartId,
      {
        inventory: dependencies.inventory,
        clock: dependencies.clock,
      },
      dependencies.customBlendResolver,
    );
    if (!cart)
      return failPreparation(
        params.idempotencyKey,
        // An existing cart that will not resolve was invalidated by its configured lines: the read
        // path refuses to price a blend whose facts are gone. Report that, not a missing cart.
        {
          success: false,
          error: dependencies.carts.exists(params.cartId)
            ? 'CUSTOM_BLEND_INVALID'
            : 'CART_NOT_FOUND',
        },
        params.auditContext,
        dependencies,
        preparationStatus,
      );
    const countryAvailability = cartLinesUnblocked(cart, dependencies);
    if (!countryAvailability.unblocked)
      return failPreparation(
        params.idempotencyKey,
        {
          success: false,
          error: 'BLOCKED_IN_COUNTRY',
          productIds: countryAvailability.productIds,
        },
        params.auditContext,
        dependencies,
        preparationStatus,
      );
    if (!customBlendLinesRemainEligible(cart, dependencies))
      return failPreparation(
        params.idempotencyKey,
        { success: false, error: 'CUSTOM_BLEND_INVALID' },
        params.auditContext,
        dependencies,
        preparationStatus,
      );
    if (cart.totalItems === 0)
      return failPreparation(
        params.idempotencyKey,
        { success: false, error: 'CART_EMPTY' },
        params.auditContext,
        dependencies,
        preparationStatus,
      );
    const minQuantity = cartMoqMinimumQuantity(cart, dependencies);
    if (minQuantity !== undefined)
      return failPreparation(
        params.idempotencyKey,
        { success: false, error: 'BELOW_MOQ', minQuantity },
        params.auditContext,
        dependencies,
        preparationStatus,
      );
    // Destination, billing party, and slot are settled here: every branch below this point may take
    // a cart, promo, or inventory reservation, and none of these failures may leave one held.
    // Read the identity country from the persisted cart row. Request headers and postal country
    // codes are intentionally irrelevant to this lookup.
    const cartCountry = dependencies.carts.country(params.cartId);
    if (!cartCountry)
      return failPreparation(
        params.idempotencyKey,
        { success: false, error: 'CART_NOT_FOUND' },
        params.auditContext,
        dependencies,
        preparationStatus,
      );
    const commitments = resolveCommitments(params, cartCountry, dependencies);
    if ('failure' in commitments)
      return failPreparation(
        params.idempotencyKey,
        commitments.failure,
        params.auditContext,
        dependencies,
        preparationStatus,
      );
    const promo = params.promoCode
      ? validatePromo(
          {
            code: params.promoCode,
            cartId: params.cartId,
            userId: params.userId,
            country: cartCountry,
            now: dependencies.clock.now(),
          },
          {
            promos: dependencies.promos,
            // Promo eligibility must inspect the same resolved material totals as the checkout
            // quote. The promo service remains a repository-bound API for legacy callers, so this
            // adapter projects the already-resolved cart into its read-only getCart path.
            carts: promoValidationCartRepository(dependencies.carts, cart),
          },
        )
      : undefined;
    if (promo && !promo.valid)
      return failPreparation(
        params.idempotencyKey,
        {
          success: false,
          error: 'PROMO_INVALID',
          promoError: promo.error,
          promoErrorCode: promo.errorCode,
          ...(promo.minSubtotalCents === undefined
            ? {}
            : { minSubtotalCents: promo.minSubtotalCents }),
        },
        params.auditContext,
        dependencies,
        preparationStatus,
      );
    const validPromo = promo?.valid ? promo.promoCode : undefined;
    // Approval must see the exact method-specific amount. Credit uses one invoice-level VAT
    // calculation in GBP pence; card retains the historical merchandise/discount/delivery total.
    const quoteTotalCents = quoteTotalBeforeReservation(
      cart,
      promo,
      method.paymentMethod,
      cartCountry,
    );
    const approval = dependencies.approvals?.evaluate({
      userId: params.userId,
      cartId: params.cartId,
      quoteTotalCents,
      resolvedCommitments: commitments.resolved,
      idempotencyKey: params.idempotencyKey,
      context: params.auditContext,
    });
    if (approval?.gate === 'defer')
      return failPreparation(
        params.idempotencyKey,
        {
          success: false,
          error: 'PENDING_APPROVAL',
          approvalRequestId: approval.approvalRequestId,
        },
        params.auditContext,
        dependencies,
        preparationStatus,
      );
    if (approval?.gate === 'rejected')
      return failPreparation(
        params.idempotencyKey,
        { success: false, error: 'APPROVAL_REJECTED' },
        params.auditContext,
        dependencies,
        preparationStatus,
      );
    if (approval?.gate === 'expired')
      return failPreparation(
        params.idempotencyKey,
        { success: false, error: 'APPROVAL_EXPIRED' },
        params.auditContext,
        dependencies,
        preparationStatus,
      );
    if (approval?.gate === 'total-drift')
      return failPreparation(
        params.idempotencyKey,
        { success: false, error: 'APPROVAL_TOTAL_DRIFT' },
        params.auditContext,
        dependencies,
        preparationStatus,
      );
    if (approval?.gate === 'requester-mismatch')
      return { success: false, error: 'CHECKOUT_FAILED' };
    if (approvalRetry) {
      if (approval?.gate !== 'approved-retry') return { success: false, error: 'CHECKOUT_FAILED' };
      if (
        !dependencies.payments.transition({
          idempotencyKey: params.idempotencyKey,
          expectedStatus: 'failed_pre_gateway',
          nextStatus: 'prepared',
          ...(method.paymentMethod === 'trade_credit' ? { amountCents: quoteTotalCents } : {}),
          updatedAt: dependencies.clock.now().toISOString(),
        })
      ) {
        const current = dependencies.payments.load(params.idempotencyKey);
        return current
          ? replay(current, fingerprint, dependencies)
          : { success: false, error: 'CHECKOUT_FAILED' };
      }
      preparationStatus = 'prepared';
    }
    const createdAt = dependencies.clock.now().toISOString();
    const reservationExpiresAt = new Date(
      Date.parse(createdAt) + RESERVATION_LEASE_MS,
    ).toISOString();

    // Credit exposure is a second money-side reservation. It is acquired only after all buyer,
    // cart, delivery, promo, and approval gates have passed, while the payment amount is already
    // set to the exact gross invoice total required by the hold repository.
    let creditHoldPrepared = false;
    if (method.paymentMethod === 'trade_credit') {
      if (!dependencies.creditAccounts) {
        return failPreparation(
          params.idempotencyKey,
          { success: false, error: 'CREDIT_PAYMENT_UNAVAILABLE' },
          params.auditContext,
          dependencies,
          preparationStatus,
        );
      }
      if (
        !dependencies.payments.transition({
          idempotencyKey: params.idempotencyKey,
          expectedStatus: 'prepared',
          nextStatus: 'prepared',
          amountCents: quoteTotalCents,
          updatedAt: createdAt,
        })
      ) {
        const current = dependencies.payments.load(params.idempotencyKey);
        return current
          ? replay(current, fingerprint, dependencies)
          : { success: false, error: 'CHECKOUT_FAILED' };
      }

      let creditFailure: CheckoutResult | undefined;
      try {
        const acquired = dependencies.creditAccounts.tryAcquireHoldInTransaction(method.userId, {
          paymentIdempotencyKey: params.idempotencyKey,
          companyId: method.companyId,
          amountCents: quoteTotalCents,
          createdAt,
          expiresAt: reservationExpiresAt,
        });
        if (!acquired.ok) {
          creditFailure = mapCreditFailure(
            acquired.code,
            quoteTotalCents,
            acquired.availableCreditCents,
          );
        } else if (acquired.hold.status !== 'prepared') {
          // An approval retry cannot legitimately encounter an already-authorized hold because
          // pending approval creates no hold. Treat any such persisted drift as a deterministic
          // idempotency failure rather than extending exposure silently.
          creditFailure = { success: false, error: 'IDEMPOTENT_CONFLICT' };
        } else {
          creditHoldPrepared = true;
        }
      } catch (error) {
        if (error instanceof CreditAccountError) {
          creditFailure = mapCreditAccountError(error, quoteTotalCents);
        } else {
          throw error;
        }
      }
      if (creditFailure) {
        return failPreparation(
          params.idempotencyKey,
          creditFailure,
          params.auditContext,
          dependencies,
          preparationStatus,
        );
      }
    }

    if (!dependencies.carts.reserve(params.cartId, params.idempotencyKey, createdAt)) {
      if (creditHoldPrepared) releasePreparedCreditHold(params.idempotencyKey, dependencies);
      return failPreparation(
        params.idempotencyKey,
        { success: false, error: 'CHECKOUT_FAILED' },
        params.auditContext,
        dependencies,
        preparationStatus,
      );
    }
    if (
      validPromo &&
      !dependencies.promos.reserve({
        code: validPromo.code,
        userId: params.userId,
        paymentIdempotencyKey: params.idempotencyKey,
        createdAt,
      })
    ) {
      dependencies.carts.releaseReservation(params.idempotencyKey);
      if (creditHoldPrepared) releasePreparedCreditHold(params.idempotencyKey, dependencies);
      return failPreparation(
        params.idempotencyKey,
        { success: false, error: 'PROMO_INVALID' },
        params.auditContext,
        dependencies,
        preparationStatus,
      );
    }
    let inventoryAllocations;
    try {
      inventoryAllocations = dependencies.inventory.reserveCheckout({
        paymentIdempotencyKey: params.idempotencyKey,
        demands: cart.items.map((item) => ({
          variantId: item.variantSnap?.variantId ?? 0,
          quantity: item.quantity,
        })),
        now: createdAt,
        expiresAt: reservationExpiresAt,
      });
    } catch (error) {
      dependencies.carts.releaseReservation(params.idempotencyKey);
      dependencies.promos.releaseReservation(params.idempotencyKey);
      if (creditHoldPrepared) releasePreparedCreditHold(params.idempotencyKey, dependencies);
      if (error instanceof InventoryError && error.code === 'INSUFFICIENT_STOCK') {
        return failPreparation(
          params.idempotencyKey,
          {
            success: false,
            error: 'INSUFFICIENT_STOCK',
            productIds: error.variantIds.map(String),
          },
          params.auditContext,
          dependencies,
          preparationStatus,
        );
      }
      throw error;
    }
    const quote = createCheckoutQuote({
      cart,
      checkout:
        method.paymentMethod === 'trade_credit'
          ? {
              ...params,
              paymentMethod: 'trade_credit',
              companyId: method.companyId,
              terms: 'net_30' as const,
              termsDays: 30 as const,
            }
          : { ...params, paymentMethod: 'card' as const },
      resolved: commitments.resolved,
      promo: validPromo,
      createdAt,
      inventoryAllocations,
      // Cart identity country is resolved from persistence above; freeze that server fact in V10
      // rather than allowing quote compatibility fields to fall back to a default.
      country: cartCountry,
      paymentMethod: method.paymentMethod,
      userId: params.userId,
      ...(method.paymentMethod === 'trade_credit'
        ? {
            companyId: method.companyId,
            terms: 'net_30' as const,
            termsDays: 30 as const,
          }
        : {}),
    });
    if (
      !dependencies.payments.persistQuote({
        idempotencyKey: params.idempotencyKey,
        cartId: params.cartId,
        quote,
        updatedAt: createdAt,
        reservationExpiresAt,
        paymentMethod: method.paymentMethod,
        ...(method.paymentMethod === 'trade_credit' ? { companyId: method.companyId } : {}),
        userId: params.userId,
      })
    ) {
      throw new Error('Checkout intent quote persistence failed');
    }
    if (method.paymentMethod === 'trade_credit') {
      try {
        dependencies.inventory.authorizeReservation(params.idempotencyKey, createdAt);
      } catch (error) {
        if (!(error instanceof InventoryError) || error.code !== 'RESERVATION_EXPIRED') throw error;
        return terminalizePreparedExpiry(
          params.idempotencyKey,
          reservationExpiresAt,
          createdAt,
          dependencies,
        );
      }
      try {
        dependencies.creditAccounts!.authorizeHold(params.idempotencyKey, createdAt);
      } catch (error) {
        if (!(error instanceof CreditAccountError) || error.code !== 'HOLD_INVALID_TRANSITION')
          throw error;
        return terminalizePreparedExpiry(
          params.idempotencyKey,
          reservationExpiresAt,
          createdAt,
          dependencies,
        );
      }
      if (
        !dependencies.payments.transition({
          idempotencyKey: params.idempotencyKey,
          expectedStatus: 'prepared',
          nextStatus: 'authorized_pending_finalize',
          amountCents: quote.totalCents,
          updatedAt: createdAt,
        })
      ) {
        throw new Error('Checkout intent state changed during credit authorization');
      }
      return { resume: true, country: cartCountry };
    }
    return { quoteTotalCents: quote.totalCents, card: method.card, country: cartCountry };
  });
}

/**
 * Re-resolves every configured line against live catalog facts inside the preparation
 * transaction, before any reservation or gateway call. Checkout owns this gate rather than
 * trusting the cart read path: a lot retired between configuration and payment must stop the
 * charge, and it must stop it with no inventory mutation and no money movement.
 */
function customBlendLinesRemainEligible(cart: Cart, dependencies: CheckoutDependencies): boolean {
  const resolver = dependencies.customBlendResolver;
  // A configured line has no authoritative price without the resolver. Plain-only direct callers
  // remain compatible, but checkout never accepts a legacy configured line through this path.
  return cart.items.every((item) => {
    const blend = item.customBlend;
    if (!blend) return item.configKey === '' && item.blendingFeeCents === 0;
    if (!resolver) return false;
    const baseVariantId = item.variantSnap?.variantId;
    if (baseVariantId === undefined) return false;
    try {
      const resolved = resolver.rehydrate(baseVariantId, blend, item.quantity);
      return resolvedCustomBlendLineMatches(item, resolved);
    } catch {
      return false;
    }
  });
}

/**
 * The cart is a read model, not a checkout commitment. Rehydrating a line again at its current
 * quantity and comparing every resolved field closes the gap between those two boundaries: a
 * changed lot, classification, compatibility verdict, component price, or tier cannot be charged
 * merely because the cart read happened to succeed.
 */
function resolvedCustomBlendLineMatches(
  item: Cart['items'][number],
  resolved: ResolvedCustomBlendSnapshot,
): boolean {
  const current = item.customBlend;
  if (
    !current ||
    !('ruleVersion' in current) ||
    current.ruleVersion !== resolved.ruleVersion ||
    item.configKey !== resolved.configKey ||
    item.quantity !== resolved.quantity ||
    item.product.consumptionClassification !== resolved.resultClassification ||
    item.resolvedUnitPriceCents !== resolved.materialUnitPriceCents ||
    item.materialSubtotalCents !== resolved.materialSubtotalCents ||
    item.discountableTotalCents !== resolved.discountableTotalCents ||
    item.blendingFeeCents !== resolved.blendingFeeCents ||
    item.lineTotalCents !== resolved.lineTotalCents
  ) {
    return false;
  }

  // Components include the live classification, source/clearance price, tier, weights, and
  // integer-pence contribution. Comparing the complete snapshot also covers the config key,
  // ingredient facts, and resolved result classification without a stale same-group shortcut.
  return isDeepStrictEqual(current, resolved);
}

function cartMoqMinimumQuantity(
  cart: Cart,
  dependencies: CheckoutDependencies,
): number | undefined {
  for (const item of cart.items) {
    const variantId = item.variantSnap?.variantId;
    if (!variantId) throw new Error('Cart line is missing its variant identity');
    const variant = dependencies.carts.getVariant(variantId);
    if (!variant) throw new Error('Cart line variant could not be resolved');
    if (
      variant.active !== 1 ||
      !validateMoq(item.quantity, variant.weight_grams, variant.moq_sacks)
    ) {
      const minQuantity = minimumOrderQuantity(variant.weight_grams, variant.moq_sacks);
      if (minQuantity === undefined) throw new Error('Cart line MOQ could not be resolved');
      return minQuantity;
    }
  }
  return undefined;
}

function cartLinesUnblocked(
  cart: Cart,
  dependencies: CheckoutDependencies,
): { unblocked: true } | { unblocked: false; productIds: string[] } {
  const countryProfiles = dependencies.countryProfiles;
  if (!countryProfiles) return { unblocked: true };

  const lineVariantIds = cart.items.map((item) => [
    ...(item.variantSnap ? [item.variantSnap.variantId] : []),
    ...(item.customBlend?.ingredients.map((ingredient) => ingredient.variantId) ?? []),
  ]);
  const facts = dependencies.carts.listCountryVariantFacts(cart.id, lineVariantIds.flat());
  const blockedVariantIds = new Set(
    facts
      .filter(
        (fact) =>
          countryProfiles.isCategoryBlocked(fact.country, fact.product_category) ||
          countryProfiles.isProductBlocked(fact.country, fact.product_slug),
      )
      .map((fact) => fact.variant_id),
  );
  const productIds = [
    ...new Set(
      cart.items
        .filter((_item, index) =>
          lineVariantIds[index]!.some((variantId) => blockedVariantIds.has(variantId)),
        )
        .map((item) => item.productId),
    ),
  ];
  return productIds.length === 0 ? { unblocked: true } : { unblocked: false, productIds };
}

function failPreparation(
  idempotencyKey: string,
  result: CheckoutResult,
  context: CheckoutParams['auditContext'],
  dependencies: CheckoutDependencies,
  expectedStatus: PreparationStatus,
): CheckoutResult {
  const transitioned = dependencies.payments.transition({
    idempotencyKey,
    expectedStatus,
    nextStatus: 'failed_pre_gateway',
    failureReason: result.success ? null : result.error,
    responseJson: JSON.stringify(result),
    updatedAt: dependencies.clock.now().toISOString(),
  });
  if (transitioned) {
    const payment = dependencies.payments.load(idempotencyKey);
    if (!payment) throw new Error('Checkout intent disappeared after pre-gateway failure');
    dependencies.audit.append({
      action: 'payment.pre_gateway_failed',
      context,
      paymentId: payment.id,
      errorCode: preGatewayFailureCode(result),
    });
  }
  return result;
}

function providerFailure(
  idempotencyKey: string,
  status: 'declined' | 'timeout',
  context: CheckoutParams['auditContext'],
  dependencies: CheckoutDependencies,
): CheckoutResult {
  return dependencies.unitOfWork.run(() => {
    const result: CheckoutResult = {
      success: false,
      error: status === 'declined' ? 'DECLINED' : 'TIMEOUT',
    };
    const transitioned = dependencies.payments.transition({
      idempotencyKey,
      expectedStatus: 'prepared',
      nextStatus: status === 'declined' ? 'declined' : 'timed_out',
      failureReason: result.error,
      responseJson: JSON.stringify(result),
      updatedAt: dependencies.clock.now().toISOString(),
    });
    dependencies.carts.releaseReservation(idempotencyKey);
    dependencies.promos.releaseReservation(idempotencyKey);
    dependencies.inventory.releaseReservation(idempotencyKey);
    if (transitioned) {
      const payment = dependencies.payments.load(idempotencyKey);
      if (!payment) throw new Error('Checkout intent disappeared after provider failure');
      dependencies.audit.append({
        action: status === 'declined' ? 'payment.declined' : 'payment.timed_out',
        context,
        paymentId: payment.id,
      });
    }
    return result;
  });
}

export function createCheckoutService(dependencies: CheckoutDependencies): CheckoutService {
  return {
    async process(params) {
      const paymentMethod = requestedPaymentMethod(params);
      if (paymentMethod === 'invalid') return { success: false, error: 'PAYMENT_METHOD_INVALID' };
      if (paymentMethod === 'trade_credit') {
        if (hasCardFields(params)) return { success: false, error: 'CARD_FIELDS_FORBIDDEN' };
        const userId = params.userId;
        if (userId === null) return { success: false, error: 'COMPANY_REQUIRED' };
        if (!dependencies.creditAccounts)
          return { success: false, error: 'CREDIT_PAYMENT_UNAVAILABLE' };
        const existing = dependencies.payments.load(params.idempotencyKey);
        const companyId = resolveCreditCompanyId(params, existing, dependencies);
        if (companyId === null) return { success: false, error: 'CREDIT_NOT_ELIGIBLE' };
        const prepared = prepare(
          params,
          { paymentMethod: 'trade_credit', card: null, companyId, userId },
          dependencies,
        );
        if ('success' in prepared) return prepared;
        if ('resume' in prepared)
          return resumeFinalization(
            dependencies,
            params.idempotencyKey,
            params.auditContext,
            prepared.country,
            selectedDeliverySiteId(params),
          );
        return { success: false, error: 'CHECKOUT_FAILED' };
      }

      const card = validateCard({
        cardNumber: params.cardNumber ?? '',
        cardExpiry: params.cardExpiry ?? '',
        cardCvc: params.cardCvc ?? '',
        now: dependencies.clock.now(),
      });
      if (!card) return { success: false, error: 'CARD_INVALID' };
      const prepared = prepare(
        params,
        { paymentMethod: 'card', card, companyId: null },
        dependencies,
      );
      if ('success' in prepared) return prepared;
      if ('resume' in prepared)
        return resumeFinalization(
          dependencies,
          params.idempotencyKey,
          params.auditContext,
          prepared.country,
          selectedDeliverySiteId(params),
        );
      const gatewayResult = await dependencies.gateway.process({
        idempotencyKey: params.idempotencyKey,
        amountCents: prepared.quoteTotalCents,
        currency: AUTHORITATIVE_CURRENCY,
        cardNumber: prepared.card.digits,
      });
      if (gatewayResult.status !== 'success')
        return providerFailure(
          params.idempotencyKey,
          gatewayResult.status,
          params.auditContext,
          dependencies,
        );
      const authorization = dependencies.unitOfWork.run(() => {
        const now = dependencies.clock.now().toISOString();
        const payment = dependencies.payments.load(params.idempotencyKey);
        if (!payment || payment.status !== 'prepared') return { authorized: false } as const;
        if (payment.reservationExpiresAt !== null && payment.reservationExpiresAt <= now) {
          return {
            authorized: false,
            expired: terminalizePreparedExpiry(
              params.idempotencyKey,
              payment.reservationExpiresAt,
              now,
              dependencies,
            ),
          } as const;
        }
        try {
          dependencies.inventory.authorizeReservation(params.idempotencyKey, now);
        } catch (error) {
          if (!(error instanceof InventoryError) || error.code !== 'RESERVATION_EXPIRED')
            throw error;
          return {
            authorized: false,
            expired: terminalizePreparedExpiry(
              params.idempotencyKey,
              payment.reservationExpiresAt ?? now,
              now,
              dependencies,
            ),
          } as const;
        }
        if (
          !dependencies.payments.transition({
            idempotencyKey: params.idempotencyKey,
            expectedStatus: 'prepared',
            nextStatus: 'authorized_pending_finalize',
            gatewayReference: gatewayResult.reference,
            updatedAt: now,
          })
        ) {
          throw new Error('Checkout intent state changed during authorization');
        }
        return { authorized: true } as const;
      });
      if (authorization.expired) return authorization.expired;
      if (!authorization.authorized) {
        return replay(
          dependencies.payments.load(params.idempotencyKey)!,
          createSafeFingerprint(params, card),
          dependencies,
        ) as CheckoutResult;
      }
      return resumeFinalization(
        dependencies,
        params.idempotencyKey,
        params.auditContext,
        prepared.country,
        selectedDeliverySiteId(params),
      );
    },
  };
}

function expirePreparedReservations(dependencies: CheckoutDependencies): void {
  const now = dependencies.clock.now().toISOString();
  dependencies.unitOfWork.run(() => {
    for (const idempotencyKey of dependencies.inventory.expirePrepared(now)) {
      const payment = dependencies.payments.load(idempotencyKey);
      if (!payment || payment.status !== 'prepared') continue;
      terminalizePreparedExpiry(
        idempotencyKey,
        payment.reservationExpiresAt ?? now,
        now,
        dependencies,
      );
    }
  });
}

function terminalizePreparedExpiry(
  idempotencyKey: string,
  reservationExpiresAt: string,
  now: string,
  dependencies: CheckoutDependencies,
): CheckoutResult {
  const result: CheckoutResult = {
    success: false,
    error: 'RESERVATION_EXPIRED',
    reservationExpiresAt,
  };
  if (
    !dependencies.payments.transition({
      idempotencyKey,
      expectedStatus: 'prepared',
      nextStatus: 'failed_pre_gateway',
      failureReason: result.error,
      responseJson: JSON.stringify(result),
      updatedAt: now,
    })
  ) {
    throw new Error('Checkout intent state changed during reservation expiry');
  }
  dependencies.carts.releaseReservation(idempotencyKey);
  dependencies.promos.releaseReservation(idempotencyKey);
  dependencies.inventory.releaseReservation(idempotencyKey);
  if (dependencies.payments.load(idempotencyKey)?.paymentMethod === 'trade_credit') {
    releasePreparedCreditHold(idempotencyKey, dependencies);
  }
  return result;
}

/**
 * The saved site an order should reference, taken from the request rather than the persisted quote:
 * the quote snapshots the resolved address, not the record it came from. Safe on the resume path
 * because the caller reaches it only after the request fingerprint matched the original attempt.
 */
function selectedDeliverySiteId(params: CheckoutParams): number | null {
  return params.deliveryDestination.kind === 'saved'
    ? Number(params.deliveryDestination.deliverySiteId)
    : null;
}

function resumeFinalization(
  dependencies: CheckoutDependencies,
  idempotencyKey: string,
  auditContext: CheckoutParams['auditContext'],
  country: Country,
  deliverySiteId: number | null,
): CheckoutResult {
  try {
    return finalizeAuthorizedCheckout(
      dependencies,
      idempotencyKey,
      auditContext,
      country,
      deliverySiteId,
    );
  } catch {
    // Authorization was committed separately; preserve it for same-key retry.
    return { success: false, error: 'IDEMPOTENT_IN_PROGRESS' };
  }
}
