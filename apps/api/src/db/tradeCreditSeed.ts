import { LEGACY_DATA_COUNTRY } from '@shop/contracts';
import type Database from 'better-sqlite3';
import { ACME_CREDIT_TERMS_DAYS } from './companyAccountsSeed.js';
import { createInvoiceRepository } from '../features/invoices/invoiceRepository.js';

const SEED_INSTANT = '2026-08-01T09:00:00.000Z';
const OPEN_ISSUED_AT = '2026-08-20T09:00:00.000Z';
const PAID_ORDER_CREATED_AT = '2026-08-03T09:00:00.000Z';
const PAID_ISSUED_AT = '2026-08-04T09:00:00.000Z';
const PAID_SETTLED_AT = '2026-08-05T09:00:00.000Z';
const PAID_DELIVERY_DATE = '2026-08-06';
const VAT_RATE_BASIS_POINTS = 2_000;
const CREDIT_POLICY_IDEMPOTENCY_KEY = 'seed-acme-credit-policy-v1';
const CREDIT_POLICY_FINGERPRINT = 'seed-acme-credit-policy-v1';
const PRODUCT_SKU = 'BKP-0001-001';
const INVOICE_EVENT_IDEMPOTENCY_KEYS = {
  'acme-credit-open:issued': '00000000-0000-4000-8000-000000000701',
  'acme-credit-paid:issued': '00000000-0000-4000-8000-000000000702',
  'acme-credit-paid:settled': '00000000-0000-4000-8000-000000000703',
} as const;

/** Stable business keys for the two local trade-credit invoice states. */
export const DEMO_TRADE_CREDIT_SCENARIO_KEYS = ['acme-credit-open', 'acme-credit-paid'] as const;

type ScenarioKey = (typeof DEMO_TRADE_CREDIT_SCENARIO_KEYS)[number];

type Scenario = {
  key: ScenarioKey;
  invoiceNumber: string;
  orderCreatedAt: string;
  issuedAt: string;
  settledAt: string | null;
  quantity: number;
  purchaseOrderReference: string;
};

const SCENARIOS: readonly Scenario[] = [
  {
    key: 'acme-credit-open',
    invoiceNumber: 'QME-2026-000701',
    orderCreatedAt: OPEN_ISSUED_AT,
    issuedAt: OPEN_ISSUED_AT,
    settledAt: null,
    quantity: 4,
    purchaseOrderReference: 'ACME-CREDIT-OPEN',
  },
  {
    key: 'acme-credit-paid',
    invoiceNumber: 'QME-2026-000702',
    orderCreatedAt: PAID_ORDER_CREATED_AT,
    issuedAt: PAID_ISSUED_AT,
    settledAt: PAID_SETTLED_AT,
    quantity: 8,
    purchaseOrderReference: 'ACME-CREDIT-PAID',
  },
];

type UserRow = { id: number; display_name: string; email: string };
type CompanyRow = {
  id: number;
  active: number;
  credit_limit_cents: number;
  credit_terms_days: number;
  credit_state: string;
  credit_version: number;
};
type ProductVariantRow = {
  product_id: number;
  product_name: string;
  product_price_cents: number;
  product_consumption_classification: string;
  variant_id: number;
  sku: string;
  variant_label: string;
  weight_grams: number;
  variant_price_cents: number;
  delivery_class: string;
};
type OrderRow = {
  id: number;
  customer_name: string;
  customer_email: string;
  created_at: string;
  user_id: number | null;
  net_cents: number;
  vat_rate_basis_points: number;
  vat_cents: number;
  gross_cents: number;
  billing_entity_json: string | null;
  purchase_order_reference: string | null;
};
type LineRow = {
  id: number;
  product_id: number;
  product_name: string;
  product_price_cents: number;
  quantity: number;
  line_total_cents: number;
  variant_id: number | null;
  sku: string | null;
};

function findUser(db: Database.Database, email: string): UserRow | undefined {
  return db
    .prepare(
      `SELECT id, display_name, email
       FROM users WHERE email = ? AND country = ?
       LIMIT 1`,
    )
    .get(email, LEGACY_DATA_COUNTRY) as UserRow | undefined;
}

function findCompany(db: Database.Database, ownerId: number): CompanyRow | undefined {
  return db
    .prepare(
      `SELECT id, active, credit_limit_cents, credit_terms_days, credit_state, credit_version
       FROM company_accounts
       WHERE created_by_user_id = ? AND name = 'Acme Materials Ltd'
       ORDER BY id LIMIT 1`,
    )
    .get(ownerId) as CompanyRow | undefined;
}

