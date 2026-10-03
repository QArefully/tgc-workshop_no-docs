import type Database from 'better-sqlite3';
import { Value } from '@sinclair/typebox/value';
import { Country, type Country as CountryType } from '@shop/contracts/country';
import { DeliverySlot } from '@shop/contracts/delivery';
import { parseInvoiceV1 } from '@shop/contracts/trade-credit';
import {
  MailboxMessage,
  SystemMailboxTemplateKey,
  SystemMailboxTemplateParamsByKeySchema,
  type LegacyMailboxKind,
  type MailboxMessage as MailboxMessageType,
  type SystemMailboxTemplateKey as SystemMailboxTemplateKeyType,
} from '@shop/contracts/mailbox';

interface MailboxRow {
  id: number;
  recipient: string;
  subject: string;
  body: string;
  kind: string;
  created_at: string;
  order_id: number | null;
  template_key: string | null;
  template_params_json: string | null;
  template_country: string | null;
  invoice_id: number | null;
  invoice_document_json: string | null;
  owning_order_id: number | null;
  owning_country: unknown;
  owning_subtotal_cents: number | null;
  owning_discount_cents: number | null;
  owning_total_cents: number | null;
  owning_delivery_charge_cents: number | null;
  owning_delivery_slot_date: string | null;
  owning_delivery_slot_window: string | null;
  owning_purchase_order_reference: string | null;
}

type MailboxCommonInput = {
  recipient: string;
  subject: string;
  body: string;
  createdAt: string;
};

/** Inputs accepted by mailbox producers. Structured rows cannot be written as raw kinds. */
export type MailboxAddInput =
  | (MailboxCommonInput & { kind: LegacyMailboxKind })
  | (MailboxCommonInput & {
      kind: 'template';
      templateKey: SystemMailboxTemplateKeyType;
      templateParams: unknown;
      country: CountryType;
    })
  | (MailboxCommonInput & { kind: 'order_receipt'; orderId: number })
  | (MailboxCommonInput & { kind: 'invoice_issued'; invoiceId: number });

/** Narrow persisted legacy discriminants before exposing the strict mailbox union. */
function parseLegacyMailboxKind(kind: unknown): LegacyMailboxKind {
  switch (kind) {
    case 'reset':
    case 'company-invite':
    case 'order_confirmation':
    case 'order-approval-request':
    case 'data_export':
    case 'notification':
    case 'plain':
      return kind;
    default:
      throw new Error(`Unsupported legacy mailbox kind: ${String(kind)}`);
  }
}

function failInvalidMailboxRow(id: number, detail: string): never {
  throw new Error(`Mailbox row ${id} is invalid: ${detail}`);
}

function assertMessage(id: number, message: unknown): MailboxMessageType {
  if (!Value.Check(MailboxMessage, message)) {
    failInvalidMailboxRow(id, 'does not match a known mailbox variant');
  }
  return message;
}

function parseTemplateParams(id: number, key: string, json: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    failInvalidMailboxRow(id, 'template parameters are not valid JSON');
  }

  if (!Value.Check(SystemMailboxTemplateKey, key)) {
    failInvalidMailboxRow(id, `unsupported template key ${key}`);
  }
  const schema = SystemMailboxTemplateParamsByKeySchema[key];
  if (!schema || !Value.Check(schema, parsed)) {
    failInvalidMailboxRow(id, `template parameters do not match ${key}`);
  }
  return parsed;
}

function mapTemplateRow(row: MailboxRow): MailboxMessageType {
  if (
    row.order_id !== null ||
    row.template_key === null ||
    row.template_params_json === null ||
    row.template_country === null ||
    row.invoice_id !== null
  ) {
    return failInvalidMailboxRow(row.id, 'template metadata is incomplete or mixed');
  }

  const key = row.template_key;
  const templateParams = parseTemplateParams(row.id, key, row.template_params_json);
  if (!Value.Check(Country, row.template_country)) {
    return failInvalidMailboxRow(row.id, `unsupported template country ${row.template_country}`);
  }
  return assertMessage(row.id, {
    id: String(row.id),
    recipient: row.recipient,
    subject: row.subject,
    body: row.body,
    created: row.created_at,
    kind: 'template',
    templateKey: key,
    templateParams,
    country: row.template_country,
  });
}

