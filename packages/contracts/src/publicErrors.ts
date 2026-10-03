import { Type, type Static, type TSchema } from '@sinclair/typebox';

/*
 * Public error identities are deliberately transport-facing.  Domain services may have richer
 * internal failure names, but a route must map those names to this closed vocabulary before they
 * cross the HTTP boundary.  Keep this list append-only: clients branch on these values.
 */
export const PUBLIC_ERROR_CODES = [
  // Boundary and common failures.
  'REQUEST_INVALID',
  'INTERNAL_ERROR',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'AUTH_REQUIRED',

  // Authentication and account self-service.
  'AUTH_SUSPENDED',
  'EMAIL_EXISTS',
  'INVALID_EMAIL',
  'INVALID_DISPLAY_NAME',
  'WEAK_PASSWORD',
  'INVALID_CURRENT',
  'SAME_PASSWORD',
  'INVALID_TOKEN',
  'EXPIRED',
  'ALREADY_USED',
  'OWNS_COMPANY',
  'CANNOT_REVOKE_CURRENT',
  'SESSION_NOT_FOUND',
  'LAST_ADMIN',

  // Trade-account and company membership.
  'NO_ACTIVE_MEMBERSHIP',
  'ALREADY_MEMBER',
  'NOT_OWNER',
  'SOLE_OWNER',
  'MEMBERSHIP_NOT_FOUND',
  'INVITE_NOT_FOUND',
  'INVITE_EXPIRED',
  'INVITE_ALREADY_USED',
  'COMPANY_NOT_FOUND',
  'INVALID_ROLE',
  'SITE_NOT_FOUND',
  'SITE_LIMIT_REACHED',
  'DUPLICATE_LABEL',
  'INVALID_POSTCODE',
  'DELIVERY_COUNTRY_NOT_ALLOWED',
  'BILLING_ENTITY_NOT_FOUND',
  'BILLING_ENTITY_LIMIT_REACHED',
  'DUPLICATE_LEGAL_NAME',

  // Catalog, cart, bundles, and repeat buying.
  'PRODUCT_NOT_FOUND',
  'VARIANT_NOT_FOUND',
  'VARIANT_NOT_IN_CART',
  'VARIANT_RETIRED',
  'VARIANT_AVAILABLE',
  'INVALID_QUANTITY',
  'BELOW_MOQ',
  'BLOCKED_IN_COUNTRY',
  'BLEND_UNAVAILABLE',
  'CUSTOM_BLEND_INVALID',
  'CUSTOM_BLEND_INCOMPATIBLE',
  'CUSTOM_BLEND_PIGMENT_CAP_EXCEEDED',
  'CART_NOT_FOUND',
  'CART_EMPTY',
  'CART_RESERVED',
  'BUNDLE_NOT_FOUND',
  'BUNDLE_UNAVAILABLE',
  'NO_INPUT_LINES',
  'TOO_MANY_LINES',
  'SKU_NOT_FOUND',

  // Orders and checkout/payment state machines.
  'ORDER_NOT_FOUND',
  'ORDER_FORBIDDEN',
  'INVALID_ALLOCATION',
  'INVALID_TRANSITION',
  'CANCELLATION_NOT_ALLOWED',
  'STALE_VERSION',
  'IDEMPOTENCY_CONFLICT',
  'IDEMPOTENT_CONFLICT',
  'IDEMPOTENT_IN_PROGRESS',
  'TRACKING_NOT_ALLOWED',
  'OUTSTANDING_BACKORDER',
  'CART_NOT_READY',
  'PROMO_INVALID',
  'PROMO_NOT_FOUND',
  'PROMO_EXPIRED',
  'PROMO_NOT_STARTED',
  'PROMO_MIN_ITEMS',
  'PROMO_MIN_SUBTOTAL',
  'PROMO_USAGE_LIMIT',
  'PROMO_CATEGORY_MISMATCH',
  'CARD_INVALID',
  'CARD_DECLINED',
  'GATEWAY_TIMEOUT',
  'DECLINED',
  'TIMEOUT',
  'CHECKOUT_FAILED',
  'RESERVATION_EXPIRED',
  'INSUFFICIENT_STOCK',
  'DELIVERY_SITE_NOT_FOUND',
  'BILLING_ENTITY_INVALID',
  'DELIVERY_SLOT_UNAVAILABLE',
  'PENDING_APPROVAL',
  'APPROVAL_REJECTED',
  'APPROVAL_EXPIRED',
  'APPROVAL_TOTAL_DRIFT',
  'APPROVAL_NOT_FOUND',
  'NOT_APPROVER',
  'APPROVAL_ALREADY_RESOLVED',

  // Trade credit and immutable invoicing.
  'CREDIT_ACCOUNT_NOT_FOUND',
  'CREDIT_ACCOUNT_FORBIDDEN',
  'CREDIT_ACCOUNT_ALREADY_EXISTS',
  'CREDIT_ACCOUNT_ON_HOLD',
  'CREDIT_ACCOUNT_SUSPENDED',
  'CREDIT_NOT_ELIGIBLE',
  'CREDIT_LIMIT_EXCEEDED',
  'CREDIT_LIMIT_INVALID',
  'CREDIT_TERMS_INVALID',
  'CREDIT_PAYMENT_UNAVAILABLE',
  'COMPANY_REQUIRED',
  'PAYMENT_METHOD_INVALID',
  'CARD_FIELDS_FORBIDDEN',
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

  // Returns, reviews, notifications, and standing orders.
  'RETURN_NOT_FOUND',
  'RETURN_NOT_ELIGIBLE',
  'RETURN_WINDOW_EXPIRED',
  'QUANTITY_UNAVAILABLE',
  'PAYMENT_NOT_REFUNDABLE',
  'PAYMENT_ORDER_MISMATCH',
  'RETURN_DATA_CORRUPT',
  'TOO_MANY_REPORTS',
  'NOTIFICATION_NOT_FOUND',
  'SUBSCRIPTION_NOT_FOUND',
  'SUBSCRIPTION_LIMIT_REACHED',
  'ALREADY_SUBSCRIBED',
  'SOURCE_NOT_FOUND',
  'INACTIVE',

  // Saved lists and repeat schedules.
  'LIST_NOT_FOUND',
  'ITEM_NOT_FOUND',
  'NAME_INVALID',
  'NAME_TAKEN',
  'LIST_LIMIT_REACHED',
  'ITEM_LIMIT_REACHED',
  'DEFAULT_LIST_IMMUTABLE',

  // Admin catalog, commerce, jobs, and integrations.
  'INVALID_INPUT',
  'INVALID_QUERY',
  'INVALID_MIXING_GROUP',
  'INVALID_VARIANT',
  'INVALID_CLEARANCE',
  'DUPLICATE_SLUG',
  'VARIANT_NO_ACTIVE_REPLACEMENT',
  'DUPLICATE',
  'ACTIVE_RESERVATIONS',
  'INVALID_REFUND',
  'JOB_NOT_FOUND',
  'JOB_NOT_RETRYABLE',
  'WEBHOOK_NOT_FOUND',
  'INVALID_SIGNATURE',
  'INVALID_PAYLOAD',
  'IDEMPOTENCY_KEY_REUSED',
  'INVENTORY_CORRUPTION',
] as const;