function findProductVariant(db: Database.Database): ProductVariantRow | undefined {
  return db
    .prepare(
      `SELECT p.id AS product_id, p.name AS product_name, p.price_cents AS product_price_cents,
              p.consumption_classification AS product_consumption_classification,
              v.id AS variant_id, v.sku, v.label AS variant_label, v.weight_grams,
              v.price_cents AS variant_price_cents, v.delivery_class
       FROM products p
       JOIN product_variants v ON v.product_id = p.id
       WHERE v.sku = ?
       LIMIT 1`,
    )
    .get(PRODUCT_SKU) as ProductVariantRow | undefined;
}

function findOrder(db: Database.Database, key: string): OrderRow | undefined {
  return db
    .prepare(
      `SELECT id, customer_name, customer_email, created_at, user_id,
              net_cents, vat_rate_basis_points, vat_cents, gross_cents,
              billing_entity_json, purchase_order_reference
       FROM orders WHERE demo_seed_key = ? LIMIT 1`,
    )
    .get(key) as OrderRow | undefined;
}

function findLine(db: Database.Database, orderId: number): LineRow | undefined {
  return db
    .prepare(
      `SELECT id, product_id, product_name, product_price_cents, quantity, line_total_cents,
              variant_id, sku
       FROM order_line_items WHERE order_id = ? ORDER BY id LIMIT 1`,
    )
    .get(orderId) as LineRow | undefined;
}

function nextInvoiceId(db: Database.Database): number {
  const maxId = (
    db.prepare('SELECT COALESCE(MAX(id), 0) AS value FROM invoices').get() as {
      value: number;
    }
  ).value;
  const sequence = db
    .prepare("SELECT COALESCE(seq, 0) AS value FROM sqlite_sequence WHERE name = 'invoices'")
    .get() as { value: number } | undefined;
  return Math.max(maxId, sequence?.value ?? 0) + 1;
}

type InvoiceIdentity = { id: number; invoiceNumber: string };

function invoiceNumberParts(invoiceNumber: string): { year: number; nextNumber: number } {
  const match = /^QME-(\d{4})-(\d{6})$/.exec(invoiceNumber);
  if (!match) throw new Error(`Invalid seeded invoice number ${invoiceNumber}`);
  return { year: Number(match[1]), nextNumber: Number(match[2]) };
}

function ensureInvoiceSequenceFloor(db: Database.Database, invoiceNumber: string): number {
  const { year, nextNumber } = invoiceNumberParts(invoiceNumber);
  const highestExisting = db
    .prepare(
      `SELECT COALESCE(MAX(CAST(substr(invoice_number, 10, 6) AS INTEGER)), 0) AS value
       FROM invoices WHERE substr(invoice_number, 5, 4) = ?`,
    )
    .get(String(year)) as { value: number };
  const sequenceFloor = Math.max(nextNumber, highestExisting.value + 1);
  db.prepare(
    `INSERT INTO invoice_sequences (year, next_number) VALUES (?, ?)
     ON CONFLICT(year) DO UPDATE SET next_number = MAX(invoice_sequences.next_number, excluded.next_number)`,
  ).run(year, sequenceFloor);
  return year;
}

/**
 * Allocates from the production invoice sequence while retaining the preferred demo number when
 * it is available. Existing higher sequence values are never lowered. A number already occupied
 * by a local invoice is consumed and skipped before the next sequence value is considered.
 */
function allocateSeedInvoiceNumber(db: Database.Database, preferredNumber: string): string {
  const year = ensureInvoiceSequenceFloor(db, preferredNumber);

  const invoices = createInvoiceRepository(db);
  for (;;) {
    const invoiceNumber = invoices.allocateNumber(year);
    const occupied = db
      .prepare('SELECT 1 FROM invoices WHERE invoice_number = ? LIMIT 1')
      .get(invoiceNumber);
    if (!occupied) return invoiceNumber;
  }
}

