import { Type, type Static } from '@sinclair/typebox';
import { CompanyInviteRole } from './companyAccounts.js';
import {
  EmailAddress,
  MoneyCents,
  PositiveIntegerString,
  PurchaseOrderReference,
} from './common.js';
import { Country } from './country.js';
import { DeliverySlot } from './delivery.js';

/**
 * Mailbox rows predate structured content.  Keep these fields identical to the historical
 * transport shape so old snapshots remain readable while new rows opt into one strict variant.
 */
const MailboxIdentity = {
  id: Type.String({ minLength: 1 }),
  recipient: EmailAddress,
  subject: Type.String(),
  body: Type.String(),
  created: Type.String(),
} as const;

/** UTC instant used by typed template parameters. */
const UtcIsoInstant = Type.String({
  minLength: 24,
  maxLength: 24,
  pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$',
});

/** Interpolated links are plain text, not HTML fragments. */
const MailboxLink = Type.String({
  minLength: 1,
  maxLength: 2_048,
  pattern: '^[^<>]*$',
});

const CompanyName = Type.String({
  minLength: 1,
  maxLength: 160,
  pattern: '^(?!\\s*$)[^<>]*$',
});

/**
 * Stable system templates are intentionally closed.  Adding a template requires a new key and
 * an explicit parameter schema below; callers cannot persist an arbitrary record.
 */
export const SystemMailboxTemplateKey = Type.Union([
  Type.Literal('password_reset'),
  Type.Literal('company_invite'),
  Type.Literal('order_approval_request'),
  Type.Literal('data_export_ready'),
]);
export type SystemMailboxTemplateKey = Static<typeof SystemMailboxTemplateKey>;

export const PasswordResetMailboxTemplateParams = Type.Object(
  { resetUrl: MailboxLink },
  { additionalProperties: false },
);
export type PasswordResetMailboxTemplateParams = Static<typeof PasswordResetMailboxTemplateParams>;

export const CompanyInviteMailboxTemplateParams = Type.Object(
  {
    companyName: CompanyName,
    inviteUrl: MailboxLink,
    role: CompanyInviteRole,
    expiresAt: UtcIsoInstant,
  },
  { additionalProperties: false },
);
export type CompanyInviteMailboxTemplateParams = Static<typeof CompanyInviteMailboxTemplateParams>;

export const OrderApprovalRequestMailboxTemplateParams = Type.Object(
  {
    companyName: CompanyName,
    approvalRequestId: PositiveIntegerString,
    totalCents: MoneyCents,
  },
  { additionalProperties: false },
);
export type OrderApprovalRequestMailboxTemplateParams = Static<
  typeof OrderApprovalRequestMailboxTemplateParams
>;

export const DataExportReadyMailboxTemplateParams = Type.Object(
  {},
  { additionalProperties: false },
);
export type DataExportReadyMailboxTemplateParams = Static<
  typeof DataExportReadyMailboxTemplateParams
>;

/** Runtime lookup used by repository boundaries when validating a parsed descriptor. */
export const SystemMailboxTemplateParamsByKeySchema = {
  password_reset: PasswordResetMailboxTemplateParams,
  company_invite: CompanyInviteMailboxTemplateParams,
  order_approval_request: OrderApprovalRequestMailboxTemplateParams,
  data_export_ready: DataExportReadyMailboxTemplateParams,
} as const;

export type SystemMailboxTemplateParamsByKey = {
  password_reset: PasswordResetMailboxTemplateParams;
  company_invite: CompanyInviteMailboxTemplateParams;
  order_approval_request: OrderApprovalRequestMailboxTemplateParams;
  data_export_ready: DataExportReadyMailboxTemplateParams;
};

/** Compile-time lookup for key-specific template parameters. */
export type SystemMailboxTemplateParamsFor<Key extends SystemMailboxTemplateKey> =
  SystemMailboxTemplateParamsByKey[Key];

/**
 * Legacy mailbox kinds emitted before structured descriptors were introduced.
 *
 * Keep this inventory closed: `template` and `order_receipt` are reserved
 * discriminants for the structured branches below and must never be accepted
 * as an identity-only legacy message.
 */
export const LegacyMailboxKind = Type.Union([
  Type.Literal('reset'),
  Type.Literal('company-invite'),
  Type.Literal('order_confirmation'),
  Type.Literal('order-approval-request'),
  Type.Literal('data_export'),
  Type.Literal('notification'),
  // Migration fixtures and earlier snapshots used this generic plain marker.
  Type.Literal('plain'),
]);
export type LegacyMailboxKind = Static<typeof LegacyMailboxKind>;

