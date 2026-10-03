import { Type, type Static } from '@sinclair/typebox';
import { TypeSystem } from '@sinclair/typebox/system';
import { Value } from '@sinclair/typebox/value';
import {
  CustomerName,
  EmailAddress,
  MoneyCents,
  PositiveIntegerString,
  PromoCodeValue,
  PurchaseOrderReference,
  Uuid,
} from './common.js';
import { PlaceOrderResponse } from './orders.js';
import { DeliveryClass, DeliveryDate, DeliverySlot, DeliverySummary } from './delivery.js';
import {
  CustomBlendSnapshot,
  LegacyCustomBlendSnapshot,
  ResolvedCustomBlendSnapshot,
} from './customBlends.js';
import { PostalAddress } from './address.js';
import { BillingEntityInput, BillingEntitySnapshot } from './tradeAccount.js';
import { PendingApprovalResult } from './orderApprovals.js';
import {
  CreditUtcIsoInstant,
  PaymentMethod as PaymentMethodSchema,
  type PaymentMethod as PaymentMethodType,
  TradeCreditPaymentMethod,
  TradeCreditTerms,
  TradeCreditTermsDays,
} from './tradeCredit.js';
import { Country } from './country.js';

/**
 * Where the consignment goes. Discriminated on `kind`: a `saved` selection carries only an
 * identifier, because the server loads the stored site and ignores any client-supplied address.
 */
export const DeliveryDestination = Type.Union([
  Type.Object(
    { kind: Type.Literal('saved'), deliverySiteId: PositiveIntegerString },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal('adhoc'), address: PostalAddress },
    { additionalProperties: false },
  ),
]);
export type DeliveryDestination = Static<typeof DeliveryDestination>;

/** Who is billed. Same discriminated shape and same server-authoritative resolution rule. */
export const BillingSelection = Type.Union([
  Type.Object(
    { kind: Type.Literal('saved'), billingEntityId: PositiveIntegerString },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal('adhoc'), billingEntity: BillingEntityInput },
    { additionalProperties: false },
  ),
]);
export type BillingSelection = Static<typeof BillingSelection>;

const PaymentCommonFields = {
  cartId: Uuid,
  promoCode: Type.Optional(PromoCodeValue),
  customerName: CustomerName,
  customerEmail: EmailAddress,
  deliveryDestination: DeliveryDestination,
  billingSelection: BillingSelection,
  deliverySlot: DeliverySlot,
  purchaseOrderReference: Type.Optional(PurchaseOrderReference),
  idempotencyKey: Uuid,
} as const;

const CardNumber = Type.String({ minLength: 12, maxLength: 25, pattern: '^[0-9 -]+$' });
const CardExpiry = Type.String({ pattern: '^(0[1-9]|1[0-2])/[0-9]{2}$' });
const CardCvc = Type.String({ pattern: '^[0-9]{3,4}$' });

/** Payment method discriminator. Omitted method is the historic simulated-card wire shape. */
export const PaymentMethod = PaymentMethodSchema;
export type PaymentMethod = PaymentMethodType;

/** Historical card body. It stays open so old callers' ignored fields remain wire-compatible. */
export const CardPaymentBody = Type.Object({
  ...PaymentCommonFields,
  paymentMethod: Type.Optional(Type.Literal('card')),
  cardNumber: CardNumber,
  cardExpiry: CardExpiry,
  cardCvc: CardCvc,
});
export type CardPaymentBody = Static<typeof CardPaymentBody>;

/** Trade-credit body is intentionally closed: card PAN, expiry, and CVC cannot cross this branch. */
export const TradeCreditPaymentBody = Type.Object(
  {
    ...PaymentCommonFields,
    paymentMethod: TradeCreditPaymentMethod,
  },
  { additionalProperties: false },
);
export type TradeCreditPaymentBody = Static<typeof TradeCreditPaymentBody>;

/** Checkout accepts the old card shape plus one strict company-credit discriminator branch. */
export const PaymentBody = Type.Union([CardPaymentBody, TradeCreditPaymentBody]);
export type PaymentBody = Static<typeof PaymentBody>;
/** Descriptive aliases for routes that call this payload a checkout request. */
export const CheckoutPaymentBody = PaymentBody;
export type CheckoutPaymentBody = PaymentBody;
export const CheckoutRequest = PaymentBody;
export type CheckoutRequest = PaymentBody;