function mapReceiptRow(row: MailboxRow): MailboxMessageType {
  if (
    row.order_id === null ||
    row.template_key !== null ||
    row.template_params_json !== null ||
    row.template_country !== null ||
    row.invoice_id !== null
  ) {
    return failInvalidMailboxRow(row.id, 'receipt metadata is incomplete or mixed');
  }
  if (row.owning_order_id === null) {
    return failInvalidMailboxRow(row.id, `owning order ${row.order_id} is missing`);
  }

  const slot = {
    date: row.owning_delivery_slot_date,
    window: row.owning_delivery_slot_window,
  };
  if (!Value.Check(Country, row.owning_country)) {
    return failInvalidMailboxRow(row.id, 'owning order country is invalid');
  }
  if (!Value.Check(DeliverySlot, slot)) {
    return failInvalidMailboxRow(row.id, 'owning order delivery slot is invalid');
  }

  return assertMessage(row.id, {
    id: String(row.id),
    recipient: row.recipient,
    subject: row.subject,
    body: row.body,
    created: row.created_at,
    kind: 'order_receipt',
    orderId: String(row.order_id),
    country: row.owning_country,
    subtotalCents: row.owning_subtotal_cents,
    discountCents: row.owning_discount_cents,
    totalCents: row.owning_total_cents,
    deliveryChargeCents: row.owning_delivery_charge_cents ?? 0,
    deliverySlot: slot,
    ...(row.owning_purchase_order_reference === null
      ? {}
      : { purchaseOrderReference: row.owning_purchase_order_reference }),
  });
}

/** Invoice mailbox rows store only an immutable document identity. Read the document at the
 * mailbox boundary so a corrupt/deleted invoice can never be presented as a valid notification;
 * the transport intentionally exposes no localized or mutable invoice prose. */
function mapInvoiceRow(row: MailboxRow): MailboxMessageType {
  if (
    row.invoice_id === null ||
    row.order_id !== null ||
    row.template_key !== null ||
    row.template_params_json !== null ||
    row.template_country !== null ||
    row.invoice_document_json === null
  ) {
    return failInvalidMailboxRow(row.id, 'invoice metadata is incomplete or mixed');
  }

  let document: ReturnType<typeof parseInvoiceV1>;
  try {
    document = parseInvoiceV1(JSON.parse(row.invoice_document_json));
  } catch {
    return failInvalidMailboxRow(row.id, `invoice ${row.invoice_id} is missing or invalid`);
  }
  if (document.id !== String(row.invoice_id)) {
    return failInvalidMailboxRow(row.id, `invoice ${row.invoice_id} does not match its document`);
  }

  return assertMessage(row.id, {
    id: String(row.id),
    recipient: row.recipient,
    subject: '',
    body: '',
    created: row.created_at,
    kind: 'invoice_issued',
    invoiceId: String(row.invoice_id),
  });
}

function mapMailboxRow(row: MailboxRow): MailboxMessageType {
  if (row.kind === 'template') return mapTemplateRow(row);
  if (row.kind === 'order_receipt') return mapReceiptRow(row);
  if (row.kind === 'invoice_issued') return mapInvoiceRow(row);

  if (
    row.order_id !== null ||
    row.template_key !== null ||
    row.template_params_json !== null ||
    row.template_country !== null ||
    row.invoice_id !== null
  ) {
    return failInvalidMailboxRow(row.id, 'legacy metadata is unexpectedly populated');
  }
  return assertMessage(row.id, {
    id: String(row.id),
    recipient: row.recipient,
    subject: row.subject,
    body: row.body,
    kind: parseLegacyMailboxKind(row.kind),
    created: row.created_at,
  });
}

