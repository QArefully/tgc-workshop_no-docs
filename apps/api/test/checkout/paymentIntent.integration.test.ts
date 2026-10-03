import assert from 'node:assert/strict';
import test from 'node:test';
import { openSeededDatabase } from '../support/seededDatabase.js';
import { createCartRepository } from '../../src/features/cart/cartRepository.js';
import {
  addItem,
  createCart,
  removeItem,
  updateItem,
} from '../../src/features/cart/cartService.js';
import {
  createPaymentRepository,
  createSafeFingerprint,
  parsePersistedCheckoutQuote,
  type SafeFingerprintParams,
  type PersistedCheckoutQuote,
} from '../../src/features/payments/paymentRepository.js';
import { createPromoRepository } from '../../src/features/promos/promoRepository.js';
import { validatePromo } from '../../src/features/promos/promoService.js';
import { testPostalAddress } from './checkoutDepthFixtures.js';

const createdAt = '2026-07-14T10:00:00.000Z';

const fingerprintParams = (
  overrides: Partial<SafeFingerprintParams> = {},
): SafeFingerprintParams => ({
  cartId: '00000000-0000-4000-8000-000000000061',
  customerName: 'Checkout test',
  customerEmail: 'checkout@example.test',
  deliveryDestination: { kind: 'adhoc', address: testPostalAddress },
  billingSelection: {
    kind: 'adhoc',
    billingEntity: { legalName: 'Test Buyer Ltd', address: testPostalAddress },
  },
  deliverySlot: { date: '2026-07-20', window: 'am' },
  cardExpiry: '12/30',
  ...overrides,
});

function quote(cartId: string, totalCents = 1200): PersistedCheckoutQuote {
  return {
    version: 8,
    cartId,
    customer: {
      name: 'Checkout test',
      email: 'checkout@example.test',
      deliveryAddress: testPostalAddress,
      shippingAddress: '1 Test Street, Testville, TS1 1TS, GB',
    },
    userId: null,
    promoCode: null,
    subtotalCents: totalCents,
    discountBaseCents: 0,
    promoCategoryScope: null,
    discountCents: 0,
    totalCents,
    lines: [],
    variantLines: [
      {
        productId: '1',
        variantId: 1,
        productName: 'Test product',
        variantLabel: '25 kg sack',
        unitPriceCents: totalCents,
        weightGrams: 25_000,
        deliveryClass: 'freight',
        quantity: 1,
        lineTotalCents: totalCents,
        consumptionClassification: 'non-food',
      },
    ],
    deliverySummary: {
      mode: 'freight',
      chargeCents: 0,
      weightGrams: 25_000,
      reason: 'A freight-class item requires freight delivery',
    },
    inventoryAllocations: [{ productId: '1', reservedQuantity: 1, backorderedQuantity: 0 }],
    billingEntity: {
      legalName: 'Test Buyer Ltd',
      registrationNumber: null,
      vatNumber: null,
      address: testPostalAddress,
    },
    deliverySlot: { date: '2026-07-20', window: 'am' },
    purchaseOrderReference: null,
    createdAt,
  };
}

