import type Database from 'better-sqlite3';
import { Value } from '@sinclair/typebox/value';
import type { Country } from '@shop/contracts/country';
import { BillingEntitySnapshot } from '@shop/contracts/trade-account';
import {
  Invoice,
  InvoiceLifecycle,
  InvoiceLifecycleEvent,
  InvoiceSettlement,
  type InvoiceDocumentV1,
  type InvoiceLifecycleStatus,
  parseInvoiceV1,
} from '@shop/contracts/trade-credit';
import { deriveInvoiceLifecycleStatus } from '../tradeCredit/tradeCreditRules.js';

const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
const INVOICE_SEQUENCE_MAX = 999_999;

/** Persistence shape owned by the invoice repository. */
export interface InvoiceRow {
  id: number;
  version: 1;
  invoice_number: string;
  order_id: number;
  payment_idempotency_key: string;
  company_id: number;
  user_id: number;
  country: Country;
  currency: 'GBP';
  terms: 'net_30';
  terms_days: 30;
  document_json: string;
  net_cents: number;
  vat_rate_basis_points: number;
  vat_cents: number;
  gross_cents: number;
  issued_at: string;
  due_at: string;
}

interface InvoiceStateRow {
  invoice_id: number;
  status: InvoiceLifecycleStatus;
  version: number;
  settled_at: string | null;
  updated_at: string;
}

export interface InvoiceEventRow {
  id: number;
  invoice_id: number;
  event_type: InvoiceLifecycleEvent['type'];
  occurred_at: string;
  idempotency_key: string | null;
  request_fingerprint: string | null;
  actor_user_id: number | null;
}

export interface InvoiceAdminListQuery {
  companyId?: number;
  status?: InvoiceLifecycleStatus;
  /** Standing administrator country. Omitted only for legacy in-process callers. */
  country?: Country;
  page: number;
  pageSize: number;
  /** Read-time clock value used to derive open versus overdue. */
  now?: string;
}

export interface InvoiceInsert {
  id: number;
  invoiceNumber: string;
  orderId: number;
  paymentIdempotencyKey: string;
  companyId: number;
  userId: number;
  country: Country;
  document: InvoiceDocumentV1;
  netCents: number;
  vatRateBasisPoints: number;
  vatCents: number;
  grossCents: number;
  issuedAt: string;
  dueAt: string;
}

export interface InvoiceLifecycleUpdate {
  invoiceId: number;
  expectedVersion: number;
  nextStatus: 'paid' | 'voided';
  settledAt: string | null;
  updatedAt: string;
}

/** Frozen order facts that may be reviewed by an invoice issuer. */
export interface InvoiceOrderReview {
  id: number;
  country: Country;
  paymentMethod: 'card' | 'trade_credit';
  companyId: number | null;
  userId: number | null;
  netCents: number | null;
  vatRateBasisPoints: number | null;
  vatCents: number | null;
  grossCents: number | null;
  billingEntity: import('@shop/contracts/trade-account').BillingEntitySnapshot | null;
  purchaseOrderReference: string | null;
  lines: Array<{
    lineId: number;
    productId: number;
    description: string;
    quantity: number;
    unitPriceCents: number;
    netCents: number;
    variantId: number | null;
    sku: string | null;
  }>;
}

/** Payment facts used to verify the reviewed invoice/payment link. */
export interface InvoicePaymentReview {
  id: number;
  orderId: number | null;
  idempotencyKey: string;
  paymentMethod: 'card' | 'trade_credit';
  companyId: number | null;
  amountCents: number;
  status: string;
}

export interface InvoiceExposureRelease {
  released: boolean;
  mismatch: boolean;
}

