import { Type, type Static } from '@sinclair/typebox';
import { TypeSystem } from '@sinclair/typebox/system';
import { Value } from '@sinclair/typebox/value';
import { Country } from './country.js';
import { BillingEntitySnapshot } from './tradeAccount.js';
import { MoneyCents, PositiveIntegerString, PurchaseOrderReference, Uuid } from './common.js';

const CreditUtcIsoInstantPattern = Type.String({
  minLength: 24,
  maxLength: 24,
  pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$',
});

function isRealCreditUtcInstant(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))
    return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

const CreditUtcIsoInstantIntegrity = TypeSystem.Type<unknown>(
  'CreditUtcIsoInstantIntegrity',
  (_options, value) => isRealCreditUtcInstant(value),
);

/** UTC instant used by all immutable credit and invoice snapshots. */
export const CreditUtcIsoInstant = Type.Intersect([
  CreditUtcIsoInstantPattern,
  CreditUtcIsoInstantIntegrity(),
]);
export type CreditUtcIsoInstant = Static<typeof CreditUtcIsoInstant>;

/** Credit policy is intentionally a closed vocabulary. */
export const TradeCreditState = Type.Union([
  Type.Literal('active'),
  Type.Literal('on_hold'),
  Type.Literal('suspended'),
]);
export type TradeCreditState = Static<typeof TradeCreditState>;
export const CreditAccountState = TradeCreditState;
export type CreditAccountState = TradeCreditState;

/** Alias used by callers that model the state as a status field. */
export const CreditAccountStatus = TradeCreditState;
export type CreditAccountStatus = TradeCreditState;

/** Expansion 2 has one deterministic term: invoices are due thirty days after issue. */
export const TradeCreditTerms = Type.Union([Type.Literal('net_30'), Type.Literal(30)]);
export type TradeCreditTerms = Static<typeof TradeCreditTerms>;
export const CreditTerms = TradeCreditTerms;
export type CreditTerms = TradeCreditTerms;
export const TradeCreditTermsDays = Type.Literal(30);
export type TradeCreditTermsDays = Static<typeof TradeCreditTermsDays>;
export const TRADE_CREDIT_TERMS_DAYS = 30 as const;

/** Payment instrument selected at checkout. Card remains the historical default. */
export const TradeCreditPaymentMethod = Type.Literal('trade_credit');
export type TradeCreditPaymentMethod = Static<typeof TradeCreditPaymentMethod>;

/** Simulated card remains available as the default/legacy payment instrument. */
export const CardPaymentMethod = Type.Literal('card');
export type CardPaymentMethod = Static<typeof CardPaymentMethod>;

/** Checkout and persisted quotes use one closed payment-method vocabulary. */
export const PaymentMethod = Type.Union([CardPaymentMethod, TradeCreditPaymentMethod]);
export type PaymentMethod = Static<typeof PaymentMethod>;

/** Plain-text reason persisted with administrative holds/suspensions. */
export const CreditStateReason = Type.String({
  minLength: 1,
  maxLength: 500,
  pattern: '^(?!\\s*$)[^<>]*$',
});

/** Credit account money is GBP pence and may never be negative or an unsafe integer. */
export const CreditMoneyCents = MoneyCents;

const NonNegativeVersion = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });

