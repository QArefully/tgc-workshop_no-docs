import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import {
  AdminCreditAccountListQuery,
  AdminCreditAccountUpdateBody,
  CreditAccount,
  CreditAccountQuery,
  CreditAccountMemberView,
  CheckoutResult,
  ExportedInvoice,
  Invoice,
  InvoiceV1,
  InvoiceSettlement,
  InvoiceIssuedMailboxDescriptor,
  InvoiceLifecycle,
  PaymentBody,
  PaymentFailureResponse,
  PersistedCheckoutQuote,
  PersistedCheckoutQuoteV10,
  PublicErrorResponse,
  TradeCreditPaymentBody,
  parseInvoiceV1,
} from '../src/index.js';

const uuid = '123e4567-e89b-42d3-a456-426614174000';
const address = {
  line1: '1 Example Street',
  city: 'London',
  postcode: 'EC1A 1BB',
  countryCode: 'GB',
};

const checkoutCommon = {
  cartId: uuid,
  customerName: 'Ada Shopper',
  customerEmail: 'ada@example.test',
  deliveryDestination: { kind: 'adhoc', address },
  billingSelection: {
    kind: 'adhoc',
    billingEntity: { legalName: 'Example Trading Ltd', address },
  },
  deliverySlot: { date: '2026-09-10', window: 'am' },
  idempotencyKey: uuid,
};

void test('card payment remains valid when method is omitted or explicit', () => {
  const legacy = {
    ...checkoutCommon,
    cardNumber: '4242 4242 4242 4242',
    cardExpiry: '12/99',
    cardCvc: '123',
  };
  assert.equal(Value.Check(PaymentBody, legacy), true);
  assert.equal(Value.Check(PaymentBody, { ...legacy, paymentMethod: 'card' }), true);
  assert.equal(Value.Check(PaymentBody, { ...legacy, paymentMethod: 'trade_credit' }), false);
});

void test('trade-credit checkout is strict and can never carry card fields', () => {
  const credit: TradeCreditPaymentBody = {
    ...checkoutCommon,
    paymentMethod: 'trade_credit',
  };
  assert.equal(Value.Check(TradeCreditPaymentBody, credit), true);
  assert.equal(Value.Check(PaymentBody, credit), true);
  assert.equal(Value.Check(TradeCreditPaymentBody, { ...credit, companyId: '7' }), false);
  assert.equal(Value.Check(PaymentBody, { ...credit, cardNumber: '424242424242' }), false);
  assert.equal(Value.Check(PaymentBody, { ...credit, paymentMethod: 'credit' }), false);
});

void test('buyer credit queries cannot select a company and admin updates require one mutation', () => {
  assert.equal(Value.Check(CreditAccountQuery, {}), true);
  assert.equal(Value.Check(CreditAccountQuery, { companyId: '7' }), false);

  const common = { expectedVersion: 0, idempotencyKey: uuid };
  assert.equal(
    Value.Check(AdminCreditAccountUpdateBody, { ...common, creditLimitCents: 100_000 }),
    true,
  );
  assert.equal(Value.Check(AdminCreditAccountUpdateBody, { ...common, state: 'active' }), true);
  assert.equal(
    Value.Check(AdminCreditAccountUpdateBody, { ...common, state: 'active', reason: 'Reinstated' }),
    true,
  );
  assert.equal(Value.Check(AdminCreditAccountUpdateBody, { ...common, reason: 'No-op' }), false);
  assert.equal(
    Value.Check(AdminCreditAccountUpdateBody, {
      ...common,
      state: 'active',
      creditLimitCents: 100_000,
    }),
    false,
  );
  assert.equal(
    Value.Check(AdminCreditAccountUpdateBody, { ...common, state: 'active', status: 'active' }),
    false,
  );
});

void test('credit accounts expose safe money and derived available credit', () => {
  const account = {
    id: '9',
    companyId: '7',
    state: 'active',
    creditLimitCents: 100_000,
    outstandingCents: 25_000,
    heldCents: 0,
    exposureCents: 25_000,
    availableCreditCents: 75_000,
    terms: 'net_30',
    holdReason: null,
    version: 0,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  } as const;
  assert.equal(Value.Check(CreditAccount, account), true);
  assert.equal(Value.Check(CreditAccount, { ...account, availableCreditCents: 74_999 }), false);
  assert.equal(
    Value.Check(CreditAccount, { ...account, creditLimitCents: Number.MAX_SAFE_INTEGER + 1 }),
    false,
  );
  assert.equal(Value.Check(CreditAccountMemberView, { ...account, id: '9' }), false);
  assert.equal(
    Value.Check(AdminCreditAccountListQuery, { state: 'suspended', page: 1, pageSize: 50 }),
    true,
  );
  assert.equal(Value.Check(AdminCreditAccountListQuery, { page: 0 }), false);
  assert.equal(Value.Check(AdminCreditAccountListQuery, { state: 'on-hold' }), false);
});