export interface InvoiceRepository {
  /** Allocates the next six-digit number for a UTC calendar year. Caller owns the transaction. */
  allocateNumber(year: number): string;
  /** Returns the next AUTOINCREMENT-compatible identity while the caller holds the write lock. */
  nextId(): number;
  insert(input: InvoiceInsert): number;
  insertState(input: {
    invoiceId: number;
    status?: 'open';
    version?: number;
    settledAt?: string | null;
    updatedAt: string;
  }): void;
  insertEvent(input: {
    invoiceId: number;
    type: InvoiceLifecycleEvent['type'];
    occurredAt: string;
    idempotencyKey?: string | null;
    requestFingerprint?: string | null;
    actorUserId?: number | null;
  }): number;
  findEventByIdempotencyKey(idempotencyKey: string): InvoiceEventRow | undefined;
  /** Takes SQLite's writer lock before a lifecycle read/CAS race. Caller owns the transaction. */
  lockLifecycle?(invoiceId: number): void;
  updateLifecycle(input: InvoiceLifecycleUpdate): boolean;
  /** Links the authorized exposure hold to its immutable invoice identity. */
  commitExposureHold(input: {
    invoiceId: number;
    paymentIdempotencyKey: string;
    companyId: number;
    grossCents: number;
    committedAt: string;
  }): boolean;
  /** Releases only a hold linked to the same invoice and exact immutable gross amount. */
  releaseExposure(input: {
    invoiceId: number;
    grossCents: number;
    releasedAt: string;
  }): InvoiceExposureRelease;
  findById(invoiceId: number, now?: string): Invoice | undefined;
  findByOrderId(orderId: number, now?: string): Invoice | undefined;
  findByPaymentIdempotencyKey(paymentIdempotencyKey: string, now?: string): Invoice | undefined;
  /** Optional source readers used by issue() to verify reviewed order/payment facts. */
  findOrderForIssue?(orderId: number): InvoiceOrderReview | undefined;
  findPaymentForIssue?(paymentIdempotencyKey: string): InvoicePaymentReview | undefined;
  findOwnedById(invoiceId: number, userId: number, now?: string): Invoice | undefined;
  findAdminById(invoiceId: number, country?: Country, now?: string): Invoice | undefined;
  listAdmin(query: InvoiceAdminListQuery): { items: Invoice[]; total: number };
}

const invoiceColumns = `id, version, invoice_number, order_id, payment_idempotency_key,
  company_id, user_id, country, currency, terms, terms_days, document_json, net_cents,
  vat_rate_basis_points, vat_cents, gross_cents, issued_at, due_at`;

const stateColumns = 'invoice_id, status, version, settled_at, updated_at';
const eventColumns =
  'id, invoice_id, event_type, occurred_at, idempotency_key, request_fingerprint, actor_user_id';

function failCorrupt(invoiceId: number, detail: string): never {
  throw new Error(`Invoice ${invoiceId} is corrupt: ${detail}`);
}

function parseDocument(row: InvoiceRow): InvoiceDocumentV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.document_json);
  } catch {
    return failCorrupt(row.id, 'document JSON is not readable');
  }
  let document: InvoiceDocumentV1;
  try {
    document = parseInvoiceV1(parsed);
  } catch {
    return failCorrupt(row.id, 'document is not valid invoice V1');
  }
  if (
    document.id !== String(row.id) ||
    document.invoiceNumber !== row.invoice_number ||
    document.orderId !== String(row.order_id) ||
    document.companyId !== String(row.company_id) ||
    document.userId !== String(row.user_id) ||
    document.country !== row.country ||
    document.currency !== row.currency ||
    document.netCents !== row.net_cents ||
    document.vatRateBasisPoints !== row.vat_rate_basis_points ||
    document.vatCents !== row.vat_cents ||
    document.grossCents !== row.gross_cents ||
    document.issuedAt !== row.issued_at ||
    document.dueAt !== row.due_at
  ) {
    return failCorrupt(row.id, 'document disagrees with immutable columns');
  }
  if (
    document.paymentIdempotencyKey !== undefined &&
    document.paymentIdempotencyKey !== row.payment_idempotency_key
  ) {
    return failCorrupt(row.id, 'document disagrees with payment identity');
  }
  return document;
}

function mapEvent(row: InvoiceEventRow): InvoiceLifecycleEvent {
  const event: Record<string, unknown> = {
    id: String(row.id),
    invoiceId: String(row.invoice_id),
    type: row.event_type,
    occurredAt: row.occurred_at,
  };
  if (row.idempotency_key !== null) event.idempotencyKey = row.idempotency_key;
  if (row.actor_user_id !== null) event.actorUserId = String(row.actor_user_id);
  if (!Value.Check(InvoiceLifecycleEvent, event)) {
    return failCorrupt(row.invoice_id, `event ${row.id} is invalid`);
  }
  return event;
}