export const PaymentFailureReason = Type.Union([
  Type.Literal('CARD_DECLINED'),
  Type.Literal('GATEWAY_TIMEOUT'),
]);
export type PaymentFailureReason = Static<typeof PaymentFailureReason>;
export const PaymentErrorResponse = Type.Object({
  error: Type.String({ minLength: 1, maxLength: 500 }),
  failureReason: Type.Optional(PaymentFailureReason),
});
export type PaymentErrorResponse = Static<typeof PaymentErrorResponse>;

const PaymentConflictFallbackError = Type.String({
  minLength: 1,
  maxLength: 500,
  // Detail-bearing conflict codes must select their dedicated schema. Generic legacy messages
  // remain valid, but cannot make a required detail field optional through the catch-all member.
  pattern:
    '^(?!(?:RESERVATION_EXPIRED|INSUFFICIENT_STOCK|BLOCKED_IN_COUNTRY|DELIVERY_SLOT_UNAVAILABLE|PENDING_APPROVAL|APPROVAL_REJECTED|APPROVAL_EXPIRED|APPROVAL_TOTAL_DRIFT|CUSTOM_BLEND_INVALID|CREDIT_LIMIT_EXCEEDED|CREDIT_ACCOUNT_ON_HOLD|CREDIT_ACCOUNT_SUSPENDED|CREDIT_NOT_ELIGIBLE)$).+$',
});

