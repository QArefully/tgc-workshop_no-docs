import { Type, type Static } from '@sinclair/typebox';
import { PositiveIntegerString, REQUIRED_PLAIN_TEXT_PATTERN } from './common.js';
import { PostalAddress } from './address.js';

const UtcIsoInstant = Type.String({
  minLength: 24,
  maxLength: 24,
  pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$',
});

/**
 * Plain-text trade record field. Markup delimiters excluded, whitespace-only values rejected.
 *
 * Every bound below mirrors the persistence CHECK constraint of the column it feeds. A contract
 * bound wider than its column turns a user input error into a `SQLITE_CONSTRAINT` failure at INSERT
 * (a 500) instead of a deterministic validation rejection, so these must be kept in step with the
 * migrations that own the columns.
 */
const tradePlainText = (maxLength: number) =>
  Type.String({ minLength: 1, maxLength, pattern: REQUIRED_PLAIN_TEXT_PATTERN });

/** `delivery_sites.label`, CHECK length 1..80. */
export const DeliverySiteLabel = tradePlainText(80);
/** `delivery_sites.contact_name`, CHECK length 1..120. */
export const ContactName = tradePlainText(120);
/**
 * `delivery_sites.contact_phone`, CHECK length 1..40.
 *
 * The leading lookahead demands at least one digit. Without it a value made only of the allowed
 * separators (five spaces satisfies `minLength`) validates here, then normalises to the empty string
 * in the service and trips the column CHECK as a `SQLITE_CONSTRAINT` 500 instead of a validation
 * rejection. Digits are the only part of a phone number that carries meaning, so requiring one is
 * both the narrowest and the correct bound.
 */
export const ContactPhone = Type.String({
  minLength: 5,
  maxLength: 32,
  pattern: '^(?=.*[0-9])[0-9 +()-]+$',
});
/** `billing_entities.legal_name`, CHECK length 1..160. */
export const LegalName = tradePlainText(120);
/** `billing_entities.registration_number`, CHECK length 1..40. */
export const RegistrationNumber = tradePlainText(40);
/** `billing_entities.vat_number`, CHECK length 1..40. */
export const VatNumber = tradePlainText(40);

/**
 * A saved trade delivery destination owned by one user. Retired sites carry `active: false`.
 *
 * `contactPhone` is optional because the column is nullable: a value that normalises away is stored
 * as SQL NULL, and the mapper must be able to represent that as an absent field. Required here it
 * would force the mapper to invent `''`, which this very schema then rejects — a 500 on read.
 */
export const DeliverySite = Type.Object(
  {
    id: PositiveIntegerString,
    label: DeliverySiteLabel,
    contactName: ContactName,
    contactPhone: Type.Optional(ContactPhone),
    address: PostalAddress,
    isDefault: Type.Boolean(),
    active: Type.Boolean(),
    createdAt: UtcIsoInstant,
    updatedAt: UtcIsoInstant,
  },
  { additionalProperties: false },
);
export type DeliverySite = Static<typeof DeliverySite>;

export const CreateDeliverySiteBody = Type.Object(
  {
    label: DeliverySiteLabel,
    contactName: ContactName,
    contactPhone: ContactPhone,
    address: PostalAddress,
    isDefault: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export type CreateDeliverySiteBody = Static<typeof CreateDeliverySiteBody>;

/** Partial update. An absent field leaves the stored value untouched. */
export const UpdateDeliverySiteBody = Type.Object(
  {
    label: Type.Optional(DeliverySiteLabel),
    contactName: Type.Optional(ContactName),
    contactPhone: Type.Optional(ContactPhone),
    address: Type.Optional(PostalAddress),
    isDefault: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export type UpdateDeliverySiteBody = Static<typeof UpdateDeliverySiteBody>;

export const DeliverySiteListResponse = Type.Array(DeliverySite);
export type DeliverySiteListResponse = Static<typeof DeliverySiteListResponse>;

export const DeliverySiteIdParam = Type.Object(
  { siteId: PositiveIntegerString },
  { additionalProperties: false },
);
export type DeliverySiteIdParam = Static<typeof DeliverySiteIdParam>;

/**
 * Billing party payload. Used both as the ad-hoc billing selection at checkout and as the body
 * of a saved billing entity, so one shape validates both paths.
 */
export const BillingEntityInput = Type.Object(
  {
    legalName: LegalName,
    registrationNumber: Type.Optional(RegistrationNumber),
    vatNumber: Type.Optional(VatNumber),
    address: PostalAddress,
  },
  { additionalProperties: false },
);
export type BillingEntityInput = Static<typeof BillingEntityInput>;

/** A saved billing party owned by one user. Retired entities carry `active: false`. */
export const BillingEntity = Type.Object(
  {
    id: PositiveIntegerString,
    legalName: LegalName,
    registrationNumber: Type.Union([RegistrationNumber, Type.Null()]),
    vatNumber: Type.Union([VatNumber, Type.Null()]),
    address: PostalAddress,
    isDefault: Type.Boolean(),
    active: Type.Boolean(),
    createdAt: UtcIsoInstant,
    updatedAt: UtcIsoInstant,
  },
  { additionalProperties: false },
);
export type BillingEntity = Static<typeof BillingEntity>;

/**
 * Immutable billing facts frozen onto an order and its persisted checkout quote. Carries no
 * identifier: a later edit or retirement of the saved entity must not rewrite billed history.
 */
export const BillingEntitySnapshot = Type.Object(
  {
    legalName: LegalName,
    registrationNumber: Type.Union([RegistrationNumber, Type.Null()]),
    vatNumber: Type.Union([VatNumber, Type.Null()]),
    address: PostalAddress,
  },
  { additionalProperties: false },
);
export type BillingEntitySnapshot = Static<typeof BillingEntitySnapshot>;

export const CreateBillingEntityBody = Type.Object(
  {
    ...BillingEntityInput.properties,
    isDefault: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export type CreateBillingEntityBody = Static<typeof CreateBillingEntityBody>;

/**
 * Partial update. Absent and `null` are different instructions, and both are reachable:
 *
 * - field absent -> the stored value is left untouched.
 * - field `null` -> the stored value is cleared to SQL NULL. Only the optional identifiers accept
 *   this; a required field has no cleared state.
 *
 * The distinction exists because a buyer must be able to remove a registration or VAT number they
 * saved earlier. Without an explicit `null` the cleared field would simply be omitted, the server
 * would read that as "no change", and the edit would silently no-op while the form reported success.
 * `CreateBillingEntityBody` deliberately does not accept `null`: on create there is no stored value
 * to clear, so a blank identifier is omitted.
 */
export const UpdateBillingEntityBody = Type.Object(
  {
    legalName: Type.Optional(LegalName),
    registrationNumber: Type.Optional(Type.Union([RegistrationNumber, Type.Null()])),
    vatNumber: Type.Optional(Type.Union([VatNumber, Type.Null()])),
    address: Type.Optional(PostalAddress),
    isDefault: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export type UpdateBillingEntityBody = Static<typeof UpdateBillingEntityBody>;

export const BillingEntityListResponse = Type.Array(BillingEntity);
export type BillingEntityListResponse = Static<typeof BillingEntityListResponse>;

export const BillingEntityIdParam = Type.Object(
  { entityId: PositiveIntegerString },
  { additionalProperties: false },
);
export type BillingEntityIdParam = Static<typeof BillingEntityIdParam>;
