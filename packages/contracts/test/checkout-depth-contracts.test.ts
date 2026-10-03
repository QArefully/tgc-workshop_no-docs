import assert from 'node:assert/strict';
import test from 'node:test';
import { TypeCompiler } from '@sinclair/typebox/compiler';
import { Value } from '@sinclair/typebox/value';
import {
  FORMATTED_ADDRESS_MAX_LENGTH,
  PostalAddress,
  formatPostalAddress,
} from '../src/address.js';
import {
  BillingEntity,
  BillingEntityInput,
  CreateBillingEntityBody,
  CreateDeliverySiteBody,
  DeliverySite,
  UpdateBillingEntityBody,
  UpdateDeliverySiteBody,
} from '../src/tradeAccount.js';
import {
  DeliveryLeadTime,
  DeliverySlot,
  DeliverySlotOptionsResponse,
  DeliverySlotWindow,
} from '../src/delivery.js';
import { Order, OrderDetailResponse, OrderSummary } from '../src/orders.js';
import {
  BillingSelection,
  CURRENT_PERSISTED_CHECKOUT_QUOTE_VERSION,
  DeliveryDestination,
  PaymentBody,
  PaymentConflictResponse,
} from '../src/payments.js';
import { AdminOrderDetailResponse } from '../src/adminOrdersList.js';

const uuid = '123e4567-e89b-42d3-a456-426614174000';

const address = {
  line1: '1 Example Street',
  city: 'London',
  postcode: 'EC1A 1BB',
  countryCode: 'GB',
};

const fullAddress = {
  line1: 'Unit 4, Riverside Trade Park',
  line2: 'Off Wharf Road',
  city: 'Manchester',
  region: 'Greater Manchester',
  postcode: 'M15 4TT',
  countryCode: 'GB',
};

void test('postal address bounds hold and reject markup or bad country codes', () => {
  assert.equal(Value.Check(PostalAddress, address), true);
  assert.equal(Value.Check(PostalAddress, fullAddress), true);
  assert.equal(Value.Check(PostalAddress, { ...address, countryCode: 'gb' }), false);
  assert.equal(Value.Check(PostalAddress, { ...address, countryCode: 'GBR' }), false);
  assert.equal(Value.Check(PostalAddress, { ...address, line1: '<b>1 Example Street</b>' }), false);
  assert.equal(Value.Check(PostalAddress, { ...address, line1: '' }), false);
  assert.equal(Value.Check(PostalAddress, { ...address, postcode: 'EC1A 1BB '.repeat(3) }), false);
  assert.equal(Value.Check(PostalAddress, { ...address, unexpected: true }), false);
});

void test('formatPostalAddress is deterministic, ordered, and skips absent parts', () => {
  assert.equal(formatPostalAddress(address), '1 Example Street, London, EC1A 1BB, GB');
  assert.equal(
    formatPostalAddress(fullAddress),
    'Unit 4, Riverside Trade Park, Off Wharf Road, Manchester, Greater Manchester, M15 4TT, GB',
  );
  assert.equal(formatPostalAddress(address), formatPostalAddress({ ...address }));
  // Whitespace-only difference must not change the rendered value.
  assert.equal(
    formatPostalAddress({ ...address, line1: '  1 Example Street  ' }),
    formatPostalAddress(address),
  );
});

void test('formatPostalAddress output stays inside the legacy 500-character address bound', () => {
  const maximal = {
    line1: 'a'.repeat(120),
    line2: 'b'.repeat(120),
    city: 'c'.repeat(80),
    region: 'd'.repeat(80),
    postcode: 'E'.repeat(16),
    countryCode: 'GB',
  };
  assert.equal(Value.Check(PostalAddress, maximal), true);
  const formatted = formatPostalAddress(maximal);
  assert.equal(formatted.length, 428);
  assert.ok(formatted.length <= FORMATTED_ADDRESS_MAX_LENGTH);
});