export type PublicErrorCode = (typeof PUBLIC_ERROR_CODES)[number];

const PublicErrorCodeSchemas = PUBLIC_ERROR_CODES.map((code) => Type.Literal(code)) as unknown as [
  TSchema,
  ...TSchema[],
];

/** Runtime schema for the closed public error identity vocabulary. */
export const PublicErrorCode = Type.Union(PublicErrorCodeSchemas);

/** Positive integer accepted in metadata whether a route has a number or transport string. */
export const PublicErrorId = Type.Union([
  Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  Type.String({ pattern: '^[1-9][0-9]*$', maxLength: 20 }),
]);
export type PublicErrorId = Static<typeof PublicErrorId>;

const SafeCount = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const SafePositiveCount = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
const SafePercentage = Type.Integer({ minimum: 0, maximum: 100 });
const SafeMoneyCents = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const Uuid = Type.String({
  minLength: 36,
  maxLength: 36,
  pattern:
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
});
const UtcIsoInstant = Type.String({
  minLength: 24,
  maxLength: 24,
  pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$',
});
const CivilDate = Type.String({ minLength: 10, maxLength: 10, pattern: '^\\d{4}-\\d{2}-\\d{2}$' });

/**
 * Metadata property vocabulary.  A code-specific schema below selects the small subset that a
 * route may disclose.  Keeping the field schemas separate means all identifiers and numbers have
 * the same bounds even when used by different error identities.
 */