void test('payment intent persistence, cart reservations, and promo reservations', (t) => {
  const { db } = openSeededDatabase(t);

  const carts = createCartRepository(db);
  const payments = createPaymentRepository(db);
  const promos = createPromoRepository(db);
  const firstCart = createCart(carts).cartId;
  const secondCart = createCart(carts).cartId;
  const thirdCart = createCart(carts).cartId;
  addItem(carts, firstCart, '1');
  addItem(carts, secondCart, '1');
  addItem(carts, thirdCart, '1');

  const reserve = (idempotencyKey: string, cartId: string) => {
    const payment = payments.reservePreGateway({
      idempotencyKey,
      fingerprint: `fingerprint-${idempotencyKey}`,
      card: { last4: '4242', brand: 'Visa' },
      createdAt,
    });
    if (payment.reserved) {
      assert.equal(
        payments.persistQuote({
          idempotencyKey,
          cartId,
          quote: quote(cartId),
          updatedAt: createdAt,
          reservationExpiresAt: '2026-07-14T10:15:00.000Z',
        }),
        true,
      );
    }
    return payment;
  };

  const first = reserve('intent-1', firstCart);
  assert.deepEqual(first, { reserved: true });
  assert.deepEqual(
    payments.reservePreGateway({
      idempotencyKey: 'unsafe-intent',
      fingerprint: 'safe-fingerprint',
      card: { last4: '4242', brand: 'Visa' },
      createdAt,
    }),
    { reserved: true },
  );
  assert.throws(
    () =>
      payments.persistQuote({
        idempotencyKey: 'unsafe-intent',
        cartId: firstCart,
        quote: {
          ...quote(firstCart),
          cardNumber: '4242424242424242',
          cardCvc: '123',
        } as unknown as PersistedCheckoutQuote,
        updatedAt: createdAt,
        reservationExpiresAt: '2026-07-14T10:15:00.000Z',
      }),
    /Invalid persisted checkout quote/,
  );
  assert.equal(payments.load('unsafe-intent')?.quoteJson, null);
  const stored = payments.load('intent-1');
  assert.equal(typeof stored?.id, 'number');
  assert.equal(Number.isSafeInteger(stored?.id), true);
  assert.equal(stored?.status, 'prepared');
  assert.equal(stored?.cartId, firstCart);
  assert.equal(stored?.quoteJson?.includes('4242424242424242'), false);
  assert.equal(stored?.quoteJson?.includes('123'), false);
  assert.equal(
    payments.transition({
      idempotencyKey: 'intent-1',
      expectedStatus: 'prepared',
      nextStatus: 'authorized_pending_finalize',
      gatewayReference: 'sim_intent-1',
      updatedAt: createdAt,
    }),
    true,
  );
  assert.equal(
    payments.transition({
      idempotencyKey: 'intent-1',
      expectedStatus: 'prepared',
      nextStatus: 'succeeded',
      updatedAt: createdAt,
    }),
    false,
  );

  assert.equal(carts.reserve(firstCart, 'intent-1', createdAt), true);
  assert.equal(carts.reserve(firstCart, 'intent-2', createdAt), false);
  assert.equal(addItem(carts, firstCart, '2'), 'CART_RESERVED');
  assert.equal(updateItem(carts, firstCart, '1', 2), 'CART_RESERVED');
  assert.equal(removeItem(carts, firstCart, '1'), 'CART_RESERVED');
  assert.equal(carts.releaseReservation('intent-1'), true);
  assert.notEqual(addItem(carts, firstCart, '2'), 'CART_RESERVED');

  reserve('intent-2', secondCart);
  db.prepare("UPDATE promo_codes SET max_redemptions = 1 WHERE code = 'SAVE10'").run();
  assert.equal(
    promos.reserve({
      code: 'SAVE10',
      userId: null,
      paymentIdempotencyKey: 'intent-2',
      createdAt,
    }),
    true,
  );
  assert.equal(promos.activeReservationCount('SAVE10'), 1);
  assert.equal(
    validatePromo(
      { code: 'SAVE10', cartId: secondCart, userId: null, now: new Date(createdAt) },
      { carts, promos },
    ).errorCode,
    'USAGE_LIMIT',
  );
  assert.equal(promos.releaseReservation('intent-2'), true);
  assert.notEqual(
    validatePromo(
      { code: 'SAVE10', cartId: secondCart, userId: null, now: new Date(createdAt) },
      { carts, promos },
    ).errorCode,
    'USAGE_LIMIT',
  );

  reserve('intent-3', thirdCart);
  assert.equal(
    promos.reserve({
      code: 'WELCOME5',
      userId: 1,
      paymentIdempotencyKey: 'intent-3',
      createdAt,
    }),
    true,
  );
  assert.equal(promos.activeReservationCountForUser('WELCOME5', 1), 1);
  assert.equal(
    validatePromo(
      { code: 'WELCOME5', cartId: thirdCart, userId: 1, now: new Date(createdAt) },
      { carts, promos },
    ).errorCode,
    'USAGE_LIMIT',
  );
  const orderId = Number(
    db
      .prepare(
        `INSERT INTO orders
          (customer_name, customer_email, shipping_address, subtotal_cents, discount_cents, total_cents)
         VALUES ('Promo test', 'promo@example.test', '1 Test Street', 1200, 500, 700)`,
      )
      .run().lastInsertRowid,
  );
  assert.equal(promos.commitReservation({ paymentIdempotencyKey: 'intent-3', orderId }), true);
  assert.equal(promos.activeReservationCountForUser('WELCOME5', 1), 0);
});

void test('persisted checkout quotes reject malformed and unknown-version data', () => {
  assert.throws(() => parsePersistedCheckoutQuote('{'), /Invalid persisted checkout quote/);
  assert.throws(
    () => parsePersistedCheckoutQuote(JSON.stringify({ ...quote('cart'), version: 2 })),
    /Invalid persisted checkout quote/,
  );
});