void test('trade account bodies enforce bounds and optional partial updates', () => {
  const create = {
    label: 'Riverside depot',
    contactName: 'Ada Shopper',
    contactPhone: '+44 161 496 0000',
    address,
  };
  assert.equal(Value.Check(CreateDeliverySiteBody, create), true);
  assert.equal(Value.Check(CreateDeliverySiteBody, { ...create, isDefault: true }), true);
  assert.equal(Value.Check(CreateDeliverySiteBody, { ...create, contactPhone: 'call me' }), false);
  assert.equal(Value.Check(CreateDeliverySiteBody, { ...create, unexpected: true }), false);
  assert.equal(Value.Check(UpdateDeliverySiteBody, {}), true);
  assert.equal(Value.Check(UpdateDeliverySiteBody, { label: 'Renamed' }), true);
  assert.equal(Value.Check(UpdateDeliverySiteBody, { label: '' }), false);

  assert.equal(
    Value.Check(DeliverySite, {
      id: '1',
      ...create,
      isDefault: true,
      active: true,
      createdAt: '2026-07-26T00:00:00.000Z',
      updatedAt: '2026-07-26T00:00:00.000Z',
    }),
    true,
  );

  assert.equal(Value.Check(BillingEntityInput, { legalName: 'Example Ltd', address }), true);
  assert.equal(
    Value.Check(BillingEntityInput, {
      legalName: 'Example Ltd',
      registrationNumber: '01234567',
      vatNumber: 'GB123456789',
      address,
    }),
    true,
  );
  // Saved entities model absent registration and VAT numbers as null, not as missing keys.
  assert.equal(
    Value.Check(BillingEntity, {
      id: '1',
      legalName: 'Example Ltd',
      registrationNumber: null,
      vatNumber: null,
      address,
      isDefault: true,
      active: true,
      createdAt: '2026-07-26T00:00:00.000Z',
      updatedAt: '2026-07-26T00:00:00.000Z',
    }),
    true,
  );
});

void test('trade text bounds stop exactly at the persistence CHECK bounds', () => {
  const create = {
    label: 'Riverside depot',
    contactName: 'Ada Shopper',
    contactPhone: '+44 161 496 0000',
    address,
  };

  // delivery_sites.label CHECK is length 1..80. A contract bound wider than the column would
  // validate here and then fail at INSERT with SQLITE_CONSTRAINT, turning a 400 into a 500.
  assert.equal(Value.Check(CreateDeliverySiteBody, { ...create, label: 'a'.repeat(80) }), true);
  assert.equal(Value.Check(CreateDeliverySiteBody, { ...create, label: 'a'.repeat(81) }), false);
  assert.equal(Value.Check(UpdateDeliverySiteBody, { label: 'a'.repeat(80) }), true);
  assert.equal(Value.Check(UpdateDeliverySiteBody, { label: 'a'.repeat(81) }), false);
  // contact_name keeps the wider 1..120 column bound.
  assert.equal(
    Value.Check(CreateDeliverySiteBody, { ...create, contactName: 'a'.repeat(120) }),
    true,
  );
  assert.equal(
    Value.Check(CreateDeliverySiteBody, { ...create, contactName: 'a'.repeat(121) }),
    false,
  );

  // billing_entities.registration_number / vat_number CHECKs are length 1..40.
  const billing = { legalName: 'Example Ltd', address };
  assert.equal(
    Value.Check(BillingEntityInput, { ...billing, registrationNumber: '0'.repeat(40) }),
    true,
  );
  assert.equal(
    Value.Check(BillingEntityInput, { ...billing, registrationNumber: '0'.repeat(41) }),
    false,
  );
  assert.equal(Value.Check(BillingEntityInput, { ...billing, vatNumber: 'G'.repeat(40) }), true);
  assert.equal(Value.Check(BillingEntityInput, { ...billing, vatNumber: 'G'.repeat(41) }), false);
  assert.equal(Value.Check(UpdateBillingEntityBody, { registrationNumber: '0'.repeat(41) }), false);
  assert.equal(Value.Check(UpdateBillingEntityBody, { vatNumber: 'G'.repeat(41) }), false);
  // legal_name keeps the wider 1..120 column bound.
  assert.equal(Value.Check(BillingEntityInput, { ...billing, legalName: 'a'.repeat(120) }), true);
  assert.equal(Value.Check(BillingEntityInput, { ...billing, legalName: 'a'.repeat(121) }), false);
});