const invoice = {
  version: 1,
  id: '101',
  invoiceNumber: 'QME-2026-000101',
  orderId: '55',
  companyId: '7',
  userId: '3',
  country: 'UK',
  paymentMethod: 'trade_credit',
  currency: 'GBP',
  terms: 'net_30',
  billingEntity: {
    legalName: 'Example Trading Ltd',
    registrationNumber: null,
    vatNumber: null,
    address,
  },
  purchaseOrderReference: 'PO-101',
  lines: [
    {
      lineId: '1',
      description: 'Material sacks',
      quantity: 2,
      unitPriceCents: 5_000,
      netCents: 10_000,
    },
  ],
  netCents: 10_000,
  vatRateBasisPoints: 2_000,
  vatCents: 2_000,
  grossCents: 12_000,
  issuedAt: '2026-09-01T00:00:00.000Z',
  dueAt: '2026-10-01T00:00:00.000Z',
} as const;

void test('invoice V1 enforces line/net/VAT/gross integrity and immutable fields', () => {
  assert.equal(Value.Check(InvoiceV1, invoice), true);
  assert.deepEqual(parseInvoiceV1(invoice), invoice);
  assert.equal(Value.Check(InvoiceV1, { ...invoice, vatCents: 2_001 }), false);
  assert.equal(Value.Check(InvoiceV1, { ...invoice, grossCents: 12_001 }), false);
  assert.equal(
    Value.Check(InvoiceV1, { ...invoice, lines: [{ ...invoice.lines[0], netCents: 9_999 }] }),
    false,
  );
  assert.equal(Value.Check(InvoiceV1, { ...invoice, convertedGrossCents: 15_000 }), false);
  assert.throws(() => parseInvoiceV1({ ...invoice, version: 2 }));
  assert.equal(Value.Check(InvoiceV1, { ...invoice, issuedAt: '2026-02-30T00:00:00.000Z' }), false);
  assert.equal(Value.Check(InvoiceV1, { ...invoice, dueAt: '2026-10-02T00:00:00.000Z' }), false);
});

void test('invoice responses retain V1 document integrity and link lifecycle records to the invoice', () => {
  const response = {
    ...invoice,
    status: 'open',
    settledAt: null,
    lifecycleVersion: 0,
    lifecycle: {
      invoiceId: invoice.id,
      status: 'open',
      version: 0,
      settledAt: null,
      updatedAt: '2026-09-01T00:00:00.000Z',
    },
    settlement: null,
    events: [
      {
        id: '301',
        invoiceId: invoice.id,
        type: 'issued',
        occurredAt: '2026-09-01T00:00:00.000Z',
      },
    ],
  } as const;
  assert.equal(Value.Check(Invoice, response), true);
  assert.equal(Value.Check(Invoice, { ...response, version: 2 }), false);
  assert.equal(Value.Check(Invoice, { ...response, vatCents: 2_001 }), false);
  assert.equal(
    Value.Check(Invoice, {
      ...response,
      lifecycle: { ...response.lifecycle, invoiceId: '999' },
    }),
    false,
  );
  assert.equal(Value.Check(Invoice, { ...response, lifecycleVersion: 1 }), false);
  assert.equal(
    Value.Check(Invoice, { ...response, status: 'open', settledAt: '2026-09-20T00:00:00.000Z' }),
    false,
  );
  assert.equal(
    Value.Check(Invoice, {
      ...response,
      status: 'paid',
      settledAt: '2026-09-20T00:00:00.000Z',
      lifecycleVersion: 1,
      lifecycle: {
        ...response.lifecycle,
        status: 'paid',
        version: 1,
        settledAt: '2026-09-20T00:00:00.000Z',
      },
      settlement: {
        id: '201',
        invoiceId: invoice.id,
        amountCents: invoice.grossCents,
        currency: 'GBP',
        status: 'settled',
        idempotencyKey: uuid,
        settledAt: '2026-09-20T00:00:00.000Z',
        createdAt: '2026-09-20T00:00:00.000Z',
      },
    }),
    true,
  );
  assert.equal(
    Value.Check(Invoice, {
      ...response,
      status: 'paid',
      settledAt: '2026-09-20T00:00:00.000Z',
      settlement: null,
    }),
    false,
  );
  assert.equal(
    Value.Check(Invoice, {
      ...response,
      events: [{ ...response.events[0], invoiceId: '999' }],
    }),
    false,
  );
});