const PublicErrorMetaFieldSchemas = {
  productId: PublicErrorId,
  productIds: Type.Array(PublicErrorId, { minItems: 1, maxItems: 100 }),
  variantId: PublicErrorId,
  variantIds: Type.Array(PublicErrorId, { minItems: 1, maxItems: 100 }),
  cartId: Uuid,
  orderId: PublicErrorId,
  bundleId: PublicErrorId,
  approvalRequestId: PublicErrorId,
  deliverySiteId: PublicErrorId,
  billingEntityId: PublicErrorId,
  companyId: PublicErrorId,
  creditAccountId: PublicErrorId,
  userId: PublicErrorId,
  listId: PublicErrorId,
  itemId: PublicErrorId,
  subscriptionId: PublicErrorId,
  returnId: PublicErrorId,
  reviewId: PublicErrorId,
  paymentId: PublicErrorId,
  invoiceId: PublicErrorId,
  jobId: PublicErrorId,
  webhookId: PublicErrorId,
  count: SafeCount,
  lineCount: SafeCount,
  itemCount: SafeCount,
  componentCount: SafeCount,
  quantity: SafePositiveCount,
  minQuantity: SafePositiveCount,
  maxQuantity: SafePositiveCount,
  addedLineCount: SafeCount,
  skippedLineCount: SafeCount,
  availableQuantity: SafeCount,
  remainingQuantity: SafeCount,
  amountCents: SafeMoneyCents,
  requestedCents: SafeMoneyCents,
  creditLimitCents: SafeMoneyCents,
  outstandingCents: SafeMoneyCents,
  availableCreditCents: SafeMoneyCents,
  totalCents: SafeMoneyCents,
  minSubtotalCents: SafeMoneyCents,
  refundAmountCents: SafeMoneyCents,
  earliestDate: CivilDate,
  reservationExpiresAt: UtcIsoInstant,
  expiresAt: UtcIsoInstant,
  retryAfterSeconds: SafeCount,
  maxPercentage: SafePercentage,
  actualPercentage: SafePercentage,
} as const;

type PublicErrorMetaField = keyof typeof PublicErrorMetaFieldSchemas;

/** Build an object that permits exactly the selected metadata fields (all are required). */
function strictMeta(fields: readonly PublicErrorMetaField[]): TSchema {
  const properties: Record<string, TSchema> = {};
  for (const field of fields) properties[field] = PublicErrorMetaFieldSchemas[field];
  return Type.Object(properties, { additionalProperties: false });
}

/** Empty metadata is intentional for identities that could reveal resource ownership/existence. */
const EmptyPublicErrorMeta = Type.Object({}, { additionalProperties: false });

/**
 * Only codes that have a caller-visible, approved parameter get a non-empty metadata schema.
 * Every other code (including all `*_NOT_FOUND` and forbidden/ownership-hiding identities) maps to
 * the empty strict object.  Metadata is optional on the response so a producer may omit it when a
 * value is unavailable, but an included object must satisfy the exact schema below.
 */