function mapInvoice(
  row: InvoiceRow,
  state: InvoiceStateRow,
  eventRows: InvoiceEventRow[],
  now: string,
): Invoice {
  const document = parseDocument(row);
  const lifecycleStatus = deriveInvoiceLifecycleStatus({
    dueAt: document.dueAt,
    now,
    status: state.status,
  });
  const lifecycle = {
    invoiceId: String(row.id),
    status: lifecycleStatus,
    version: state.version,
    settledAt: state.settled_at,
    updatedAt: state.updated_at,
  };
  if (!Value.Check(InvoiceLifecycle, lifecycle)) {
    return failCorrupt(row.id, 'lifecycle projection is invalid');
  }

  const events = eventRows.map(mapEvent);
  const issuedEvents = events.filter((event) => event.type === 'issued');
  const settledEvents = events.filter((event) => event.type === 'settled');
  const voidedEvents = events.filter((event) => event.type === 'voided');
  if (issuedEvents.length !== 1)
    return failCorrupt(row.id, 'issued event is missing or duplicated');
  if (state.status === 'paid' && settledEvents.length !== 1) {
    return failCorrupt(row.id, 'paid invoice has no unique settlement event');
  }
  if (state.status !== 'paid' && settledEvents.length !== 0) {
    return failCorrupt(row.id, 'unpaid invoice has a settlement event');
  }
  if (state.status === 'voided' && voidedEvents.length !== 1) {
    return failCorrupt(row.id, 'voided invoice has no unique void event');
  }
  if (state.status !== 'voided' && voidedEvents.length !== 0) {
    return failCorrupt(row.id, 'non-voided invoice has a void event');
  }

  let settlement: InvoiceSettlement | null = null;
  if (settledEvents.length === 1) {
    const event = settledEvents[0]!;
    if (state.settled_at !== event.occurredAt || event.idempotencyKey === undefined) {
      return failCorrupt(row.id, 'settlement event disagrees with lifecycle');
    }
    settlement = {
      id: event.id,
      invoiceId: String(row.id),
      amountCents: document.grossCents,
      currency: 'GBP',
      status: 'settled',
      idempotencyKey: event.idempotencyKey,
      settledAt: event.occurredAt,
      createdAt: event.occurredAt,
      version: state.version,
    };
    if (!Value.Check(InvoiceSettlement, settlement)) {
      return failCorrupt(row.id, 'settlement record is invalid');
    }
  }

  const invoice = {
    ...document,
    status: lifecycleStatus,
    lifecycleStatus,
    lifecycleVersion: state.version,
    settledAt: state.settled_at,
    lifecycle,
    settlement,
    events,
  };
  if (!Value.Check(Invoice, invoice)) {
    return failCorrupt(row.id, 'invoice envelope is invalid');
  }
  return invoice;
}

function validYear(year: number): void {
  if (!Number.isSafeInteger(year) || year < 1000 || year > 9999) {
    throw new RangeError('Invoice sequence year must be a four-digit integer');
  }
}

function validPositiveId(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_SAFE_INTEGER) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
}