const PasswordResetMailboxTemplate = Type.Object(
  {
    ...MailboxIdentity,
    kind: Type.Literal('template'),
    templateKey: Type.Literal('password_reset'),
    templateParams: PasswordResetMailboxTemplateParams,
    country: Country,
  },
  { additionalProperties: false },
);

const CompanyInviteMailboxTemplate = Type.Object(
  {
    ...MailboxIdentity,
    kind: Type.Literal('template'),
    templateKey: Type.Literal('company_invite'),
    templateParams: CompanyInviteMailboxTemplateParams,
    country: Country,
  },
  { additionalProperties: false },
);

const OrderApprovalRequestMailboxTemplate = Type.Object(
  {
    ...MailboxIdentity,
    kind: Type.Literal('template'),
    templateKey: Type.Literal('order_approval_request'),
    templateParams: OrderApprovalRequestMailboxTemplateParams,
    country: Country,
  },
  { additionalProperties: false },
);

const DataExportReadyMailboxTemplate = Type.Object(
  {
    ...MailboxIdentity,
    kind: Type.Literal('template'),
    templateKey: Type.Literal('data_export_ready'),
    templateParams: DataExportReadyMailboxTemplateParams,
    country: Country,
  },
  { additionalProperties: false },
);

/** Strict typed system-template envelope. */
export const SystemMailboxTemplate = Type.Union([
  PasswordResetMailboxTemplate,
  CompanyInviteMailboxTemplate,
  OrderApprovalRequestMailboxTemplate,
  DataExportReadyMailboxTemplate,
]);
export type SystemMailboxTemplate =
  | Static<typeof PasswordResetMailboxTemplate>
  | Static<typeof CompanyInviteMailboxTemplate>
  | Static<typeof OrderApprovalRequestMailboxTemplate>
  | Static<typeof DataExportReadyMailboxTemplate>;

/** Historical plain message branch.  `kind` is closed to the known pre-structured inventory. */
export const LegacyMailboxMessage = Type.Object(
  {
    ...MailboxIdentity,
    kind: LegacyMailboxKind,
  },
  { additionalProperties: false },
);
export type LegacyMailboxMessage = Static<typeof LegacyMailboxMessage>;

/** Canonical order facts.  Money remains integer pence; no display conversion is transported. */
export const MailboxOrderReceipt = Type.Object(
  {
    ...MailboxIdentity,
    kind: Type.Literal('order_receipt'),
    orderId: PositiveIntegerString,
    country: Country,
    subtotalCents: MoneyCents,
    discountCents: MoneyCents,
    totalCents: MoneyCents,
    deliveryChargeCents: MoneyCents,
    deliverySlot: DeliverySlot,
    purchaseOrderReference: Type.Optional(PurchaseOrderReference),
  },
  { additionalProperties: false },
);
export type MailboxOrderReceipt = Static<typeof MailboxOrderReceipt>;

/** Alias retained for consumers that name this branch by its transport kind. */
export const OrderReceiptMailboxMessage = MailboxOrderReceipt;
export type OrderReceiptMailboxMessage = MailboxOrderReceipt;

/** Structured invoice notification. The reader hydrates the immutable document by invoice id. */
export const InvoiceIssuedMailboxDescriptor = Type.Object(
  {
    ...MailboxIdentity,
    kind: Type.Literal('invoice_issued'),
    invoiceId: PositiveIntegerString,
  },
  { additionalProperties: false },
);
export type InvoiceIssuedMailboxDescriptor = Static<typeof InvoiceIssuedMailboxDescriptor>;
export const MailboxInvoiceIssued = InvoiceIssuedMailboxDescriptor;
export type MailboxInvoiceIssued = InvoiceIssuedMailboxDescriptor;
export const InvoiceIssuedMailboxMessage = InvoiceIssuedMailboxDescriptor;
export type InvoiceIssuedMailboxMessage = InvoiceIssuedMailboxDescriptor;

/**
 * Every row is exactly one of: legacy plain, typed system template, or canonical order receipt.
 * Each branch closes its object so metadata cannot be mixed across variants.
 */
export const MailboxMessage = Type.Union([
  LegacyMailboxMessage,
  SystemMailboxTemplate,
  MailboxOrderReceipt,
  InvoiceIssuedMailboxDescriptor,
]);
export type MailboxMessage = Static<typeof MailboxMessage>;

export const MailboxListResponse = Type.Array(MailboxMessage);
export type MailboxListResponse = Static<typeof MailboxListResponse>;