void test('required plain-text fields reject whitespace-only values', () => {
  // formatPostalAddress trims each part, so a whitespace-only line1 would render an address with
  // no street line rather than failing at the contract boundary.
  assert.equal(Value.Check(PostalAddress, { ...address, line1: '   ' }), false);
  assert.equal(Value.Check(PostalAddress, { ...address, line2: '\t' }), false);
  assert.equal(Value.Check(PostalAddress, { ...address, city: ' ' }), false);
  assert.equal(Value.Check(PostalAddress, { ...address, region: ' ' }), false);
  // Interior and surrounding whitespace around real content stays acceptable.
  assert.equal(Value.Check(PostalAddress, { ...address, line1: '  1 Example Street  ' }), true);

  assert.equal(Value.Check(UpdateDeliverySiteBody, { label: '   ' }), false);
  assert.equal(Value.Check(BillingEntityInput, { legalName: '  ', address }), false);
  assert.equal(
    Value.Check(BillingEntityInput, { legalName: 'Example Ltd', vatNumber: ' ', address }),
    false,
  );
});

void test('contact phone rejects digit-free values that would normalise to empty', () => {
  const create = {
    label: 'Riverside depot',
    contactName: 'Ada Shopper',
    contactPhone: '+44 161 496 0000',
    address,
  };

  // Separators alone satisfy minLength but normalise to '' in the service, which the
  // contact_phone CHECK (IS NULL OR length 1..40) then rejects as a SQLITE_CONSTRAINT 500.
  for (const digitFree of ['     ', '  \t  ', '+()-+', '  ()  ', '(   )-']) {
    assert.equal(
      Value.Check(CreateDeliverySiteBody, { ...create, contactPhone: digitFree }),
      false,
    );
    assert.equal(Value.Check(UpdateDeliverySiteBody, { contactPhone: digitFree }), false);
  }

  // A single digit among separators still carries a number, so it stays acceptable.
  assert.equal(Value.Check(CreateDeliverySiteBody, { ...create, contactPhone: '+44 0' }), true);
  assert.equal(Value.Check(UpdateDeliverySiteBody, { contactPhone: '01234 567890' }), true);
  assert.equal(Value.Check(UpdateDeliverySiteBody, { contactPhone: '(0161) 496-0000' }), true);
  // The allowed character set is unchanged: letters and other punctuation stay rejected.
  assert.equal(Value.Check(UpdateDeliverySiteBody, { contactPhone: '0161 x4960' }), false);
  assert.equal(Value.Check(UpdateDeliverySiteBody, { contactPhone: '0161.496.0000' }), false);
  // minLength 5 is unchanged.
  assert.equal(Value.Check(UpdateDeliverySiteBody, { contactPhone: '0161' }), false);
});

void test('billing entity update separates absent from explicit null identifiers', () => {
  // Absent -> leave the stored value alone. Null -> clear it. A buyer removing a saved VAT number
  // has no other way to say so, and without null the request would be indistinguishable from "no
  // change": the server would keep the old value while the form reported success.
  assert.equal(Value.Check(UpdateBillingEntityBody, {}), true);
  assert.equal(Value.Check(UpdateBillingEntityBody, { registrationNumber: null }), true);
  assert.equal(Value.Check(UpdateBillingEntityBody, { vatNumber: null }), true);
  assert.equal(
    Value.Check(UpdateBillingEntityBody, { registrationNumber: null, vatNumber: null }),
    true,
  );
  assert.equal(Value.Check(UpdateBillingEntityBody, { registrationNumber: '01234567' }), true);
  // Clearing is spelled null, never ''. The empty string fails the column CHECK.
  assert.equal(Value.Check(UpdateBillingEntityBody, { vatNumber: '' }), false);
  // legalName is required on the record, so it has no cleared state to express.
  assert.equal(Value.Check(UpdateBillingEntityBody, { legalName: null }), false);
  // Create has no stored value to clear, so it keeps omitting blanks rather than accepting null.
  assert.equal(
    Value.Check(CreateBillingEntityBody, { legalName: 'Example Ltd', address, vatNumber: null }),
    false,
  );
  assert.equal(Value.Check(CreateBillingEntityBody, { legalName: 'Example Ltd', address }), true);
});