export function createInvoiceRepository(db: Database.Database): InvoiceRepository {
  // Two checkout/admin workers may share a local database file. A bounded busy timeout lets the
  // second lifecycle command wait for the first transaction and then evaluate its version CAS.
  db.pragma('busy_timeout = 5000');

  const loadRow = (invoiceId: number): InvoiceRow | undefined =>
    db.prepare(`SELECT ${invoiceColumns} FROM invoices WHERE id = ?`).get(invoiceId) as
      InvoiceRow | undefined;

  const loadState = (invoiceId: number): InvoiceStateRow | undefined =>
    db.prepare(`SELECT ${stateColumns} FROM invoice_states WHERE invoice_id = ?`).get(invoiceId) as
      InvoiceStateRow | undefined;

  const loadEvents = (invoiceId: number): InvoiceEventRow[] =>
    db
      .prepare(
        `SELECT ${eventColumns} FROM invoice_events
         WHERE invoice_id = ? ORDER BY occurred_at ASC, id ASC`,
      )
      .all(invoiceId) as InvoiceEventRow[];

  const hydrate = (invoiceId: number, now = new Date().toISOString()): Invoice | undefined => {
    const row = loadRow(invoiceId);
    if (!row) return undefined;
    const state = loadState(invoiceId);
    if (!state) return failCorrupt(invoiceId, 'lifecycle projection is missing');
    return mapInvoice(row, state, loadEvents(invoiceId), now);
  };

  return {
    allocateNumber(year) {
      validYear(year);
      db.prepare(
        `INSERT INTO invoice_sequences (year, next_number) VALUES (?, 1)
         ON CONFLICT(year) DO NOTHING`,
      ).run(year);
      const row = db
        .prepare('SELECT next_number FROM invoice_sequences WHERE year = ?')
        .get(year) as { next_number: number } | undefined;
      if (!row) throw new Error('Invoice sequence row disappeared');
      if (row.next_number > INVOICE_SEQUENCE_MAX) {
        throw new Error(`Invoice number sequence exhausted for ${year}`);
      }
      const invoiceNumber = `QME-${year}-${String(row.next_number).padStart(6, '0')}`;
      if (row.next_number < INVOICE_SEQUENCE_MAX) {
        const changed = db
          .prepare(
            `UPDATE invoice_sequences SET next_number = next_number + 1
             WHERE year = ? AND next_number = ?`,
          )
          .run(year, row.next_number).changes;
        if (changed !== 1) throw new Error('Invoice number sequence changed during allocation');
      } else {
        // The migration deliberately bounds next_number to six digits, so the final number is
        // reserved by leaving the row at the upper bound. Once that number is committed, a later
        // allocation sees the unique invoice row and reports exhaustion; a rolled-back issuance
        // leaves no invoice row and may safely reuse this candidate.
        db.prepare('UPDATE invoice_sequences SET next_number = next_number WHERE year = ?').run(
          year,
        );
        const alreadyIssued = db
          .prepare('SELECT 1 FROM invoices WHERE invoice_number = ?')
          .get(invoiceNumber);
        if (alreadyIssued) throw new Error(`Invoice number sequence exhausted for ${year}`);
      }
      return invoiceNumber;
    },

    nextId() {
      const row = db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS id FROM invoices').get() as {
        id: number;
      };
      validPositiveId(row.id, 'invoice id');
      return row.id;
    },

    insert(input) {
      validPositiveId(input.id, 'invoice id');
      const result = db
        .prepare(
          `INSERT INTO invoices
           (id, version, invoice_number, order_id, payment_idempotency_key, company_id, user_id,
            country, currency, terms, terms_days, document_json, net_cents,
            vat_rate_basis_points, vat_cents, gross_cents, issued_at, due_at)
           VALUES (?, 1, ?, ?, ?, ?, ?, ?, 'GBP', 'net_30', 30, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.id,
          input.invoiceNumber,
          input.orderId,
          input.paymentIdempotencyKey,
          input.companyId,
          input.userId,
          input.country,
          JSON.stringify(input.document),
          input.netCents,
          input.vatRateBasisPoints,
          input.vatCents,
          input.grossCents,
          input.issuedAt,
          input.dueAt,
        );
      return Number(result.lastInsertRowid);
    },

    insertState(input) {
      db.prepare(
        `INSERT INTO invoice_states (invoice_id, status, version, settled_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(
        input.invoiceId,
        input.status ?? 'open',
        input.version ?? 0,
        input.settledAt ?? null,
        input.updatedAt,
      );
    },

    insertEvent(input) {
      const result = db
        .prepare(
          `INSERT INTO invoice_events
           (invoice_id, event_type, occurred_at, idempotency_key, request_fingerprint, actor_user_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.invoiceId,
          input.type,
          input.occurredAt,
          input.idempotencyKey ?? null,
          input.requestFingerprint ?? null,
          input.actorUserId ?? null,
        );
      return Number(result.lastInsertRowid);
    },

    findEventByIdempotencyKey(idempotencyKey) {
      return db
        .prepare(`SELECT ${eventColumns} FROM invoice_events WHERE idempotency_key = ?`)
        .get(idempotencyKey) as InvoiceEventRow | undefined;
    },

    lockLifecycle(invoiceId) {
      db.prepare(`UPDATE invoice_states SET updated_at = updated_at WHERE invoice_id = ?`).run(
        invoiceId,
      );
    },

    updateLifecycle(input) {
      return (
        db
          .prepare(
            `UPDATE invoice_states
             SET status = ?, version = version + 1, settled_at = ?, updated_at = ?
             WHERE invoice_id = ? AND version = ? AND status IN ('open', 'overdue')`,
          )
          .run(
            input.nextStatus,
            input.settledAt,
            input.updatedAt,
            input.invoiceId,
            input.expectedVersion,
          ).changes === 1
      );
    },

    commitExposureHold(input) {
      const hold = db
        .prepare(
          `SELECT hold.id, hold.invoice_id, hold.company_id, hold.amount_cents, hold.status,
                  payment.status AS payment_status
           FROM credit_exposure_holds hold
           JOIN payments payment
             ON payment.idempotency_key = hold.payment_idempotency_key
          WHERE hold.payment_idempotency_key = ?`,
        )
        .get(input.paymentIdempotencyKey) as
        | {
            id: number;
            invoice_id: number | null;
            company_id: number;
            amount_cents: number;
            status: 'prepared' | 'authorized' | 'committed' | 'released';
            payment_status: string;
          }
        | undefined;
      if (!hold) return false;
      if (
        hold.company_id !== input.companyId ||
        hold.amount_cents !== input.grossCents ||
        (hold.invoice_id !== null && hold.invoice_id !== input.invoiceId)
      ) {
        throw new Error('Credit exposure hold does not match invoice facts');
      }
      if (hold.status === 'released') {
        throw new Error('Credit exposure hold is already released');
      }
      if (hold.invoice_id === input.invoiceId && hold.status === 'committed') return true;
      if (hold.status === 'committed') {
        throw new Error('Credit exposure hold is already committed to another invoice');
      }
      if (hold.status !== 'authorized') {
        throw new Error('Credit exposure hold is not authorized');
      }
      if (hold.payment_status !== 'authorized_pending_finalize') {
        throw new Error('Payment is not authorized for invoice finalization');
      }
      return (
        db
          .prepare(
            `UPDATE credit_exposure_holds
             SET invoice_id = ?, status = 'committed', committed_at = ?, updated_at = ?
             WHERE id = ? AND invoice_id IS NULL
               AND status = 'authorized'`,
          )
          .run(input.invoiceId, input.committedAt, input.committedAt, hold.id).changes === 1
      );
    },

    releaseExposure(input) {
      const holds = db
        .prepare(`SELECT id, amount_cents, status FROM credit_exposure_holds WHERE invoice_id = ?`)
        .all(input.invoiceId) as Array<{
        id: number;
        amount_cents: number;
        status: 'prepared' | 'authorized' | 'committed' | 'released';
      }>;
      if (holds.some((hold) => hold.amount_cents !== input.grossCents)) {
        return { released: false, mismatch: true };
      }
      if (holds.length === 0) return { released: false, mismatch: false };
      const result = db
        .prepare(
          `UPDATE credit_exposure_holds
           SET status = 'released', released_at = ?, updated_at = ?
           WHERE invoice_id = ? AND amount_cents = ?
             AND status IN ('prepared', 'authorized', 'committed')`,
        )
        .run(input.releasedAt, input.releasedAt, input.invoiceId, input.grossCents);
      return { released: result.changes > 0, mismatch: false };
    },

    findById: (invoiceId, now) => hydrate(invoiceId, now),

    findByOrderId(orderId, now) {
      const row = db.prepare('SELECT id FROM invoices WHERE order_id = ?').get(orderId) as
        { id: number } | undefined;
      return row ? hydrate(row.id, now) : undefined;
    },

    findByPaymentIdempotencyKey(paymentIdempotencyKey, now) {
      const row = db
        .prepare('SELECT id FROM invoices WHERE payment_idempotency_key = ?')
        .get(paymentIdempotencyKey) as { id: number } | undefined;
      return row ? hydrate(row.id, now) : undefined;
    },

    findOrderForIssue(orderId) {
      const row = db
        .prepare(
          `SELECT id, country, payment_method, company_id, user_id, net_cents,
                  vat_rate_basis_points, vat_cents, gross_cents, billing_entity_json,
                  purchase_order_reference
           FROM orders WHERE id = ?`,
        )
        .get(orderId) as
        | {
            id: number;
            country: Country;
            payment_method: 'card' | 'trade_credit';
            company_id: number | null;
            user_id: number | null;
            net_cents: number | null;
            vat_rate_basis_points: number | null;
            vat_cents: number | null;
            gross_cents: number | null;
            billing_entity_json: string | null;
            purchase_order_reference: string | null;
          }
        | undefined;
      if (!row) return undefined;

      let billingEntity: InvoiceOrderReview['billingEntity'] = null;
      if (row.billing_entity_json !== null) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(row.billing_entity_json);
        } catch {
          throw new Error(`Order ${orderId} has an unreadable billing entity snapshot`);
        }
        if (!Value.Check(BillingEntitySnapshot, parsed)) {
          throw new Error(`Order ${orderId} has an invalid billing entity snapshot`);
        }
        billingEntity = parsed;
      }

      const lines = db
        .prepare(
          `SELECT id, product_id, product_name, quantity, product_price_cents,
                  line_total_cents, variant_id, sku
           FROM order_line_items WHERE order_id = ? ORDER BY id ASC`,
        )
        .all(orderId) as Array<{
        id: number;
        product_id: number;
        product_name: string;
        quantity: number;
        product_price_cents: number;
        line_total_cents: number;
        variant_id: number | null;
        sku: string | null;
      }>;
      return {
        id: row.id,
        country: row.country,
        paymentMethod: row.payment_method,
        companyId: row.company_id,
        userId: row.user_id,
        netCents: row.net_cents,
        vatRateBasisPoints: row.vat_rate_basis_points,
        vatCents: row.vat_cents,
        grossCents: row.gross_cents,
        billingEntity,
        purchaseOrderReference: row.purchase_order_reference,
        lines: lines.map((line) => ({
          lineId: line.id,
          productId: line.product_id,
          description: line.product_name,
          quantity: line.quantity,
          unitPriceCents: line.product_price_cents,
          netCents: line.line_total_cents,
          variantId: line.variant_id,
          sku: line.sku,
        })),
      };
    },

    findPaymentForIssue(paymentIdempotencyKey) {
      const row = db
        .prepare(
          `SELECT id, order_id, idempotency_key, payment_method, company_id, amount_cents, status
           FROM payments WHERE idempotency_key = ?`,
        )
        .get(paymentIdempotencyKey) as
        | {
            id: number;
            order_id: number | null;
            idempotency_key: string;
            payment_method: 'card' | 'trade_credit';
            company_id: number | null;
            amount_cents: number;
            status: string;
          }
        | undefined;
      return row
        ? {
            id: row.id,
            orderId: row.order_id,
            idempotencyKey: row.idempotency_key,
            paymentMethod: row.payment_method,
            companyId: row.company_id,
            amountCents: row.amount_cents,
            status: row.status,
          }
        : undefined;
    },

    findOwnedById(invoiceId, userId, now) {
      const row = db
        .prepare(
          `SELECT i.id FROM invoices i JOIN orders o ON o.id = i.order_id
           WHERE i.id = ? AND o.user_id = ?`,
        )
        .get(invoiceId, userId) as { id: number } | undefined;
      return row ? hydrate(row.id, now) : undefined;
    },

    findAdminById(invoiceId, country, now) {
      const row = db
        .prepare(
          `SELECT id FROM invoices WHERE id = ?${country === undefined ? '' : ' AND country = ?'}`,
        )
        .get(...(country === undefined ? [invoiceId] : [invoiceId, country])) as
        { id: number } | undefined;
      return row ? hydrate(row.id, now) : undefined;
    },

    listAdmin(query) {
      const where: string[] = [];
      const params: Array<string | number> = [];
      if (query.country !== undefined) {
        where.push('i.country = ?');
        params.push(query.country);
      }
      if (query.companyId !== undefined) {
        where.push('i.company_id = ?');
        params.push(query.companyId);
      }
      const now = query.now ?? new Date().toISOString();
      if (query.status === 'paid' || query.status === 'voided') {
        where.push('s.status = ?');
        params.push(query.status);
      } else if (query.status === 'open') {
        where.push("s.status IN ('open', 'overdue') AND i.due_at > ?");
        params.push(now);
      } else if (query.status === 'overdue') {
        where.push("s.status IN ('open', 'overdue') AND i.due_at <= ?");
        params.push(now);
      }
      const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const count = db
        .prepare(
          `SELECT COUNT(*) AS count FROM invoices i
           JOIN invoice_states s ON s.invoice_id = i.id ${clause}`,
        )
        .get(...params) as { count: number };
      const rows = db
        .prepare(
          `SELECT i.id FROM invoices i
           JOIN invoice_states s ON s.invoice_id = i.id ${clause}
           ORDER BY i.issued_at DESC, i.id DESC LIMIT ? OFFSET ?`,
        )
        .all(...params, query.pageSize, (query.page - 1) * query.pageSize) as Array<{ id: number }>;
      return {
        items: rows.map((row) => hydrate(row.id, now)!).filter(Boolean),
        total: count.count,
      };
    },
  };
}