void test('V10 quote carries country, method, identity, accounting, and terms while V8/V9 read', () => {
  const frozenLine = {
    productId: '1',
    variantId: 1,
    productName: 'Material sacks',
    variantLabel: '25kg sack',
    sku: 'MAT-001',
    unitPriceCents: 10_000,
    weightGrams: 25_000,
    deliveryClass: 'freight' as const,
    quantity: 1,
    lineTotalCents: 10_000,
    consumptionClassification: 'non-food' as const,
  };
  const v10 = {
    version: 10,
    cartId: uuid,
    customer: {
      name: 'Ada Shopper',
      email: 'ada@example.test',
      deliveryAddress: address,
      shippingAddress: '1 Example Street, London, EC1A 1BB, GB',
    },
    userId: '3',
    companyId: '7',
    country: 'UK',
    paymentMethod: 'trade_credit',
    terms: 'net_30',
    promoCode: null,
    subtotalCents: 10_000,
    discountBaseCents: 10_000,
    promoCategoryScope: null,
    discountCents: 0,
    totalCents: 12_000,
    netCents: 10_000,
    vatRateBasisPoints: 2_000,
    vatCents: 2_000,
    grossCents: 12_000,
    lines: [],
    variantLines: [frozenLine],
    deliverySummary: { mode: 'freight', chargeCents: 0, weightGrams: 1_000, reason: 'Freight' },
    inventoryAllocations: [],
    billingEntity: invoice.billingEntity,
    deliverySlot: { date: '2026-09-10', window: 'am' },
    purchaseOrderReference: null,
    createdAt: '2026-09-01T00:00:00.000Z',
  } as const;
  assert.equal(Value.Check(PersistedCheckoutQuoteV10, v10), true);
  assert.equal(Value.Check(PersistedCheckoutQuote, v10), true);
  assert.equal(
    Value.Check(PersistedCheckoutQuoteV10, {
      ...v10,
      variantLines: [{ ...frozenLine, sku: undefined }],
    }),
    false,
  );
  assert.equal(Value.Check(PersistedCheckoutQuoteV10, { ...v10, grossCents: 12_001 }), false);
  assert.equal(Value.Check(PersistedCheckoutQuoteV10, { ...v10, totalCents: 10_000 }), false);
  assert.equal(Value.Check(PersistedCheckoutQuoteV10, { ...v10, terms: null }), false);
  assert.equal(Value.Check(PersistedCheckoutQuoteV10, { ...v10, termsDays: null }), false);
  const withoutTerms: Record<string, unknown> = { ...v10 };
  delete withoutTerms.terms;
  assert.equal(Value.Check(PersistedCheckoutQuoteV10, withoutTerms), false);
  assert.equal(
    Value.Check(PersistedCheckoutQuoteV10, { ...v10, cardNumber: '424242424242' }),
    false,
  );
  const cardV10 = {
    ...v10,
    userId: null,
    companyId: null,
    paymentMethod: 'card' as const,
    terms: null,
    totalCents: 10_000,
    netCents: 10_000,
    vatRateBasisPoints: 0,
    vatCents: 0,
    grossCents: 10_000,
  };
  assert.equal(Value.Check(PersistedCheckoutQuoteV10, cardV10), true);
  assert.equal(Value.Check(PersistedCheckoutQuoteV10, { ...cardV10, terms: 'net_30' }), false);
  assert.equal(Value.Check(PersistedCheckoutQuoteV10, { ...cardV10, terms: 30 }), false);
  assert.equal(Value.Check(PersistedCheckoutQuoteV10, { ...cardV10, termsDays: 30 }), false);
});