function isSafeMoney(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isSafePositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

function isTerms(value: unknown): value is TradeCreditTerms {
  return value === 'net_30' || value === 30;
}

const CreditAccountMoneyIntegrity = TypeSystem.Type<unknown>(
  'CreditAccountMoneyIntegrity',
  (_options, value) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const account = value as {
      state?: unknown;
      status?: unknown;
      terms?: unknown;
      termsDays?: unknown;
      creditLimitCents?: unknown;
      outstandingCents?: unknown;
      outstandingInvoiceCents?: unknown;
      heldCents?: unknown;
      heldExposureCents?: unknown;
      exposureCents?: unknown;
      totalExposureCents?: unknown;
      availableCreditCents?: unknown;
      availableCents?: unknown;
      version?: unknown;
    };
    const isSafeMoney = (candidate: unknown): candidate is number =>
      typeof candidate === 'number' && Number.isSafeInteger(candidate) && candidate >= 0;
    if (
      !isSafeMoney(account.creditLimitCents) ||
      !isSafeMoney(account.outstandingCents) ||
      !isSafeMoney(account.heldCents) ||
      !isSafeMoney(account.exposureCents) ||
      !isSafeMoney(account.availableCreditCents) ||
      typeof account.version !== 'number' ||
      !Number.isSafeInteger(account.version) ||
      account.version < 0
    ) {
      return false;
    }
    if (account.status !== undefined && account.status !== account.state) return false;
    if (account.terms !== undefined && account.terms !== 'net_30' && account.terms !== 30)
      return false;
    if (account.termsDays !== undefined && account.termsDays !== 30) return false;
    if (account.terms === undefined && account.termsDays === undefined) return false;
    if (
      account.outstandingInvoiceCents !== undefined &&
      account.outstandingInvoiceCents !== account.outstandingCents
    )
      return false;
    if (account.heldExposureCents !== undefined && account.heldExposureCents !== account.heldCents)
      return false;
    if (account.heldCents > Number.MAX_SAFE_INTEGER - account.outstandingCents) return false;
    const exposure = account.outstandingCents + account.heldCents;
    if (account.exposureCents !== exposure) return false;
    if (account.totalExposureCents !== undefined && account.totalExposureCents !== exposure)
      return false;
    const available = Math.max(0, account.creditLimitCents - exposure);
    return (
      account.availableCreditCents === available &&
      (account.availableCents === undefined || account.availableCents === available)
    );
  },
);

/** Canonical account record. `availableCreditCents` is a derived, consistency-checked value. */
export const CreditAccount = Type.Intersect([
  Type.Object(
    {
      /** Optional because the account is persisted on the company row in the current schema. */
      id: Type.Optional(PositiveIntegerString),
      companyId: PositiveIntegerString,
      state: TradeCreditState,
      status: Type.Optional(TradeCreditState),
      creditLimitCents: CreditMoneyCents,
      outstandingCents: CreditMoneyCents,
      outstandingInvoiceCents: Type.Optional(CreditMoneyCents),
      heldCents: CreditMoneyCents,
      heldExposureCents: Type.Optional(CreditMoneyCents),
      exposureCents: CreditMoneyCents,
      totalExposureCents: Type.Optional(CreditMoneyCents),
      availableCreditCents: CreditMoneyCents,
      availableCents: Type.Optional(CreditMoneyCents),
      terms: Type.Optional(TradeCreditTerms),
      termsDays: Type.Optional(TradeCreditTermsDays),
      holdReason: Type.Union([CreditStateReason, Type.Null()]),
      version: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
      createdAt: CreditUtcIsoInstant,
      updatedAt: CreditUtcIsoInstant,
    },
    { additionalProperties: false },
  ),
  CreditAccountMoneyIntegrity(),
]);
export type CreditAccount = Static<typeof CreditAccount>;
export const CompanyCreditAccount = CreditAccount;
export type CompanyCreditAccount = CreditAccount;
export const TradeCreditAccount = CreditAccount;
export type TradeCreditAccount = CreditAccount;

/** Member-facing view omits administrative identifiers and internal audit details. */
export const CreditAccountMemberView = Type.Intersect([
  Type.Object(
    {
      companyId: PositiveIntegerString,
      state: TradeCreditState,
      status: Type.Optional(TradeCreditState),
      creditLimitCents: CreditMoneyCents,
      outstandingCents: CreditMoneyCents,
      outstandingInvoiceCents: Type.Optional(CreditMoneyCents),
      heldCents: CreditMoneyCents,
      heldExposureCents: Type.Optional(CreditMoneyCents),
      exposureCents: CreditMoneyCents,
      totalExposureCents: Type.Optional(CreditMoneyCents),
      availableCreditCents: CreditMoneyCents,
      availableCents: Type.Optional(CreditMoneyCents),
      terms: Type.Optional(TradeCreditTerms),
      termsDays: Type.Optional(TradeCreditTermsDays),
      holdReason: Type.Union([CreditStateReason, Type.Null()]),
      version: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
      updatedAt: CreditUtcIsoInstant,
    },
    { additionalProperties: false },
  ),
  CreditAccountMoneyIntegrity(),
]);
export type CreditAccountMemberView = Static<typeof CreditAccountMemberView>;
export const CompanyCreditAccountMemberView = CreditAccountMemberView;
export type CompanyCreditAccountMemberView = CreditAccountMemberView;
export const CompanyCreditAccountMemberSummary = CreditAccountMemberView;
export type CompanyCreditAccountMemberSummary = CreditAccountMemberView;
export const TradeCreditMemberView = CreditAccountMemberView;
export type TradeCreditMemberView = CreditAccountMemberView;
export const MemberCreditAccountView = CreditAccountMemberView;
export type MemberCreditAccountView = CreditAccountMemberView;