void test('delivery site represents a phone-less row as an absent field', () => {
  // contact_phone is nullable, so the mapper must have a legal way to say "no phone". '' is not it:
  // it fails ContactPhone's bounds, so emitting it would 500 on every read of that row.
  const site = {
    id: '1',
    label: 'Riverside depot',
    contactName: 'Ada Shopper',
    address,
    isDefault: true,
    active: true,
    createdAt: '2026-07-26T00:00:00.000Z',
    updatedAt: '2026-07-26T00:00:00.000Z',
  };
  assert.equal(Value.Check(DeliverySite, site), true);
  assert.equal(Value.Check(DeliverySite, { ...site, contactPhone: '01234 567890' }), true);
  assert.equal(Value.Check(DeliverySite, { ...site, contactPhone: '' }), false);
});

void test('delivery slot transport is UTC-date and window scoped', () => {
  assert.equal(Value.Check(DeliverySlotWindow, 'am'), true);
  assert.equal(Value.Check(DeliverySlotWindow, 'evening'), false);
  assert.equal(Value.Check(DeliverySlot, { date: '2026-08-03', window: 'pm' }), true);
  assert.equal(Value.Check(DeliverySlot, { date: '03/08/2026', window: 'pm' }), false);
  assert.equal(
    Value.Check(DeliverySlot, { date: '2026-08-03T00:00:00.000Z', window: 'pm' }),
    false,
  );
  assert.equal(Value.Check(DeliverySlot, { date: '2026-08-03', window: 'am', capacity: 2 }), false);

  const leadTime = {
    earliestDate: '2026-08-03',
    latestDate: '2026-08-21',
    businessDays: 3,
    reason: 'Freight consignment, 3 business days to dispatch',
  };
  assert.equal(Value.Check(DeliveryLeadTime, leadTime), true);
  assert.equal(Value.Check(DeliveryLeadTime, { ...leadTime, businessDays: -1 }), false);
  assert.equal(
    Value.Check(DeliverySlotOptionsResponse, {
      delivery: { mode: 'freight', chargeCents: 999, weightGrams: 250_000, reason: 'Freight' },
      leadTime,
      slots: [{ date: '2026-08-03', window: 'am' }],
    }),
    true,
  );
});

void test('destination and billing selections discriminate on kind and never mix members', () => {
  assert.equal(Value.Check(DeliveryDestination, { kind: 'saved', deliverySiteId: '7' }), true);
  assert.equal(Value.Check(DeliveryDestination, { kind: 'adhoc', address }), true);
  // A saved selection carries no address: the server loads the stored site.
  assert.equal(
    Value.Check(DeliveryDestination, { kind: 'saved', deliverySiteId: '7', address }),
    false,
  );
  assert.equal(Value.Check(DeliveryDestination, { kind: 'adhoc', deliverySiteId: '7' }), false);
  assert.equal(Value.Check(DeliveryDestination, { kind: 'saved', deliverySiteId: '0' }), false);
  assert.equal(Value.Check(DeliveryDestination, { address }), false);

  assert.equal(Value.Check(BillingSelection, { kind: 'saved', billingEntityId: '3' }), true);
  assert.equal(
    Value.Check(BillingSelection, {
      kind: 'adhoc',
      billingEntity: { legalName: 'Example Ltd', address },
    }),
    true,
  );
  assert.equal(
    Value.Check(BillingSelection, {
      kind: 'saved',
      billingEntityId: '3',
      billingEntity: { legalName: 'Example Ltd', address },
    }),
    false,
  );
});

