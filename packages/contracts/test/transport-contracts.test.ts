import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import * as AuthContracts from '../src/auth.js';
import { SignupBody } from '../src/auth.js';
import { Cart, CartIdParam } from '../src/cart.js';
import { Order } from '../src/orders.js';
import {
  PaymentBody,
  PersistedCheckoutQuote,
  PersistedCheckoutQuoteV7,
  PersistedCheckoutQuoteV8,
  PersistedCheckoutQuoteV9,
  parsePersistedCheckoutQuote,
} from '../src/payments.js';

const uuid = '123e4567-e89b-42d3-a456-426614174000';

const address = {
  line1: '1 Example Street',
  city: 'London',
  postcode: 'EC1A 1BB',
  countryCode: 'GB',
};

const billingEntity = {
  legalName: 'Example Trading Ltd',
  registrationNumber: null,
  vatNumber: null,
  address,
};

void test('auth transport rejects unconstrained email and password values', () => {
  assert.equal(
    Value.Check(SignupBody, { email: 'not-an-email', password: '12345678', displayName: 'A' }),
    false,
  );
  assert.equal(
    Value.Check(SignupBody, { email: 'shopper@example.test', password: 'short', displayName: 'A' }),
    false,
  );
  assert.equal(
    Value.Check(SignupBody, {
      email: 'shopper@example.test',
      password: 'password8',
      displayName: 'A',
      country: 'UK',
    }),
    true,
  );
});

void test('cart and payment transports require UUID identifiers and bounded card fields', () => {
  assert.equal(Value.Check(CartIdParam, { cartId: 'cart-123' }), false);
  assert.equal(Value.Check(CartIdParam, { cartId: uuid }), true);

  const payment = {
    cartId: uuid,
    customerName: 'Ada Shopper',
    customerEmail: 'ada@example.test',
    deliveryDestination: { kind: 'adhoc', address },
    billingSelection: {
      kind: 'adhoc',
      billingEntity: { legalName: 'Example Trading Ltd', address },
    },
    deliverySlot: { date: '2026-08-03', window: 'am' },
    cardNumber: '4242 4242 4242 4242',
    cardExpiry: '12/99',
    cardCvc: '123',
    idempotencyKey: uuid,
  };
  assert.equal(Value.Check(PaymentBody, payment), true);
  assert.equal(Value.Check(PaymentBody, { ...payment, cardNumber: '4242-4242-4242-4242' }), true);
  assert.equal(Value.Check(PaymentBody, { ...payment, cardCvc: '1x3' }), false);
  assert.equal(Value.Check(PaymentBody, { ...payment, cardExpiry: '13/99' }), false);
});

void test('cart and order transports accept product-only line collections', () => {
  const emptyCart = {
    id: uuid,
    items: [],
    subtotalCents: 0,
    discountableSubtotalCents: 0,
    blendingFeeTotalCents: 0,
    totalItems: 0,
  };
  assert.equal(Value.Check(Cart, emptyCart), true);
  assert.equal(Value.Check(Cart, { ...emptyCart, totalItems: -1 }), false);

  const emptyOrder = {
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
  assert.equal(Value.Check(Order, emptyOrder), true);
  assert.equal(Value.Check(Order, { ...emptyOrder, retiredLegacyField: [] }), false);
});

void test('persisted checkout quotes accept only strict V8 or V9 shapes', () => {
  const v8 = {
    version: 8,
    cartId: uuid,
    customer: {
      name: 'Ada Shopper',
      email: 'ada@example.test',
      deliveryAddress: address,
      shippingAddress: '1 Example Street, London, EC1A 1BB, GB',
    },
    userId: null,
    promoCode: null,
    subtotalCents: 2500,
    discountCents: 0,
    discountBaseCents: 2500,
    promoCategoryScope: null,
    totalCents: 2500,
    lines: [],
    createdAt: '2026-07-14T00:00:00.000Z',
    variantLines: [],
    deliverySummary: {
      mode: 'parcel',
      chargeCents: 0,
      weightGrams: 500,
      reason: 'Under threshold',
    },
    inventoryAllocations: [{ productId: '1', reservedQuantity: 1, backorderedQuantity: 0 }],
    billingEntity,
    deliverySlot: { date: '2026-08-03', window: 'am' },
    purchaseOrderReference: null,
  };

  assert.equal(Value.Check(PersistedCheckoutQuoteV8, v8), true);
  assert.equal(Value.Check(PersistedCheckoutQuote, v8), true);
  assert.deepEqual(parsePersistedCheckoutQuote(v8), v8);
  const v9 = { ...v8, version: 9 };
  assert.equal(Value.Check(PersistedCheckoutQuoteV9, v9), true);
  assert.equal(Value.Check(PersistedCheckoutQuote, v9), true);
  assert.deepEqual(parsePersistedCheckoutQuote(v9), v9);
  const v7 = { ...v8, version: 7 };
  Reflect.deleteProperty(v7, 'discountBaseCents');
  Reflect.deleteProperty(v7, 'promoCategoryScope');
  assert.equal(Value.Check(PersistedCheckoutQuoteV7, v7), true);
  assert.equal(Value.Check(PersistedCheckoutQuote, v7), false);
  assert.throws(() => parsePersistedCheckoutQuote(v7));
  assert.equal(
    Value.Check(PersistedCheckoutQuoteV8, { ...v8, unexpectedPersistedField: true }),
    false,
  );
  assert.throws(() => parsePersistedCheckoutQuote({ ...v8, unexpectedPersistedField: true }));
  assert.throws(() => parsePersistedCheckoutQuote({ ...v9, version: 10 }));
});

void test('current-user transport contract accepts public user or null', () => {
  assert.ok('CurrentUserResponse' in AuthContracts, 'Missing CurrentUserResponse contract');
  const schema = (AuthContracts as Record<string, unknown>).CurrentUserResponse;
  assert.ok(schema && typeof schema === 'object');
  assert.equal(Value.Check(schema as Parameters<typeof Value.Check>[0], null), true);
  assert.equal(
    Value.Check(schema as Parameters<typeof Value.Check>[0], {
      id: '1',
      email: 'shopper@example.test',
      displayName: 'Shopper',
      role: 'customer',
      country: 'UK',
    }),
    true,
  );
});