void test('method-aware reservations persist conditional card and company metadata', (t) => {
  const { db } = openSeededDatabase(t);
  const payments = createPaymentRepository(db);
  const companyId = (db
    .prepare('SELECT id FROM company_accounts ORDER BY id LIMIT 1')
    .pluck()
    .get() ?? 0) as number;
  assert.ok(companyId > 0);

  const card = payments.reservePreGateway({
    idempotencyKey: '00000000-0000-4000-8000-000000000062',
    fingerprint: 'card-fingerprint',
    card: { last4: '4242', brand: 'Visa' },
    createdAt,
  });
  assert.deepEqual(card, { reserved: true });
  const cardRecord = payments.load('00000000-0000-4000-8000-000000000062');
  assert.equal(cardRecord?.paymentMethod, 'card');
  assert.equal(cardRecord?.companyId, null);
  assert.equal(cardRecord?.userId, null);
  assert.equal(cardRecord?.cardLast4, '4242');
  assert.equal(cardRecord?.cardBrand, 'Visa');

  const creditKey = '00000000-0000-4000-8000-000000000063';
  assert.deepEqual(
    payments.reservePreGateway({
      idempotencyKey: creditKey,
      fingerprint: 'credit-fingerprint',
      paymentMethod: 'trade_credit',
      companyId,
      userId: 1,
      createdAt,
    }),
    { reserved: true },
  );
  const creditRecord = payments.load(creditKey);
  assert.equal(creditRecord?.paymentMethod, 'trade_credit');
  assert.equal(creditRecord?.companyId, companyId);
  assert.equal(creditRecord?.userId, 1);
  assert.equal(creditRecord?.cardLast4, null);
  assert.equal(creditRecord?.cardBrand, null);
});

void test('omitted and explicit card fingerprints retain legacy normalization while credit binds identity', () => {
  const card = { last4: '4242', brand: 'Visa' } as const;
  const omitted = createSafeFingerprint(fingerprintParams({ userId: null }), card);
  const explicit = createSafeFingerprint(
    fingerprintParams({ paymentMethod: 'card', userId: null }),
    card,
  );
  assert.equal(explicit, omitted);
  assert.equal(
    createSafeFingerprint(fingerprintParams({ userId: 7 }), card),
    createSafeFingerprint(fingerprintParams({ paymentMethod: 'card', userId: 8 }), card),
    'authenticated legacy card retries must not add buyer identity to the digest',
  );

  const credit = createSafeFingerprint(
    fingerprintParams({
      paymentMethod: 'trade_credit',
      userId: '7',
      companyId: '11',
      cardExpiry: undefined,
    }),
  );
  assert.notEqual(
    credit,
    createSafeFingerprint(
      fingerprintParams({
        paymentMethod: 'trade_credit',
        userId: '8',
        companyId: '11',
        cardExpiry: undefined,
      }),
    ),
  );
  assert.notEqual(
    credit,
    createSafeFingerprint(
      fingerprintParams({ paymentMethod: 'card', userId: 7, cardExpiry: '12/30' }),
      card,
    ),
  );
  assert.throws(
    () =>
      createSafeFingerprint(
        fingerprintParams({
          paymentMethod: 'trade_credit',
          userId: 7,
          companyId: 11,
          cardExpiry: undefined,
        }),
        { last4: '4242', brand: 'Visa' },
      ),
    /cannot include card metadata/,
  );
});