void test('invoice settlement, mailbox descriptor, and public metadata are strict', () => {
  const settlement = {
    id: '201',
    invoiceId: '101',
    amountCents: 12_000,
    currency: 'GBP',
    status: 'settled',
    idempotencyKey: uuid,
    settledAt: '2026-09-20T00:00:00.000Z',
    createdAt: '2026-09-20T00:00:00.000Z',
  };
  assert.equal(Value.Check(InvoiceSettlement, settlement), true);
  assert.equal(Value.Check(InvoiceSettlement, { ...settlement, amountCents: 0 }), false);
  const descriptor = {
    id: '301',
    recipient: 'ada@example.test',
    subject: 'Invoice issued',
    body: 'Invoice INV-101 issued',
    created: '2026-09-01T00:00:00.000Z',
    kind: 'invoice_issued',
    invoiceId: '101',
  };
  assert.equal(Value.Check(InvoiceIssuedMailboxDescriptor, descriptor), true);
  assert.equal(
    Value.Check(InvoiceIssuedMailboxDescriptor, { ...descriptor, grossCents: 12_000 }),
    false,
  );
  assert.equal(
    Value.Check(PublicErrorResponse, {
      error: 'Credit limit exceeded',
      code: 'CREDIT_LIMIT_EXCEEDED',
      meta: { requestedCents: 20_000, availableCreditCents: 10_000 },
    }),
    true,
  );
  assert.equal(
    Value.Check(PublicErrorResponse, {
      error: 'Credit limit exceeded',
      code: 'CREDIT_LIMIT_EXCEEDED',
      meta: { requestedCents: 20_000 },
    }),
    false,
  );
});

void test('credit checkout failures use closed code-specific fields', () => {
  const failures = [
    { success: false, error: 'CREDIT_NOT_ELIGIBLE' },
    { success: false, error: 'CREDIT_ACCOUNT_ON_HOLD' },
    { success: false, error: 'CREDIT_ACCOUNT_SUSPENDED' },
    { success: false, error: 'CREDIT_PAYMENT_UNAVAILABLE' },
    { success: false, error: 'COMPANY_REQUIRED' },
    { success: false, error: 'PAYMENT_METHOD_INVALID' },
    { success: false, error: 'CARD_FIELDS_FORBIDDEN' },
    {
      success: false,
      error: 'CREDIT_LIMIT_EXCEEDED',
      requestedCents: 12_000,
      availableCreditCents: 10_000,
    },
  ] as const;
  for (const failure of failures) {
    assert.equal(Value.Check(CheckoutResult, failure), true, failure.error);
    assert.equal(Value.Check(PaymentFailureResponse, failure), true, failure.error);
    assert.equal(
      Value.Check(CheckoutResult, { ...failure, promoError: 'internal account details' }),
      false,
      `${failure.error} must not accept promoError`,
    );
    assert.equal(
      Value.Check(CheckoutResult, { ...failure, promoErrorCode: 'PRIVATE_CODE' }),
      false,
      `${failure.error} must not accept promoErrorCode`,
    );
  }
  assert.equal(Value.Check(PaymentFailureResponse, { success: true, order: {} }), false);
});

void test('account invoice export includes only immutable document plus safe settlement state', () => {
  const exported = { ...invoice, status: 'open', settledAt: null };
  assert.equal(Value.Check(ExportedInvoice, exported), true);
  assert.equal(Value.Check(ExportedInvoice, { ...exported, paymentIdempotencyKey: uuid }), false);
  assert.equal(Value.Check(ExportedInvoice, { ...exported, lifecycle: {} }), false);
  assert.equal(Value.Check(ExportedInvoice, { ...exported, events: [] }), false);
  assert.equal(
    Value.Check(ExportedInvoice, {
      ...exported,
      status: 'open',
      settledAt: '2026-09-20T00:00:00.000Z',
    }),
    false,
  );
  assert.equal(
    Value.Check(ExportedInvoice, {
      ...exported,
      status: 'paid',
      settledAt: '2026-09-20T00:00:00.000Z',
    }),
    true,
  );
});

void test('invoice lifecycle requires settlement timestamps to match status', () => {
  const lifecycle = {
    invoiceId: invoice.id,
    status: 'open' as const,
    version: 0,
    settledAt: null,
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
  assert.equal(Value.Check(InvoiceLifecycle, lifecycle), true);
  assert.equal(Value.Check(InvoiceLifecycle, { ...lifecycle, status: 'overdue' }), true);
  assert.equal(Value.Check(InvoiceLifecycle, { ...lifecycle, status: 'voided' }), true);
  assert.equal(
    Value.Check(InvoiceLifecycle, {
      ...lifecycle,
      status: 'paid',
      settledAt: '2026-09-20T00:00:00.000Z',
    }),
    true,
  );
  assert.equal(
    Value.Check(InvoiceLifecycle, {
      ...lifecycle,
      status: 'paid',
      settledAt: null,
    }),
    false,
  );
  assert.equal(
    Value.Check(InvoiceLifecycle, {
      ...lifecycle,
      status: 'open',
      settledAt: '2026-09-20T00:00:00.000Z',
    }),
    false,
  );
});