/** Alias that makes the audience explicit in account-depth route code. */
export const MemberCreditView = CreditAccountMemberView;
export type MemberCreditView = CreditAccountMemberView;

/** Administrator view includes the account id and company display name. */
export const CreditAccountAdminView = Type.Intersect([
  Type.Object(
    {
      id: PositiveIntegerString,
      companyId: PositiveIntegerString,
      companyName: Type.String({ minLength: 1, maxLength: 160, pattern: '^(?!\\s*$)[^<>]*$' }),
      state: TradeCreditState,
      status: Type.Optional(TradeCreditState),
      creditLimitCents: CreditMoneyCents,
      outstandingCents: CreditMoneyCents,
      outstandingInvoiceCents: Type.Optional(CreditMoneyCents),
      heldCents: CreditMoneyCents,
      heldExposureCents: Type.Optional(CreditMoneyCents),
      exposureCents: CreditMoneyCents,
      totalExposureCents: Type.Optional(CreditMoneyCents),
      availableCreditCents: CreditMoneyCents,
      availableCents: Type.Optional(CreditMoneyCents),
      terms: Type.Optional(TradeCreditTerms),
      termsDays: Type.Optional(TradeCreditTermsDays),
      holdReason: Type.Union([CreditStateReason, Type.Null()]),
      version: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
      createdAt: CreditUtcIsoInstant,
      updatedAt: CreditUtcIsoInstant,
    },
    { additionalProperties: false },
  ),
  CreditAccountMoneyIntegrity(),
]);
export type CreditAccountAdminView = Static<typeof CreditAccountAdminView>;
export const CompanyCreditAccountAdminView = CreditAccountAdminView;
export type CompanyCreditAccountAdminView = CreditAccountAdminView;
export const TradeCreditAdminView = CreditAccountAdminView;
export type TradeCreditAdminView = CreditAccountAdminView;
export const AdminCreditView = CreditAccountAdminView;
export type AdminCreditView = CreditAccountAdminView;

/** Company-facing response is null when the caller has no active company membership. */
export const CreditAccountMemberResponse = Type.Union([CreditAccountMemberView, Type.Null()]);
export type CreditAccountMemberResponse = Static<typeof CreditAccountMemberResponse>;
export const TradeCreditAccountResponse = CreditAccountMemberResponse;
export type TradeCreditAccountResponse = CreditAccountMemberResponse;
export const CompanyCreditAccountResponse = CreditAccountMemberResponse;
export type CompanyCreditAccountResponse = CreditAccountMemberResponse;

export const CreditAccountListResponse = Type.Array(CreditAccountAdminView);
export type CreditAccountListResponse = Static<typeof CreditAccountListResponse>;
export const TradeCreditAccountListResponse = CreditAccountListResponse;
export type TradeCreditAccountListResponse = CreditAccountListResponse;

/** Route-level alias used by the company credit endpoint. */
export const CompanyCreditAccountListResponse = Type.Object(
  {
    items: Type.Array(CreditAccountAdminView),
    total: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    page: Type.Integer({ minimum: 1, maximum: 10_000 }),
    pageSize: Type.Integer({ minimum: 1, maximum: 100 }),
  },
  { additionalProperties: false },
);
export type CompanyCreditAccountListResponse = Static<typeof CompanyCreditAccountListResponse>;

const Page = Type.Integer({ minimum: 1, maximum: 10_000 });
const PageSize = Type.Integer({ minimum: 1, maximum: 100 });

/** Member query is deliberately limited to the caller's active company context. */
export const CreditAccountQuery = Type.Object({}, { additionalProperties: false });
export type CreditAccountQuery = Static<typeof CreditAccountQuery>;