void test('quote persistence rejects changed method/company and malformed conditional rows', (t) => {
  const { db } = openSeededDatabase(t);
  const payments = createPaymentRepository(db);
  const companyId = (db
    .prepare('SELECT id FROM company_accounts ORDER BY id LIMIT 1')
    .pluck()
    .get() ?? 0) as number;
  assert.ok(companyId > 0);
  const key = '00000000-0000-4000-8000-000000000064';
  payments.reservePreGateway({
    idempotencyKey: key,
    fingerprint: 'credit-fingerprint',
    paymentMethod: 'trade_credit',
    companyId,
    userId: 1,
    createdAt,
  });
  const baseCreditQuote = quote('00000000-0000-4000-8000-000000000065', 1200);
  const creditQuote = {
    ...baseCreditQuote,
    // V10 freezes the catalogue SKU; keep the fixture schema-valid so binding assertions run.
    variantLines: baseCreditQuote.variantLines.map((line) => ({
      ...line,
      sku: 'BKP-0001-001',
    })),
    version: 10,
    userId: 1,
    companyId: String(companyId),
    country: 'UK' as const,
    paymentMethod: 'trade_credit' as const,
    netCents: 1200,
    vatRateBasisPoints: 2000,
    vatCents: 240,
    grossCents: 1440,
    totalCents: 1440,
    terms: 'net_30' as const,
  } as unknown as PersistedCheckoutQuote;
  assert.throws(
    () =>
      payments.persistQuote({
        idempotencyKey: key,
        cartId: creditQuote.cartId,
        quote: creditQuote,
        updatedAt: createdAt,
        reservationExpiresAt: '2026-07-14T10:15:00.000Z',
        companyId: companyId + 1,
        userId: 1,
      }),
    /does not match payment reservation/,
  );

  assert.throws(
    () =>
      payments.persistQuote({
        idempotencyKey: key,
        cartId: creditQuote.cartId,
        quote: creditQuote,
        updatedAt: createdAt,
        reservationExpiresAt: '2026-07-14T10:15:00.000Z',
      }),
    /user must be bound to payment reservation/,
  );
  assert.throws(
    () =>
      payments.persistQuote({
        idempotencyKey: key,
        cartId: creditQuote.cartId,
        quote: creditQuote,
        updatedAt: createdAt,
        reservationExpiresAt: '2026-07-14T10:15:00.000Z',
        userId: 2,
      }),
    /does not match payment reservation/,
  );

  db.pragma('ignore_check_constraints = ON');
  db.prepare(
    `UPDATE payments SET payment_method = 'trade_credit', company_id = ?, card_last4 = '4242', card_brand = 'Visa'
     WHERE idempotency_key = ?`,
  ).run(companyId, key);
  db.pragma('ignore_check_constraints = OFF');
  assert.throws(() => payments.load(key), /Invalid persisted payment intent/);
});

void test('credit quote persistence binds the quote buyer to the stored reservation buyer', (t) => {
  const { db } = openSeededDatabase(t);
  const payments = createPaymentRepository(db);
  const companyId = (db
    .prepare('SELECT id FROM company_accounts ORDER BY id LIMIT 1')
    .pluck()
    .get() ?? 0) as number;
  assert.ok(companyId > 0);

  const key = '00000000-0000-4000-8000-000000000066';
  payments.reservePreGateway({
    idempotencyKey: key,
    fingerprint: 'credit-buyer-a-fingerprint',
    paymentMethod: 'trade_credit',
    companyId,
    userId: 1,
    createdAt,
  });
  const baseQuoteForBuyerB = quote('00000000-0000-4000-8000-000000000067', 1200);
  const quoteForBuyerB = {
    ...baseQuoteForBuyerB,
    // V10 freezes the catalogue SKU; keep the fixture schema-valid so buyer binding is tested.
    variantLines: baseQuoteForBuyerB.variantLines.map((line) => ({
      ...line,
      sku: 'BKP-0001-001',
    })),
    version: 10,
    userId: 2,
    companyId: String(companyId),
    country: 'UK' as const,
    paymentMethod: 'trade_credit' as const,
    netCents: 1200,
    vatRateBasisPoints: 2000,
    vatCents: 240,
    grossCents: 1440,
    totalCents: 1440,
    terms: 'net_30' as const,
  } as unknown as PersistedCheckoutQuote;

  assert.throws(
    () =>
      payments.persistQuote({
        idempotencyKey: key,
        cartId: quoteForBuyerB.cartId,
        quote: quoteForBuyerB,
        updatedAt: createdAt,
        reservationExpiresAt: '2026-07-14T10:15:00.000Z',
        paymentMethod: 'trade_credit',
        companyId,
        // The caller assertion agrees with the quote, but not with the stored reservation.
        userId: 2,
      }),
    /does not match payment reservation/,
  );
  assert.equal(payments.load(key)?.quoteJson, null);
});

void test('trade-credit reservations require a positive authenticated user', (t) => {
  const { db } = openSeededDatabase(t);
  const payments = createPaymentRepository(db);
  const companyId = (db
    .prepare('SELECT id FROM company_accounts ORDER BY id LIMIT 1')
    .pluck()
    .get() ?? 0) as number;
  assert.ok(companyId > 0);
  for (const userId of [undefined, null, 0, '0', -1] as const) {
    assert.throws(
      () =>
        payments.reservePreGateway({
          idempotencyKey: `00000000-0000-4000-8000-${String(70 + (userId ?? 0)).padStart(12, '0')}`,
          fingerprint: 'credit-fingerprint',
          paymentMethod: 'trade_credit',
          companyId,
          userId,
          createdAt,
        }),
      /(?:authenticated user|Invalid payment user)/,
    );
  }
});