void test('payment body carries the B2B commitments and no free-text shipping address', () => {
  const payment = {
    cartId: uuid,
    customerName: 'Ada Shopper',
    customerEmail: 'ada@example.test',
    deliveryDestination: { kind: 'saved', deliverySiteId: '7' },
    billingSelection: { kind: 'saved', billingEntityId: '3' },
    deliverySlot: { date: '2026-08-03', window: 'am' },
    cardNumber: '4242 4242 4242 4242',
    cardExpiry: '12/99',
    cardCvc: '123',
    idempotencyKey: uuid,
  };
  assert.equal(Value.Check(PaymentBody, payment), true);
  assert.equal(Value.Check(PaymentBody, { ...payment, purchaseOrderReference: 'PO-4471' }), true);
  assert.equal(Value.Check(PaymentBody, { ...payment, purchaseOrderReference: '' }), false);
  assert.equal(Value.Check(PaymentBody, { ...payment, purchaseOrderReference: '<po>' }), false);

  const withoutSlot: Partial<typeof payment> = { ...payment };
  delete withoutSlot.deliverySlot;
  assert.equal(Value.Check(PaymentBody, withoutSlot), false);

  const withFreeTextAddress = { ...payment, shippingAddress: '1 Example Street' };
  assert.equal(
    Value.Check(PaymentBody, withFreeTextAddress),
    true,
    'PaymentBody is non-strict; the removed field is simply no longer read',
  );
});

void test('payment conflict detail members cannot degrade to a generic conflict', () => {
  assert.equal(
    Value.Check(PaymentConflictResponse, {
      error: 'DELIVERY_SLOT_UNAVAILABLE',
      earliestDate: '2026-08-05',
    }),
    true,
  );
  assert.equal(
    Value.Check(PaymentConflictResponse, {
      error: 'DELIVERY_SLOT_UNAVAILABLE',
      earliestDate: '05/08/2026',
    }),
    false,
  );
  assert.equal(
    Value.Check(PaymentConflictResponse, {
      error: 'PENDING_APPROVAL',
      approvalRequestId: '17',
    }),
    true,
  );
  assert.equal(Value.Check(PaymentConflictResponse, { error: 'PENDING_APPROVAL' }), false);
  assert.equal(
    Value.Check(PaymentConflictResponse, {
      error: 'Payment already submitted with different data',
    }),
    true,
  );
  assert.equal(Value.Check(PaymentConflictResponse, { earliestDate: '2026-08-05' }), false);
  assert.equal(Value.Check(PaymentConflictResponse, {}), false);
});

void test('order exposes the four new fields as optional so historic rows stay representable', () => {
  const legacyOrder = {
    id: '1',
    status: 'processing',
    version: 0,
    items: [],
    subtotalCents: 0,
    discountCents: 0,
    totalCents: 0,
    promoApplied: null,
    createdAt: '2026-07-14T00:00:00.000Z',
  };
  assert.equal(Value.Check(Order, legacyOrder), true);
  assert.equal(
    Value.Check(Order, {
      ...legacyOrder,
      deliveryAddress: address,
      billingEntity: {
        legalName: 'Example Ltd',
        registrationNumber: null,
        vatNumber: null,
        address,
      },
      deliverySlot: { date: '2026-08-03', window: 'pm' },
      purchaseOrderReference: 'PO-4471',
    }),
    true,
  );
  // Partial population is legitimate: fields land independently on historic rows.
  assert.equal(Value.Check(Order, { ...legacyOrder, purchaseOrderReference: 'PO-4471' }), true);
});

void test('order summary carries an optional PO reference so history rows can show it', () => {
  const legacySummary = {
    id: '1',
    status: 'processing',
    version: 0,
    totalCents: 0,
    totalItems: 0,
    hasBackorder: false,
    createdAt: '2026-07-14T00:00:00.000Z',
  };
  assert.equal(Value.Check(OrderSummary, legacySummary), true);
  assert.equal(
    Value.Check(OrderSummary, { ...legacySummary, purchaseOrderReference: 'PO-4471' }),
    true,
  );
  // Same bounded type as the detail field: markup and over-length references stay rejected.
  assert.equal(
    Value.Check(OrderSummary, { ...legacySummary, purchaseOrderReference: '<b>PO</b>' }),
    false,
  );
  assert.equal(
    Value.Check(OrderSummary, { ...legacySummary, purchaseOrderReference: 'P'.repeat(65) }),
    false,
  );
});