/** Cross-company administrator filters are closed and bounded. */
export const AdminCreditAccountListQuery = Type.Object(
  {
    companyId: Type.Optional(PositiveIntegerString),
    state: Type.Optional(CreditAccountState),
    /** `status` is accepted as a read-only naming alias used by admin list routes. */
    status: Type.Optional(CreditAccountState),
    page: Type.Optional(Page),
    pageSize: Type.Optional(PageSize),
  },
  { additionalProperties: false },
);
export type AdminCreditAccountListQuery = Static<typeof AdminCreditAccountListQuery>;
export const TradeCreditAccountListQuery = AdminCreditAccountListQuery;
export type TradeCreditAccountListQuery = AdminCreditAccountListQuery;

export const AdminCreditAccountListResponse = Type.Object(
  {
    items: Type.Array(CreditAccountAdminView),
    total: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    page: Page,
    pageSize: PageSize,
  },
  { additionalProperties: false },
);
export type AdminCreditAccountListResponse = Static<typeof AdminCreditAccountListResponse>;
export const CompanyCreditAccountAdminListResponse = AdminCreditAccountListResponse;
export type CompanyCreditAccountAdminListResponse = AdminCreditAccountListResponse;
export const CreditAccountAdminListResponse = AdminCreditAccountListResponse;
export type CreditAccountAdminListResponse = AdminCreditAccountListResponse;
export const TradeCreditAccountAdminListResponse = AdminCreditAccountListResponse;
export type TradeCreditAccountAdminListResponse = AdminCreditAccountListResponse;

export const AdminCreditAccountDetailResponse = CreditAccountAdminView;
export type AdminCreditAccountDetailResponse = CreditAccountAdminView;

const CreditAccountUpdateCommonFields = {
  expectedVersion: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  idempotencyKey: Uuid,
  reason: Type.Optional(CreditStateReason),
} as const;

/** Idempotent optimistic-versioned PATCH with exactly one unambiguous account mutation. */
export const AdminCreditAccountUpdateBody = Type.Union([
  Type.Object(
    {
      ...CreditAccountUpdateCommonFields,
      creditLimitCents: CreditMoneyCents,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...CreditAccountUpdateCommonFields,
      state: TradeCreditState,
    },
    { additionalProperties: false },
  ),
]);
export type AdminCreditAccountUpdateBody = Static<typeof AdminCreditAccountUpdateBody>;

/** Administrator creates one account per company. Terms are fixed to net-30. */
export const CreateCreditAccountBody = Type.Object(
  {
    companyId: PositiveIntegerString,
    creditLimitCents: CreditMoneyCents,
    /** Optional because net-30 is the only supported/default term. */
    terms: Type.Optional(TradeCreditTerms),
    termsDays: Type.Optional(TradeCreditTermsDays),
  },
  { additionalProperties: false },
);
export type CreateCreditAccountBody = Static<typeof CreateCreditAccountBody>;
export const CreateTradeCreditAccountBody = CreateCreditAccountBody;
export type CreateTradeCreditAccountBody = CreateCreditAccountBody;

/** Limit updates do not silently alter the state or terms. */
export const UpdateCreditAccountBody = AdminCreditAccountUpdateBody;
export type UpdateCreditAccountBody = AdminCreditAccountUpdateBody;
export const UpdateTradeCreditAccountBody = UpdateCreditAccountBody;
export type UpdateTradeCreditAccountBody = UpdateCreditAccountBody;

export const UpdateCreditAccountStateBody = Type.Object(
  {
    state: TradeCreditState,
    expectedVersion: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    idempotencyKey: Uuid,
    reason: Type.Optional(CreditStateReason),
  },
  { additionalProperties: false },
);
export type UpdateCreditAccountStateBody = Static<typeof UpdateCreditAccountStateBody>;
export const SetCreditAccountStateBody = UpdateCreditAccountStateBody;
export type SetCreditAccountStateBody = UpdateCreditAccountStateBody;
export const UpdateTradeCreditAccountStateBody = UpdateCreditAccountStateBody;
export type UpdateTradeCreditAccountStateBody = UpdateCreditAccountStateBody;

export const UpdateCreditAccountLimitBody = Type.Object(
  {
    creditLimitCents: CreditMoneyCents,
    expectedVersion: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    idempotencyKey: Uuid,
  },
  { additionalProperties: false },
);
export type UpdateCreditAccountLimitBody = Static<typeof UpdateCreditAccountLimitBody>;