const ParameterizedPublicErrorMetaSchemas = {
  RATE_LIMITED: strictMeta(['retryAfterSeconds']),
  INVALID_QUANTITY: strictMeta(['quantity']),
  BELOW_MOQ: strictMeta(['minQuantity']),
  BUNDLE_UNAVAILABLE: strictMeta(['variantIds']),
  PROMO_MIN_ITEMS: strictMeta(['itemCount']),
  PROMO_MIN_SUBTOTAL: strictMeta(['minSubtotalCents']),
  RESERVATION_EXPIRED: strictMeta(['reservationExpiresAt']),
  INSUFFICIENT_STOCK: strictMeta(['productIds']),
  BLOCKED_IN_COUNTRY: strictMeta(['productIds']),
  DELIVERY_SLOT_UNAVAILABLE: strictMeta(['earliestDate']),
  PENDING_APPROVAL: strictMeta(['approvalRequestId']),
  CREDIT_LIMIT_EXCEEDED: strictMeta(['requestedCents', 'availableCreditCents']),
  INVOICE_SETTLEMENT_INVALID: strictMeta(['invoiceId']),
  INVOICE_SETTLEMENT_CONFLICT: strictMeta(['invoiceId']),
  QUANTITY_UNAVAILABLE: strictMeta(['availableQuantity']),
  TOO_MANY_LINES: strictMeta(['lineCount']),
  CUSTOM_BLEND_PIGMENT_CAP_EXCEEDED: strictMeta(['maxPercentage', 'actualPercentage']),
} as const satisfies Partial<Record<PublicErrorCode, TSchema>>;

type FieldStatic<Field extends PublicErrorMetaField> = Static<
  (typeof PublicErrorMetaFieldSchemas)[Field]
>;

/** Compile-time metadata shapes mirror the code-indexed runtime schemas above. */
type ParameterizedPublicErrorMetaByCode = {
  RATE_LIMITED: { retryAfterSeconds: FieldStatic<'retryAfterSeconds'> };
  INVALID_QUANTITY: { quantity: FieldStatic<'quantity'> };
  BELOW_MOQ: { minQuantity: FieldStatic<'minQuantity'> };
  BUNDLE_UNAVAILABLE: { variantIds: FieldStatic<'variantIds'> };
  PROMO_MIN_ITEMS: { itemCount: FieldStatic<'itemCount'> };
  PROMO_MIN_SUBTOTAL: { minSubtotalCents: FieldStatic<'minSubtotalCents'> };
  RESERVATION_EXPIRED: { reservationExpiresAt: FieldStatic<'reservationExpiresAt'> };
  INSUFFICIENT_STOCK: { productIds: FieldStatic<'productIds'> };
  BLOCKED_IN_COUNTRY: { productIds: FieldStatic<'productIds'> };
  DELIVERY_SLOT_UNAVAILABLE: { earliestDate: FieldStatic<'earliestDate'> };
  PENDING_APPROVAL: { approvalRequestId: FieldStatic<'approvalRequestId'> };
  QUANTITY_UNAVAILABLE: { availableQuantity: FieldStatic<'availableQuantity'> };
  TOO_MANY_LINES: { lineCount: FieldStatic<'lineCount'> };
  CUSTOM_BLEND_PIGMENT_CAP_EXCEEDED: {
    maxPercentage: FieldStatic<'maxPercentage'>;
    actualPercentage: FieldStatic<'actualPercentage'>;
  };
  CREDIT_LIMIT_EXCEEDED: {
    requestedCents: FieldStatic<'requestedCents'>;
    availableCreditCents: FieldStatic<'availableCreditCents'>;
  };
  INVOICE_SETTLEMENT_INVALID: { invoiceId: FieldStatic<'invoiceId'> };
  INVOICE_SETTLEMENT_CONFLICT: { invoiceId: FieldStatic<'invoiceId'> };
};

/** Public error identities whose caller must provide one approved metadata object. */
export type ParameterizedPublicErrorCode = keyof typeof ParameterizedPublicErrorMetaSchemas;
export type UnparameterizedPublicErrorCode = Exclude<PublicErrorCode, ParameterizedPublicErrorCode>;