void test('order summary and detail share credit attribution and accounting integrity', () => {
  const accounting = {
    country: 'UK' as const,
    paymentMethod: 'trade_credit' as const,
    companyId: '7',
    netCents: 10_000,
    vatRateBasisPoints: 2_000,
    vatCents: 2_000,
    grossCents: 12_000,
  };
  const summary = {
    id: '1',
    status: 'processing',
    version: 0,
    totalCents: 12_000,
    ...accounting,
    totalItems: 0,
    hasBackorder: false,
    createdAt: '2026-07-14T00:00:00.000Z',
  };
  const detail = {
    id: '1',
    status: 'processing',
    version: 0,
    items: [],
    subtotalCents: 10_000,
    discountCents: 0,
    totalCents: 12_000,
    ...accounting,
    promoApplied: null,
    createdAt: '2026-07-14T00:00:00.000Z',
    shipments: [],
    events: [],
    canCancel: true,
  };
  assert.equal(Value.Check(OrderSummary, summary), true);
  assert.equal(Value.Check(OrderDetailResponse, detail), true);
  const creditAdminDetail = {
    ...detail,
    refundPayment: { paymentId: '501', remainingRefundableCents: 12_000 },
  };
  assert.equal(Value.Check(AdminOrderDetailResponse, creditAdminDetail), true);
  assert.equal(
    Value.Check(AdminOrderDetailResponse, {
      ...detail,
      grossCents: 12_001,
      refundPayment: null,
    }),
    false,
  );

  // The admin extension is used directly by Fastify response serialization. Keep its merged
  // object metadata non-enumerable while checking both method-specific accounting shapes.
  assert.equal(
    Object.prototype.propertyIsEnumerable.call(AdminOrderDetailResponse, 'properties'),
    false,
  );
  const adminDetailSchema = TypeCompiler.Compile(AdminOrderDetailResponse);
  assert.equal(adminDetailSchema.Check(creditAdminDetail), true);
  assert.deepEqual(Value.Parse(AdminOrderDetailResponse, creditAdminDetail), creditAdminDetail);
  const { companyId: omittedCompanyId, ...cardDetailBase } = detail;
  assert.equal(omittedCompanyId, '7');
  const cardAdminDetail = {
    ...cardDetailBase,
    paymentMethod: 'card' as const,
    netCents: 12_000,
    vatRateBasisPoints: 0,
    vatCents: 0,
    grossCents: 12_000,
    refundPayment: null,
  };
  assert.equal(adminDetailSchema.Check(cardAdminDetail), true);
  assert.deepEqual(Value.Parse(AdminOrderDetailResponse, cardAdminDetail), cardAdminDetail);
  assert.equal(adminDetailSchema.Check({ ...cardAdminDetail, companyId: '7' }), false);

  for (const candidate of [summary, detail]) {
    const schema = candidate === summary ? OrderSummary : OrderDetailResponse;
    assert.equal(Value.Check(schema, { ...candidate, grossCents: 12_001 }), false);
    assert.equal(Value.Check(schema, { ...candidate, totalCents: 10_000 }), false);
    assert.equal(Value.Check(schema, { ...candidate, companyId: undefined }), false);
    assert.equal(
      Value.Check(schema, {
        ...candidate,
        paymentMethod: 'card',
        companyId: '7',
        vatRateBasisPoints: 0,
        vatCents: 0,
        grossCents: 12_000,
      }),
      false,
    );
  }
  assert.equal(Value.Check(OrderSummary, { ...summary, netCents: undefined }), false);
  assert.equal(Value.Check(OrderDetailResponse, { ...detail, netCents: undefined }), false);
  for (const candidate of [summary, detail]) {
    const schema = candidate === summary ? OrderSummary : OrderDetailResponse;
    assert.equal(Value.Check(schema, { ...candidate, country: undefined }), false);
    assert.equal(
      Value.Check(schema, {
        ...candidate,
        paymentMethod: 'card',
        companyId: undefined,
        netCents: undefined,
        vatRateBasisPoints: undefined,
        vatCents: undefined,
        grossCents: undefined,
      }),
      false,
    );
  }
});

void test('persisted quote version advanced and never restarted', () => {
  assert.equal(CURRENT_PERSISTED_CHECKOUT_QUOTE_VERSION, 10);
});