export const CreditAccountIdParam = Type.Object(
  { creditAccountId: PositiveIntegerString },
  { additionalProperties: false },
);
export type CreditAccountIdParam = Static<typeof CreditAccountIdParam>;
export const TradeCreditAccountIdParam = CreditAccountIdParam;
export type TradeCreditAccountIdParam = CreditAccountIdParam;
export const CompanyCreditAccountParam = Type.Object(
  { companyId: PositiveIntegerString },
  { additionalProperties: false },
);
export type CompanyCreditAccountParam = Static<typeof CompanyCreditAccountParam>;
export const CompanyCreditAccountIdParam = CompanyCreditAccountParam;
export type CompanyCreditAccountIdParam = CompanyCreditAccountParam;

const InvoiceNumber = Type.String({
  minLength: 15,
  maxLength: 15,
  pattern: '^QME-[0-9]{4}-[0-9]{6}$',
});
const InvoiceDescription = Type.String({
  minLength: 1,
  maxLength: 240,
  pattern: '^(?!\\s*$)[^<>]*$',
});

const InvoiceLineV1Fields = Type.Object(
  {
    lineId: PositiveIntegerString,
    description: InvoiceDescription,
    productId: Type.Optional(PositiveIntegerString),
    variantId: Type.Optional(PositiveIntegerString),
    sku: Type.Optional(Type.String({ minLength: 1, maxLength: 64, pattern: '^[^<>]*$' })),
    quantity: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
    unitPriceCents: MoneyCents,
    netCents: MoneyCents,
  },
  { additionalProperties: false },
);

const InvoiceLineV1Integrity = TypeSystem.Type<unknown>(
  'InvoiceLineV1Integrity',
  (_options, value) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const line = value as { unitPriceCents?: unknown; quantity?: unknown; netCents?: unknown };
    if (
      !isSafeMoney(line.unitPriceCents) ||
      !isSafePositiveInteger(line.quantity) ||
      !isSafeMoney(line.netCents)
    )
      return false;
    if (
      line.quantity > 0 &&
      line.unitPriceCents > Math.floor(Number.MAX_SAFE_INTEGER / line.quantity)
    )
      return false;
    return line.unitPriceCents * line.quantity === line.netCents;
  },
);

/** Invoice lines freeze quantity and unit-price arithmetic in the V1 document. */
export const InvoiceLineV1 = Type.Intersect([InvoiceLineV1Fields, InvoiceLineV1Integrity()]);
export type InvoiceLineV1 = Static<typeof InvoiceLineV1>;
export const InvoiceLine = InvoiceLineV1;
export type InvoiceLine = InvoiceLineV1;

function calculateVatCents(netCents: unknown, vatRateBasisPoints: unknown): number | undefined {
  if (!isSafeMoney(netCents) || typeof vatRateBasisPoints !== 'number') return undefined;
  if (
    !Number.isSafeInteger(vatRateBasisPoints) ||
    vatRateBasisPoints < 0 ||
    vatRateBasisPoints > 10_000
  )
    return undefined;
  if (vatRateBasisPoints > 0 && netCents > Math.floor(Number.MAX_SAFE_INTEGER / vatRateBasisPoints))
    return undefined;
  const numerator = netCents * vatRateBasisPoints;
  if (!Number.isSafeInteger(numerator) || numerator > Number.MAX_SAFE_INTEGER - 5_000)
    return undefined;
  return Math.floor((numerator + 5_000) / 10_000);
}

export const InvoiceDocumentV1Facts = Type.Object(
  {
    version: Type.Literal(1),
    id: PositiveIntegerString,
    invoiceNumber: InvoiceNumber,
    orderId: PositiveIntegerString,
    companyId: PositiveIntegerString,
    userId: PositiveIntegerString,
    country: Country,
    paymentMethod: TradeCreditPaymentMethod,
    currency: Type.Literal('GBP'),
    terms: Type.Optional(TradeCreditTerms),
    termsDays: Type.Optional(TradeCreditTermsDays),
    billingEntity: BillingEntitySnapshot,
    purchaseOrderReference: Type.Union([PurchaseOrderReference, Type.Null()]),
    paymentIdempotencyKey: Type.Optional(Uuid),
    lines: Type.Array(InvoiceLineV1, { minItems: 1, maxItems: 1_000 }),
    netCents: MoneyCents,
    vatRateBasisPoints: Type.Integer({ minimum: 0, maximum: 10_000 }),
    vatCents: MoneyCents,
    grossCents: MoneyCents,
    issuedAt: CreditUtcIsoInstant,
    dueAt: CreditUtcIsoInstant,
  },
  { additionalProperties: false },
);