export interface MailboxRepository {
  add(input: MailboxAddInput): void;
  list(): MailboxMessageType[];
}

export function createMailboxRepository(db: Database.Database): MailboxRepository {
  return {
    add(input) {
      if (input.kind === 'invoice_issued') {
        if (!Number.isSafeInteger(input.invoiceId) || input.invoiceId < 1) {
          throw new Error(`Invalid mailbox invoice id: ${String(input.invoiceId)}`);
        }
        // Subject/body remain blank by design. Readers hydrate the immutable invoice document by
        // id; persisting generated/localized prose would create a second mutable source of truth.
        db.prepare(
          `INSERT INTO dev_mailbox
             (recipient, subject, body, kind, created_at, invoice_id)
           VALUES (?, ?, ?, 'invoice_issued', ?, ?)`,
        ).run(input.recipient, '', '', input.createdAt, input.invoiceId);
        return;
      }

      if (input.kind === 'template') {
        if (!Value.Check(SystemMailboxTemplateKey, input.templateKey)) {
          throw new Error(`Unsupported mailbox template key: ${String(input.templateKey)}`);
        }
        if (!Value.Check(Country, input.country)) {
          throw new Error(`Unsupported mailbox template country: ${String(input.country)}`);
        }
        const schema = SystemMailboxTemplateParamsByKeySchema[input.templateKey];
        if (!schema || !Value.Check(schema, input.templateParams)) {
          throw new Error(`Invalid mailbox template parameters: ${input.templateKey}`);
        }
        db.prepare(
          `INSERT INTO dev_mailbox
             (recipient, subject, body, kind, created_at, template_key, template_params_json,
              template_country)
           VALUES (?, ?, ?, 'template', ?, ?, ?, ?)`,
        ).run(
          input.recipient,
          input.subject,
          input.body,
          input.createdAt,
          input.templateKey,
          JSON.stringify(input.templateParams),
          input.country,
        );
        return;
      }

      if (input.kind === 'order_receipt') {
        if (!Number.isSafeInteger(input.orderId) || input.orderId < 1) {
          throw new Error(`Invalid mailbox receipt order id: ${String(input.orderId)}`);
        }
        db.prepare(
          `INSERT INTO dev_mailbox
             (recipient, subject, body, kind, created_at, order_id)
           VALUES (?, ?, ?, 'order_receipt', ?, ?)`,
        ).run(input.recipient, input.subject, input.body, input.createdAt, input.orderId);
        return;
      }

      // Validate before writing so reserved/unknown raw kinds cannot become unreadable rows.
      const kind = parseLegacyMailboxKind(input.kind);
      db.prepare(
        `INSERT INTO dev_mailbox (recipient, subject, body, kind, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(input.recipient, input.subject, input.body, kind, input.createdAt);
    },
    list() {
      const rows = db
        .prepare(
          `SELECT m.id, m.recipient, m.subject, m.body, m.kind, m.created_at,
                  m.order_id, m.template_key, m.template_params_json, m.template_country,
                  m.invoice_id, i.document_json AS invoice_document_json,
                  o.id AS owning_order_id, o.country AS owning_country,
                  o.subtotal_cents AS owning_subtotal_cents,
                  o.discount_cents AS owning_discount_cents,
                  o.total_cents AS owning_total_cents,
                  o.delivery_charge_cents AS owning_delivery_charge_cents,
                  o.delivery_slot_date AS owning_delivery_slot_date,
                  o.delivery_slot_window AS owning_delivery_slot_window,
                  o.purchase_order_reference AS owning_purchase_order_reference
           FROM dev_mailbox m
           LEFT JOIN orders o ON o.id = m.order_id
           LEFT JOIN invoices i ON i.id = m.invoice_id
           ORDER BY m.created_at DESC, m.id DESC`,
        )
        .all() as MailboxRow[];
      return rows.map(mapMailboxRow);
    },
  };
}