function dueAt(issuedAt: string): string {
  return new Date(
    Date.parse(issuedAt) + ACME_CREDIT_TERMS_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
}

function billingEntity(): Record<string, unknown> {
  return {
    legalName: 'Acme Materials Ltd',
    registrationNumber: null,
    vatNumber: null,
    address: {
      line1: '1 Acme Way',
      city: 'Demo City',
      postcode: 'DC1 1AA',
      countryCode: LEGACY_DATA_COUNTRY,
    },
  };
}

function shippingAddress(): Record<string, unknown> {
  return {
    line1: '1 Acme Way',
    city: 'Demo City',
    postcode: 'DC1 1AA',
    countryCode: LEGACY_DATA_COUNTRY,
  };
}

function parseBillingEntity(json: string | null): Record<string, unknown> {
  if (json === null) return billingEntity();
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  return billingEntity();
}

function insertCreditPolicyEvent(db: Database.Database, company: CompanyRow): void {
  db.prepare(
    `INSERT OR IGNORE INTO company_credit_events
       (company_id, event_type, credit_limit_cents, credit_terms_days, credit_state,
        credit_version, amount_cents, reason, idempotency_key, request_fingerprint, occurred_at)
     VALUES (?, 'policy_seeded', ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
  ).run(
    company.id,
    company.credit_limit_cents,
    company.credit_terms_days,
    company.credit_state,
    company.credit_version,
    'Initial Acme trade-credit policy',
    CREDIT_POLICY_IDEMPOTENCY_KEY,
    CREDIT_POLICY_FINGERPRINT,
    SEED_INSTANT,
  );
}

function insertOrder(
  db: Database.Database,
  scenario: Scenario,
  buyer: UserRow,
  company: CompanyRow,
  product: ProductVariantRow,
): OrderRow | undefined {
  const unitPriceCents = product.variant_price_cents;
  const netCents = unitPriceCents * scenario.quantity;
  const vatCents = Math.floor((netCents * VAT_RATE_BASIS_POINTS + 5_000) / 10_000);
  const grossCents = netCents + vatCents;
  const deliveryWeightGrams = product.weight_grams * scenario.quantity;
  const insert = db.prepare(
    `INSERT OR IGNORE INTO orders
       (customer_name, customer_email, shipping_address, promo_code_applied, subtotal_cents,
        discount_cents, total_cents, created_at, user_id, lifecycle_status, version,
        demo_seed_key, delivery_mode, delivery_charge_cents, delivery_weight_grams,
        delivery_address_json, billing_entity_json, delivery_slot_date, delivery_slot_window,
        purchase_order_reference, country, payment_method, company_id, net_cents,
        vat_rate_basis_points, vat_cents, gross_cents)
     VALUES (?, ?, ?, NULL, ?, 0, ?, ?, ?, ?, 0, ?, ?, 0, ?, ?, ?, ?, 'am', ?, ?, 'trade_credit', ?, ?, ?, ?, ?)`,
  );
  insert.run(
    buyer.display_name,
    buyer.email,
    JSON.stringify(shippingAddress()),
    netCents,
    grossCents,
    scenario.orderCreatedAt,
    buyer.id,
    // No order lifecycle history is seeded for these fixtures, so both remain at the honest
    // initial state. Invoice settlement does not imply that the shipment was delivered.
    'processing',
    scenario.key,
    product.delivery_class,
    deliveryWeightGrams,
    JSON.stringify(shippingAddress()),
    JSON.stringify(billingEntity()),
    scenario.settledAt === null ? '2026-08-21' : PAID_DELIVERY_DATE,
    scenario.purchaseOrderReference,
    LEGACY_DATA_COUNTRY,
    company.id,
    netCents,
    VAT_RATE_BASIS_POINTS,
    vatCents,
    grossCents,
  );
  return findOrder(db, scenario.key);
}

function ensureLine(
  db: Database.Database,
  order: OrderRow,
  product: ProductVariantRow,
  quantity: number,
): LineRow | undefined {
  let line = findLine(db, order.id);
  if (!line) {
    const lineTotalCents = product.variant_price_cents * quantity;
    db.prepare(
      `INSERT INTO order_line_items
         (order_id, product_id, product_name, product_price_cents, quantity, line_total_cents,
          discountable_total_cents, blending_fee_cents, variant_id, sku, variant_label,
          weight_grams, consumption_classification, delivery_class)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
    ).run(
      order.id,
      product.product_id,
      product.product_name,
      product.variant_price_cents,
      quantity,
      lineTotalCents,
      lineTotalCents,
      product.variant_id,
      product.sku,
      product.variant_label,
      product.weight_grams,
      product.product_consumption_classification,
      product.delivery_class,
    );
    line = findLine(db, order.id);
  }
  return line;
}