export const InvoiceDocumentV1Integrity = TypeSystem.Type<unknown>(
  'InvoiceDocumentV1Integrity',
  (_options, value) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const invoice = value as {
      terms?: unknown;
      termsDays?: unknown;
      lines?: unknown;
      netCents?: unknown;
      vatRateBasisPoints?: unknown;
      vatCents?: unknown;
      grossCents?: unknown;
      issuedAt?: unknown;
      dueAt?: unknown;
    };
    const issuedAt = isRealCreditUtcInstant(invoice.issuedAt)
      ? Date.parse(invoice.issuedAt)
      : undefined;
    const dueAt = isRealCreditUtcInstant(invoice.dueAt) ? Date.parse(invoice.dueAt) : undefined;
    if (
      (invoice.terms === undefined && invoice.termsDays === undefined) ||
      (invoice.terms !== undefined && !isTerms(invoice.terms)) ||
      (invoice.termsDays !== undefined && invoice.termsDays !== 30) ||
      !Array.isArray(invoice.lines) ||
      !isSafeMoney(invoice.netCents) ||
      !isSafeMoney(invoice.vatCents) ||
      !isSafeMoney(invoice.grossCents) ||
      issuedAt === undefined ||
      dueAt === undefined ||
      dueAt !== issuedAt + 30 * 24 * 60 * 60 * 1_000
    )
      return false;
    let lineNet = 0;
    for (const line of invoice.lines) {
      if (typeof line !== 'object' || line === null || Array.isArray(line)) return false;
      const amount = (line as { netCents?: unknown }).netCents;
      if (!isSafeMoney(amount) || amount > Number.MAX_SAFE_INTEGER - lineNet) return false;
      lineNet += amount;
    }
    const expectedVat = calculateVatCents(invoice.netCents, invoice.vatRateBasisPoints);
    return (
      expectedVat !== undefined &&
      lineNet === invoice.netCents &&
      expectedVat === invoice.vatCents &&
      invoice.netCents <= Number.MAX_SAFE_INTEGER - invoice.vatCents &&
      invoice.netCents + invoice.vatCents === invoice.grossCents
    );
  },
);

/** Immutable V1 document. Lifecycle status is deliberately kept in a separate projection. */
export const InvoiceDocumentV1 = Type.Intersect([
  InvoiceDocumentV1Facts,
  InvoiceDocumentV1Integrity(),
]);
export type InvoiceDocumentV1 = Static<typeof InvoiceDocumentV1>;
export const InvoiceV1 = InvoiceDocumentV1;
export type InvoiceV1 = InvoiceDocumentV1;
export const InvoiceDocument = InvoiceDocumentV1;
export type InvoiceDocument = InvoiceDocumentV1;
export const CURRENT_INVOICE_VERSION = 1 as const;

/** Strict storage-boundary reader for immutable invoice snapshots. */
export function parseInvoiceV1(value: unknown): InvoiceDocumentV1 {
  if (Value.Check(InvoiceDocumentV1, value)) return value;
  throw new Error('Invalid invoice V1');
}

/** Lifecycle projection; overdue is derived when `now >= dueAt` rather than persisted in the doc. */
export const InvoiceLifecycleStatus = Type.Union([
  Type.Literal('open'),
  Type.Literal('overdue'),
  Type.Literal('paid'),
  Type.Literal('voided'),
]);
export type InvoiceLifecycleStatus = Static<typeof InvoiceLifecycleStatus>;
export const InvoiceStatus = InvoiceLifecycleStatus;
export type InvoiceStatus = InvoiceLifecycleStatus;

const InvoiceLifecycleIntegrity = TypeSystem.Type<unknown>(
  'InvoiceLifecycleIntegrity',
  (_options, value) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const lifecycle = value as { status?: unknown; settledAt?: unknown };
    if (lifecycle.status === 'paid') return lifecycle.settledAt !== null;
    if (
      lifecycle.status === 'open' ||
      lifecycle.status === 'overdue' ||
      lifecycle.status === 'voided'
    )
      return lifecycle.settledAt === null;
    return false;
  },
);

