import assert from 'node:assert/strict';
import test from 'node:test';
import type Database from 'better-sqlite3';
import { formatPostalAddress } from '@shop/contracts/address';
import { countryProfile } from '@shop/contracts/country-profiles';
import { CURRENT_PERSISTED_CHECKOUT_QUOTE_VERSION } from '@shop/contracts/payments';
import { MOQ_DEFAULT_SACKS, SACK_WEIGHT_GRAMS } from '@shop/contracts/pricing';
import { calculateLeadTime } from '../../src/features/delivery/deliverySlotRules.js';
import {
  createCheckoutService,
  type CheckoutParams,
} from '../../src/features/checkout/checkoutService.js';
import { createCartRepository } from '../../src/features/cart/cartRepository.js';
import { addItem, createCart } from '../../src/features/cart/cartService.js';
import { openSeededDatabase } from '../support/seededDatabase.js';
import { createUnitOfWork } from '../../src/db/unitOfWork.js';
import { createPromoRepository } from '../../src/features/promos/promoRepository.js';
import {
  createPaymentRepository,
  parsePersistedCheckoutQuote,
} from '../../src/features/payments/paymentRepository.js';
import { createOrderRepository } from '../../src/features/orders/orderRepository.js';
import { createMailboxRepository } from '../../src/features/mailbox/mailboxRepository.js';
import {
  simulatedPaymentGateway,
  type GatewayResult,
  type PaymentGateway,
} from '../../src/features/payments/paymentGateway.js';
import { createProductRepository } from '../../src/features/catalog/productRepository.js';
import { createAuditRepository } from '../../src/features/audit/auditRepository.js';
import { createAuditWriter } from '../../src/features/audit/auditService.js';
import { createInventoryRepository } from '../../src/features/inventory/inventoryRepository.js';
import { createInventoryService } from '../../src/features/inventory/inventoryService.js';
import { createDeliverySiteRepository } from '../../src/features/tradeAccount/deliverySiteRepository.js';
import { createDeliverySiteService } from '../../src/features/tradeAccount/deliverySiteService.js';
import { createBillingEntityRepository } from '../../src/features/tradeAccount/billingEntityRepository.js';
import { createBillingEntityService } from '../../src/features/tradeAccount/billingEntityService.js';
import {
  adhocBilling,
  adhocDestination,
  bookableSlot,
  checkoutDepthDependencies,
  testPostalAddress,
} from './checkoutDepthFixtures.js';

const NOW = new Date('2026-07-27T09:00:00.000Z');
const CLOCK = { now: () => NOW };

function spyGateway(result: GatewayResult = { status: 'success' }): {
  gateway: PaymentGateway;
  calls: () => number;
} {
  let count = 0;
  return {
    gateway: {
      process: () => {
        count += 1;
        return Promise.resolve(result);
      },
    },
    calls: () => count,
  };
}

function checkoutWith(db: Database.Database, gateway: PaymentGateway = simulatedPaymentGateway) {
  return createCheckoutService({
    unitOfWork: createUnitOfWork(db),
    carts: createCartRepository(db),
    promos: createPromoRepository(db),
    payments: createPaymentRepository(db),
    orders: createOrderRepository(db),
    mailbox: createMailboxRepository(db),
    gateway,
    clock: CLOCK,
    products: createProductRepository(db),
    audit: createAuditWriter({ repository: createAuditRepository(db), clock: CLOCK }),
    inventory: createInventoryService({ repository: createInventoryRepository(db) }),
    ...checkoutDepthDependencies(db, CLOCK),
  });
}

function createUser(db: Database.Database, email: string): number {
  return Number(
    db
      .prepare(
        `INSERT INTO users (email, display_name, password_hash, password_salt, role, created_at)
         VALUES (?, 'Depth Test', 'hash', '', 'customer', '2026-07-27T09:00:00.000Z')`,
      )
      .run(email).lastInsertRowid,
  );
}