function ensurePayment(
  db: Database.Database,
  order: OrderRow,
  company: CompanyRow,
  buyer: UserRow,
  scenario: Scenario,
): string {
  const key = `seed-trade-credit-${scenario.key}`;
  db.prepare(
    `INSERT OR IGNORE INTO payments
       (order_id, idempotency_key, request_fingerprint, status, amount_cents, card_last4,
        card_brand, failure_reason, created_at, response_json, payment_method, company_id, user_id)
     VALUES (?, ?, ?, 'succeeded', ?, NULL, NULL, NULL, ?, ?, 'trade_credit', ?, ?)`,
  ).run(
    order.id,
    key,
    `seed-trade-credit-fingerprint-${scenario.key}`,
    order.gross_cents,
    scenario.issuedAt,
    JSON.stringify({ paymentMethod: 'trade_credit', status: 'succeeded' }),
    company.id,
    buyer.id,
  );
  return key;
}

function ensureInvoice(
  db: Database.Database,
  order: OrderRow,
  line: LineRow,
  company: CompanyRow,
  buyer: UserRow,
  scenario: Scenario,
  paymentKey: string,
): InvoiceIdentity | undefined {
  const existing = db
    .prepare(
      `SELECT id, invoice_number, order_id
       FROM invoices WHERE payment_idempotency_key = ? LIMIT 1`,
    )
    .get(paymentKey) as { id: number; invoice_number: string; order_id: number } | undefined;
  // The deterministic payment/order link is the seed identity. Never treat a matching display
  // number as ownership: a local invoice may already use the preferred number.
  if (existing) {
    if (existing.order_id !== order.id) return undefined;
    ensureInvoiceSequenceFloor(db, existing.invoice_number);
    return { id: existing.id, invoiceNumber: existing.invoice_number };
  }
  if (
    order.user_id !== buyer.id ||
    order.net_cents !== line.line_total_cents ||
    order.vat_rate_basis_points !== VAT_RATE_BASIS_POINTS ||
    order.gross_cents !== order.net_cents + order.vat_cents
  ) {
    return undefined;
  }

  const id = nextInvoiceId(db);
  const issuedAt = scenario.issuedAt;
  const invoiceNumber = allocateSeedInvoiceNumber(db, scenario.invoiceNumber);
  const document = {
    version: 1,
    id: String(id),
    invoiceNumber,
    orderId: String(order.id),
    companyId: String(company.id),
    userId: String(buyer.id),
    country: LEGACY_DATA_COUNTRY,
    paymentMethod: 'trade_credit',
    currency: 'GBP',
    terms: 'net_30',
    termsDays: ACME_CREDIT_TERMS_DAYS,
    billingEntity: parseBillingEntity(order.billing_entity_json),
    purchaseOrderReference: scenario.purchaseOrderReference,
    lines: [
      {
        lineId: String(line.id),
        description: line.product_name,
        productId: String(line.product_id),
        ...(line.variant_id === null ? {} : { variantId: String(line.variant_id) }),
        ...(line.sku === null ? {} : { sku: line.sku }),
        quantity: line.quantity,
        unitPriceCents: line.product_price_cents,
        netCents: line.line_total_cents,
      },
    ],
    netCents: order.net_cents,
    vatRateBasisPoints: order.vat_rate_basis_points,
    vatCents: order.vat_cents,
    grossCents: order.gross_cents,
    issuedAt,
    dueAt: dueAt(issuedAt),
  };
  db.prepare(
    `INSERT INTO invoices
       (id, version, invoice_number, order_id, payment_idempotency_key, company_id, user_id,
        country, currency, terms, terms_days, document_json, net_cents,
        vat_rate_basis_points, vat_cents, gross_cents, issued_at, due_at)
     VALUES (?, 1, ?, ?, ?, ?, ?, ?, 'GBP', 'net_30', ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    invoiceNumber,
    order.id,
    paymentKey,
    company.id,
    buyer.id,
    LEGACY_DATA_COUNTRY,
    ACME_CREDIT_TERMS_DAYS,
    JSON.stringify(document),
    order.net_cents,
    order.vat_rate_basis_points,
    order.vat_cents,
    order.gross_cents,
    issuedAt,
    dueAt(issuedAt),
  );
  return { id, invoiceNumber };
}

function ensureInvoiceStateAndEvents(
  db: Database.Database,
  invoiceId: number,
  buyer: UserRow,
  scenario: Scenario,
): void {
  const status = scenario.settledAt === null ? 'open' : 'paid';
  db.prepare(
    `INSERT OR IGNORE INTO invoice_states (invoice_id, status, version, settled_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    invoiceId,
    status,
    scenario.settledAt === null ? 0 : 1,
    scenario.settledAt,
    scenario.settledAt ?? scenario.issuedAt,
  );
  const event = (eventType: 'issued' | 'settled', occurredAt: string): void => {
    const eventKey = `${scenario.key}:${eventType}` as keyof typeof INVOICE_EVENT_IDEMPOTENCY_KEYS;
    db.prepare(
      `INSERT OR IGNORE INTO invoice_events
         (invoice_id, event_type, occurred_at, idempotency_key, request_fingerprint, actor_user_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      invoiceId,
      eventType,
      occurredAt,
      INVOICE_EVENT_IDEMPOTENCY_KEYS[eventKey],
      `seed-${scenario.key}-invoice-${eventType}-fingerprint`,
      buyer.id,
    );
  };
  event('issued', scenario.issuedAt);
  if (scenario.settledAt !== null) event('settled', scenario.settledAt);
}

function ensureCreditHold(
  db: Database.Database,
  invoiceId: number,
  order: OrderRow,
  company: CompanyRow,
  scenario: Scenario,
  paymentKey: string,
): void {
  const releasedAt = scenario.settledAt;
  const status = releasedAt === null ? 'committed' : 'released';
  db.prepare(
    `INSERT OR IGNORE INTO credit_exposure_holds
       (company_id, payment_idempotency_key, amount_cents, status, expires_at, invoice_id,
        authorized_at, committed_at, released_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
  ).run(
    company.id,
    paymentKey,
    order.gross_cents,
    status,
    invoiceId,
    scenario.issuedAt,
    scenario.issuedAt,
    releasedAt,
    scenario.issuedAt,
    releasedAt ?? scenario.issuedAt,
  );
}

function ensureInvoiceMailbox(
  db: Database.Database,
  invoiceId: number,
  buyer: UserRow,
  scenario: Scenario,
): void {
  db.prepare(
    `INSERT INTO dev_mailbox (recipient, subject, body, kind, created_at, invoice_id)
     SELECT ?, ?, ?, 'invoice_issued', ?, ?
     WHERE NOT EXISTS (
       SELECT 1 FROM dev_mailbox WHERE kind = 'invoice_issued' AND invoice_id = ?
     )`,
  ).run(
    buyer.email,
    `Invoice ${scenario.invoiceNumber}`,
    `Invoice ${scenario.invoiceNumber} for Acme Materials Ltd`,
    scenario.issuedAt,
    invoiceId,
    invoiceId,
  );
}

/** Inserts deterministic Acme trade-credit orders, payment intents, invoices, and events. */
export function seedTradeCredit(db: Database.Database): void {
  const owner = findUser(db, 'acme@example.com');
  const buyer = findUser(db, 'buyer@example.com');
  const approver = findUser(db, 'approver@example.com');
  if (!owner || !buyer || !approver) return;

  const company = findCompany(db, owner.id);
  if (!company || company.active !== 1) return;
  const activeMemberships = db
    .prepare(
      `SELECT COUNT(*) AS count FROM company_memberships
       WHERE company_id = ? AND active = 1 AND user_id IN (?, ?, ?)`,
    )
    .get(company.id, owner.id, buyer.id, approver.id) as { count: number };
  if (activeMemberships.count !== 3) return;

  insertCreditPolicyEvent(db, company);
  const product = findProductVariant(db);
  if (!product) return;
  for (const scenario of SCENARIOS) {
    const order = insertOrder(db, scenario, buyer, company, product);
    if (!order) continue;
    const line = ensureLine(db, order, product, scenario.quantity);
    if (!line) continue;
    const paymentKey = ensurePayment(db, order, company, buyer, scenario);
    const invoice = ensureInvoice(db, order, line, company, buyer, scenario, paymentKey);
    if (invoice === undefined) continue;
    ensureInvoiceStateAndEvents(db, invoice.id, buyer, scenario);
    ensureCreditHold(db, invoice.id, order, company, scenario, paymentKey);
    ensureInvoiceMailbox(db, invoice.id, buyer, {
      ...scenario,
      invoiceNumber: invoice.invoiceNumber,
    });
  }
}