/** Mutable, versioned lifecycle projection kept separate from immutable document facts. */
const InvoiceLifecycleFields = Type.Object(
  {
    invoiceId: PositiveIntegerString,
    status: InvoiceLifecycleStatus,
    version: NonNegativeVersion,
    settledAt: Type.Union([CreditUtcIsoInstant, Type.Null()]),
    updatedAt: CreditUtcIsoInstant,
  },
  { additionalProperties: false },
);
export const InvoiceLifecycle = Object.assign(
  Type.Intersect([InvoiceLifecycleFields, InvoiceLifecycleIntegrity()]),
  { properties: InvoiceLifecycleFields.properties },
);
export type InvoiceLifecycle = Static<typeof InvoiceLifecycle>;
export const InvoiceLifecycleProjection = InvoiceLifecycle;
export type InvoiceLifecycleProjection = InvoiceLifecycle;

/** Immutable events are the three permitted lifecycle transitions. */
export const InvoiceLifecycleEventType = Type.Union([
  Type.Literal('issued'),
  Type.Literal('settled'),
  Type.Literal('voided'),
]);
export type InvoiceLifecycleEventType = Static<typeof InvoiceLifecycleEventType>;
export const InvoiceLifecycleEvent = Type.Object(
  {
    id: PositiveIntegerString,
    invoiceId: PositiveIntegerString,
    type: InvoiceLifecycleEventType,
    occurredAt: CreditUtcIsoInstant,
    idempotencyKey: Type.Optional(Uuid),
    actorUserId: Type.Optional(PositiveIntegerString),
  },
  { additionalProperties: false },
);
export type InvoiceLifecycleEvent = Static<typeof InvoiceLifecycleEvent>;
export const InvoiceEvent = InvoiceLifecycleEvent;
export type InvoiceEvent = InvoiceLifecycleEvent;

/** Only a completed full settlement is a valid settlement record. */
export const InvoiceSettlementStatus = Type.Literal('settled');
export type InvoiceSettlementStatus = Static<typeof InvoiceSettlementStatus>;
export const InvoiceSettlement = Type.Object(
  {
    id: PositiveIntegerString,
    invoiceId: PositiveIntegerString,
    amountCents: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
    currency: Type.Literal('GBP'),
    status: InvoiceSettlementStatus,
    idempotencyKey: Uuid,
    settledAt: CreditUtcIsoInstant,
    createdAt: CreditUtcIsoInstant,
    version: Type.Optional(NonNegativeVersion),
  },
  { additionalProperties: false },
);
export type InvoiceSettlement = Static<typeof InvoiceSettlement>;

/** Full settlement has no caller-supplied amount; server settles immutable gross amount. */
export const InvoiceSettlementBody = Type.Object(
  {
    expectedVersion: NonNegativeVersion,
    idempotencyKey: Uuid,
  },
  { additionalProperties: false },
);
export type InvoiceSettlementBody = Static<typeof InvoiceSettlementBody>;
export const SettleInvoiceBody = InvoiceSettlementBody;
export type SettleInvoiceBody = InvoiceSettlementBody;
export const AdminInvoiceSettlementBody = InvoiceSettlementBody;
export type AdminInvoiceSettlementBody = InvoiceSettlementBody;

export const InvoiceIdParam = Type.Object(
  { invoiceId: PositiveIntegerString },
  { additionalProperties: false },
);
export type InvoiceIdParam = Static<typeof InvoiceIdParam>;

const InvoiceEnvelopeFacts = Type.Object(
  {
    ...InvoiceDocumentV1Facts.properties,
    status: InvoiceLifecycleStatus,
    lifecycleStatus: Type.Optional(InvoiceLifecycleStatus),
    /** Mutable lifecycle version is kept separate from immutable document version `1`. */
    lifecycleVersion: NonNegativeVersion,
    settledAt: Type.Union([CreditUtcIsoInstant, Type.Null()]),
    lifecycle: Type.Optional(InvoiceLifecycle),
    settlement: Type.Optional(Type.Union([InvoiceSettlement, Type.Null()])),
    events: Type.Optional(Type.Array(InvoiceLifecycleEvent)),
  },
  { additionalProperties: false },
);