type EmptyPublicErrorMeta = { readonly __empty?: never };

/** Compile-time lookup used by send helpers and feature route mappers. */
export type PublicErrorMetaFor<Code extends PublicErrorCode> =
  Code extends keyof typeof ParameterizedPublicErrorMetaSchemas
    ? ParameterizedPublicErrorMetaByCode[Code & keyof ParameterizedPublicErrorMetaByCode]
    : EmptyPublicErrorMeta;

/** Argument tuple for public-error emitters; parameterized identities require metadata. */
export type PublicErrorArgs<Code extends PublicErrorCode> =
  Code extends ParameterizedPublicErrorCode
    ? [code: Code, meta: PublicErrorMetaFor<Code>]
    : [code: Code, meta?: PublicErrorMetaFor<Code>];

export type PublicErrorMetaByCode = {
  readonly [Code in PublicErrorCode]: PublicErrorMetaFor<Code>;
};

/** Runtime lookup mirrors `PublicErrorMetaByCode`; every vocabulary code is represented. */
const PublicErrorMetaSchemasByCode = Object.fromEntries(
  PUBLIC_ERROR_CODES.map((code) => [
    code,
    (ParameterizedPublicErrorMetaSchemas as Partial<Record<PublicErrorCode, TSchema>>)[code] ??
      EmptyPublicErrorMeta,
  ]),
) as { readonly [Code in PublicErrorCode]: TSchema };
export const PublicErrorMetaByCodeSchema = PublicErrorMetaSchemasByCode;

/**
 * Standalone safe metadata schema.  Responses use the code-indexed schemas above; this union is
 * retained for callers that validate a metadata object independently of its response envelope.
 */
const PublicErrorMetaSchemas = [
  EmptyPublicErrorMeta,
  ...Object.values(ParameterizedPublicErrorMetaSchemas),
] as [TSchema, ...TSchema[]];
export const PublicErrorMeta = Type.Union(PublicErrorMetaSchemas);
export type PublicErrorMeta = Static<typeof PublicErrorMeta>;
export const PublicErrorMetaSchema = PublicErrorMeta;

const PublicErrorText = Type.String({ minLength: 1, maxLength: 500 });
const LegacyPublicErrorResponse = Type.Object(
  {
    error: PublicErrorText,
    /** @deprecated Use `code` and `meta`; retained while legacy routes migrate. */
    details: Type.Optional(Type.Unknown({ deprecated: true })),
  },
  { additionalProperties: false },
);

const CodedPublicErrorResponses = PUBLIC_ERROR_CODES.map((code) =>
  Type.Object(
    {
      error: PublicErrorText,
      code: Type.Literal(code),
      meta: Type.Optional(PublicErrorMetaSchemasByCode[code]),
    },
    { additionalProperties: false },
  ),
) as unknown as [TSchema, ...TSchema[]];

/**
 * Strict legacy/new union. Legacy responses may retain `details`, but cannot carry a code or meta;
 * coded responses require a known code, permit only that code's metadata, and reject `details`.
 */
export const PublicErrorResponse = Type.Union([
  LegacyPublicErrorResponse,
  ...CodedPublicErrorResponses,
] as [TSchema, ...TSchema[]]);
type LegacyPublicErrorResponseType = Static<typeof LegacyPublicErrorResponse>;
export type PublicErrorResponseFor<Code extends PublicErrorCode> = {
  error: Static<typeof PublicErrorText>;
  code: Code;
  meta?: PublicErrorMetaFor<Code>;
};
export type PublicErrorResponse =
  | LegacyPublicErrorResponseType
  | { [Code in PublicErrorCode]: PublicErrorResponseFor<Code> }[PublicErrorCode];
export const PublicErrorResponseSchema = PublicErrorResponse;

/** Compatibility alias for consumers that import the response from this module. */
export const ErrorResponse = PublicErrorResponse;
export type ErrorResponse = PublicErrorResponse;