export const PaymentConflictResponse = Type.Union([
  Type.Object(
    {
      error: Type.Literal('RESERVATION_EXPIRED'),
      reservationExpiresAt: Type.String(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      error: Type.Literal('INSUFFICIENT_STOCK'),
      productIds: Type.Array(PositiveIntegerString, { minItems: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      error: Type.Literal('BLOCKED_IN_COUNTRY'),
      productIds: Type.Array(PositiveIntegerString, { minItems: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      error: Type.Literal('DELIVERY_SLOT_UNAVAILABLE'),
      earliestDate: DeliveryDate,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      error: Type.Literal('PENDING_APPROVAL'),
      approvalRequestId: PositiveIntegerString,
    },
    { additionalProperties: false },
  ),
  Type.Object({ error: Type.Literal('APPROVAL_REJECTED') }, { additionalProperties: false }),
  Type.Object({ error: Type.Literal('APPROVAL_EXPIRED') }, { additionalProperties: false }),
  Type.Object({ error: Type.Literal('APPROVAL_TOTAL_DRIFT') }, { additionalProperties: false }),
  Type.Object({ error: Type.Literal('CUSTOM_BLEND_INVALID') }, { additionalProperties: false }),
  Type.Object(
    {
      error: Type.Literal('CREDIT_LIMIT_EXCEEDED'),
      requestedCents: MoneyCents,
      availableCreditCents: MoneyCents,
    },
    { additionalProperties: false },
  ),
  Type.Object({ error: Type.Literal('CREDIT_ACCOUNT_ON_HOLD') }, { additionalProperties: false }),
  Type.Object({ error: Type.Literal('CREDIT_ACCOUNT_SUSPENDED') }, { additionalProperties: false }),
  Type.Object({ error: Type.Literal('CREDIT_NOT_ELIGIBLE') }, { additionalProperties: false }),
  Type.Object({ error: PaymentConflictFallbackError }),
]);
export type PaymentConflictResponse = Static<typeof PaymentConflictResponse>;

/**
 * Buyer identity plus resolved destination. `shippingAddress` is the `formatPostalAddress`
 * rendering of `deliveryAddress`, retained so the legacy free-text order column has exactly one
 * source and cannot drift from the structured value.
 */
const PersistedCheckoutCustomer = Type.Object(
  {
    name: Type.String(),
    email: Type.String(),
    deliveryAddress: PostalAddress,
    shippingAddress: Type.String(),
  },
  { additionalProperties: false },
);

const PersistedCheckoutLine = Type.Object(
  {
    productId: PositiveIntegerString,
    productName: Type.String(),
    unitPriceCents: MoneyCents,
    quantity: Type.Integer({ minimum: 1 }),
    lineTotalCents: MoneyCents,
  },
  { additionalProperties: false },
);

const PersistedCheckoutQuoteFields = {
  cartId: Uuid,
  customer: PersistedCheckoutCustomer,
  userId: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  promoCode: Type.Union([Type.String(), Type.Null()]),
  subtotalCents: MoneyCents,
  discountCents: MoneyCents,
  totalCents: MoneyCents,
  lines: Type.Array(PersistedCheckoutLine),
  createdAt: Type.String(),
};

const PersistedInventoryAllocation = Type.Object(
  {
    productId: PositiveIntegerString,
    reservedQuantity: Type.Integer({ minimum: 0 }),
    backorderedQuantity: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

const PersistedCheckoutVariantLineFields = {
  productId: PositiveIntegerString,
  variantId: Type.Integer({ minimum: 1 }),
  productName: Type.String(),
  variantLabel: Type.String({ minLength: 1, maxLength: 160 }),
  unitPriceCents: MoneyCents,
  weightGrams: Type.Integer({ minimum: 1 }),
  deliveryClass: DeliveryClass,
  quantity: Type.Integer({ minimum: 1 }),
  materialSubtotalCents: Type.Optional(MoneyCents),
  blendingFeeCents: Type.Optional(MoneyCents),
  discountableTotalCents: Type.Optional(MoneyCents),
  lineTotalCents: MoneyCents,
  consumptionClassification: Type.String(),
} as const;

/** Historical V7 line shape. The broad snapshot union is retained for old callers. */
const PersistedCheckoutVariantLineV7 = Type.Object(
  {
    ...PersistedCheckoutVariantLineFields,
    customBlend: Type.Optional(CustomBlendSnapshot),
  },
  { additionalProperties: false },
);

/** V8 freezes configured lines to the specification-only snapshot used by prepared intents. */
const PersistedCheckoutVariantLineV8 = Type.Object(
  {
    ...PersistedCheckoutVariantLineFields,
    customBlend: Type.Optional(LegacyCustomBlendSnapshot),
  },
  { additionalProperties: false },
);

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function safeProduct(left: unknown, right: unknown): number | undefined {
  if (!isSafeNonNegativeInteger(left) || !isSafeNonNegativeInteger(right)) return undefined;
  if (right > 0 && left > Math.floor(Number.MAX_SAFE_INTEGER / right)) return undefined;
  const result = left * right;
  return Number.isSafeInteger(result) ? result : undefined;
}

function safeSum(values: readonly unknown[]): number | undefined {
  let total = 0;
  for (const value of values) {
    if (!isSafeNonNegativeInteger(value) || value > Number.MAX_SAFE_INTEGER - total)
      return undefined;
    total += value;
  }
  return total;
}

/**
 * A V9 configured line duplicates the resolved outcome's money at the line boundary. Keeping the
 * pair exact prevents a valid snapshot from being attached to a different charged amount.
 */
const PersistedCheckoutVariantLineV9Integrity = TypeSystem.Type<unknown>(
  'PersistedCheckoutVariantLineV9Integrity',
  (_options, value) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const line = value as {
      productId?: unknown;
      variantId?: unknown;
      productName?: unknown;
      unitPriceCents?: unknown;
      quantity?: unknown;
      materialSubtotalCents?: unknown;
      blendingFeeCents?: unknown;
      discountableTotalCents?: unknown;
      lineTotalCents?: unknown;
      customBlend?: unknown;
    };
    // Plain V9 lines deliberately retain V8's semantics and may omit the configured split.
    if (line.customBlend === undefined) return true;
    if (
      typeof line.customBlend !== 'object' ||
      line.customBlend === null ||
      Array.isArray(line.customBlend)
    ) {
      return false;
    }
    const blend = line.customBlend as {
      quantity?: unknown;
      components?: unknown;
      materialUnitPriceCents?: unknown;
      materialSubtotalCents?: unknown;
      blendingFeeCents?: unknown;
      discountableTotalCents?: unknown;
      lineTotalCents?: unknown;
    };
    const base = Array.isArray(blend.components)
      ? blend.components.find(
          (
            component,
          ): component is {
            role?: unknown;
            productId?: unknown;
            variantId?: unknown;
            productName?: unknown;
          } =>
            typeof component === 'object' &&
            component !== null &&
            !Array.isArray(component) &&
            (component as { role?: unknown }).role === 'base',
        )
      : undefined;
    return (
      base !== undefined &&
      base.productId === line.productId &&
      base.variantId === line.variantId &&
      base.productName === line.productName &&
      safeProduct(line.unitPriceCents, line.quantity) === line.materialSubtotalCents &&
      line.materialSubtotalCents === line.discountableTotalCents &&
      safeSum([line.materialSubtotalCents, line.blendingFeeCents]) === line.lineTotalCents &&
      blend.quantity === line.quantity &&
      blend.materialUnitPriceCents === line.unitPriceCents &&
      blend.materialSubtotalCents === line.materialSubtotalCents &&
      blend.discountableTotalCents === line.discountableTotalCents &&
      blend.lineTotalCents === line.lineTotalCents &&
      blend.blendingFeeCents === line.blendingFeeCents
    );
  },
);

/** Plain V9 lines retain the historical optional split and have no configured outcome. */
const PersistedCheckoutVariantLineV9Plain = Type.Object(
  { ...PersistedCheckoutVariantLineFields },
  { additionalProperties: false },
);

/** Configured V9 lines require the resolved outcome and every matching money field. */
const PersistedCheckoutVariantLineV9Configured = Type.Intersect([
  Type.Object(
    {
      ...PersistedCheckoutVariantLineFields,
      materialSubtotalCents: MoneyCents,
      blendingFeeCents: MoneyCents,
      discountableTotalCents: MoneyCents,
      customBlend: ResolvedCustomBlendSnapshot,
    },
    { additionalProperties: false },
  ),
  PersistedCheckoutVariantLineV9Integrity(),
]);

/** V9 is a strict plain/configured union; configured lines cannot omit their resolved outcome. */
const PersistedCheckoutVariantLineV9 = Type.Union([
  PersistedCheckoutVariantLineV9Plain,
  PersistedCheckoutVariantLineV9Configured,
]);

/** Current V10 lines freeze the catalogue SKU used by finalization. */
const PersistedCheckoutVariantLineV10Plain = Type.Object(
  {
    ...PersistedCheckoutVariantLineFields,
    sku: Type.String({ minLength: 1, maxLength: 64 }),
  },
  { additionalProperties: false },
);

const PersistedCheckoutVariantLineV10Configured = Type.Intersect([
  Type.Object(
    {
      ...PersistedCheckoutVariantLineFields,
      sku: Type.String({ minLength: 1, maxLength: 64 }),
      materialSubtotalCents: MoneyCents,
      blendingFeeCents: MoneyCents,
      discountableTotalCents: MoneyCents,
      customBlend: ResolvedCustomBlendSnapshot,
    },
    { additionalProperties: false },
  ),
  PersistedCheckoutVariantLineV9Integrity(),
]);

/** V10 keeps plain and configured lines strict while retaining V8/V9 readers unchanged. */
const PersistedCheckoutVariantLineV10 = Type.Union([
  PersistedCheckoutVariantLineV10Plain,
  PersistedCheckoutVariantLineV10Configured,
]);

/** Historical V7 schema retained for callers that reference its transport type. */
export const PersistedCheckoutQuoteV7 = Type.Object(
  {
    version: Type.Literal(7),
    ...PersistedCheckoutQuoteFields,
    variantLines: Type.Array(PersistedCheckoutVariantLineV7),
    deliverySummary: DeliverySummary,
    inventoryAllocations: Type.Array(PersistedInventoryAllocation),
    billingEntity: BillingEntitySnapshot,
    deliverySlot: DeliverySlot,
    purchaseOrderReference: Type.Union([PurchaseOrderReference, Type.Null()]),
  },
  { additionalProperties: false },
);
export type PersistedCheckoutQuoteV7 = Static<typeof PersistedCheckoutQuoteV7>;

/**
 * V8 records the base eligible for a promo discount, the category that scoped it, and the V7
 * checkout commitments. Configured lines retain their legacy specification-only snapshot so
 * already-prepared V8 intents remain representable during the V9 transition.
 */
export const PersistedCheckoutQuoteV8 = Type.Object(
  {
    version: Type.Literal(8),
    ...PersistedCheckoutQuoteFields,
    discountBaseCents: MoneyCents,
    promoCategoryScope: Type.Union([Type.String({ minLength: 1, maxLength: 100 }), Type.Null()]),
    variantLines: Type.Array(PersistedCheckoutVariantLineV8),
    deliverySummary: DeliverySummary,
    inventoryAllocations: Type.Array(PersistedInventoryAllocation),
    billingEntity: BillingEntitySnapshot,
    deliverySlot: DeliverySlot,
    purchaseOrderReference: Type.Union([PurchaseOrderReference, Type.Null()]),
  },
  { additionalProperties: false },
);
export type PersistedCheckoutQuoteV8 = Static<typeof PersistedCheckoutQuoteV8>;

/** New quotes freeze resolved configured outcomes and their exact line-level money pairing. */
export const PersistedCheckoutQuoteV9 = Type.Object(
  {
    version: Type.Literal(9),
    ...PersistedCheckoutQuoteFields,
    discountBaseCents: MoneyCents,
    promoCategoryScope: Type.Union([Type.String({ minLength: 1, maxLength: 100 }), Type.Null()]),
    variantLines: Type.Array(PersistedCheckoutVariantLineV9),
    deliverySummary: DeliverySummary,
    inventoryAllocations: Type.Array(PersistedInventoryAllocation),
    billingEntity: BillingEntitySnapshot,
    deliverySlot: DeliverySlot,
    purchaseOrderReference: Type.Union([PurchaseOrderReference, Type.Null()]),
  },
  { additionalProperties: false },
);
export type PersistedCheckoutQuoteV9 = Static<typeof PersistedCheckoutQuoteV9>;

/** V10 freezes buyer/company identity and the invoice accounting basis at quote creation. */
const PersistedCheckoutQuoteV10Facts = Type.Object(
  {
    ...PersistedCheckoutQuoteV9.properties,
    version: Type.Literal(10),
    variantLines: Type.Array(PersistedCheckoutVariantLineV10),
    // Existing persisted rows use a number; transport writers may use the canonical string form.
    // Both forms remain safe and are normalized by the persistence owner.
    userId: Type.Union([
      Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
      PositiveIntegerString,
      Type.Null(),
    ]),
    companyId: Type.Union([PositiveIntegerString, Type.Null()]),
    country: Country,
    paymentMethod: PaymentMethod,
    netCents: MoneyCents,
    vatRateBasisPoints: Type.Integer({ minimum: 0, maximum: 10_000 }),
    vatCents: MoneyCents,
    grossCents: MoneyCents,
    terms: Type.Optional(Type.Union([TradeCreditTerms, Type.Null()])),
    termsDays: Type.Optional(Type.Union([TradeCreditTermsDays, Type.Null()])),
    preparedAt: Type.Optional(CreditUtcIsoInstant),
  },
  { additionalProperties: false },
);

const PersistedCheckoutQuoteV10Integrity = TypeSystem.Type<unknown>(
  'PersistedCheckoutQuoteV10Integrity',
  (_options, value) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const quote = value as {
      paymentMethod?: unknown;
      companyId?: unknown;
      terms?: unknown;
      termsDays?: unknown;
      userId?: unknown;
      totalCents?: unknown;
      netCents?: unknown;
      vatRateBasisPoints?: unknown;
      vatCents?: unknown;
      grossCents?: unknown;
    };
    const safeMoney = (candidate: unknown): candidate is number =>
      typeof candidate === 'number' && Number.isSafeInteger(candidate) && candidate >= 0;
    if (
      !safeMoney(quote.netCents) ||
      !safeMoney(quote.vatCents) ||
      !safeMoney(quote.grossCents) ||
      typeof quote.vatRateBasisPoints !== 'number' ||
      !Number.isSafeInteger(quote.vatRateBasisPoints) ||
      quote.vatRateBasisPoints < 0 ||
      quote.vatRateBasisPoints > 10_000
    ) {
      return false;
    }
    // A credit quote must point at an authenticated user/company and carry the fixed net-30 term.
    // Card quotes retain the legacy no-company identity and zero VAT.
    if (quote.paymentMethod === 'trade_credit') {
      if (
        typeof quote.companyId !== 'string' ||
        quote.userId === null ||
        (quote.terms !== 'net_30' && quote.terms !== 30 && quote.termsDays !== 30) ||
        (quote.terms !== undefined && quote.terms !== 'net_30' && quote.terms !== 30) ||
        (quote.termsDays !== undefined && quote.termsDays !== 30)
      )
        return false;
      if (quote.grossCents !== quote.totalCents) return false;
    } else if (quote.paymentMethod === 'card') {
      if (
        quote.companyId !== null ||
        // Card V10 snapshots may omit these optional fields (or carry explicit nulls), but a
        // non-null credit term must never cross the method discriminator.
        (quote.terms !== undefined && quote.terms !== null) ||
        (quote.termsDays !== undefined && quote.termsDays !== null) ||
        quote.vatRateBasisPoints !== 0 ||
        quote.vatCents !== 0 ||
        quote.netCents !== quote.grossCents ||
        quote.grossCents !== quote.totalCents
      )
        return false;
    } else {
      return false;
    }
    if (
      quote.vatRateBasisPoints > 0 &&
      quote.netCents > Math.floor(Number.MAX_SAFE_INTEGER / quote.vatRateBasisPoints)
    ) {
      return false;
    }
    const vatNumerator = quote.netCents * quote.vatRateBasisPoints;
    if (!Number.isSafeInteger(vatNumerator) || vatNumerator > Number.MAX_SAFE_INTEGER - 5_000)
      return false;
    const expectedVat = Math.floor((vatNumerator + 5_000) / 10_000);
    return (
      expectedVat === quote.vatCents &&
      quote.netCents <= Number.MAX_SAFE_INTEGER - quote.vatCents &&
      quote.netCents + quote.vatCents === quote.grossCents &&
      (quote.paymentMethod !== 'card' || quote.grossCents === quote.totalCents)
    );
  },
);

export const PersistedCheckoutQuoteV10 = Type.Intersect([
  PersistedCheckoutQuoteV10Facts,
  PersistedCheckoutQuoteV10Integrity(),
]);
export type PersistedCheckoutQuoteV10 = Static<typeof PersistedCheckoutQuoteV10>;

/** Strict reader union. Prepared V8/V9 intents and current V10 intents are accepted. */
export const PersistedCheckoutQuote = Type.Union([
  PersistedCheckoutQuoteV8,
  PersistedCheckoutQuoteV9,
  PersistedCheckoutQuoteV10,
]);
export type PersistedCheckoutQuote = Static<typeof PersistedCheckoutQuote>;
export const CURRENT_PERSISTED_CHECKOUT_QUOTE_VERSION = 10;

/** Strict storage-boundary parser. Unknown versions and malformed configured pairs fail closed. */
export function parsePersistedCheckoutQuote(value: unknown): PersistedCheckoutQuote {
  if (Value.Check(PersistedCheckoutQuote, value)) return value;
  throw new Error('Invalid persisted checkout quote');
}

/** Successful checkout response returned by the payment endpoint. */
export const PaymentSuccessResponse = PlaceOrderResponse;
export type PaymentSuccessResponse = Static<typeof PaymentSuccessResponse>;

/** Shared checkout result shape. API routes still map success to the historic raw order response. */
export const CheckoutErrorCode = Type.Union([
  Type.Literal('CART_NOT_FOUND'),
  Type.Literal('CART_EMPTY'),
  Type.Literal('PROMO_INVALID'),
  Type.Literal('CARD_INVALID'),
  Type.Literal('DECLINED'),
  Type.Literal('TIMEOUT'),
  Type.Literal('IDEMPOTENT_CONFLICT'),
  Type.Literal('IDEMPOTENT_IN_PROGRESS'),
  Type.Literal('RESERVATION_EXPIRED'),
  Type.Literal('INSUFFICIENT_STOCK'),
  Type.Literal('BELOW_MOQ'),
  Type.Literal('CUSTOM_BLEND_INVALID'),
  Type.Literal('DELIVERY_SITE_NOT_FOUND'),
  Type.Literal('BILLING_ENTITY_INVALID'),
  Type.Literal('DELIVERY_SLOT_UNAVAILABLE'),
  Type.Literal('CHECKOUT_FAILED'),
  Type.Literal('PENDING_APPROVAL'),
  Type.Literal('APPROVAL_REJECTED'),
  Type.Literal('APPROVAL_EXPIRED'),
  Type.Literal('APPROVAL_TOTAL_DRIFT'),
  Type.Literal('CREDIT_NOT_ELIGIBLE'),
  Type.Literal('CREDIT_ACCOUNT_ON_HOLD'),
  Type.Literal('CREDIT_ACCOUNT_SUSPENDED'),
  Type.Literal('CREDIT_LIMIT_EXCEEDED'),
  Type.Literal('CREDIT_PAYMENT_UNAVAILABLE'),
  Type.Literal('COMPANY_REQUIRED'),
  Type.Literal('PAYMENT_METHOD_INVALID'),
  Type.Literal('CARD_FIELDS_FORBIDDEN'),
]);
export type CheckoutErrorCode = Static<typeof CheckoutErrorCode>;

const CheckoutGenericErrorCode = Type.Union([
  Type.Literal('CART_NOT_FOUND'),
  Type.Literal('CART_EMPTY'),
  Type.Literal('PROMO_INVALID'),
  Type.Literal('CARD_INVALID'),
  Type.Literal('DECLINED'),
  Type.Literal('TIMEOUT'),
  Type.Literal('IDEMPOTENT_CONFLICT'),
  Type.Literal('IDEMPOTENT_IN_PROGRESS'),
  Type.Literal('BELOW_MOQ'),
  Type.Literal('CUSTOM_BLEND_INVALID'),
  Type.Literal('DELIVERY_SITE_NOT_FOUND'),
  Type.Literal('BILLING_ENTITY_INVALID'),
  Type.Literal('CHECKOUT_FAILED'),
]);

export const CheckoutResult = Type.Union([
  Type.Object(
    { success: Type.Literal(true), order: PlaceOrderResponse },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      success: Type.Literal(false),
      error: CheckoutGenericErrorCode,
      promoError: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
      promoErrorCode: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
      minSubtotalCents: Type.Optional(MoneyCents),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      success: Type.Literal(false),
      error: Type.Literal('RESERVATION_EXPIRED'),
      reservationExpiresAt: Type.String(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      success: Type.Literal(false),
      error: Type.Literal('INSUFFICIENT_STOCK'),
      productIds: Type.Array(PositiveIntegerString, { minItems: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      success: Type.Literal(false),
      error: Type.Literal('DELIVERY_SLOT_UNAVAILABLE'),
      earliestDate: DeliveryDate,
    },
    { additionalProperties: false },
  ),
  PendingApprovalResult,
  Type.Object(
    { success: Type.Literal(false), error: Type.Literal('APPROVAL_REJECTED') },
    { additionalProperties: false },
  ),
  Type.Object(
    { success: Type.Literal(false), error: Type.Literal('APPROVAL_EXPIRED') },
    { additionalProperties: false },
  ),
  Type.Object(
    { success: Type.Literal(false), error: Type.Literal('APPROVAL_TOTAL_DRIFT') },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      success: Type.Literal(false),
      error: Type.Literal('CREDIT_LIMIT_EXCEEDED'),
      requestedCents: MoneyCents,
      availableCreditCents: MoneyCents,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { success: Type.Literal(false), error: Type.Literal('CREDIT_NOT_ELIGIBLE') },
    { additionalProperties: false },
  ),
  Type.Object(
    { success: Type.Literal(false), error: Type.Literal('CREDIT_ACCOUNT_ON_HOLD') },
    { additionalProperties: false },
  ),
  Type.Object(
    { success: Type.Literal(false), error: Type.Literal('CREDIT_ACCOUNT_SUSPENDED') },
    { additionalProperties: false },
  ),
  Type.Object(
    { success: Type.Literal(false), error: Type.Literal('CREDIT_PAYMENT_UNAVAILABLE') },
    { additionalProperties: false },
  ),
  Type.Object(
    { success: Type.Literal(false), error: Type.Literal('COMPANY_REQUIRED') },
    { additionalProperties: false },
  ),
  Type.Object(
    { success: Type.Literal(false), error: Type.Literal('PAYMENT_METHOD_INVALID') },
    { additionalProperties: false },
  ),
  Type.Object(
    { success: Type.Literal(false), error: Type.Literal('CARD_FIELDS_FORBIDDEN') },
    { additionalProperties: false },
  ),
]);
export type CheckoutResult = Static<typeof CheckoutResult>;

const PaymentFailureResponseIntegrity = TypeSystem.Type<unknown>(
  'PaymentFailureResponseIntegrity',
  (_options, value) =>
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (value as { success?: unknown }).success === false &&
    Value.Check(CheckoutResult, value),
);

/** Failure-only view of checkout responses for payment route consumers. */
export const PaymentFailureResponse = Type.Intersect([
  CheckoutResult,
  PaymentFailureResponseIntegrity(),
]);
export type PaymentFailureResponse = Static<typeof PaymentFailureResponse>;