const InvoiceEnvelopeIntegrity = TypeSystem.Type<unknown>(
  'InvoiceEnvelopeIntegrity',
  (_options, value) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const invoice = value as {
      id?: unknown;
      status?: unknown;
      lifecycleStatus?: unknown;
      lifecycle?: unknown;
      lifecycleVersion?: unknown;
      settlement?: unknown;
      settledAt?: unknown;
      grossCents?: unknown;
      events?: unknown;
    };
    if (invoice.lifecycleStatus !== undefined && invoice.lifecycleStatus !== invoice.status)
      return false;
    if (invoice.lifecycle !== undefined && invoice.lifecycle !== null) {
      const lifecycle = invoice.lifecycle as {
        invoiceId?: unknown;
        status?: unknown;
        version?: unknown;
        settledAt?: unknown;
      };
      if (
        lifecycle.invoiceId !== invoice.id ||
        lifecycle.status !== invoice.status ||
        (invoice.lifecycleVersion !== undefined &&
          lifecycle.version !== invoice.lifecycleVersion) ||
        lifecycle.settledAt !== invoice.settledAt
      )
        return false;
    }
    if (invoice.status === 'paid') {
      if (invoice.settledAt === null) return false;
      if (invoice.settlement === null) return false;
    } else if (
      invoice.status === 'open' ||
      invoice.status === 'overdue' ||
      invoice.status === 'voided'
    ) {
      if (invoice.settledAt !== null) return false;
      if (invoice.settlement !== undefined && invoice.settlement !== null) return false;
    }
    if (invoice.settlement !== undefined && invoice.settlement !== null) {
      const settlement = invoice.settlement as {
        invoiceId?: unknown;
        amountCents?: unknown;
        settledAt?: unknown;
      };
      if (
        invoice.status !== 'paid' ||
        invoice.settledAt === null ||
        settlement.invoiceId !== invoice.id ||
        settlement.amountCents !== invoice.grossCents ||
        settlement.settledAt !== invoice.settledAt
      )
        return false;
    }
    if (invoice.events !== undefined) {
      if (!Array.isArray(invoice.events)) return false;
      for (const event of invoice.events) {
        if (
          typeof event !== 'object' ||
          event === null ||
          Array.isArray(event) ||
          (event as { invoiceId?: unknown }).invoiceId !== invoice.id
        )
          return false;
      }
    }
    return true;
  },
);

/** Authenticated invoice response combines immutable facts with lifecycle projection. */
export const Invoice = Type.Intersect([
  InvoiceEnvelopeFacts,
  InvoiceDocumentV1Integrity(),
  InvoiceEnvelopeIntegrity(),
]);
export type Invoice = Static<typeof Invoice>;
export const InvoiceResponse = Invoice;
export type InvoiceResponse = Invoice;
export const InvoiceDetailResponse = Invoice;
export type InvoiceDetailResponse = Invoice;
export const InvoiceListResponse = Type.Array(Invoice);
export type InvoiceListResponse = Static<typeof InvoiceListResponse>;

export const AdminInvoiceListQuery = Type.Object(
  {
    companyId: Type.Optional(PositiveIntegerString),
    status: Type.Optional(InvoiceLifecycleStatus),
    page: Type.Optional(Page),
    pageSize: Type.Optional(PageSize),
  },
  { additionalProperties: false },
);
export type AdminInvoiceListQuery = Static<typeof AdminInvoiceListQuery>;
export const InvoiceListQuery = AdminInvoiceListQuery;
export type InvoiceListQuery = AdminInvoiceListQuery;

export const AdminInvoiceListResponse = Type.Object(
  {
    items: Type.Array(Invoice),
    total: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    page: Page,
    pageSize: PageSize,
  },
  { additionalProperties: false },
);
export type AdminInvoiceListResponse = Static<typeof AdminInvoiceListResponse>;

export const VoidInvoiceBody = Type.Object(
  {
    expectedVersion: NonNegativeVersion,
    idempotencyKey: Uuid,
    reason: CreditStateReason,
  },
  { additionalProperties: false },
);
export type VoidInvoiceBody = Static<typeof VoidInvoiceBody>;