void test('checkout depth: destination, billing, slot, and buyer reference', async (t) => {
  const { db } = openSeededDatabase(t);

  const carts = createCartRepository(db);
  const unitOfWork = createUnitOfWork(db);
  const sites = createDeliverySiteService({
    repository: createDeliverySiteRepository(db),
    unitOfWork,
    clock: CLOCK,
  });
  const billingEntities = createBillingEntityService({
    repository: createBillingEntityRepository(db),
    unitOfWork,
    clock: CLOCK,
  });

  const buyerId = createUser(db, 'depth-buyer@example.test');
  const otherId = createUser(db, 'depth-other@example.test');

  const savedSite = sites.create(buyerId, {
    label: 'Depth Yard',
    contactName: 'Yard Foreman',
    contactPhone: '01234 567890',
    address: { line1: '9 Wharf Road', city: 'Leeds', postcode: 'ls1 4ap', countryCode: 'GB' },
  });
  assert.equal(savedSite.ok, true);
  const savedSiteId = savedSite.ok ? savedSite.value.id : '0';

  const savedEntity = billingEntities.create(buyerId, {
    legalName: 'Depth Holdings Ltd',
    registrationNumber: '09876543',
    address: { line1: '1 Finance Way', city: 'Leeds', postcode: 'ls2 7ee', countryCode: 'GB' },
  });
  assert.equal(savedEntity.ok, true);
  const savedEntityId = savedEntity.ok ? savedEntity.value.id : '0';

  const otherSite = sites.create(otherId, {
    label: 'Other Yard',
    contactName: 'Other Foreman',
    contactPhone: '01234 000000',
    address: { line1: '2 Other Street', city: 'Hull', postcode: 'hu1 1aa', countryCode: 'GB' },
  });
  assert.equal(otherSite.ok, true);
  const otherSiteId = otherSite.ok ? otherSite.value.id : '0';

  const freshCart = (): string => {
    const { cartId } = createCart(carts);
    const variantId = (
      db
        .prepare('SELECT id FROM product_variants WHERE active = 1 ORDER BY sort_order LIMIT 1')
        .get() as { id: number }
    ).id;
    // One pallet-free MOQ-minimum line: the suite pays many times against one seeded lot, so each
    // cart takes the smallest quantity the variant floor allows.
    addItem(carts, cartId, String(variantId), MOQ_DEFAULT_SACKS);
    return cartId;
  };

  const params = (
    cartId: string,
    idempotencyKey: string,
    userId: number | null,
  ): CheckoutParams => ({
    cartId,
    customerName: 'Depth Buyer',
    customerEmail: 'depth-buyer@example.test',
    deliveryDestination: adhocDestination,
    billingSelection: adhocBilling,
    deliverySlot: bookableSlot(NOW),
    purchaseOrderReference: 'PO-4417',
    cardNumber: '4242 4242 4242 4242',
    cardExpiry: '12/99',
    cardCvc: '123',
    idempotencyKey,
    userId,
    auditContext: {
      actor: userId === null ? { type: 'anonymous', userId: null } : { type: 'user', userId },
      requestId: `request-${idempotencyKey}`,
    },
  });

  /** Reservation rows a failed preparation must not leave behind, scoped to one attempt. */
  const heldReservations = (idempotencyKey: string, cartId: string) => ({
    inventory: (
      db
        .prepare(
          'SELECT COUNT(*) AS total FROM inventory_reservations WHERE payment_idempotency_key = ?',
        )
        .get(idempotencyKey) as { total: number }
    ).total,
    promo: (
      db
        .prepare(
          'SELECT COUNT(*) AS total FROM promo_reservations WHERE payment_idempotency_key = ?',
        )
        .get(idempotencyKey) as { total: number }
    ).total,
    cart: (
      db
        .prepare('SELECT COUNT(*) AS total FROM cart_reservations WHERE cart_id = ?')
        .get(cartId) as { total: number }
    ).total,
  });

  await t.test('a saved site is resolved server-side and a client address is ignored', async () => {
    const cartId = freshCart();
    const result = await checkoutWith(db).process({
      ...params(cartId, '00000000-0000-4000-8000-000000000001', buyerId),
      deliveryDestination: { kind: 'saved', deliverySiteId: savedSiteId },
    });
    assert.equal(result.success, true, JSON.stringify(result));
    if (!result.success) return;

    const expected = {
      line1: '9 Wharf Road',
      city: 'Leeds',
      // Normalised on the way into storage, and read back from there rather than from the request.
      postcode: 'LS1 4AP',
      countryCode: 'GB',
    };
    assert.deepEqual(result.order.deliveryAddress, expected);

    const stored = db
      .prepare('SELECT shipping_address, delivery_site_id FROM orders WHERE id = ?')
      .get(Number(result.order.id)) as {
      shipping_address: string;
      delivery_site_id: number | null;
    };
    assert.equal(stored.shipping_address, formatPostalAddress(expected));
    assert.equal(stored.delivery_site_id, Number(savedSiteId));
  });

  await t.test('an ad-hoc destination persists the submitted address', async () => {
    const cartId = freshCart();
    const result = await checkoutWith(db).process(
      params(cartId, '00000000-0000-4000-8000-000000000002', null),
    );
    assert.equal(result.success, true, JSON.stringify(result));
    if (!result.success) return;
    assert.deepEqual(result.order.deliveryAddress, testPostalAddress);
    assert.deepEqual(result.order.deliverySlot, bookableSlot(NOW));
    assert.equal(result.order.purchaseOrderReference, 'PO-4417');
    assert.deepEqual(result.order.billingEntity, {
      legalName: 'Test Buyer Ltd',
      registrationNumber: null,
      vatNumber: null,
      address: testPostalAddress,
    });
    // An anonymous checkout owns no saved records, so it can never stamp a site reference.
    assert.equal(
      (
        db
          .prepare('SELECT delivery_site_id FROM orders WHERE id = ?')
          .get(Number(result.order.id)) as {
          delivery_site_id: number | null;
        }
      ).delivery_site_id,
      null,
    );
  });

  await t.test("another user's site fails before any reservation", async () => {
    const cartId = freshCart();
    const gateway = spyGateway();
    const key = '00000000-0000-4000-8000-000000000003';
    const result = await checkoutWith(db, gateway.gateway).process({
      ...params(cartId, key, buyerId),
      deliveryDestination: { kind: 'saved', deliverySiteId: otherSiteId },
    });
    assert.deepEqual(result, { success: false, error: 'DELIVERY_SITE_NOT_FOUND' });
    assert.equal(gateway.calls(), 0);
    assert.deepEqual(heldReservations(key, cartId), {
      inventory: 0,
      promo: 0,
      cart: 0,
    });
  });

  await t.test('a retired site is no longer a valid destination', async () => {
    const retired = sites.create(buyerId, {
      label: 'Closed Yard',
      contactName: 'Yard Foreman',
      contactPhone: '01234 567891',
      address: { line1: '3 Closed Road', city: 'Leeds', postcode: 'ls3 1aa', countryCode: 'GB' },
    });
    assert.equal(retired.ok, true);
    const retiredId = retired.ok ? retired.value.id : '0';
    sites.retire(buyerId, Number(retiredId));

    const cartId = freshCart();
    const result = await checkoutWith(db).process({
      ...params(cartId, '00000000-0000-4000-8000-000000000004', buyerId),
      deliveryDestination: { kind: 'saved', deliverySiteId: retiredId },
    });
    assert.deepEqual(result, { success: false, error: 'DELIVERY_SITE_NOT_FOUND' });
  });

  await t.test('anonymous checkout cannot use saved selections', async () => {
    const cartId = freshCart();
    const site = await checkoutWith(db).process({
      ...params(cartId, '00000000-0000-4000-8000-000000000005', null),
      deliveryDestination: { kind: 'saved', deliverySiteId: savedSiteId },
    });
    assert.deepEqual(site, { success: false, error: 'DELIVERY_SITE_NOT_FOUND' });

    const billing = await checkoutWith(db).process({
      ...params(cartId, '00000000-0000-4000-8000-000000000006', null),
      billingSelection: { kind: 'saved', billingEntityId: savedEntityId },
    });
    assert.deepEqual(billing, { success: false, error: 'BILLING_ENTITY_INVALID' });
  });

  await t.test('a saved billing entity is snapshotted without its identifier', async () => {
    const cartId = freshCart();
    const result = await checkoutWith(db).process({
      ...params(cartId, '00000000-0000-4000-8000-000000000007', buyerId),
      billingSelection: { kind: 'saved', billingEntityId: savedEntityId },
    });
    assert.equal(result.success, true, JSON.stringify(result));
    if (!result.success) return;
    assert.deepEqual(result.order.billingEntity, {
      legalName: 'Depth Holdings Ltd',
      registrationNumber: '09876543',
      vatNumber: null,
      address: {
        line1: '1 Finance Way',
        city: 'Leeds',
        postcode: 'LS2 7EE',
        countryCode: 'GB',
      },
    });
  });

  await t.test('an unbookable slot conflicts with no reservation and no gateway call', async () => {
    const cartId = freshCart();
    const gateway = spyGateway();
    const key = '00000000-0000-4000-8000-000000000008';
    const result = await checkoutWith(db, gateway.gateway).process({
      ...params(cartId, key, buyerId),
      // Well before the freight lead time: offered by nobody, so preparation must refuse it.
      deliverySlot: { date: '2026-07-28', window: 'am' },
    });
    assert.equal(result.success, false);
    if (result.success) return;
    assert.equal(result.error, 'DELIVERY_SLOT_UNAVAILABLE');
    // The date reported back is the one derived from this cart's own consignment, not the
    // heavier-cart date the fixture books with.
    assert.equal(
      result.error === 'DELIVERY_SLOT_UNAVAILABLE' ? result.earliestDate : null,
      calculateLeadTime({
        deliverySummary: { mode: 'freight', weightGrams: SACK_WEIGHT_GRAMS * MOQ_DEFAULT_SACKS },
        now: NOW,
        profile: countryProfile('UK'),
      }).earliestDate,
    );
    assert.equal(gateway.calls(), 0);
    assert.deepEqual(heldReservations(key, cartId), {
      inventory: 0,
      promo: 0,
      cart: 0,
    });
    // The failure is audited like every other pre-gateway refusal.
    assert.equal(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS total FROM audit_events
             WHERE action = 'payment.pre_gateway_failed' AND request_id = ?`,
          )
          .get(`request-${key}`) as { total: number }
      ).total,
      1,
    );
  });

  await t.test('one key with a changed commitment is a conflict, never a replay', async () => {
    for (const [suffix, change] of [
      ['slot', { deliverySlot: { date: bookableSlot(NOW).date, window: 'pm' as const } }],
      [
        'address',
        {
          deliveryDestination: {
            kind: 'adhoc' as const,
            address: { ...testPostalAddress, line1: '2 Other Street' },
          },
        },
      ],
      ['billing', { billingSelection: { kind: 'saved' as const, billingEntityId: savedEntityId } }],
      ['po', { purchaseOrderReference: 'PO-9999' }],
    ] as const) {
      const cartId = freshCart();
      const key = `00000000-0000-4000-8000-00000000001${['slot', 'address', 'billing', 'po'].indexOf(suffix)}`;
      const first = await checkoutWith(db).process(params(cartId, key, buyerId));
      assert.equal(first.success, true, `${suffix}: first attempt`);
      const second = await checkoutWith(db).process({
        ...params(cartId, key, buyerId),
        ...change,
      });
      assert.deepEqual(second, { success: false, error: 'IDEMPOTENT_CONFLICT' }, suffix);
    }
  });

  await t.test('one key with a re-typed but equivalent commitment replays', async () => {
    // The fingerprint hashes the same normalised values checkout resolution uses, so casing and
    // whitespace variants of one ad-hoc destination, billed party, or buyer reference are one
    // request.
    const cases = [
      [
        'address casing and spacing',
        {},
        {
          deliveryDestination: {
            kind: 'adhoc' as const,
            address: {
              ...testPostalAddress,
              line1: '  1 Test   Street ',
              postcode: ' ts1  1ts ',
              countryCode: 'gb',
            },
          },
        },
      ],
      [
        'buyer reference spacing',
        { purchaseOrderReference: 'PO 4417' },
        { purchaseOrderReference: '  PO   4417  ' },
      ],
      [
        'billed party casing and spacing',
        {
          billingSelection: {
            kind: 'adhoc' as const,
            billingEntity: {
              legalName: 'Test Buyer Ltd',
              registrationNumber: '09876543',
              address: testPostalAddress,
            },
          },
        },
        {
          billingSelection: {
            kind: 'adhoc' as const,
            billingEntity: {
              legalName: '  Test   Buyer  Ltd ',
              registrationNumber: ' 09876543 ',
              address: {
                ...testPostalAddress,
                line1: ' 1 Test   Street  ',
                postcode: ' ts1  1ts ',
                countryCode: 'gb',
              },
            },
          },
        },
      ],
    ] as const;
    for (const [index, [suffix, first, second]] of cases.entries()) {
      const cartId = freshCart();
      const key = `00000000-0000-4000-8000-00000000003${index}`;
      const original = await checkoutWith(db).process({
        ...params(cartId, key, buyerId),
        ...first,
      });
      assert.equal(original.success, true, `${suffix}: first attempt`);
      const replay = await checkoutWith(db).process({
        ...params(cartId, key, buyerId),
        ...second,
      });
      assert.deepEqual(replay, original, suffix);
    }
  });

  await t.test(
    'the persisted quote is v9 and the confirmation names slot and reference',
    async () => {
      const cartId = freshCart();
      const key = '00000000-0000-4000-8000-000000000020';
      const result = await checkoutWith(db).process(params(cartId, key, buyerId));
      assert.equal(result.success, true, JSON.stringify(result));
      if (!result.success) return;

      const quoteJson = (
        db.prepare('SELECT quote_json FROM payments WHERE idempotency_key = ?').get(key) as {
          quote_json: string;
        }
      ).quote_json;
      const quote = parsePersistedCheckoutQuote(quoteJson);
      assert.equal(quote.version, CURRENT_PERSISTED_CHECKOUT_QUOTE_VERSION);
      assert.equal(quote.discountBaseCents, 0);
      assert.equal(quote.promoCategoryScope, null);
      assert.equal(quote.customer.shippingAddress, formatPostalAddress(testPostalAddress));
      assert.deepEqual(quote.customer.deliveryAddress, testPostalAddress);
      assert.equal(quote.purchaseOrderReference, 'PO-4417');

      const legacyReceipt = db
        .prepare('SELECT subject, body FROM dev_mailbox WHERE kind = ? AND order_id = ? LIMIT 1')
        .get('order_receipt', Number(result.order.id)) as
        { subject: string; body: string } | undefined;
      assert.deepEqual(legacyReceipt, { subject: '', body: '' });

      const receipt = createMailboxRepository(db)
        .list()
        .find((message) => message.kind === 'order_receipt' && message.orderId === result.order.id);
      assert.ok(receipt);
      assert.deepEqual(receipt, {
        id: receipt.id,
        recipient: 'depth-buyer@example.test',
        subject: '',
        body: '',
        created: result.order.createdAt,
        kind: 'order_receipt',
        orderId: result.order.id,
        country: 'UK',
        subtotalCents: result.order.subtotalCents,
        discountCents: result.order.discountCents,
        totalCents: result.order.totalCents,
        deliveryChargeCents: result.order.deliveryChargeCents ?? 0,
        deliverySlot: bookableSlot(NOW),
        purchaseOrderReference: 'PO-4417',
      });
    },
  );

  await t.test('totals for an unchanged cart are unaffected by the new commitments', async () => {
    const cartId = freshCart();
    const withReference = await checkoutWith(db).process(
      params(cartId, '00000000-0000-4000-8000-000000000021', buyerId),
    );
    const bareCartId = freshCart();
    const bare = await checkoutWith(db).process({
      ...params(bareCartId, '00000000-0000-4000-8000-000000000022', buyerId),
      purchaseOrderReference: undefined,
      deliveryDestination: { kind: 'saved', deliverySiteId: savedSiteId },
      billingSelection: { kind: 'saved', billingEntityId: savedEntityId },
    });
    assert.equal(withReference.success && bare.success, true);
    if (!withReference.success || !bare.success) return;
    assert.deepEqual(
      {
        subtotalCents: bare.order.subtotalCents,
        discountCents: bare.order.discountCents,
        totalCents: bare.order.totalCents,
        deliveryChargeCents: bare.order.deliveryChargeCents,
      },
      {
        subtotalCents: withReference.order.subtotalCents,
        discountCents: withReference.order.discountCents,
        totalCents: withReference.order.totalCents,
        deliveryChargeCents: withReference.order.deliveryChargeCents,
      },
    );
  });
});
